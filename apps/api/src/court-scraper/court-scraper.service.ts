import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  EsajTjalScraper,
  CourtCaseData,
  CourtCaseListItem,
  CourtCaseListResult,
} from './scrapers/esaj-tjal.scraper';

// Converte data no formato "dd/mm/yyyy" (como o e-SAJ retorna) para Date.
// Retorna null se a string nao parse. Hora fixa em 12:00 UTC para evitar
// offsets de timezone.
function parseEsajDate(dateStr: string): Date | null {
  const m = dateStr?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`);
}

// Gera hash SHA256(case_number|date|description) para dedup idempotente de
// movimentacoes. Se o mesmo processo for re-scraped, as movimentacoes ja
// salvas sao ignoradas (unique constraint em CaseEvent.movement_hash).
function makeMovementHash(caseNumber: string, date: string, description: string): string {
  return createHash('sha256')
    .update(`${caseNumber}|${date}|${description}`)
    .digest('hex');
}

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

    // Scrape do tribunal. IMPORTANTE: sempre rodamos o scraper, mesmo quando o
    // processo ja esta cadastrado localmente. O modal de cadastro em lote usa
    // este endpoint para pre-preencher campos (autor, reu, classe, vara etc.);
    // se retornassemos cedo quando existing=true, o frontend receberia uma
    // resposta sem `data` e o modal abriria com todos os campos vazios.
    const scraper = this.getScraper(tribunalKey);
    let scraped: CourtCaseData | null = null;
    try {
      scraped = await scraper.searchByNumber(digits);
    } catch (error: any) {
      this.logger.error(`[SEARCH] Erro ao consultar ${tribunal?.name}: ${error.message}`);
      // Se o processo ja existe localmente, ainda conseguimos devolver uma
      // resposta util (o frontend pode alertar "ja cadastrado"). Caso contrario,
      // propagamos o erro para o usuario.
      if (existing) {
        return {
          found: true,
          already_registered: true,
          existing_case_id: existing.id,
          tribunal: tribunal?.name,
        };
      }
      throw new BadRequestException(
        `Erro ao consultar ${tribunal?.name || 'tribunal'}: ${error.message}`,
      );
    }

    if (existing) {
      return {
        found: true,
        already_registered: true,
        existing_case_id: existing.id,
        data: scraped || undefined,
        tribunal: tribunal?.name,
      };
    }

    if (!scraped) {
      return { found: false, already_registered: false, tribunal: tribunal?.name };
    }

    return {
      found: true,
      already_registered: false,
      data: scraped,
      tribunal: tribunal?.name,
    };
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

    // Verificar quais já estão cadastrados.
    // IMPORTANTE: o banco tem mistura de formatos (alguns processos foram
    // salvos com mascara formatada "0707175-85.2026.8.02.0058", outros como
    // digits-only "07071758520268020058"). A query antiga usava apenas
    // `contains: digits.slice(0,13)`, que e um substring literal do Postgres
    // e NAO casa com formatos mascarados (os 13 digitos nunca aparecem
    // contiguos em "0707175-85.2026.8...").
    //
    // Fix: tentar casar tanto o formato digits-only quanto o formatado (e
    // manter o contains como fallback para outros formatos esdruxulos).
    // O filtro final em JS normaliza ambos os lados para digits-only, entao
    // falsos positivos do contains sao descartados.
    const caseNumbers = Array.from(allCases.keys()); // digits-only (20 digits)

    const formatCnj = (d: string): string => {
      if (d.length !== 20) return d;
      return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
    };

    const orConditions = caseNumbers.flatMap(digits => {
      const formatted = formatCnj(digits);
      const conditions: any[] = [
        { case_number: digits },       // banco em digits-only
        { case_number: formatted },    // banco com mascara formatada
        { case_number: { contains: digits.slice(0, 13) } }, // fallback
      ];
      return conditions;
    });

    const existingCases = orConditions.length > 0
      ? await this.prisma.legalCase.findMany({
          where: { OR: orConditions },
          select: { id: true, case_number: true },
        })
      : [];

    // Normaliza chaves dos existentes para comparacao robusta (digits-only)
    const existingById = new Map<string, string>(
      existingCases.map(c => [(c.case_number || '').replace(/\D/g, ''), c.id]),
    );

    const cases = Array.from(allCases.values()).map(c => {
      const digits = c.case_number.replace(/\D/g, '');
      const existingId = existingById.get(digits);
      return {
        ...c,
        already_registered: !!existingId,
        existing_case_id: existingId,
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
        const legalCase = await this.prisma.legalCase.create({
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

        // Persistir movimentacoes como CaseEvent (type=MOVIMENTACAO, source=ESAJ).
        //
        // Atualizado em 2026-04-20: antes as movimentacoes extraidas pelo scraper
        // eram descartadas. Agora sao salvas em batch, com movement_hash (dedup
        // idempotente para re-scrape futuro). Prepara o caminho para UI timeline
        // + cron de re-sync periodico.
        if (data.movements && data.movements.length > 0) {
          const movementRows = data.movements.map((m) => ({
            case_id: legalCase.id,
            type: 'MOVIMENTACAO',
            source: 'ESAJ',
            title: m.description.slice(0, 120), // primeiros 120 chars como titulo
            description: m.description,
            event_date: parseEsajDate(m.date),
            movement_hash: makeMovementHash(data.case_number, m.date, m.description),
            source_raw: { raw_date: m.date, raw_description: m.description } as any,
          }));
          // createMany com skipDuplicates garante idempotencia — se o hash ja
          // existir (re-scrape posterior), row e ignorada silenciosamente.
          const createResult = await this.prisma.caseEvent.createMany({
            data: movementRows,
            skipDuplicates: true,
          });
          this.logger.log(
            `[IMPORT] Processo ${data.case_number}: ${createResult.count}/${data.movements.length} movimentacoes salvas (resto ja existia)`,
          );
        }

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
