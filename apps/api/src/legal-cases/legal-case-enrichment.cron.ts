import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CourtScraperService } from '../court-scraper/court-scraper.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Enriquecimento assincrono de LegalCases pos-protocolo.
 *
 * Fluxo (criado 2026-05-13):
 *   1. Advogado arrasta card pra etapa PROTOCOLO na Triagem e informa apenas
 *      o numero do processo + polo (autor/reu). sendToTracking marca
 *      enrichment_status='PENDING' e enrichment_scheduled_for=now+24h.
 *   2. Este cron roda de hora em hora. Filtra casos PENDING com schedule
 *      vencido e, pra cada um, consulta o tribunal via CourtScraperService.
 *   3. Sucesso: preenche court/judge/action_type/opposing_party/claim_value/
 *      legal_area/filed_at, flipa in_tracking=true + tracking_stage derivado
 *      dos movimentos, marca enrichment_status='DONE'. Caso aparece no menu
 *      Processos.
 *   4. Falha transitoria (timeout, scraper indisponivel): incrementa
 *      enrichment_attempts e re-agenda +24h. Maximo 3 tentativas.
 *   5. Falha terminal (tribunal nao suportado, esgotou retries): marca
 *      enrichment_status='FAILED' com mensagem em enrichment_error. Caso fica
 *      na Triagem com badge pra operador editar manual.
 *
 * Limites: 20 casos por execucao com sleep 3s entre requests pra nao saturar
 * o tribunal (esaj-sync ja usa 2s; aqui somos mais conservadores porque
 * podemos rodar concorrente com o sync de movimentacoes).
 */
@Injectable()
export class LegalCaseEnrichmentCronService {
  private readonly logger = new Logger(LegalCaseEnrichmentCronService.name);
  private readonly BATCH_SIZE = 20;
  private readonly REQUEST_DELAY_MS = 3000;
  private readonly MAX_ATTEMPTS = 3;
  private readonly RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private scraper: CourtScraperService,
    private cronRunner: CronRunnerService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'America/Maceio' })
  async runHourly() {
    await this.cronRunner.run(
      'legal-case-enrichment',
      30 * 60,
      async () => { await this.processBatch(); },
      {
        description: 'Enriquece LegalCases recem-protocolados consultando o tribunal (1x/h)',
        schedule: '0 * * * *',
      },
    );
  }

  /** Tambem expoe trigger publico pra admin executar manual */
  async processBatch(): Promise<{ processed: number; done: number; failed: number; retried: number }> {
    const now = new Date();

    const pending = await this.prisma.legalCase.findMany({
      where: {
        // Cast pra any: o Prisma Client ainda nao foi regenerado em dev local
        // (rola na build da VPS). Em runtime os campos existem na coluna do banco.
        enrichment_status: 'PENDING',
        enrichment_scheduled_for: { lte: now },
        archived: false,
      } as any,
      select: {
        id: true, case_number: true, client_is_author: true,
        // @ts-ignore — campo existe no banco apos migration 2026-05-13
        enrichment_attempts: true,
      } as any,
      orderBy: { enrichment_scheduled_for: 'asc' } as any,
      take: this.BATCH_SIZE,
    });

    if (pending.length === 0) {
      this.logger.log('[ENRICH] Nenhum caso pendente — fila vazia');
      return { processed: 0, done: 0, failed: 0, retried: 0 };
    }

    this.logger.log(`[ENRICH] Processando ${pending.length} casos pendentes`);

    let done = 0;
    let failed = 0;
    let retried = 0;

    for (const lc of pending) {
      const lcAny = lc as any;
      try {
        if (!lc.case_number) {
          await this.markFailed(lc.id, 'Caso sem numero de processo cadastrado.');
          failed++;
          continue;
        }

        await this.sleep(this.REQUEST_DELAY_MS);

        let result: Awaited<ReturnType<CourtScraperService['searchByNumber']>>;
        try {
          result = await this.scraper.searchByNumber(lc.case_number);
        } catch (e: any) {
          // BadRequestException de "Tribunal nao suportado" → terminal,
          // nao adianta retry. Outros erros → transitorio.
          const msg = e?.message || 'Erro desconhecido ao consultar tribunal';
          if (/Tribunal n[ãa]o suportado/i.test(msg)) {
            await this.markFailed(lc.id, msg);
            failed++;
            continue;
          }
          // Transitorio
          await this.retryOrFail(lc.id, lcAny.enrichment_attempts || 0, msg);
          retried++;
          continue;
        }

        if (!result?.data) {
          // Scraper nao encontrou — pode ser indexacao pendente. Retry.
          await this.retryOrFail(
            lc.id,
            lcAny.enrichment_attempts || 0,
            'Processo nao encontrado no tribunal — pode ainda nao estar indexado.',
          );
          retried++;
          continue;
        }

        const data = result.data;
        const opposingParty = this.pickOpposingParty(data.parties, lc.client_is_author);
        const claimValue = this.parseClaimValue(data.claim_value);
        const filedAt = data.filed_at ? new Date(`${data.filed_at}T12:00:00Z`) : null;

        await this.prisma.legalCase.update({
          where: { id: lc.id },
          data: {
            // Dados do tribunal
            court: data.court || undefined,
            judge: data.judge || undefined,
            action_type: data.action_type || undefined,
            legal_area: this.normalizeLegalArea(data.legal_area) || undefined,
            opposing_party: opposingParty || undefined,
            claim_value: claimValue ?? undefined,
            filed_at: filedAt ?? undefined,
            // Promove pra menu Processos
            in_tracking: true,
            tracking_stage: data.tracking_stage || 'DISTRIBUIDO',
            stage_changed_at: new Date(),
            // Marca enriquecimento como concluido
            enrichment_status: 'DONE',
            enriched_at: new Date(),
            enrichment_error: null,
          } as any,
        });

        this.logger.log(
          `[ENRICH] ${lc.case_number}: enriquecido com sucesso ` +
          `(tracking_stage=${data.tracking_stage}, parties=${data.parties.length})`,
        );
        done++;
      } catch (e: any) {
        // Erro nao classificado — re-agenda como retry generico.
        this.logger.error(`[ENRICH] Erro inesperado em ${lc.case_number}: ${e?.message}`);
        try {
          await this.retryOrFail(
            lc.id,
            lcAny.enrichment_attempts || 0,
            e?.message || 'Erro inesperado',
          );
          retried++;
        } catch {}
      }
    }

    this.logger.log(`[ENRICH] Concluido: ${done} done, ${retried} retried, ${failed} failed`);
    return { processed: pending.length, done, failed, retried };
  }

  // ─── Helpers ───────────────────────────────────────────────

  /**
   * Escolhe opposing_party com base no polo do cliente.
   *  - cliente AUTOR  → contraria eh REU/REQUERIDO/RECLAMADO/EXECUTADO
   *  - cliente REU    → contraria eh AUTOR/REQUERENTE/RECLAMANTE/EXEQUENTE
   */
  private pickOpposingParty(
    parties: Array<{ role: string; name: string }>,
    clientIsAuthor: boolean,
  ): string | null {
    if (!parties?.length) return null;
    const rolesAuthor = /\b(autor|requerente|reclamante|exequente|impetrante|embargante)\b/i;
    const rolesReu = /\b(r[eé]u|reclamad[oa]|requerid[oa]|executad[oa]|impetrad[oa]|embargad[oa])\b/i;
    const target = clientIsAuthor ? rolesReu : rolesAuthor;
    const match = parties.find(p => target.test(p.role || ''));
    return match?.name || null;
  }

  /**
   * Converte "R$ 50.000,00" → 50000. Aceita ja-numero, null, undefined.
   */
  private parseClaimValue(raw: any): number | null {
    if (raw == null) return null;
    if (typeof raw === 'number') return raw > 0 ? raw : null;
    const s = String(raw)
      .replace(/[Rr]\$|\s/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.');
    const n = parseFloat(s);
    return !isNaN(n) && n > 0 ? n : null;
  }

  /**
   * Normaliza legal_area pra valores aceitos pelo enum interno do CRM.
   */
  private normalizeLegalArea(area: string | null | undefined): string | null {
    if (!area) return null;
    const map: Record<string, string> = {
      civel: 'CIVIL', civil: 'CIVIL',
      trabalhista: 'TRABALHISTA', trabalho: 'TRABALHISTA',
      previdenciario: 'PREVIDENCIARIO', inss: 'PREVIDENCIARIO',
      tributario: 'TRIBUTARIO', fiscal: 'TRIBUTARIO',
      familia: 'FAMILIA', divorcio: 'FAMILIA',
      criminal: 'CRIMINAL', penal: 'CRIMINAL',
      consumidor: 'CONSUMIDOR',
      empresarial: 'EMPRESARIAL',
      administrativo: 'ADMINISTRATIVO',
    };
    const key = area.toLowerCase().replace(/[^a-z]/g, '');
    return map[key] || area.toUpperCase();
  }

  private async retryOrFail(id: string, currentAttempts: number, error: string) {
    const next = currentAttempts + 1;
    if (next >= this.MAX_ATTEMPTS) {
      await this.markFailed(id, `${error} (apos ${next} tentativas)`);
      return;
    }
    await this.prisma.legalCase.update({
      where: { id },
      data: {
        enrichment_attempts: next,
        enrichment_scheduled_for: new Date(Date.now() + this.RETRY_DELAY_MS),
        enrichment_error: error,
      } as any,
    });
  }

  private async markFailed(id: string, error: string) {
    await this.prisma.legalCase.update({
      where: { id },
      data: {
        enrichment_status: 'FAILED',
        enriched_at: new Date(),
        enrichment_error: error,
      } as any,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
