import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateAccountDto,
  UpdateCampaignDto,
  UpdateSettingsDto,
} from './trafego.dto';

const MICROS_PER_BRL = 1_000_000n;

const toMicros = (brl: number | null | undefined): bigint | null => {
  if (brl === null || brl === undefined) return null;
  return BigInt(Math.round(brl * Number(MICROS_PER_BRL)));
};

const fromMicros = (micros: bigint | null | undefined): number | null => {
  if (micros === null || micros === undefined) return null;
  return Number(micros) / 1_000_000;
};

/**
 * Servico principal do modulo de trafego.
 *
 * Responsabilidades:
 *   - Leitura de TrafficAccount/Campaign/MetricDaily/Alert/Settings
 *   - Mutate de anotacoes internas (favorita, tags, notes — NAO toca no Google)
 *   - Mutate de settings (metas, thresholds, canais)
 *
 * NAO faz chamadas a Google Ads API direto — isso eh do worker.
 */
@Injectable()
export class TrafegoService {
  private readonly logger = new Logger(TrafegoService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Conta ──────────────────────────────────────────────────────────────

  async getAccount(tenantId: string) {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { tenant_id: tenantId },
      select: {
        id: true,
        customer_id: true,
        login_customer_id: true,
        authorized_email: true,
        account_name: true,
        currency_code: true,
        time_zone: true,
        status: true,
        last_sync_at: true,
        last_error: true,
        created_at: true,
      },
    });
    return account;
  }

  async updateAccount(tenantId: string, dto: UpdateAccountDto) {
    return this.prisma.trafficAccount.update({
      where: { tenant_id: tenantId },
      data: dto,
    });
  }

  async disconnectAccount(tenantId: string) {
    // Apaga refresh_token mas mantem o registro (status REVOKED) pra historico.
    await this.prisma.trafficAccount.update({
      where: { tenant_id: tenantId },
      data: {
        refresh_token_enc: '',
        status: 'REVOKED',
      },
    });
    return { ok: true };
  }

  // ─── Campanhas ──────────────────────────────────────────────────────────

  async listCampaigns(
    tenantId: string,
    opts: { includeArchived?: boolean } = {},
  ) {
    const campaigns = await this.prisma.trafficCampaign.findMany({
      where: {
        tenant_id: tenantId,
        ...(opts.includeArchived ? {} : { is_archived_internal: false }),
      },
      orderBy: [{ is_favorite: 'desc' }, { last_seen_at: 'desc' }],
    });

    // Serializa BigInt pra JSON-friendly
    return campaigns.map((c) => ({
      ...c,
      daily_budget_micros: c.daily_budget_micros?.toString() ?? null,
      daily_budget_brl: fromMicros(c.daily_budget_micros),
    }));
  }

  async updateCampaign(
    tenantId: string,
    campaignId: string,
    dto: UpdateCampaignDto,
  ) {
    const campaign = await this.prisma.trafficCampaign.findFirst({
      where: { id: campaignId, tenant_id: tenantId },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');

    return this.prisma.trafficCampaign.update({
      where: { id: campaignId },
      data: dto,
    });
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  async getSettings(tenantId: string) {
    let settings = await this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantId },
    });

    // Cria com defaults se ainda nao existe
    if (!settings) {
      settings = await this.prisma.trafficSettings.create({
        data: { tenant_id: tenantId },
      });
    }

    return this.serializeSettings(settings);
  }

  async updateSettings(tenantId: string, dto: UpdateSettingsDto) {
    const data: any = {};

    if (dto.target_cpl_brl !== undefined) {
      data.target_cpl_micros = toMicros(dto.target_cpl_brl);
    }
    if (dto.target_ctr !== undefined) data.target_ctr = dto.target_ctr;
    if (dto.target_roas !== undefined) data.target_roas = dto.target_roas;
    if (dto.target_daily_budget_brl !== undefined) {
      data.target_daily_budget_micros = toMicros(dto.target_daily_budget_brl);
    }
    if (dto.cpl_alert_threshold !== undefined)
      data.cpl_alert_threshold = dto.cpl_alert_threshold;
    if (dto.ctr_alert_threshold !== undefined)
      data.ctr_alert_threshold = dto.ctr_alert_threshold;
    if (dto.alert_window_days !== undefined)
      data.alert_window_days = dto.alert_window_days;
    if (dto.notify_email !== undefined) data.notify_email = dto.notify_email;
    if (dto.notify_whatsapp !== undefined)
      data.notify_whatsapp = dto.notify_whatsapp;
    if (dto.notify_whatsapp_phone !== undefined)
      data.notify_whatsapp_phone = dto.notify_whatsapp_phone;
    if (dto.notify_inapp !== undefined) data.notify_inapp = dto.notify_inapp;
    if (dto.sync_hour_local !== undefined)
      data.sync_hour_local = dto.sync_hour_local;
    if (dto.sync_enabled !== undefined) data.sync_enabled = dto.sync_enabled;

    const settings = await this.prisma.trafficSettings.upsert({
      where: { tenant_id: tenantId },
      update: data,
      create: { tenant_id: tenantId, ...data },
    });

    return this.serializeSettings(settings);
  }

  private serializeSettings(s: any) {
    return {
      ...s,
      target_cpl_micros: s.target_cpl_micros?.toString() ?? null,
      target_cpl_brl: fromMicros(s.target_cpl_micros),
      target_daily_budget_micros: s.target_daily_budget_micros?.toString() ?? null,
      target_daily_budget_brl: fromMicros(s.target_daily_budget_micros),
    };
  }

  // ─── Alertas ────────────────────────────────────────────────────────────

  async listAlerts(
    tenantId: string,
    opts: { status?: string; limit?: number } = {},
  ) {
    return this.prisma.trafficAlert.findMany({
      where: {
        tenant_id: tenantId,
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: opts.limit ?? 50,
    });
  }

  async acknowledgeAlert(
    tenantId: string,
    alertId: string,
    userId: string,
    status: string,
  ) {
    const alert = await this.prisma.trafficAlert.findFirst({
      where: { id: alertId, tenant_id: tenantId },
    });
    if (!alert) throw new NotFoundException('Alerta nao encontrado');

    return this.prisma.trafficAlert.update({
      where: { id: alertId },
      data: {
        status,
        acknowledged_by: userId,
        acknowledged_at: new Date(),
      },
    });
  }

  // ─── Sync logs ──────────────────────────────────────────────────────────

  async getSyncLogs(tenantId: string, limit = 20) {
    return this.prisma.trafficSyncLog.findMany({
      where: { tenant_id: tenantId },
      orderBy: { started_at: 'desc' },
      take: limit,
    });
  }

  // ─── Dashboard ──────────────────────────────────────────────────────────

  /**
   * Calcula KPIs e graficos do dashboard a partir de TrafficMetricDaily
   * + TrafficCampaign sincronizados pelo worker.
   *
   * Janelas de tempo (em America/Maceio):
   *   - Hoje: gasto/leads do dia atual
   *   - Mes: do dia 1 ate hoje
   *   - 7d: ultimos 7 dias (CPL, CTR, CPC medios)
   *   - 30d: ultimos 30 dias (timeseries + top_campaigns + ROAS)
   *
   * Valores monetarios saem em BRL (convertidos de micros: dividir por 1M).
   * Cuidado com BigInt — Prisma sum em BigInt, JS Number perde precisao
   * acima de 9 quadrilhoes mas pra gasto em micros (R$ 9 bilhoes em micros)
   * ainda ta safe.
   */
  async getDashboard(
    tenantId: string,
    _opts: {
      dateFrom?: string;
      dateTo?: string;
      channelType?: string;
    },
  ) {
    const account = await this.getAccount(tenantId);
    if (!account) {
      return {
        connected: false,
        message: 'Conecte uma conta Google Ads para ver dados.',
      };
    }
    if (account.status === 'PENDING') {
      return {
        connected: false,
        message:
          'OAuth conectado mas conta-alvo nao configurada. Defina GOOGLE_ADS_CUSTOMER_ID.',
      };
    }

    // Datas de referencia (UTC — TrafficMetricDaily.date eh @db.Date)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const monthStart = new Date(today);
    monthStart.setUTCDate(1);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    if (account.last_sync_at === null) {
      return {
        connected: true,
        synced: false,
        message: 'Conta conectada. Aguardando primeiro sync.',
        account,
      };
    }

    // ─── Aggregations paralelas ──────────────────────────────────────────
    const [
      todayAgg,
      monthAgg,
      last7dAgg,
      last30dAgg,
      campaignsCount,
      timeseries,
      topCampaigns,
    ] = await Promise.all([
      // Hoje
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: today },
        _sum: { cost_micros: true, conversions: true, clicks: true, impressions: true },
      }),
      // Mes corrente
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: { gte: monthStart } },
        _sum: { cost_micros: true, conversions: true },
      }),
      // 7 dias (medias)
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: { gte: sevenDaysAgo } },
        _sum: {
          cost_micros: true,
          clicks: true,
          impressions: true,
          conversions: true,
        },
      }),
      // 30 dias (ROAS)
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: { gte: thirtyDaysAgo } },
        _sum: { cost_micros: true, conversions_value: true },
      }),
      // Campaign counts por status
      this.prisma.trafficCampaign.groupBy({
        by: ['status'],
        where: { tenant_id: tenantId, is_archived_internal: false },
        _count: { _all: true },
      }),
      // Timeseries 30d agrupado por dia (gasto + leads)
      this.prisma.trafficMetricDaily.groupBy({
        by: ['date'],
        where: { tenant_id: tenantId, date: { gte: thirtyDaysAgo } },
        _sum: { cost_micros: true, conversions: true },
        orderBy: { date: 'asc' },
      }),
      // Top campanhas por menor CPL nos ultimos 7d (com pelo menos 1 conversao)
      this.prisma.trafficMetricDaily.groupBy({
        by: ['campaign_id'],
        where: {
          tenant_id: tenantId,
          date: { gte: sevenDaysAgo },
          conversions: { gt: 0 },
        },
        _sum: { cost_micros: true, conversions: true, clicks: true, impressions: true },
        orderBy: { _sum: { cost_micros: 'asc' } },
        take: 5,
      }),
    ]);

    // ─── KPIs ────────────────────────────────────────────────────────────
    const microsToBRL = (m: bigint | null | undefined): number =>
      m ? Number(m) / 1_000_000 : 0;

    const sumCostToday = microsToBRL(todayAgg._sum.cost_micros);
    const sumCostMonth = microsToBRL(monthAgg._sum.cost_micros);
    const sumCost7d = microsToBRL(last7dAgg._sum.cost_micros);
    const sumCost30d = microsToBRL(last30dAgg._sum.cost_micros);

    const conversions7d = Number(last7dAgg._sum.conversions ?? 0);
    const conversions30dValue = Number(last30dAgg._sum.conversions_value ?? 0);
    const clicks7d = Number(last7dAgg._sum.clicks ?? 0);
    const impressions7d = Number(last7dAgg._sum.impressions ?? 0);

    const cpl7d = conversions7d > 0 ? sumCost7d / conversions7d : 0;
    const ctr7d = impressions7d > 0 ? clicks7d / impressions7d : 0;
    const avgCpc7d = clicks7d > 0 ? sumCost7d / clicks7d : 0;
    const roas30d = sumCost30d > 0 ? conversions30dValue / sumCost30d : 0;

    const activeCount =
      campaignsCount.find((c) => c.status === 'ENABLED')?._count._all ?? 0;
    const pausedCount =
      campaignsCount.find((c) => c.status === 'PAUSED')?._count._all ?? 0;

    // ─── Top campaigns: enriquece com nome ─────────────────────────────
    const topCampaignIds = topCampaigns.map((t) => t.campaign_id);
    const campaignNames = await this.prisma.trafficCampaign.findMany({
      where: { id: { in: topCampaignIds } },
      select: { id: true, name: true, channel_type: true },
    });
    const nameMap = new Map(campaignNames.map((c) => [c.id, c]));

    const topCampaignsEnriched = topCampaigns.map((t) => {
      const meta = nameMap.get(t.campaign_id);
      const cost = microsToBRL(t._sum.cost_micros);
      const convs = Number(t._sum.conversions ?? 0);
      return {
        id: t.campaign_id,
        name: meta?.name ?? '(removida)',
        channel_type: meta?.channel_type ?? null,
        cost_brl: cost,
        conversions: convs,
        cpl_brl: convs > 0 ? cost / convs : 0,
      };
    });

    return {
      connected: true,
      synced: true,
      account,
      kpis: {
        spend_today_brl: sumCostToday,
        spend_month_brl: sumCostMonth,
        leads_today: Number(todayAgg._sum.conversions ?? 0),
        cpl_brl: cpl7d,
        ctr: ctr7d,
        avg_cpc_brl: avgCpc7d,
        roas_estimated: roas30d,
        active_campaigns: activeCount,
        paused_campaigns: pausedCount,
      },
      timeseries: timeseries.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        spend_brl: microsToBRL(d._sum.cost_micros),
        leads: Number(d._sum.conversions ?? 0),
      })),
      top_campaigns: topCampaignsEnriched,
      at_risk_campaigns: [],
      ranges: {
        today: todayStr,
        month_start: monthStart.toISOString().slice(0, 10),
        seven_days_ago: sevenDaysAgo.toISOString().slice(0, 10),
        thirty_days_ago: thirtyDaysAgo.toISOString().slice(0, 10),
      },
    };
  }
}
