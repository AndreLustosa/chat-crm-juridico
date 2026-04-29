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

  // ─── Dashboard (placeholder — implementacao real na Fase 3) ─────────────

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
    if (account.last_sync_at === null) {
      return {
        connected: true,
        synced: false,
        message: 'Conta conectada. Aguardando primeiro sync.',
        account,
      };
    }

    // Implementacao real virá na Fase 3 — agora retorna estrutura vazia
    // pra UI conseguir renderizar sem quebrar.
    return {
      connected: true,
      synced: true,
      account,
      kpis: {
        spend_today_brl: 0,
        spend_month_brl: 0,
        leads_today: 0,
        cpl_brl: 0,
        ctr: 0,
        avg_cpc_brl: 0,
        roas_estimated: 0,
        active_campaigns: 0,
        paused_campaigns: 0,
      },
      timeseries: [],
      top_campaigns: [],
      at_risk_campaigns: [],
    };
  }
}
