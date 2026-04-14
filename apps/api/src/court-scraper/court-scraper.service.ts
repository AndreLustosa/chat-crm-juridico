import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EsajTjalScraper,
  CourtCaseData,
  CourtCaseListItem,
  CourtCaseListResult,
} from './scrapers/esaj-tjal.scraper';

// ─── Interfaces ──────────────────────────────────────────────

interface TribunalScraper {
  searchByNumber(caseNumber: string): Promise<CourtCaseData | null>;
  searchByOAB(oabNumber: string, oabUf?: string): Promise<CourtCaseListResult>;
  fetchCaseDetail(processoCodigo: string, foro: string, cookie: string): Promise<CourtCaseData | null>;
}

export interface MultiOabResult {
  cases: Array<CourtCaseListItem & {
    found_by_oabs: string[];      // OABs que encontraram este processo
    found_by_lawyers: string[];   // Nomes dos advogados
    already_registered: boolean;  // Já cadastrado no sistema
    existing_case_id?: string;    // ID se já cadastrado
  }>;
  totalByOab: Record<string, number>;
}

// ─── Mapa de Tribunais ───────────────────────────────────────

const TRIBUNAL_MAP: Record<string, { name: string; type: 'esaj' | 'pje' }> = {
  '8.02': { name: 'TJAL', type: 'esaj' },
  // Extensível:
  // '5.19': { name: 'TRT19', type: 'pje' },
  // '8.26': { name: 'TJSP', type: 'esaj' },
  // '8.19': { name: 'TJRJ', type: 'esaj' },
};

// ─── Service ─────────────────────────────────────────────────

@Injectable()
export class CourtScraperService {
  private readonly logger = new Logger(CourtScraperService.name);
  private readonly scrapers: Record<string, TribunalScraper> = {};

  constructor(private prisma: PrismaService) {
    // Registrar scrapers disponíveis
    this.scrapers['8.02'] = new EsajTjalScraper();
  }

  // ─── Helpers ─────────────────────────────────────────────

  /** Parseia o CNJ e retorna J.TR para identificar tribunal */
  private parseTribunalKey(caseNumber: string): string {
    const digits = caseNumber.replace(/\D/g, '');
    if (digits.length !== 20) {
      throw new BadRequestException(
        `Número de processo inválido: esperados 20 dígitos, recebidos ${digits.length}. Formato CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO`,
      );
    }
    const j = digits[13];   // Justiça
    const tr = digits.slice(14, 16); // Tribunal Regional
    return `${j}.${tr}`;
  }

  private getScraper(tribunalKey: string): TribunalScraper {
    const scraper = this.scrapers[tribunalKey];
    if (!scraper) {
      const supported = Object.entries(TRIBUNAL_MAP)
        .map(([k, v]) => `${v.name} (${k})`)
        .join(', ');
      throw new BadRequestException(
        `Tribunal não suportado: ${tribunalKey}. Tribunais disponíveis: ${supported || 'nenhum'}`,
      );
    }
    return scraper;
  }

  // ─── Busca por Número ────────────────────────────────────

  async searchByNumber(caseNumber: string): Promise<{
    found: boolean;
    already_registered: boolean;
    existing_case_id?: string;
    data?: CourtCaseData;
    tribunal?: string;
  }> {
    const digits = caseNumber.replace(/\D/g, '');
    const tribunalKey = this.parseTribunalKey(digits);
    const tribunal = TRIBUNAL_MAP[tribunalKey];

    // Verificar se já está cadastrado localmente
    const existing = await this.prisma.legalCase.findFirst({
      where: {
        OR: [
          { case_number: caseNumber },
          { case_number: digits },
          { case_number: { contains: digits.slice(0, 13) } },
        ],
      },
      select: { id: true, case_number: true },
    });

    if (existing) {
      return {
        found: true,
        already_registered: true,
        existing_case_id: existing.id,
        tribunal: tribunal?.name,
      };
    }

    // Scrape do tribunal
    const scraper = this.getScraper(tribunalKey);

    try {
      const data = await scraper.searchByNumber(digits);
      if (!data) {
        return { found: false, already_registered: false, tribunal: tribunal?.name };
      }
      return {
        found: true,
        already_registered: false,
        data,
        tribunal: tribunal?.name,
      };
    } catch (error: any) {
      this.logger.error(`[SEARCH] Erro ao consultar ${tribunal?.name}: ${error.message}`);
      throw new BadRequestException(
        `Erro ao consultar ${tribunal?.name || 'tribunal'}: ${error.message}`,
      );
    }
  }

  // ─── Busca por OAB (múltiplas) ───────────────────────────

  async searchByOABs(
    oabEntries: Array<{ number: string; uf: string }>,
    tenantId?: string,
  ): Promise<MultiOabResult> {
    if (!oabEntries.length) {
      throw new BadRequestException('Informe ao menos uma OAB');
    }

    const oabNumbers = oabEntries.map(e => e.number);

    // Buscar nomes dos advogados para cada OAB
    const lawyers = await this.prisma.user.findMany({
      where: {
        oab_number: { in: oabNumbers },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      select: { oab_number: true, name: true },
    });
    const oabToName = new Map(lawyers.map(l => [l.oab_number!, l.name]));

    // Por enquanto, só temos ESAJ TJAL — buscar em cada OAB
    const scraper = this.scrapers['8.02'] as EsajTjalScraper;
    if (!scraper) {
      throw new BadRequestException('Nenhum scraper disponível');
    }

    const allCases = new Map<string, CourtCaseListItem & {
      found_by_oabs: string[];
      found_by_lawyers: string[];
    }>();
    const totalByOab: Record<string, number> = {};

    for (const entry of oabEntries) {
      const oab = entry.number;
      const uf = entry.uf || 'AL';
      try {
        this.logger.log(`[OAB-MULTI] Buscando OAB ${oab}/${uf} (${oabToName.get(oab) || 'Avulsa'})...`);
        const result = await scraper.searchByOAB(oab, uf);
        totalByOab[oab] = result.cases.length;

        for (const c of result.cases) {
          const key = c.case_number.replace(/\D/g, '');
          if (allCases.has(key)) {
            const existing = allCases.get(key)!;
            if (!existing.found_by_oabs.includes(oab)) {
              existing.found_by_oabs.push(oab);
              existing.found_by_lawyers.push(oabToName.get(oab) || oab);
            }
          } else {
            allCases.set(key, {
              ...c,
              found_by_oabs: [oab],
              found_by_lawyers: [oabToName.get(oab) || oab],
            });
          }
        }

        // Delay entre OABs para não sobrecarregar
        if (oabEntries.indexOf(entry) < oabEntries.length - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (error: any) {
        this.logger.warn(`[OAB-MULTI] Erro ao buscar OAB ${oab}: ${error.message}`);
        totalByOab[oab] = 0;
      }
    }

    // Verificar quais já estão cadastrados
    const caseNumbers = Array.from(allCases.keys());
    const existingCases = caseNumbers.length > 0
      ? await this.prisma.legalCase.findMany({
          where: {
            OR: caseNumbers.map(digits => ({
              case_number: { contains: digits.slice(0, 13) },
            })),
          },
          select: { id: true, case_number: true },
        })
      : [];

    const registeredSet = new Set(
      existingCases.map(c => (c.case_number || '').replace(/\D/g, '')),
    );

    const cases = Array.from(allCases.values()).map(c => {
      const digits = c.case_number.replace(/\D/g, '');
      const matchedExisting = existingCases.find(
        e => (e.case_number || '').replace(/\D/g, '').includes(digits.slice(0, 13)),
      );
      return {
        ...c,
        already_registered: registeredSet.has(digits) || !!matchedExisting,
        existing_case_id: matchedExisting?.id,
      };
    });

    this.logger.log(
      `[OAB-MULTI] Total: ${cases.length} processos unicos, ${cases.filter(c => c.already_registered).length} ja cadastrados`,
    );

    return { cases, totalByOab };
  }

  // ─── Importar processos em lote ──────────────────────────

  async importCases(
    items: Array<{ processo_codigo: string; foro: string; lawyer_id?: string }>,
    tenantId?: string,
    actorId?: string,
  ): Promise<{ imported: number; errors: string[] }> {
    const scraper = this.scrapers['8.02'] as EsajTjalScraper;
    if (!scraper) throw new BadRequestException('Scraper não disponível');

    // Inicializar sessão uma vez
    const cookie = await (scraper as any).initSession();
    const imported: string[] = [];
    const errors: string[] = [];

    for (const item of items) {
      try {
        await new Promise(r => setTimeout(r, 2500)); // Rate limit
        const data = await scraper.fetchCaseDetail(item.processo_codigo, item.foro, cookie);

        if (!data) {
          errors.push(`Processo ${item.processo_codigo}: dados não encontrados`);
          continue;
        }

        // Verificar se já existe
        const digits = data.case_number.replace(/\D/g, '');
        const existing = await this.prisma.legalCase.findFirst({
          where: { case_number: { contains: digits.slice(0, 13) } },
        });
        if (existing) {
          errors.push(`${data.case_number}: já cadastrado`);
          continue;
        }

        // Extrair parte contrária (primeiro Réu)
        const opposingParty = data.parties
          .filter(p => /r[eé]u|requerido|executado/i.test(p.role))
          .map(p => p.name)
          .join(', ');

        // Extrair autor (possível cliente)
        const author = data.parties
          .find(p => /autor|requerente|exequente|reclamante/i.test(p.role));

        // Montar notas com assunto e partes
        const notesLines = [
          data.subject ? `Assunto: ${data.subject}` : '',
          data.status ? `Status ESAJ: ${data.status}` : '',
          ...data.parties.slice(0, 6).map(p => `${p.role}: ${p.name}`),
        ].filter(Boolean);

        // Definir lawyer_id: passado explicitamente ou o primeiro advogado ADMIN
        let lawyerId = item.lawyer_id;
        if (!lawyerId) {
          const firstLawyer = await this.prisma.user.findFirst({
            where: {
              roles: { hasSome: ['ADVOGADO', 'Advogados', 'ADMIN'] },
              ...(tenantId ? { tenant_id: tenantId } : {}),
            },
            select: { id: true },
          });
          lawyerId = firstLawyer?.id;
        }

        if (!lawyerId) {
          errors.push(`${data.case_number}: nenhum advogado encontrado`);
          continue;
        }

        // Criar lead a partir do autor (se houver)
        let leadId: string | undefined;
        if (author) {
          // Buscar lead por nome
          const existingLead = await this.prisma.lead.findFirst({
            where: {
              name: { contains: author.name.split(' ')[0], mode: 'insensitive' },
              ...(tenantId ? { tenant_id: tenantId } : {}),
            },
            select: { id: true },
          });
          leadId = existingLead?.id;
        }

        // Se não encontrou lead, criar placeholder
        if (!leadId) {
          const lead = await this.prisma.lead.create({
            data: {
              tenant_id: tenantId || null,
              name: author?.name || 'Cliente - ' + data.case_number,
              phone: `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              origin: 'ESAJ_IMPORT',
              stage: 'FINALIZADO',
            },
          });
          leadId = lead.id;
        }

        // Criar legal case
        await this.prisma.legalCase.create({
          data: {
            tenant_id: tenantId || null,
            lead_id: leadId,
            lawyer_id: lawyerId,
            case_number: data.case_number,
            legal_area: data.legal_area || null,
            action_type: data.action_type || null,
            opposing_party: opposingParty || null,
            court: data.court || null,
            judge: data.judge || null,
            claim_value: data.claim_value || null,
            tracking_stage: data.tracking_stage || 'DISTRIBUIDO',
            stage: 'ACOMPANHAMENTO',
            priority: 'NORMAL',
            notes: notesLines.join('\n'),
            filed_at: data.filed_at ? new Date(data.filed_at) : null,
          },
        });

        imported.push(data.case_number);
        this.logger.log(`[IMPORT] Processo ${data.case_number} importado com sucesso`);
      } catch (error: any) {
        errors.push(`${item.processo_codigo}: ${error.message}`);
        this.logger.warn(`[IMPORT] Erro: ${error.message}`);
      }
    }

    return { imported: imported.length, errors };
  }

  // ─── Listar advogados com OAB ────────────────────────────

  async getLawyersWithOAB(tenantId?: string) {
    return this.prisma.user.findMany({
      where: {
        roles: { hasSome: ['ADVOGADO', 'Advogados', 'ADMIN'] },
        oab_number: { not: null },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      select: {
        id: true,
        name: true,
        oab_number: true,
        oab_uf: true,
      },
    });
  }
}
