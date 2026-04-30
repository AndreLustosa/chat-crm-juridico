import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TrafegoBackfillService — API-side facade pro backfill histórico
 * (Sprint H.1).
 *
 * Pra start: marca conta com backfill_status='RUNNING' + cursor inicial via
 * SQL direto, e enfileira primeiro job. O cron `*\/5 * * * *` no worker
 * mantém empurrando 1 mês por vez até `DONE`.
 */
@Injectable()
export class TrafegoBackfillService {
  private readonly logger = new Logger(TrafegoBackfillService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('trafego-backfill') private readonly queue: Queue,
  ) {}

  async start(tenantId: string, targetFrom?: string) {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
      select: { id: true, backfill_status: true },
    });
    if (!account) {
      throw new HttpException(
        'Conecte uma conta Google Ads primeiro.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    if (account.backfill_status === 'RUNNING') {
      throw new HttpException(
        'Backfill já está rodando.',
        HttpStatus.CONFLICT,
      );
    }

    const fromDate = targetFrom
      ? new Date(targetFrom)
      : monthsAgoFirstDay(24);
    if (Number.isNaN(fromDate.getTime())) {
      throw new HttpException(
        'target_from inválido (use YYYY-MM-DD).',
        HttpStatus.BAD_REQUEST,
      );
    }
    const startMonth = firstDayOfMonth(fromDate);
    const endMonth = firstDayOfMonth(new Date());
    const totalMonths = monthsBetween(startMonth, endMonth) + 1;

    if (totalMonths > 60) {
      throw new HttpException(
        'target_from muito antigo (max 5 anos).',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.trafficAccount.update({
      where: { id: account.id },
      data: {
        backfill_status: 'RUNNING',
        backfill_target_from: startMonth,
        backfill_cursor: startMonth,
        backfill_total_months: totalMonths,
        backfill_done_months: 0,
        backfill_completed_at: null,
        backfill_error: null,
      },
    });

    // Empurra primeiro step imediato (cron de 5min pega o resto)
    await this.queue.add(
      'step',
      { accountId: account.id },
      {
        jobId: `backfill-${account.id}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 30,
      },
    );

    return {
      ok: true,
      total_months: totalMonths,
      target_from: startMonth.toISOString().slice(0, 10),
      message: `Backfill iniciado — ${totalMonths} meses serão importados em ~${Math.ceil(totalMonths / 12)}h.`,
    };
  }

  async getStatus(tenantId: string) {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId },
      select: {
        id: true,
        status: true,
        backfill_status: true,
        backfill_target_from: true,
        backfill_cursor: true,
        backfill_total_months: true,
        backfill_done_months: true,
        backfill_completed_at: true,
        backfill_error: true,
      },
    });
    if (!account) {
      throw new HttpException('Conta não encontrada.', HttpStatus.NOT_FOUND);
    }
    const total = account.backfill_total_months ?? 0;
    const done = account.backfill_done_months ?? 0;
    return {
      ...account,
      progress_pct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  async cancel(tenantId: string) {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId },
      select: { id: true, backfill_status: true },
    });
    if (!account) {
      throw new HttpException('Conta não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (account.backfill_status !== 'RUNNING') {
      throw new HttpException(
        'Backfill não está rodando.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.trafficAccount.update({
      where: { id: account.id },
      data: {
        backfill_status: 'NONE',
        backfill_cursor: null,
        backfill_error: 'Cancelado pelo admin',
      },
    });
    return { ok: true };
  }
}

// Helpers
function firstDayOfMonth(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(1);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
function monthsAgoFirstDay(n: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return firstDayOfMonth(d);
}
function monthsBetween(a: Date, b: Date): number {
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth())
  );
}
