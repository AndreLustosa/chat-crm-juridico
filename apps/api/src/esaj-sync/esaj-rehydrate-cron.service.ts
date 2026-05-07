import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EsajTjalScraper } from '../court-scraper/scrapers/esaj-tjal.scraper';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Re-hidrata source_raw das movimentacoes ESAJ antigas com cd_movimentacao
 * + processo_codigo. Sem isso, botao "Baixar PDF" no portal nao funciona
 * pra movimentacoes sincronizadas antes do deploy do parser (2026-04-26).
 *
 * Estrategia:
 *   - Roda 1x/dia as 2h da manha (madrugada, baixa carga)
 *   - Pega N processos por execucao (default 50)
 *   - Pra cada: scraper.searchByNumber → atualiza source_raw das movs
 *     que tem match e sem cd_movimentacao
 *   - Sleep 2s entre processos pra nao saturar TJAL
 *   - Lock distribuido pra impedir double-run em multi-replica
 *
 * Tempo estimado: 100 processos = ~3-5min. Re-sync completo do historico
 * acontece em ~30 dias se houver ~3000 processos.
 *
 * Idempotente: pula processos que ja tem 100% das movs hidratadas.
 */
@Injectable()
export class EsajRehydrateCronService {
  private readonly logger = new Logger(EsajRehydrateCronService.name);
  private readonly scraper = new EsajTjalScraper();
  private readonly BATCH_SIZE = 50;
  private readonly REQUEST_DELAY_MS = 2000;

  constructor(
    private prisma: PrismaService,
    private cronRunner: CronRunnerService,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'America/Maceio' })
  async runDaily() {
    await this.cronRunner.run(
      'esaj-rehydrate',
      30 * 60,
      async () => { await this.rehydrate(); },
      { description: 'Hidrata cd_movimentacao em CaseEvents ESAJ antigos (1x/dia)', schedule: '0 2 * * *' },
    );
  }

  /**
   * Tambem expoe metodo publico pra trigger manual (ex: endpoint admin).
   */
  async rehydrate(): Promise<{ processed: number; updated: number; skipped: number }> {
    this.logger.log('[REHYDRATE] Iniciando hidratacao de cd_movimentacao');

    // Busca N casos com pelo menos uma movimentacao ESAJ sem cd_movimentacao.
    // Filtra: in_tracking + nao arquivado + tem case_number TJAL valido.
    const cases = await this.prisma.$queryRaw<Array<{ id: string; case_number: string }>>`
      SELECT lc.id, lc.case_number
      FROM "LegalCase" lc
      WHERE lc.in_tracking = true
        AND lc.archived = false
        AND lc.renounced = false
        AND lc.case_number IS NOT NULL
        AND SUBSTRING(REGEXP_REPLACE(lc.case_number, '\\D', '', 'g') FROM 14 FOR 3) = '802'
        AND EXISTS (
          SELECT 1 FROM "CaseEvent" ce
          WHERE ce.case_id = lc.id
            AND ce.source = 'ESAJ'
            AND ce.type = 'MOVIMENTACAO'
            AND (ce.source_raw->>'cd_movimentacao') IS NULL
        )
      ORDER BY lc.updated_at DESC
      LIMIT ${this.BATCH_SIZE}
    `;

    if (cases.length === 0) {
      this.logger.log('[REHYDRATE] Nenhum processo precisa de hidratacao — historico completo');
      return { processed: 0, updated: 0, skipped: 0 };
    }

    this.logger.log(`[REHYDRATE] Processando ${cases.length} processos`);

    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const lc of cases) {
      try {
        await this.sleep(this.REQUEST_DELAY_MS);

        const data = await this.scraper.searchByNumber(lc.case_number);
        if (!data || !data.processo_codigo) {
          totalSkipped++;
          continue;
        }

        // Indexa movimentacoes do scraper por (date|description) — chave de match
        const movsWithCd = data.movements.filter((m: any) => m.cd_movimentacao);
        if (movsWithCd.length === 0) {
          this.logger.warn(`[REHYDRATE] ${lc.case_number}: scraping retornou 0 movs com cd_movimentacao — parser pode estar quebrado`);
          totalSkipped++;
          continue;
        }

        // Busca CaseEvents do caso que ainda nao tem cd_movimentacao
        const events = await this.prisma.caseEvent.findMany({
          where: {
            case_id: lc.id,
            source: 'ESAJ',
            type: 'MOVIMENTACAO',
          },
          select: { id: true, description: true, title: true, event_date: true, source_raw: true },
        });

        let updatedInCase = 0;
        for (const ce of events) {
          const sr = (ce.source_raw as any) || {};
          if (sr.cd_movimentacao) continue; // ja hidratado

          const targetDesc = (ce.description || ce.title || '').trim();
          const targetDate = ce.event_date
            ? this.toBrDate(ce.event_date)
            : '';

          // Match: data + descricao
          const movMatch = movsWithCd.find((m: any) =>
            m.date === targetDate &&
            (m.description === targetDesc ||
              targetDesc.includes(m.description.slice(0, 50)) ||
              m.description.includes(targetDesc.slice(0, 50))),
          ) || movsWithCd.find((m: any) =>
            // Fallback: so descricao
            m.description === targetDesc || targetDesc.includes(m.description.slice(0, 50)),
          );

          if (movMatch?.cd_movimentacao) {
            await this.prisma.caseEvent.update({
              where: { id: ce.id },
              data: {
                source_raw: {
                  ...sr,
                  cd_movimentacao: movMatch.cd_movimentacao,
                  processo_codigo: data.processo_codigo,
                  ...(movMatch.document_type ? { document_type: movMatch.document_type } : {}),
                } as any,
              },
            }).catch(() => {});
            updatedInCase++;
          }
        }

        if (updatedInCase > 0) {
          totalUpdated += updatedInCase;
          this.logger.log(
            `[REHYDRATE] ${lc.case_number}: ${updatedInCase} movs hidratadas ` +
            `(${movsWithCd.length} candidatas no scraper, ${events.length} no banco)`,
          );
        } else {
          totalSkipped++;
        }
      } catch (e: any) {
        this.logger.warn(`[REHYDRATE] Erro em ${lc.case_number}: ${e.message}`);
        totalSkipped++;
      }
    }

    this.logger.log(
      `[REHYDRATE] Concluido: ${cases.length} processos, ${totalUpdated} movs hidratadas, ${totalSkipped} pulados`,
    );

    return { processed: cases.length, updated: totalUpdated, skipped: totalSkipped };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private toBrDate(date: Date): string {
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
}
