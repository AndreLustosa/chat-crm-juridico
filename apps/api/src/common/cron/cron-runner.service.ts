import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LockService } from '../locks/lock.service';

export interface CronRunOptions {
  /** Descricao curta pra UI admin */
  description?: string;
  /** Expressao cron pra display (ex: "0 9 * * 1-5") */
  schedule?: string;
}

/**
 * Runner unificado de crons:
 *   - lock distribuido via Redis (evita overlap em multi-replica e rolling-update)
 *   - feature flag por cron (admin pode desativar via UI sem deploy)
 *   - historico de execucao (last_run_at, last_status, last_error, duracao, contagem)
 *
 * Auto-registra cada cron no DB (CronConfig) na primeira execucao — descricao
 * e schedule passados via options sao salvos pra UI mostrar. Updates
 * subsequentes preservam enabled (admin tem a fonte da verdade).
 *
 * Uso:
 *   @Cron('0 9 * * 1-5', { timeZone: 'America/Maceio' })
 *   async sendReminders() {
 *     await this.cronRunner.run(
 *       'payment-due-reminders',
 *       10 * 60,
 *       async () => {
 *         // logica do cron aqui
 *       },
 *       { description: 'Lembrete WhatsApp 3 dias antes do vencimento', schedule: '0 9 * * 1-5' },
 *     );
 *   }
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

    const result = await this.lock.withLock(`cron:${name}`, ttlSeconds, async () => {
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
    if (result === null) {
      // Lock skipou (outra replica esta rodando) — nao registra como erro nem
      // sucesso pra nao confundir o admin. LockService ja loga.
    }
  }

  private async ensureExists(name: string, options?: CronRunOptions): Promise<void> {
    try {
      await this.prisma.cronConfig.upsert({
        where: { name },
        update: {
          // Atualiza apenas metadata visivel — preserva enabled (fonte da verdade
          // eh o que o admin marcou).
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
      // Falha em gravar historico nao deve mascarar a execucao em si
      this.logger.warn(`[CRON] Falha ao gravar historico de "${name}": ${e.message}`);
    }
  }
}
