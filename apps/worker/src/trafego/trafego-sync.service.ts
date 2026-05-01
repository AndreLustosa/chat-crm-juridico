import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import type { Customer } from 'google-ads-api';
import { enums } from 'google-ads-api';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { TrafegoAlertEvaluatorService } from './trafego-alert-evaluator.service';
import { TrafegoAlertNotifierService } from './trafego-alert-notifier.service';
import { TrafegoSyncExtendedService } from './trafego-sync-extended.service';

// ─── Helpers de conversao de tipos do Google Ads API → Prisma ──────────────
//
// Google Ads API declara varios campos como int64 mas a API computa alguns
// como divisao (ex: average_cpc = cost_micros / clicks) e devolve floats
// mesmo nesses campos "inteiros". Sem arredondamento, BigInt() lanca
// "RangeError: cannot be converted to BigInt because it is not an integer".
//
// Centralizamos aqui pra nao ter caso-a-caso espalhado.

/** SDK retorna enums proto como inteiros (status=3); UI/dashboard espera
 *  strings nominais (status='PAUSED'). Reverse-mapping via enum bidirecional. */
function enumToStr<E extends Record<number | string, any>>(
  enumObj: E,
  value: number | undefined | null,
  fallback: string | null = null,
): string | null {
  if (value === undefined || value === null) return fallback;
  return (enumObj[value] as string) ?? fallback;
}

/**
 * Converte qualquer valor (number, string, BigInt) pra BigInt seguro.
 * Arredonda decimais (Math.round) — necessario pra campos como
 * average_cpc / cost_per_conversion que vem como float mesmo declarados
 * como int64 na API. Retorna null pra valores ausentes/invalidos.
 */
function toBigIntSafe(
  value: number | string | bigint | null | undefined,
): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return null;
  return BigInt(Math.round(num));
}

/** Converte pra Number defensivamente. Strings → numero, NaN → fallback. */
function toNumberSafe(
  value: number | string | null | undefined,
  fallback = 0,
): number {
  if (value === null || value === undefined || value === '') return fallback;
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : fallback;
}

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
    private alertEvaluator: TrafegoAlertEvaluatorService,
    private alertNotifier: TrafegoAlertNotifierService,
    private syncExtended: TrafegoSyncExtendedService,
  ) {
    super();
  }

  // ─── Processor BullMQ ────────────────────────────────────────────────────

  /**
   * Process jobs. Roteia por job.name:
   *   - 'trafego-sync-account': sync completo (queries Google + upsert + alertas)
   *   - 'trafego-evaluate-alerts': re-avalia regras sem rodar sync
   *     (util pra testar regras ou re-avaliar apos admin mudar thresholds)
   */
  async process(
    job: Job<{
      accountId: string;
      trigger?: 'CRON' | 'MANUAL' | 'OAUTH_CALLBACK';
    }>,
  ) {
    if (job.name === 'trafego-evaluate-alerts') {
      const newAlertIds = await this.alertEvaluator.evaluateForAccount(
        job.data.accountId,
      );
      if (newAlertIds.length > 0) {
        await this.alertNotifier.notifyAlerts(newAlertIds);
      }
      this.logger.log(
        `[TRAFEGO_EVAL] Conta ${job.data.accountId}: ${newAlertIds.length} alerta(s) novos`,
      );
      return;
    }
    // default: sync
    const { accountId, trigger = 'MANUAL' } = job.data;
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
      // start_date/end_date sao "Unrecognized" por google-ads-api v23
      // (provavel mismatch entre versao do SDK e da API). Removidos pra
      // destravar — campos do schema continuam nullable, ficam null.
      const campaignRows: any[] = await customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.bidding_strategy_type,
          campaign.campaign_budget,
          campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED'
      `);
      campaignsSeen = campaignRows.length;

      // Upsert em TrafficCampaign
      const campaignByGoogleId = new Map<string, string>(); // google_campaign_id -> our id
      for (const row of campaignRows) {
        const googleCampaignId = String(row.campaign?.id);

        const baseData = {
          name: row.campaign?.name ?? '(sem nome)',
          // Enums do SDK vem como inteiro; converte pra nome string
          // ('ENABLED' | 'PAUSED' | 'REMOVED' | etc) que o resto do
          // sistema (UI, dashboard) consome.
          status:
            enumToStr(enums.CampaignStatus, row.campaign?.status, 'UNSPECIFIED') ??
            'UNSPECIFIED',
          channel_type: enumToStr(
            enums.AdvertisingChannelType,
            row.campaign?.advertising_channel_type,
          ),
          daily_budget_micros: toBigIntSafe(row.campaign_budget?.amount_micros),
          budget_resource_name:
            typeof row.campaign?.campaign_budget === 'string' &&
            row.campaign.campaign_budget.length > 0
              ? row.campaign.campaign_budget
              : null,
          bidding_strategy: enumToStr(
            enums.BiddingStrategyType,
            row.campaign?.bidding_strategy_type,
          ),
        };

        const upserted = await this.prisma.trafficCampaign.upsert({
          where: {
            account_id_google_campaign_id: {
              account_id: account.id,
              google_campaign_id: googleCampaignId,
            },
          },
          update: { ...baseData, last_seen_at: new Date() },
          create: {
            tenant_id: account.tenant_id,
            account_id: account.id,
            google_campaign_id: googleCampaignId,
            ...baseData,
          },
        });
        // googleCampaignId ja temos no escopo, evita depender de select
        campaignByGoogleId.set(googleCampaignId, upserted.id);
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

        // ─── Conversoes seguras de tipo ─────────────────────────────────
        // BigInt's via toBigIntSafe (lida com float — average_cpc e
        // cost_per_conversion sao calculados como divisao pela API e
        // podem vir decimais mesmo declarados como int64).
        // Number's via toNumberSafe (lida com string-numero do SDK).
        const impressions = toNumberSafe(row.metrics?.impressions);
        const clicks = toNumberSafe(row.metrics?.clicks);
        const costMicros = toBigIntSafe(row.metrics?.cost_micros) ?? 0n;
        const conversions = toNumberSafe(row.metrics?.conversions);
        const conversionsValue = toNumberSafe(row.metrics?.conversions_value);
        const ctr = toNumberSafe(row.metrics?.ctr);
        const avgCpcMicros = toBigIntSafe(row.metrics?.average_cpc);
        const costPerConvMicros = toBigIntSafe(row.metrics?.cost_per_conversion);

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

      // ─── 2.5. Sync expandido (budgets, ad_groups, keywords, ads) ────────
      // Roda em try interno: falhas individuais nao matam o sync principal
      // (campanhas + metricas ja foram persistidas).
      //
      // Sub-erros (ext.errors) sao propagados pro TrafficSyncLog.error_message
      // mesmo em status SUCCESS — sem isso, conversion_actions/keywords
      // falhando ficavam invisiveis pro admin (so log do servidor).
      let extendedErrors: string[] = [];
      try {
        const ext = await this.syncExtended.syncExtended(
          customer,
          account.tenant_id,
          account.id,
          campaignByGoogleId,
        );
        this.logger.log(
          `[TRAFEGO_SYNC] Extended: ${ext.budgets} budgets, ${ext.adGroups} ad_groups, ${ext.keywords} keywords, ${ext.ads} ads, ${ext.conversionActions} conv_actions` +
            (ext.errors.length > 0 ? ` (${ext.errors.length} sub-erros)` : ''),
        );
        extendedErrors = ext.errors;
      } catch (extErr: any) {
        const msg = `sync-extended fatal: ${extErr?.message ?? extErr}`;
        this.logger.warn(`[TRAFEGO_SYNC] ${msg}`);
        extendedErrors = [msg];
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
      // Se sub-syncs (conversion_actions, keywords, ads) falharam mas
      // metricas principais persistiram, marca PARTIAL e expoe os sub-erros
      // em error_message — admin enxerga em /trafego/sync-logs sem precisar
      // de acesso aos logs do container.
      const finishedAt = new Date();
      const hasExtendedErrors = extendedErrors.length > 0;
      await this.prisma.trafficSyncLog.create({
        data: {
          tenant_id: account.tenant_id,
          account_id: account.id,
          trigger,
          status: hasExtendedErrors ? 'PARTIAL' : 'SUCCESS',
          date_from: dateFrom,
          date_to: dateTo,
          rows_upserted: rowsUpserted,
          campaigns_seen: campaignsSeen,
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          started_at: startedAt,
          finished_at: finishedAt,
          error_message: hasExtendedErrors
            ? extendedErrors.join('\n').slice(0, 2000)
            : null,
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

      // ─── 5. Avaliacao de alertas (pos-sync) ────────────────────────────
      // Roda em try separado: sync ja foi sucesso, falha aqui nao deve
      // marcar a conta como erro nem reverter o estado.
      try {
        const newAlertIds = await this.alertEvaluator.evaluateForAccount(
          account.id,
        );
        if (newAlertIds.length > 0) {
          await this.alertNotifier.notifyAlerts(newAlertIds);
        }
      } catch (alertError: any) {
        this.logger.error(
          `[TRAFEGO_SYNC] Avaliacao de alertas falhou (sync ja OK): ${alertError.message}`,
        );
      }
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
