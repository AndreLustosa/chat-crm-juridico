import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import type { Customer } from 'google-ads-api';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';

/**
 * Sync diario de metricas Google Ads.
 *
 * Cron: 06:00 America/Maceio (todos os dias) — sync incremental dos
 * ultimos 7 dias (overlap com syncs anteriores eh OK pq upsert eh idempotente).
 *
 * Tambem expoe job 'trafego-sync-account' (BullMQ) pra disparo manual via
 * botao "Sincronizar agora" no painel.
 *
 * Pipeline por conta ativa:
 *   1. GoogleAdsClientService.getCustomer() — monta cliente autenticado
 *   2. Query 1: campaigns (metadata) — atualiza TrafficCampaign
 *   3. Query 2: metrics_per_day_per_campaign — upsert em TrafficMetricDaily
 *   4. Marca campanhas que sumiram como is_archived_internal=true (?) — nao,
 *      mantem mas atualiza last_seen_at desatualizado: usuario decide
 *   5. Grava TrafficSyncLog (success/error/duration/rows)
 *
 * Sobre tipo de acesso: queries usadas funcionam em "Acesso as Analises"
 * (read-only metrics tier — nao precisa Basic Access).
 */
@Injectable()
@Processor('trafego-sync', { concurrency: 1 })
export class TrafegoSyncService extends WorkerHost {
  private readonly logger = new Logger(TrafegoSyncService.name);

  /** Default de dias pra sincronizar no cron diario. */
  private readonly DEFAULT_LOOKBACK_DAYS = 7;

  /** No primeiro sync de uma conta nova, vai buscar 30 dias. */
  private readonly INITIAL_LOOKBACK_DAYS = 30;

  constructor(
    private prisma: PrismaService,
    private adsClient: GoogleAdsClientService,
  ) {
    super();
  }

  // ─── Processor BullMQ ────────────────────────────────────────────────────

  /**
   * Job 'trafego-sync-account' (enfileirado pela API quando admin clica
   * "Sincronizar agora"). Tambem usado pelo cron pra cada conta.
   */
  async process(job: Job<{ accountId: string; trigger: 'CRON' | 'MANUAL' | 'OAUTH_CALLBACK' }>) {
    const { accountId, trigger } = job.data;
    await this.syncAccount(accountId, trigger);
  }

  // ─── Cron diario ─────────────────────────────────────────────────────────

  @Cron('0 6 * * *', { timeZone: 'America/Maceio' })
  async runDailySync() {
    const accounts = await this.prisma.trafficAccount.findMany({
      where: { status: 'ACTIVE' },
      include: {
        tenant: {
          select: {
            traffic_settings: { select: { sync_enabled: true } },
          },
        },
      },
    });

    if (accounts.length === 0) {
      this.logger.log('[TRAFEGO_SYNC] Nenhuma conta ativa — skip');
      return;
    }

    this.logger.log(`[TRAFEGO_SYNC] Sync diario de ${accounts.length} conta(s)`);

    for (const account of accounts) {
      const enabled = account.tenant?.traffic_settings?.sync_enabled ?? true;
      if (!enabled) continue;
      try {
        await this.syncAccount(account.id, 'CRON');
      } catch (e: any) {
        this.logger.error(
          `[TRAFEGO_SYNC] Erro sync conta ${account.id}: ${e.message}`,
        );
        // Continua pras proximas — erro de uma conta nao trava as outras
      }
    }
  }

  /**
   * Limpeza diaria: TrafficSyncLog mais antigos que 90 dias.
   */
  @Cron('30 2 * * *', { timeZone: 'America/Maceio' })
  async pruneOldSyncLogs() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const result = await this.prisma.trafficSyncLog.deleteMany({
      where: { started_at: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`[TRAFEGO_SYNC] Purge: ${result.count} log(s) > 90d removido(s)`);
    }
  }

  // ─── Sync de uma conta especifica ────────────────────────────────────────

  /**
   * Sincroniza campanhas + metricas diarias da conta. Idempotente
   * (upsert por (campaign_id, date)).
   */
  async syncAccount(
    accountId: string,
    trigger: 'CRON' | 'MANUAL' | 'OAUTH_CALLBACK',
  ) {
    const startedAt = new Date();
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      this.logger.warn(`[TRAFEGO_SYNC] Conta ${accountId} nao encontrada`);
      return;
    }

    // Decide range: primeiro sync da conta = lookback maior
    const isFirstSync = account.last_sync_at === null;
    const lookback = isFirstSync ? this.INITIAL_LOOKBACK_DAYS : this.DEFAULT_LOOKBACK_DAYS;
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - lookback);

    let customer: Customer;
    try {
      customer = await this.adsClient.getCustomer(account.tenant_id, account.id);
    } catch (e: any) {
      await this.recordFailure(account, trigger, startedAt, e);
      return;
    }

    let rowsUpserted = 0;
    let campaignsSeen = 0;

    try {
      // ─── 1. Campaigns (metadata) ───────────────────────────────────────
      const campaignRows: any[] = await customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.start_date,
          campaign.end_date,
          campaign.bidding_strategy_type,
          campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED'
      `);
      campaignsSeen = campaignRows.length;

      // Upsert em TrafficCampaign
      const campaignByGoogleId = new Map<string, string>(); // google_campaign_id -> our id
      for (const row of campaignRows) {
        const googleCampaignId = String(row.campaign?.id);
        const result = await this.prisma.trafficCampaign.upsert({
          where: {
            account_id_google_campaign_id: {
              account_id: account.id,
              google_campaign_id: googleCampaignId,
            },
          },
          update: {
            name: row.campaign?.name ?? '(sem nome)',
            status: row.campaign?.status ?? 'UNSPECIFIED',
            channel_type: row.campaign?.advertising_channel_type ?? null,
            daily_budget_micros: row.campaign_budget?.amount_micros
              ? BigInt(row.campaign_budget.amount_micros)
              : null,
            bidding_strategy: row.campaign?.bidding_strategy_type ?? null,
            start_date: row.campaign?.start_date ? new Date(row.campaign.start_date) : null,
            end_date: row.campaign?.end_date ? new Date(row.campaign.end_date) : null,
            last_seen_at: new Date(),
          },
          create: {
            tenant_id: account.tenant_id,
            account_id: account.id,
            google_campaign_id: googleCampaignId,
            name: row.campaign?.name ?? '(sem nome)',
            status: row.campaign?.status ?? 'UNSPECIFIED',
            channel_type: row.campaign?.advertising_channel_type ?? null,
            daily_budget_micros: row.campaign_budget?.amount_micros
              ? BigInt(row.campaign_budget.amount_micros)
              : null,
            bidding_strategy: row.campaign?.bidding_strategy_type ?? null,
            start_date: row.campaign?.start_date ? new Date(row.campaign.start_date) : null,
            end_date: row.campaign?.end_date ? new Date(row.campaign.end_date) : null,
          },
          select: { id: true, google_campaign_id: true },
        });
        campaignByGoogleId.set(result.google_campaign_id, result.id);
      }

      // ─── 2. Metricas diarias por campanha ──────────────────────────────
      const fromStr = dateFrom.toISOString().slice(0, 10); // YYYY-MM-DD
      const toStr = dateTo.toISOString().slice(0, 10);
      const metricRows: any[] = await customer.query(`
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

      for (const row of metricRows) {
        const googleCampaignId = String(row.campaign?.id);
        const ourCampaignId = campaignByGoogleId.get(googleCampaignId);
        if (!ourCampaignId) continue; // Campanha sumiu entre as 2 queries (raro)

        const dateStr = row.segments?.date;
        if (!dateStr) continue;

        const impressions = Number(row.metrics?.impressions ?? 0);
        const clicks = Number(row.metrics?.clicks ?? 0);
        const costMicros = BigInt(row.metrics?.cost_micros ?? 0);
        const conversions = Number(row.metrics?.conversions ?? 0);
        const conversionsValue = Number(row.metrics?.conversions_value ?? 0);
        const ctr = Number(row.metrics?.ctr ?? 0);
        const avgCpcMicros = row.metrics?.average_cpc
          ? BigInt(row.metrics.average_cpc)
          : null;
        const costPerConvMicros = row.metrics?.cost_per_conversion
          ? BigInt(row.metrics.cost_per_conversion)
          : null;

        await this.prisma.trafficMetricDaily.upsert({
          where: {
            campaign_id_date: {
              campaign_id: ourCampaignId,
              date: new Date(dateStr),
            },
          },
          update: {
            impressions,
            clicks,
            cost_micros: costMicros,
            conversions,
            conversions_value: conversionsValue,
            ctr,
            avg_cpc_micros: avgCpcMicros,
            cost_per_conv_micros: costPerConvMicros,
          },
          create: {
            tenant_id: account.tenant_id,
            account_id: account.id,
            campaign_id: ourCampaignId,
            date: new Date(dateStr),
            impressions,
            clicks,
            cost_micros: costMicros,
            conversions,
            conversions_value: conversionsValue,
            ctr,
            avg_cpc_micros: avgCpcMicros,
            cost_per_conv_micros: costPerConvMicros,
          },
        });
        rowsUpserted++;
      }

      // ─── 3. Atualiza metadata da conta (currency, timezone, name) ───────
      try {
        const customerInfo: any[] = await customer.query(`
          SELECT customer.descriptive_name, customer.currency_code, customer.time_zone
          FROM customer LIMIT 1
        `);
        const info = customerInfo[0]?.customer;
        if (info) {
          await this.prisma.trafficAccount.update({
            where: { id: account.id },
            data: {
              account_name: info.descriptive_name ?? account.account_name,
              currency_code: info.currency_code ?? account.currency_code,
              time_zone: info.time_zone ?? account.time_zone,
            },
          });
        }
      } catch (e: any) {
        // Nao critico — se falhar, segue
        this.logger.warn(`[TRAFEGO_SYNC] Falha lendo customer info: ${e.message}`);
      }

      // ─── 4. Sucesso — registra log + atualiza last_sync ─────────────────
      const finishedAt = new Date();
      await this.prisma.trafficSyncLog.create({
        data: {
          tenant_id: account.tenant_id,
          account_id: account.id,
          trigger,
          status: 'SUCCESS',
          date_from: dateFrom,
          date_to: dateTo,
          rows_upserted: rowsUpserted,
          campaigns_seen: campaignsSeen,
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          started_at: startedAt,
          finished_at: finishedAt,
        },
      });
      await this.prisma.trafficAccount.update({
        where: { id: account.id },
        data: {
          last_sync_at: finishedAt,
          last_error: null,
          status: 'ACTIVE',
        },
      });

      this.logger.log(
        `[TRAFEGO_SYNC] Conta ${account.customer_id}: ${campaignsSeen} campanhas, ${rowsUpserted} rows upsertadas em ${finishedAt.getTime() - startedAt.getTime()}ms`,
      );
    } catch (e: any) {
      await this.recordFailure(account, trigger, startedAt, e, {
        rowsUpserted,
        campaignsSeen,
        dateFrom,
        dateTo,
      });
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async recordFailure(
    account: any,
    trigger: 'CRON' | 'MANUAL' | 'OAUTH_CALLBACK',
    startedAt: Date,
    error: any,
    partial: {
      rowsUpserted?: number;
      campaignsSeen?: number;
      dateFrom?: Date;
      dateTo?: Date;
    } = {},
  ) {
    const { kind, message } = this.adsClient.formatError(error);
    const finishedAt = new Date();

    this.logger.error(
      `[TRAFEGO_SYNC] Conta ${account.customer_id} falhou (${kind}): ${message}`,
    );

    await this.prisma.trafficSyncLog.create({
      data: {
        tenant_id: account.tenant_id,
        account_id: account.id,
        trigger,
        status: partial.rowsUpserted ? 'PARTIAL' : 'ERROR',
        date_from: partial.dateFrom ?? null,
        date_to: partial.dateTo ?? null,
        rows_upserted: partial.rowsUpserted ?? 0,
        campaigns_seen: partial.campaignsSeen ?? 0,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        started_at: startedAt,
        finished_at: finishedAt,
        error_message: `[${kind}] ${message}`.slice(0, 2000),
      },
    });

    // Se token revogado, marca conta como ERROR pra evitar tentativas futuras
    if (kind === 'TokenRevoked') {
      await this.prisma.trafficAccount.update({
        where: { id: account.id },
        data: { status: 'ERROR', last_error: message },
      });
    } else {
      // Erro transiente — apenas anota mas mantem ACTIVE pra cron tentar amanha
      await this.prisma.trafficAccount.update({
        where: { id: account.id },
        data: { last_error: `[${kind}] ${message}`.slice(0, 500) },
      });
    }
  }
}
