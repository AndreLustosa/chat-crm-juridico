import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { Prisma } from '@prisma/client';

/**
 * TrafficBackfillService — sync histórico de métricas (Sprint H.1).
 *
 * O sync diário (TrafegoSyncService) traz 30 dias rolling. Pra IA
 * conversacional analisar histórico longo (ex: comparar 2024 vs 2025), o
 * admin clica "Baixar histórico completo" e este service paga o ônus.
 *
 * Estratégia:
 *   - Janela de 1 mês por iteração (gentle nas operações Google Ads)
 *   - Usa o cursor `backfill_cursor` em TrafficAccount pra retomar de onde
 *     parou se job morrer no meio (idempotente: re-roda do mês corrente)
 *   - Limit: respeita Basic Access ~15k ops/dia. 1 sync de 30d × 8 campanhas
 *     ≈ 30 ops. Cabe folgado mesmo com 5 anos = 60 meses × 30 = 1800 ops.
 *   - target_from default: 24 meses atrás (admin pode override pra mais)
 *
 * Status flow: NONE → RUNNING → DONE (ou ERROR)
 */
@Injectable()
export class TrafficBackfillService {
  private readonly logger = new Logger(TrafficBackfillService.name);

  constructor(
    private prisma: PrismaService,
    private adsClient: GoogleAdsClientService,
  ) {}

  /**
   * Inicia o backfill marcando RUNNING + cursor inicial. NÃO faz o sync —
   * isso é responsabilidade do processor que pega 1 mês por job.
   */
  async start(
    accountId: string,
    targetFrom?: Date,
  ): Promise<{ ok: true; total_months: number }> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new HttpException('Conta não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (account.status !== 'ACTIVE') {
      throw new HttpException(
        'Conta não está ativa. Conecte via OAuth antes.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    if (account.backfill_status === 'RUNNING') {
      throw new HttpException(
        'Backfill já está rodando para esta conta.',
        HttpStatus.CONFLICT,
      );
    }

    // Default: 24 meses atrás (suficiente pra YoY + tendência longa)
    const from = targetFrom ?? this.monthsAgo(24);
    const startMonth = this.firstDayOfMonth(from);
    const endMonth = this.firstDayOfMonth(new Date());

    const totalMonths = this.monthsBetween(startMonth, endMonth) + 1;

    await this.prisma.trafficAccount.update({
      where: { id: accountId },
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

    this.logger.log(
      `[backfill] start account=${accountId} from=${startMonth.toISOString().slice(0, 10)} total_months=${totalMonths}`,
    );

    return { ok: true, total_months: totalMonths };
  }

  /**
   * Sincroniza UM mês. Avança o cursor +1. Marca DONE quando passa do mês
   * atual. Idempotente: se rodar 2x pra mesmo mês, upsert na metric_daily
   * apenas atualiza valores.
   */
  async syncOneMonth(accountId: string): Promise<BackfillStepReport> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.backfill_status !== 'RUNNING') {
      return { accountId, done: true, noop: true };
    }
    const cursor = account.backfill_cursor ?? this.firstDayOfMonth(new Date());
    const monthEnd = this.lastDayOfMonth(cursor);
    const today = new Date();

    // Já passou do mês atual → marca DONE
    if (cursor > today) {
      await this.markDone(accountId);
      return { accountId, done: true };
    }

    const fromStr = cursor.toISOString().slice(0, 10);
    const toStr = (monthEnd > today ? today : monthEnd).toISOString().slice(0, 10);

    try {
      const customer = await this.adsClient.getCustomer(
        account.tenant_id,
        account.id,
      );

      // Mapping campaign google_id -> local id (campanhas removidas tb são
      // contempladas — IA precisa do histórico mesmo de campanhas mortas).
      const campaignsLocal = await this.prisma.trafficCampaign.findMany({
        where: { account_id: accountId },
        select: { id: true, google_campaign_id: true },
      });
      const campaignByGoogleId = new Map<string, string>();
      for (const c of campaignsLocal) {
        campaignByGoogleId.set(c.google_campaign_id, c.id);
      }

      // GAQL — mesmo da sync diária, mas com janela específica do mês
      const rows: any[] = await customer.query(`
        SELECT
          campaign.id,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date BETWEEN '${fromStr}' AND '${toStr}'
      `);

      let upserted = 0;
      let skipped = 0;
      for (const row of rows) {
        const googleCampaignId = String(row.campaign?.id ?? '');
        const localCampaignId = campaignByGoogleId.get(googleCampaignId);
        if (!localCampaignId) {
          skipped++;
          continue;
        }
        const dateStr: string = row.segments?.date;
        if (!dateStr) continue;

        const clicks = Number(row.metrics?.clicks ?? 0);
        const conversions = Number(row.metrics?.conversions ?? 0);
        const costMicros = toBigIntSafe(row.metrics?.cost_micros);
        const data = {
          impressions: Number(row.metrics?.impressions ?? 0),
          clicks,
          cost_micros: costMicros,
          conversions: new Prisma.Decimal(conversions.toFixed(4)),
          conversions_value: new Prisma.Decimal(
            Number(row.metrics?.conversions_value ?? 0).toFixed(4),
          ),
          ctr: new Prisma.Decimal(Number(row.metrics?.ctr ?? 0).toFixed(6)),
          // avg_cpc_micros e cost_per_conv_micros são derivados (nullable)
          avg_cpc_micros: clicks > 0 ? toBigIntSafe(row.metrics?.average_cpc) : null,
          cost_per_conv_micros:
            conversions > 0
              ? toBigIntSafe(row.metrics?.cost_per_conversion)
              : null,
        };

        await this.prisma.trafficMetricDaily.upsert({
          where: {
            campaign_id_date: {
              campaign_id: localCampaignId,
              date: new Date(dateStr),
            },
          },
          update: data,
          create: {
            tenant_id: account.tenant_id,
            account_id: accountId,
            campaign_id: localCampaignId,
            date: new Date(dateStr),
            ...data,
          },
        });
        upserted++;
      }

      // Avança cursor +1 mês e incrementa done_months
      const nextCursor = this.firstDayOfMonth(this.addMonths(cursor, 1));
      const passed = nextCursor > today;
      const newDoneMonths = (account.backfill_done_months ?? 0) + 1;

      await this.prisma.trafficAccount.update({
        where: { id: accountId },
        data: {
          backfill_cursor: passed ? null : nextCursor,
          backfill_done_months: newDoneMonths,
          backfill_status: passed ? 'DONE' : 'RUNNING',
          backfill_completed_at: passed ? new Date() : null,
        },
      });

      this.logger.log(
        `[backfill] step account=${accountId} month=${fromStr.slice(0, 7)} ` +
          `rows=${rows.length} upserted=${upserted} skipped=${skipped} done=${newDoneMonths}/${account.backfill_total_months}`,
      );

      return {
        accountId,
        month: fromStr.slice(0, 7),
        upserted,
        skipped,
        rows: rows.length,
        done: passed,
      };
    } catch (err: any) {
      const fmt = this.adsClient.formatError(err);
      this.logger.error(
        `[backfill] step failed account=${accountId} month=${fromStr.slice(0, 7)}: ${fmt.message}`,
      );
      await this.prisma.trafficAccount.update({
        where: { id: accountId },
        data: {
          backfill_status: 'ERROR',
          backfill_error: `mês ${fromStr.slice(0, 7)}: ${fmt.message}`,
        },
      });
      throw err;
    }
  }

  /**
   * Status pra exibir progresso na UI.
   */
  async getStatus(accountId: string) {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
      select: {
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
    return account;
  }

  async cancel(accountId: string): Promise<{ ok: true }> {
    await this.prisma.trafficAccount.update({
      where: { id: accountId },
      data: {
        backfill_status: 'NONE',
        backfill_cursor: null,
        backfill_error: 'Cancelado pelo admin',
      },
    });
    this.logger.log(`[backfill] cancelado account=${accountId}`);
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers de data
  // ──────────────────────────────────────────────────────────────────────

  private async markDone(accountId: string) {
    await this.prisma.trafficAccount.update({
      where: { id: accountId },
      data: {
        backfill_status: 'DONE',
        backfill_completed_at: new Date(),
        backfill_cursor: null,
      },
    });
  }

  private monthsAgo(n: number): Date {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - n);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private firstDayOfMonth(d: Date): Date {
    const out = new Date(d);
    out.setUTCDate(1);
    out.setUTCHours(0, 0, 0, 0);
    return out;
  }

  private lastDayOfMonth(d: Date): Date {
    const out = new Date(d);
    out.setUTCMonth(out.getUTCMonth() + 1);
    out.setUTCDate(0);
    out.setUTCHours(23, 59, 59, 999);
    return out;
  }

  private addMonths(d: Date, n: number): Date {
    const out = new Date(d);
    out.setUTCMonth(out.getUTCMonth() + n);
    return out;
  }

  private monthsBetween(start: Date, end: Date): number {
    return (
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth())
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function toBigIntSafe(v: unknown): bigint {
  if (v === null || v === undefined) return 0n;
  if (typeof v === 'bigint') return v;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round(n));
}

export type BackfillStepReport = {
  accountId: string;
  month?: string;
  upserted?: number;
  skipped?: number;
  rows?: number;
  done: boolean;
  noop?: boolean;
};
