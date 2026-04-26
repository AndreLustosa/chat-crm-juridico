import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { EsajTjalScraper, MovementData } from '../court-scraper/scrapers/esaj-tjal.scraper';
import { createHash } from 'crypto';

/**
 * Busca documento de processo automaticamente — primeiro no CaseDocument
 * existente, fallback pra scraping do TJAL.
 *
 * Limitacao conhecida (André, 2026-04-26): so funciona pra TJAL e apenas
 * pra documentos publicos. Sigilosos exigem certificado digital do
 * advogado, fora do escopo automatico.
 *
 * Quando scraping falha, retorna null — chamador decide o fallback
 * (notificar advogado, etc).
 */

const KEYWORD_TO_REGEX: Record<string, RegExp> = {
  sentenca: /senten[çc]a|julg[oa]u|julgamento\s+de\s+m[eé]rito/i,
  decisao: /decis[ãa]o|despacho/i,
  acordao: /ac[óo]rd[ãa]o|recurso\s+julgado/i,
  despacho: /despacho/i,
};

@Injectable()
export class PortalDocumentFetcherService {
  private readonly logger = new Logger(PortalDocumentFetcherService.name);
  private readonly scraper = new EsajTjalScraper();

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
  ) {}

  /**
   * Tenta encontrar/baixar documento. Fluxo:
   *   1. Busca em CaseDocument do lead — se existe, retorna direto
   *   2. Se nao, e o caso eh do TJAL, tenta scraping da movimentacao
   *      mais recente que case com a keyword
   *   3. Salva em S3 + cria CaseDocument folder=DECISOES
   *   4. Retorna o documento criado
   *
   * Retorna null se nao conseguir achar/baixar — chamador decide fallback.
   */
  async findOrFetch(
    leadId: string,
    keyword: string,
    caseNumber?: string,
  ): Promise<{
    id: string;
    name: string;
    folder: string;
    mime_type: string;
    case_number: string | null;
    legal_case_id: string;
    source: 'cached' | 'scraped';
  } | null> {
    // ── 1. Busca em CaseDocument (cache) ──
    const cached = await this.prisma.caseDocument.findFirst({
      where: {
        folder: { in: ['CLIENTE', 'CONTRATOS', 'DECISOES', 'PROCURACOES'] },
        legal_case: {
          lead_id: leadId,
          archived: false,
          renounced: false,
          ...(caseNumber ? { case_number: caseNumber } : {}),
        },
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { folder: { contains: keyword, mode: 'insensitive' } },
          ...(KEYWORD_TO_REGEX[keyword.toLowerCase()]
            ? [{ folder: 'DECISOES' as const }]
            : []),
        ],
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, name: true, folder: true, mime_type: true,
        legal_case_id: true,
        legal_case: { select: { case_number: true } },
      },
    });

    if (cached) {
      this.logger.log(`[FETCHER] Cache hit: doc ${cached.id} pra keyword="${keyword}"`);
      return {
        id: cached.id,
        name: cached.name,
        folder: cached.folder,
        mime_type: cached.mime_type,
        case_number: cached.legal_case.case_number,
        legal_case_id: cached.legal_case_id,
        source: 'cached',
      };
    }

    // ── 2. Tenta scraping TJAL ──
    const cases = await this.prisma.legalCase.findMany({
      where: {
        lead_id: leadId,
        archived: false,
        renounced: false,
        ...(caseNumber ? { case_number: caseNumber } : {}),
      },
      select: {
        id: true, case_number: true, lawyer_id: true, tenant_id: true,
      },
    });

    if (cases.length === 0) {
      this.logger.log(`[FETCHER] Lead ${leadId} sem processos ativos`);
      return null;
    }

    const keywordRegex = KEYWORD_TO_REGEX[keyword.toLowerCase()] ||
      new RegExp(keyword, 'i');

    for (const lc of cases) {
      if (!lc.case_number) continue;
      const digits = lc.case_number.replace(/\D/g, '');
      // So TJAL — tribunal code 802
      if (digits.length !== 20 || digits.slice(13, 16) !== '802') {
        this.logger.debug(`[FETCHER] ${lc.case_number} nao eh TJAL, pulando scraping`);
        continue;
      }

      try {
        const data = await this.scraper.searchByNumber(lc.case_number);
        if (!data || !data.processo_codigo) {
          this.logger.warn(`[FETCHER] Scraper nao retornou data/codigo pra ${lc.case_number}`);
          continue;
        }

        // Procura movimentacao mais recente que case com keyword + tem cd_movimentacao
        const candidates = data.movements
          .filter((m: MovementData) =>
            keywordRegex.test(m.description) &&
            !!m.cd_movimentacao,
          )
          .sort((a: any, b: any) => {
            const da = this.parseDate(a.date)?.getTime() || 0;
            const db = this.parseDate(b.date)?.getTime() || 0;
            return db - da; // mais recente primeiro
          });

        if (candidates.length === 0) {
          this.logger.log(
            `[FETCHER] ${lc.case_number}: sem movimentacao com PDF vinculado pra "${keyword}". ` +
            `(${data.movements.length} movs total, ${data.movements.filter((m: any) => m.cd_movimentacao).length} com cd_mov)`,
          );
          continue;
        }

        const target = candidates[0];
        this.logger.log(
          `[FETCHER] Tentando baixar doc cdMov=${target.cd_movimentacao} ` +
          `(${target.document_type || 'tipo desconhecido'}) — "${target.description.slice(0, 80)}"`,
        );

        const pdfData = await this.scraper.downloadMovementDocument(
          data.processo_codigo,
          target.cd_movimentacao!,
        );

        if (!pdfData) {
          this.logger.warn(`[FETCHER] downloadMovementDocument retornou null`);
          continue;
        }

        // Salva no S3
        const docName = `${target.document_type || 'Documento'} - ${target.date}.pdf`;
        const fileHash = createHash('sha256')
          .update(`${lc.id}-${target.cd_movimentacao}-${pdfData.buffer.length}`)
          .digest('hex')
          .slice(0, 16);
        const s3Key = `case-documents/${lc.id}/auto-${fileHash}.pdf`;

        await this.s3.uploadBuffer(s3Key, pdfData.buffer, pdfData.mimeType);

        // Cria CaseDocument. uploaded_by_id = lawyer_id (FK requer User)
        const doc = await this.prisma.caseDocument.create({
          data: {
            tenant_id: lc.tenant_id,
            legal_case_id: lc.id,
            uploaded_by_id: lc.lawyer_id,
            folder: 'DECISOES',
            name: docName,
            original_name: docName,
            s3_key: s3Key,
            mime_type: pdfData.mimeType,
            size: pdfData.buffer.length,
            description: `Baixado automaticamente do TJAL via Sophia (movimentação: "${target.description.slice(0, 200)}")`,
          },
        });

        this.logger.log(
          `[FETCHER] Doc ${doc.id} criado via scraping: ${docName} (${pdfData.buffer.length} bytes)`,
        );

        return {
          id: doc.id,
          name: doc.name,
          folder: doc.folder,
          mime_type: doc.mime_type,
          case_number: lc.case_number,
          legal_case_id: lc.id,
          source: 'scraped',
        };
      } catch (e: any) {
        this.logger.error(`[FETCHER] Erro no scraping de ${lc.case_number}: ${e.message}`);
        continue;
      }
    }

    this.logger.log(`[FETCHER] Nenhum doc encontrado/baixado pra lead=${leadId} keyword="${keyword}"`);
    return null;
  }

  private parseDate(dateStr: string): Date | null {
    // ESAJ format: dd/mm/yyyy
    const m = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`);
  }

  /**
   * Baixa PDF de uma movimentacao ESAJ especifica (botao "Baixar PDF" na
   * timeline do portal). Diferente do findOrFetch:
   *   - findOrFetch: busca por keyword, pega "uma" sentenca relevante
   *   - fetchPdfForCaseEvent: pega o PDF EXATAMENTE daquela movimentacao
   *
   * Estrategia:
   *   1. Valida ownership (case.lead_id === leadId)
   *   2. Le source_raw.cd_movimentacao + processo_codigo do CaseEvent
   *      (preenchido pelos syncs novos; antigos podem nao ter)
   *   3. Se faltar dados, refaz scraping da pagina pra extrair
   *   4. Baixa PDF via downloadMovementDocument
   *   5. Cacheia em CaseDocument folder=DECISOES (proxima request eh cache hit)
   *
   * Retorna null se nao conseguir baixar — caller traduz pra 404.
   */
  async fetchPdfForCaseEvent(
    leadId: string,
    caseEventId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
    const ce = await this.prisma.caseEvent.findUnique({
      where: { id: caseEventId },
      select: {
        id: true, title: true, description: true, source: true, type: true,
        event_date: true, source_raw: true, client_explanation: true,
        legal_case: {
          select: {
            id: true, lead_id: true, case_number: true, lawyer_id: true,
            tenant_id: true, archived: true, renounced: true,
          },
        },
      },
    });
    if (!ce) return null;
    if (ce.legal_case.lead_id !== leadId) return null;
    if (ce.legal_case.archived || ce.legal_case.renounced) return null;
    if (ce.source !== 'ESAJ' || ce.type !== 'MOVIMENTACAO') return null;

    const sourceRaw = (ce.source_raw as any) || {};
    let cdMovimentacao: string | undefined = sourceRaw.cd_movimentacao;
    let processoCodigo: string | undefined = sourceRaw.processo_codigo;
    let documentType: string | undefined = sourceRaw.document_type;

    // Se faltam metadados (movimentacoes antigas), refaz scraping
    if (!cdMovimentacao || !processoCodigo) {
      this.logger.log(`[FETCHER/event] CaseEvent ${caseEventId} sem metadados — refazendo scraping`);
      const data = await this.scraper.searchByNumber(ce.legal_case.case_number || '').catch(() => null);
      if (!data || !data.processo_codigo) {
        this.logger.warn(`[FETCHER/event] Scraper nao retornou data pra ${ce.legal_case.case_number}`);
        return null;
      }
      processoCodigo = data.processo_codigo;
      // Tenta achar a movimentacao pela descricao + data
      const targetDesc = ce.description || ce.title || '';
      const movMatch = data.movements.find((m: any) =>
        m.cd_movimentacao &&
        (m.description === targetDesc || targetDesc.includes(m.description.slice(0, 50))),
      );
      if (movMatch?.cd_movimentacao) {
        cdMovimentacao = movMatch.cd_movimentacao;
        documentType = movMatch.document_type;
      }
    }

    if (!cdMovimentacao || !processoCodigo) {
      this.logger.warn(`[FETCHER/event] Sem cd_movimentacao pra CaseEvent ${caseEventId} — provavel movimentacao sem PDF anexado`);
      return null;
    }

    const pdfData = await this.scraper.downloadMovementDocument(
      processoCodigo, cdMovimentacao,
    );
    if (!pdfData) {
      this.logger.warn(`[FETCHER/event] downloadMovementDocument retornou null pra cdMov=${cdMovimentacao}`);
      return null;
    }

    // Nome do arquivo
    const dateStr = ce.event_date
      ? ce.event_date.toISOString().slice(0, 10)
      : 'sem-data';
    const fileName = `${documentType || 'Movimentação'} - ${dateStr}.pdf`;

    // Cacheia como CaseDocument pra proximas requests serem cache hit
    try {
      const fileHash = createHash('sha256')
        .update(`${ce.legal_case.id}-${cdMovimentacao}-${pdfData.buffer.length}`)
        .digest('hex')
        .slice(0, 16);
      const s3Key = `case-documents/${ce.legal_case.id}/auto-${fileHash}.pdf`;
      await this.s3.uploadBuffer(s3Key, pdfData.buffer, pdfData.mimeType);
      await this.prisma.caseDocument.create({
        data: {
          tenant_id: ce.legal_case.tenant_id,
          legal_case_id: ce.legal_case.id,
          uploaded_by_id: ce.legal_case.lawyer_id,
          folder: 'DECISOES',
          name: fileName,
          original_name: fileName,
          s3_key: s3Key,
          mime_type: pdfData.mimeType,
          size: pdfData.buffer.length,
          description: `Baixado automaticamente do TJAL via portal (CaseEvent ${ce.id})`,
        },
      });
      this.logger.log(`[FETCHER/event] PDF cacheado em CaseDocument: ${fileName}`);
    } catch (e: any) {
      // Nao bloqueia o retorno — usuario ainda recebe o PDF
      this.logger.warn(`[FETCHER/event] Falha ao cachear: ${e.message}`);
    }

    return { buffer: pdfData.buffer, mimeType: pdfData.mimeType, fileName };
  }
}
