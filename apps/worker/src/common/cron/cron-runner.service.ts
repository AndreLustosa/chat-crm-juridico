import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LockService } from '../locks/lock.service';

export interface CronRunOptions {
  description?: string;
  schedule?: string;
}

/**
 * Runner unificado de crons (espelha apps/api/src/common/cron):
 *   - lock distribuido via Redis
 *   - feature flag por cron via CronConfig table
 *   - historico de execucao
 */
@Injectable()
export class CronRunnerService {
  private readonly logger = new Logger('CronRunner');

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: LockService,
  ) {}

  async run(
    name: string,
    ttlSeconds: number,
    fn: () => Promise<void>,
    options?: CronRunOptions,
  ): Promise<void> {
    await this.ensureExists(name, options);

    const config = await this.prisma.cronConfig.findUnique({
      where: { name },
      select: { enabled: true },
    });
    if (!config?.enabled) {
      this.logger.log(`[CRON] "${name}" desativado via admin — skipando`);
      return;
    }

    await this.lock.withLock(`cron:${name}`, ttlSeconds, async () => {
      const startedAtMs = Date.now();
      try {
        await fn();
        await this.recordRun(name, 'ok', null, Date.now() - startedAtMs);
      } catch (e: any) {
        const errMsg = String(e?.message || e).slice(0, 1000);
        await this.recordRun(name, 'error', errMsg, Date.now() - startedAtMs);
        throw e;
      }
    });
  }

  private async ensureExists(name: string, options?: CronRunOptions): Promise<void> {
    try {
      await this.prisma.cronConfig.upsert({
        where: { name },
        update: {
          description: options?.description ?? undefined,
          schedule: options?.schedule ?? undefined,
        },
        create: {
          name,
          description: options?.description,
          schedule: options?.schedule,
          enabled: true,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[CRON] Falha ao registrar "${name}" no banco: ${e.message}`);
    }
  }

  private async recordRun(
    name: string,
    status: 'ok' | 'error',
    errorMsg: string | null,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.prisma.cronConfig.update({
        where: { name },
        data: {
          last_run_at: new Date(),
          last_status: status,
          last_error: errorMsg,
          last_duration_ms: durationMs,
          run_count: { increment: 1 },
        },
      });
    } catch (e: any) {
      this.logger.warn(`[CRON] Falha ao gravar historico de "${name}": ${e.message}`);
    }
  }
}
