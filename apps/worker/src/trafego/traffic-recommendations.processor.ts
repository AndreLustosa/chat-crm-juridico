import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TrafficRecommendationsService } from './traffic-recommendations.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Processor + cron pra Recommendations.
 *
 * Cron: 30 7 * * *  (Maceió 07:30) — uma hora depois do sync principal de
 *   métricas (06:30) pra o snapshot de campaign/ad_group já estar fresco.
 *
 * Fila: trafego-recommendations
 *   job 'sync'    → syncRecommendations
 *   job 'apply'   → applyRecommendation (force opcional)
 *   job 'dismiss' → dismissRecommendation
 */
@Injectable()
@Processor('trafego-recommendations', { concurrency: 1 })
export class TrafficRecommendationsProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafficRecommendationsProcessor.name);

  constructor(
    private prisma: PrismaService,
    private recs: TrafficRecommendationsService,
    private cronRunner: CronRunnerService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<unknown> {
    switch (job.name) {
      case 'sync':
        return this.recs.syncRecommendations(job.data.accountId);
      case 'apply':
        return this.recs.applyRecommendation(
          job.data.accountId,
          job.data.recommendationId,
          {
            force: !!job.data.force,
            resolvedBy: job.data.resolvedBy ?? 'AI_AGENT',
          },
        );
      case 'dismiss':
        return this.recs.dismissRecommendation(
          job.data.accountId,
          job.data.recommendationId,
          { resolvedBy: job.data.resolvedBy ?? 'AI_AGENT' },
        );
      default:
        this.logger.warn(`[recommendations-processor] job desconhecido: ${job.name}`);
        return { ignored: true };
    }
  }

  /**
   * Cron diário 07:30 Maceió — sync de recommendations pra todas as
   * contas ACTIVE. Erros isolados por conta.
   */
  @Cron('30 7 * * *', { timeZone: 'America/Maceio' })
  async runDailySync() {
    await this.cronRunner.run(
      'trafego-recommendations-daily',
      30 * 60,
      async () => {
        const accounts = await this.prisma.trafficAccount.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, customer_id: true },
        });
        if (accounts.length === 0) {
          this.logger.log('[recommendations-cron] sem contas ativas — skip');
          return;
        }

        this.logger.log(
          `[recommendations-cron] iniciando p/ ${accounts.length} conta(s)`,
        );

        let ok = 0;
        let fail = 0;
        for (const acc of accounts) {
          try {
            await this.recs.syncRecommendations(acc.id);
            ok++;
          } catch (err: any) {
            fail++;
            this.logger.error(
              `[recommendations-cron] account=${acc.id} customer=${acc.customer_id}: ${err?.message ?? err}`,
            );
          }
        }
        this.logger.log(`[recommendations-cron] done ok=${ok} fail=${fail}`);
      },
      { description: 'Sync de Recommendations Google Ads (07:30 diario)', schedule: '30 7 * * *' },
    );
  }
}
