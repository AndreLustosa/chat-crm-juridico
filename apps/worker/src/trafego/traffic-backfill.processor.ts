import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TrafficBackfillService } from './traffic-backfill.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Processor + cron driver pro backfill histórico (Sprint H.1).
 *
 * Fila: trafego-backfill
 *   - 'step'  → payload { accountId } — sincroniza 1 mês e avança cursor
 *
 * Cron: a cada 5 min, varre TrafficAccount com status=RUNNING e enfileira
 * 1 step pra cada uma. Isso cria pulso natural respeitando rate limit:
 *   60 meses × 5min = 5h pra terminar 60 meses (24m default = 2h)
 *
 * Sem urgência — backfill é low priority. Sync diário de 30d nada sofre.
 */
@Injectable()
@Processor('trafego-backfill', { concurrency: 1 })
export class TrafficBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafficBackfillProcessor.name);

  constructor(
    private prisma: PrismaService,
    private backfill: TrafficBackfillService,
    @InjectQueue('trafego-backfill') private readonly queue: Queue,
    private cronRunner: CronRunnerService,
  ) {
    super();
  }

  async process(job: Job<{ accountId: string }>): Promise<unknown> {
    if (job.name !== 'step') {
      this.logger.warn(`[backfill] job desconhecido: ${job.name}`);
      return { ignored: true };
    }
    return this.backfill.syncOneMonth(job.data.accountId);
  }

  /**
   * Cron a cada 5 min: enfileira 1 step pra cada conta com RUNNING.
   * Throttle natural — Google Ads API não vai rate-limit nem com 30 contas.
   */
  @Cron('*/5 * * * *', { timeZone: 'America/Maceio' })
  async pulse() {
    await this.cronRunner.run(
      'trafego-backfill-pulse',
      4 * 60,
      async () => {
        const running = await this.prisma.trafficAccount.findMany({
          where: { backfill_status: 'RUNNING' },
          select: { id: true, customer_id: true },
        });
        if (running.length === 0) return;

        for (const acc of running) {
          await this.queue.add(
            'step',
            { accountId: acc.id },
            {
              jobId: `backfill-${acc.id}-${Date.now()}`,
              removeOnComplete: 50,
              removeOnFail: 30,
            },
          );
        }
        this.logger.log(`[backfill-pulse] enqueued steps p/ ${running.length} conta(s)`);
      },
      { description: 'Pulse de backfill historico Google Ads (a cada 5min)', schedule: '*/5 * * * *' },
    );
  }
}
