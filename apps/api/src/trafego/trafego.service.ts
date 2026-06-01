import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateAccountDto,
  UpdateCampaignDto,
  UpdateSettingsDto,
} from './trafego.dto';
import {
  buildTrafegoSnapshotPdf,
  TrafegoSnapshotData,
} from '../reports/templates/trafego-snapshot';

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
    opts: { includeArchived?: boolean; days?: number } = {},
  ) {
    // Janela default 30d para metrics agregados — UI passa days=30 explicito.
    // Bound entre 1 e 90 pra evitar agg pesado em base grande.
    const windowDays = Math.min(90, Math.max(1, opts.days ?? 30));

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

    const [campaigns, perCampaignAgg, perCampaignShareAvg, adStrengthAgg, allSchedules] =
      await Promise.all([
        this.prisma.trafficCampaign.findMany({
          where: {
            tenant_id: tenantId,
            ...(opts.includeArchived
              ? {}
              : { is_archived_internal: false, status: { not: 'REMOVED' } }),
          },
          orderBy: [{ is_favorite: 'desc' }, { last_seen_at: 'desc' }],
        }),
        this.prisma.trafficMetricDaily.groupBy({
          by: ['campaign_id'],
          where: {
            tenant_id: tenantId,
            date: { gte: windowStart },
          },
          _sum: {
            cost_micros: true,
            impressions: true,
            clicks: true,
            conversions: true,
          },
        }),
        // P2: avg de impression_share na janela. Usamos _avg (Prisma)
        // — Google retorna 0..1 por dia, média de N dias = visão "típica".
        this.prisma.trafficMetricDaily.groupBy({
          by: ['campaign_id'],
          where: {
            tenant_id: tenantId,
            date: { gte: windowStart },
            search_impression_share: { not: null },
          },
          _avg: {
            search_impression_share: true,
            search_lost_is_budget: true,
            search_lost_is_rank: true,
            search_top_impression_share: true,
            search_abs_top_impression_share: true,
          },
        }),
        // P2: best ad_strength por campanha. Joinea via ad_group_id no
        // worst-case mas como Prisma groupBy não suporta join, agrupamos
        // ads ENABLED por ad_group e depois mapeamos no service.
        this.prisma.trafficAd.findMany({
          where: {
            tenant_id: tenantId,
            status: 'ENABLED',
            ad_strength: { not: null },
          },
          select: {
            ad_strength: true,
            ad_group: { select: { campaign_id: true } },
          },
        }),
        // Ad schedule (todas as campaigns) — uma unica query, agrupa
        // depois no client. Sem isso teriamos N+1 (1 query por campaign).
        // findMany simples + orderBy do indice (campaign_id) eh o mais
        // eficiente — TrafficAdSchedule ja indexa por campaign_id.
        this.prisma.trafficAdSchedule.findMany({
          where: { tenant_id: tenantId },
          orderBy: [{ campaign_id: 'asc' }, { day_of_week: 'asc' }, { start_hour: 'asc' }],
          select: {
            campaign_id: true,
            day_of_week: true,
            start_hour: true,
            start_minute: true,
            end_hour: true,
            end_minute: true,
            bid_modifier: true,
          },
        }),
      ]);

    const aggMap = new Map(perCampaignAgg.map((a) => [a.campaign_id, a._sum]));
    const shareMap = new Map(
      perCampaignShareAvg.map((a) => [a.campaign_id, a._avg]),
    );

    // Agrupa schedules por campaign_id (mantem ordem do orderBy).
    // Mantemos bid_modifier:null pra preservar compat com UI (mostra "Padrao"
    // em vez de "+0%"). Helper enrich trata null como 1.0 internamente.
    const schedulesByCampaign = new Map<
      string,
      Array<{
        day_of_week: string;
        start_hour: number;
        start_minute: number;
        end_hour: number;
        end_minute: number;
        bid_modifier: number | null;
      }>
    >();
    for (const s of allSchedules) {
      const arr = schedulesByCampaign.get(s.campaign_id) ?? [];
      arr.push({
        day_of_week: s.day_of_week,
        start_hour: s.start_hour,
        start_minute: s.start_minute,
        end_hour: s.end_hour,
        end_minute: s.end_minute,
        bid_modifier: s.bid_modifier ? Number(s.bid_modifier) : null,
      });
      schedulesByCampaign.set(s.campaign_id, arr);
    }

    // Best ad_strength por campanha (POOR=1, AVERAGE=2, GOOD=3, EXCELLENT=4)
    const STRENGTH_RANK: Record<string, number> = {
      EXCELLENT: 4,
      GOOD: 3,
      AVERAGE: 2,
      POOR: 1,
      PENDING: 0,
      NO_ADS: 0,
    };
    const bestStrengthByCampaign = new Map<string, string>();
    for (const ad of adStrengthAgg) {
      const cid = ad.ad_group?.campaign_id;
      if (!cid || !ad.ad_strength) continue;
      const current = bestStrengthByCampaign.get(cid);
      if (
        !current ||
        (STRENGTH_RANK[ad.ad_strength] ?? 0) > (STRENGTH_RANK[current] ?? 0)
      ) {
        bestStrengthByCampaign.set(cid, ad.ad_strength);
      }
    }

    // Serializa BigInt pra JSON-friendly + agrega metrics_window + imp_share
    return campaigns.map((c) => {
      const agg = aggMap.get(c.id);
      const share = shareMap.get(c.id);
      const cost = agg?.cost_micros ? Number(agg.cost_micros) / 1_000_000 : 0;
      const conversions = Number(agg?.conversions ?? 0);
      const clicks = Number(agg?.clicks ?? 0);
      const impressions = Number(agg?.impressions ?? 0);
      // Ad schedule enriched (uso o helper compartilhado com getCampaignSchedule).
      // Cache local TrafficAdSchedule eh populado pelo sync — se a campanha
      // nao tem slots, retorna {is_24_7:true, slots:[], summary:"24/7"}.
      const adSchedule = this.enrichScheduleData(
        schedulesByCampaign.get(c.id) ?? [],
      );
      return {
        ...c,
        daily_budget_micros: c.daily_budget_micros?.toString() ?? null,
        daily_budget_brl: fromMicros(c.daily_budget_micros),
        // Best ad_strength entre os ads ENABLED dessa campanha
        ad_strength: bestStrengthByCampaign.get(c.id) ?? null,
        // Ad schedule resumido — pra UI/MCP ver dayparting sem chamada extra
        ad_schedule: adSchedule,
        metrics_window: {
          days: windowDays,
          spend_brl: cost,
          conversions,
          clicks,
          impressions,
          cpl_brl: conversions > 0 ? cost / conversions : 0,
          ctr: impressions > 0 ? clicks / impressions : 0,
          avg_cpc_brl: clicks > 0 ? cost / clicks : 0,
          // P2: impression share médio na janela
          impression_share: share?.search_impression_share
            ? Number(share.search_impression_share)
            : null,
          lost_is_budget: share?.search_lost_is_budget
            ? Number(share.search_lost_is_budget)
            : null,
          lost_is_rank: share?.search_lost_is_rank
            ? Number(share.search_lost_is_rank)
            : null,
          top_impression_share: share?.search_top_impression_share
            ? Number(share.search_top_impression_share)
            : null,
          abs_top_impression_share: share?.search_abs_top_impression_share
            ? Number(share.search_abs_top_impression_share)
            : null,
        },
      };
    });
  }

  // ─── P3: Ad Schedule ───────────────────────────────────────────────────

  /**
   * Lista o agendamento atual de uma campanha (cache local sincronizado
   * pelo syncAdSchedules).
   */
  async getAuctionInsights(
    tenantId: string,
    opts: {
      days?: number;
      startDate?: string;
      endDate?: string;
      campaignId?: string;
    } = {},
  ) {
    const parseDateOnly = (value?: string) => {
      if (!value) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('Data invalida. Use YYYY-MM-DD.');
      }
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('Data invalida. Use YYYY-MM-DD.');
      }
      return date;
    };

    const formatDateOnly = (date: Date | null | undefined) =>
      date ? date.toISOString().slice(0, 10) : null;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const explicitStart = parseDateOnly(opts.startDate);
    const explicitEnd = parseDateOnly(opts.endDate);
    const rangeEnd = explicitEnd ?? yesterday;
    const requestedDays = Math.min(365, Math.max(1, opts.days ?? 30));
    const rangeStart = explicitStart ?? new Date(rangeEnd);
    if (!explicitStart) {
      rangeStart.setUTCDate(rangeStart.getUTCDate() - requestedDays + 1);
    }

    if (rangeStart > rangeEnd) {
      throw new BadRequestException('A data inicial nao pode ser maior que a final.');
    }

    const windowDays =
      Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1;
    if (windowDays > 365) {
      throw new BadRequestException('O periodo maximo para leilao e de 365 dias.');
    }

    if (opts.campaignId) {
      const campaign = await this.prisma.trafficCampaign.findFirst({
        where: { id: opts.campaignId, tenant_id: tenantId },
        select: { id: true },
      });
      if (!campaign) throw new NotFoundException('Campanha nao encontrada');
    }

    const where = {
      tenant_id: tenantId,
      date: { gte: rangeStart, lte: rangeEnd },
      ...(opts.campaignId ? { campaign_id: opts.campaignId } : {}),
    };

    const [domains, self, auctionCoverage, lastAuctionSyncError, latestSync] =
      await Promise.all([
      this.prisma.trafficAuctionInsightDaily.groupBy({
        by: ['domain'],
        where,
        _avg: {
          impression_share: true,
          overlap_rate: true,
          position_above_rate: true,
          top_impression_rate: true,
          abs_top_impression_rate: true,
          outranking_share: true,
        },
        _count: { _all: true },
      }),
      this.prisma.trafficMetricDaily.aggregate({
        where,
        _avg: {
          search_impression_share: true,
          search_top_impression_share: true,
          search_abs_top_impression_share: true,
        },
      }),
      this.prisma.trafficAuctionInsightDaily.aggregate({
        where,
        _count: { _all: true },
        _min: { date: true },
        _max: { date: true },
      }),
      this.prisma.trafficSyncLog.findFirst({
        where: {
          tenant_id: tenantId,
          error_message: { contains: 'auction insights' },
        },
        orderBy: { started_at: 'desc' },
        select: { error_message: true, started_at: true },
      }),
      this.prisma.trafficSyncLog.findFirst({
        where: { tenant_id: tenantId },
        orderBy: { started_at: 'desc' },
        select: {
          status: true,
          date_from: true,
          date_to: true,
          started_at: true,
          error_message: true,
        },
      }),
    ]);

    const rows = domains
      .map((d) => ({
        domain: d.domain,
        impression_share:
          d._avg.impression_share === null
            ? null
            : Number(d._avg.impression_share),
        overlap_rate:
          d._avg.overlap_rate === null ? null : Number(d._avg.overlap_rate),
        position_above_rate:
          d._avg.position_above_rate === null
            ? null
            : Number(d._avg.position_above_rate),
        top_impression_rate:
          d._avg.top_impression_rate === null
            ? null
            : Number(d._avg.top_impression_rate),
        abs_top_impression_rate:
          d._avg.abs_top_impression_rate === null
            ? null
            : Number(d._avg.abs_top_impression_rate),
        outranking_share:
          d._avg.outranking_share === null
            ? null
            : Number(d._avg.outranking_share),
        samples: d._count._all,
      }))
      .sort(
        (a, b) =>
          (b.impression_share ?? -1) - (a.impression_share ?? -1) ||
          (b.overlap_rate ?? -1) - (a.overlap_rate ?? -1),
      );

    return {
      days: windowDays,
      date_from: formatDateOnly(rangeStart),
      date_to: formatDateOnly(rangeEnd),
      self: {
        impression_share:
          self._avg.search_impression_share === null
            ? null
            : Number(self._avg.search_impression_share),
        top_impression_rate:
          self._avg.search_top_impression_share === null
            ? null
            : Number(self._avg.search_top_impression_share),
        abs_top_impression_rate:
          self._avg.search_abs_top_impression_share === null
            ? null
            : Number(self._avg.search_abs_top_impression_share),
      },
      rows,
      coverage: {
        auction_rows: auctionCoverage._count._all,
        date_from: formatDateOnly(auctionCoverage._min.date),
        date_to: formatDateOnly(auctionCoverage._max.date),
      },
      latest_sync: latestSync
        ? {
            status: latestSync.status,
            date_from: formatDateOnly(latestSync.date_from),
            date_to: formatDateOnly(latestSync.date_to),
            started_at: latestSync.started_at,
            error_message: latestSync.error_message,
          }
        : null,
      unavailable_reason:
        rows.length === 0 && lastAuctionSyncError?.error_message
          ? lastAuctionSyncError.error_message
          : null,
      last_error_at: lastAuctionSyncError?.started_at ?? null,
    };
  }

  /**
   * Retorna o ad_schedule de uma campanha — slots brutos + summary humanizado
   * + flags (is_24_7, has_custom_bid_modifiers) + timezone da conta +
   * warning de freshness (se ultimo sync >24h).
   *
   * Aceita UUID interno OU google_campaign_id (via requireCampaign).
   *
   * include_history=true anexa ultimas 10 mutacoes via TrafficMutateLog
   * filtrado por resource_type='campaign_criterion' + context.campaign_id_local.
   */
  async getCampaignSchedule(
    tenantId: string,
    campaignIdOrGoogleId: string,
    opts: { includeHistory?: boolean } = {},
  ) {
    const campaign = await this.requireCampaign(tenantId, campaignIdOrGoogleId);

    const [items, account] = await Promise.all([
      this.prisma.trafficAdSchedule.findMany({
        where: { campaign_id: campaign.id },
        orderBy: [{ day_of_week: 'asc' }, { start_hour: 'asc' }],
      }),
      this.prisma.trafficAccount.findUnique({
        where: { id: campaign.account_id },
        select: { time_zone: true, last_sync_at: true },
      }),
    ]);

    const slots = items.map((s) => ({
      id: s.id,
      google_criterion_id: s.google_criterion_id,
      day_of_week: s.day_of_week,
      start_hour: s.start_hour,
      start_minute: s.start_minute,
      end_hour: s.end_hour,
      end_minute: s.end_minute,
      // null = sem ajuste (padrao 1.0). Mantemos null pra UI exibir
      // "Padrao" vs "+X%". O helper enrich trata null como 1.0 internamente.
      bid_modifier: s.bid_modifier ? Number(s.bid_modifier) : null,
    }));

    const enriched = this.enrichScheduleData(slots);

    // Freshness warning — se a conta nao sincroniza ha mais de 24h, o cache
    // local pode estar defasado em relacao ao Google Ads.
    const warnings: string[] = [];
    if (account?.last_sync_at) {
      const hoursAgo =
        (Date.now() - account.last_sync_at.getTime()) / 3_600_000;
      if (hoursAgo > 24) {
        warnings.push(
          `Schedule pode estar defasado: ultima sync da conta ha ${Math.floor(hoursAgo)}h. Considere disparar traffic_trigger_sync antes de mutar.`,
        );
      }
    }
    if (campaign.status === 'REMOVED') {
      warnings.push(
        'Campanha esta REMOVED — schedule mostrado eh do ultimo estado conhecido.',
      );
    }

    // History opcional — todas as mutacoes de campaign_criterion sao
    // logadas no TrafficMutateLog com context.campaign_id_local. Filtra
    // por campaign_id_local + resource_type=campaign_criterion (cobre
    // create/remove gerados pelo update_schedule, que faz substituicao).
    let history: Array<{
      mutate_log_id: string;
      operation: string;
      initiator: string;
      changed_at: string;
      status: string;
    }> | undefined;
    if (opts.includeHistory) {
      const logs = await this.prisma.trafficMutateLog.findMany({
        where: {
          tenant_id: tenantId,
          resource_type: 'campaign_criterion',
          status: { in: ['SUCCESS', 'PARTIAL'] },
          // Filtra por campaign_id_local dentro do JSON context
          context: { path: ['campaign_id_local'], equals: campaign.id },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          id: true,
          operation: true,
          initiator: true,
          status: true,
          created_at: true,
        },
      });
      history = logs.map((l) => ({
        mutate_log_id: l.id,
        operation: l.operation,
        initiator: l.initiator,
        changed_at: l.created_at.toISOString(),
        status: l.status,
      }));
    }

    return {
      campaign_id_local: campaign.id,
      google_campaign_id: campaign.google_campaign_id,
      campaign_name: campaign.name,
      campaign_status: campaign.status,
      time_zone: account?.time_zone ?? null,
      ...enriched,
      ...(warnings.length > 0 && { warnings }),
      ...(history && { history }),
    };
  }

  /**
   * Helper compartilhado — gera summary humanizado a partir dos slots.
   * Usado por getCampaignSchedule + listCampaigns (enriquecimento).
   *
   * Heuristicas (em ordem):
   *  1. slots vazios       → "24/7"
   *  2. 7 dias mesmas horas → "Todos os dias HH:MM-HH:MM"
   *  3. Mon-Fri so          → "Seg-Sex HH:MM-HH:MM"
   *  4. Sat+Sun so          → "Sab-Dom HH:MM-HH:MM"
   *  5. fallback            → "N slots customizados"
   *
   * Se algum slot tem bid_modifier != 1.0, sufixa " (com bid modifier)".
   */
  private enrichScheduleData(
    slots: Array<{
      day_of_week: string;
      start_hour: number;
      start_minute: number;
      end_hour: number;
      end_minute: number;
      bid_modifier: number | null;
    }>,
  ) {
    // null = padrao 1.0 (sem ajuste). So conta como "custom" se != 1.0.
    const has_custom_bid_modifiers = slots.some((s) => {
      if (s.bid_modifier === null || s.bid_modifier === undefined) return false;
      return Math.abs(s.bid_modifier - 1.0) > 0.001;
    });
    const summary = this.buildScheduleSummary(slots, has_custom_bid_modifiers);
    return {
      is_24_7: slots.length === 0,
      summary,
      slots_count: slots.length,
      has_custom_bid_modifiers,
      slots,
    };
  }

  private buildScheduleSummary(
    slots: Array<{
      day_of_week: string;
      start_hour: number;
      start_minute: number;
      end_hour: number;
      end_minute: number;
      bid_modifier: number | null;
    }>,
    hasCustomBidModifiers: boolean,
  ): string {
    if (slots.length === 0) return '24/7';

    const fmtTime = (h: number, m: number) =>
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const fmtWindow = (s: (typeof slots)[number]) =>
      `${fmtTime(s.start_hour, s.start_minute)}-${fmtTime(s.end_hour, s.end_minute)}`;

    const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
    const WEEKEND = ['SATURDAY', 'SUNDAY'];
    const ALL_DAYS = [...WEEKDAYS, ...WEEKEND];

    // Agrupa slots por janela (HH:MM-HH:MM). Se todos os dias em um grupo
    // tem a MESMA janela, podemos resumir.
    const byWindow = new Map<string, Set<string>>();
    for (const s of slots) {
      const w = fmtWindow(s);
      const set = byWindow.get(w) ?? new Set<string>();
      set.add(s.day_of_week);
      byWindow.set(w, set);
    }

    const suffix = hasCustomBidModifiers ? ' (com bid modifier)' : '';

    // Caso 1: 1 unica janela cobrindo todos os 7 dias
    if (byWindow.size === 1) {
      const [window, days] = [...byWindow.entries()][0];
      const dayCount = days.size;
      if (dayCount === 7 && ALL_DAYS.every((d) => days.has(d))) {
        return `Todos os dias ${window}${suffix}`;
      }
      if (dayCount === 5 && WEEKDAYS.every((d) => days.has(d))) {
        return `Seg-Sex ${window}${suffix}`;
      }
      if (dayCount === 2 && WEEKEND.every((d) => days.has(d))) {
        return `Sab-Dom ${window}${suffix}`;
      }
    }

    // Caso 2: 2 janelas — Mon-Fri e Sat-Sun com janelas diferentes
    if (byWindow.size === 2) {
      const entries = [...byWindow.entries()];
      const weekdayEntry = entries.find(
        ([_, days]) =>
          days.size === 5 && WEEKDAYS.every((d) => days.has(d)),
      );
      const weekendEntry = entries.find(
        ([_, days]) =>
          days.size === 2 && WEEKEND.every((d) => days.has(d)),
      );
      if (weekdayEntry && weekendEntry) {
        return `Seg-Sex ${weekdayEntry[0]} + Sab-Dom ${weekendEntry[0]}${suffix}`;
      }
    }

    // Fallback — caso geral
    return `${slots.length} slots customizados (use traffic_get_schedule pra detalhe)${suffix}`;
  }

  // ─── P2: Hourly + Device endpoints (detalhe campanha) ──────────────────

  /**
   * Métricas hora × dia da semana de uma campanha (últimos N dias, default
   * 30). Já retorna agregado pra heatmap (24×7 = 168 buckets).
   */
  async getCampaignHourlyMetrics(
    tenantId: string,
    campaignId: string,
    days = 30,
  ) {
    await this.requireCampaign(tenantId, campaignId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - days);

    const rows = await this.prisma.trafficMetricHourly.findMany({
      where: {
        campaign_id: campaignId,
        date: { gte: windowStart },
      },
      select: {
        date: true,
        hour: true,
        impressions: true,
        clicks: true,
        cost_micros: true,
        conversions: true,
      },
    });

    // Agrega por (dow, hour). dow: 0=Dom..6=Sab (UTC do db.Date).
    type Cell = {
      dow: number;
      hour: number;
      impressions: number;
      clicks: number;
      cost_brl: number;
      conversions: number;
    };
    const grid = new Map<string, Cell>();
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        grid.set(`${dow}-${hour}`, {
          dow,
          hour,
          impressions: 0,
          clicks: 0,
          cost_brl: 0,
          conversions: 0,
        });
      }
    }
    for (const r of rows) {
      const dow = r.date.getUTCDay();
      const key = `${dow}-${r.hour}`;
      const cell = grid.get(key);
      if (!cell) continue;
      cell.impressions += r.impressions;
      cell.clicks += r.clicks;
      cell.cost_brl += Number(r.cost_micros) / 1_000_000;
      cell.conversions += Number(r.conversions);
    }

    return {
      days,
      cells: [...grid.values()].map((c) => ({
        ...c,
        cpl_brl: c.conversions > 0 ? c.cost_brl / c.conversions : 0,
        ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
      })),
    };
  }

  /**
   * Métricas por dispositivo agregadas no período (default 30d).
   */
  async getCampaignDeviceMetrics(
    tenantId: string,
    campaignId: string,
    days = 30,
  ) {
    await this.requireCampaign(tenantId, campaignId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - days);

    const aggs = await this.prisma.trafficMetricDevice.groupBy({
      by: ['device'],
      where: {
        campaign_id: campaignId,
        date: { gte: windowStart },
      },
      _sum: {
        impressions: true,
        clicks: true,
        cost_micros: true,
        conversions: true,
        conversions_value: true,
      },
    });

    const totalCost = aggs.reduce(
      (s, a) => s + (a._sum.cost_micros ? Number(a._sum.cost_micros) : 0),
      0,
    );
    const totalConv = aggs.reduce(
      (s, a) => s + Number(a._sum.conversions ?? 0),
      0,
    );

    return {
      days,
      total_cost_brl: totalCost / 1_000_000,
      total_conversions: totalConv,
      items: aggs.map((a) => {
        const cost = a._sum.cost_micros
          ? Number(a._sum.cost_micros) / 1_000_000
          : 0;
        const conv = Number(a._sum.conversions ?? 0);
        const clicks = Number(a._sum.clicks ?? 0);
        const impressions = Number(a._sum.impressions ?? 0);
        return {
          device: a.device,
          impressions,
          clicks,
          cost_brl: cost,
          conversions: conv,
          cpl_brl: conv > 0 ? cost / conv : 0,
          ctr: impressions > 0 ? clicks / impressions : 0,
          // % do total de gastos (pra donut)
          spend_share:
            totalCost > 0 ? Number(a._sum.cost_micros) / totalCost : 0,
          conv_share: totalConv > 0 ? conv / totalConv : 0,
        };
      }),
    };
  }

  async updateCampaign(
    tenantId: string,
    campaignIdOrGoogleId: string,
    dto: UpdateCampaignDto,
  ) {
    // Aceita UUID interno OU google_campaign_id (alinhado com requireCampaign).
    const campaign = await this.requireCampaign(tenantId, campaignIdOrGoogleId);
    return this.prisma.trafficCampaign.update({
      where: { id: campaign.id },
      data: dto,
    });
  }

  // ─── Ad Groups ──────────────────────────────────────────────────────────

  async listAdGroups(
    tenantId: string,
    opts: { campaignId?: string; status?: string } = {},
  ) {
    const items = await this.prisma.trafficAdGroup.findMany({
      where: {
        tenant_id: tenantId,
        ...(opts.campaignId ? { campaign_id: opts.campaignId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        is_archived_internal: false,
      },
      orderBy: { last_seen_at: 'desc' },
      include: { campaign: { select: { id: true, name: true, status: true } } },
    });
    return items.map((i) => ({
      ...i,
      cpc_bid_micros: i.cpc_bid_micros?.toString() ?? null,
      cpm_bid_micros: i.cpm_bid_micros?.toString() ?? null,
      target_cpa_micros: i.target_cpa_micros?.toString() ?? null,
      cpc_bid_brl: fromMicros(i.cpc_bid_micros),
      target_cpa_brl: fromMicros(i.target_cpa_micros),
    }));
  }

  // ─── Keywords ───────────────────────────────────────────────────────────

  /** Status oficial do Google → rótulo amigável (Qualificado / Raramente exibido / etc.). */
  private mapServingStatusLabel(
    s: string | null | undefined,
    qs: number | null | undefined,
  ): string | null {
    if (!s) return null;
    switch (s) {
      case 'ELIGIBLE':
        return 'Qualificado';
      case 'RARELY_SERVED':
        return 'Não qualificado — raramente exibido (baixo volume)';
      case 'LIMITED':
        return qs != null && qs < 5 ? 'Limitado — baixa qualidade' : 'Limitado por orçamento';
      case 'PAUSED':
        return 'Pausado';
      case 'REMOVED':
        return 'Removido';
      case 'DISAPPROVED':
        return 'Reprovado';
      default:
        return s;
    }
  }

  async listKeywords(
    tenantId: string,
    adGroupId: string,
    opts: { negative?: boolean } = {},
  ) {
    const items = await this.prisma.trafficKeyword.findMany({
      where: {
        tenant_id: tenantId,
        ad_group_id: adGroupId,
        ...(typeof opts.negative === 'boolean'
          ? { negative: opts.negative }
          : {}),
      },
      orderBy: { last_seen_at: 'desc' },
    });
    return items.map((i) => {
      // Sprint 2 (2026-05-17): expor campos derivados do quality_info JSON
      // pra Claude/UI nao precisar parsear. Mantemos quality_info raw tambem
      // pra clientes que queiram tudo.
      const qi = (i.quality_info as any) ?? {};
      const impressions = (i as any).impressions ?? null;
      const clicks = (i as any).clicks ?? null;
      const conversions = (i as any).conversions != null ? Number((i as any).conversions) : null;
      const costBrl = (i as any).cost_micros != null ? fromMicros((i as any).cost_micros) : null;
      return {
        ...i,
        cpc_bid_micros: i.cpc_bid_micros?.toString() ?? null,
        cpc_bid_brl: fromMicros(i.cpc_bid_micros),
        // ── Status oficial do Google + label amigável (fix 2026-05-30, BUG-L) ──
        serving_status: (i as any).serving_status ?? null,
        serving_status_label: this.mapServingStatusLabel((i as any).serving_status, i.quality_score),
        is_low_search_volume: (i as any).serving_status === 'RARELY_SERVED',
        // ── Métricas da janela (~30d) — evita decisão às cegas (BUG-L) ──
        cost_micros: (i as any).cost_micros?.toString() ?? null,
        cost_brl: costBrl,
        impressions,
        clicks,
        conversions,
        conversions_value: (i as any).conversions_value != null ? Number((i as any).conversions_value) : null,
        ctr: impressions && impressions > 0 ? (clicks ?? 0) / impressions : null,
        cpc_brl: clicks && clicks > 0 && costBrl != null ? costBrl / clicks : null,
        cpl_brl: conversions && conversions > 0 && costBrl != null ? costBrl / conversions : null,
        conversion_rate: clicks && clicks > 0 && conversions != null ? conversions / clicks : null,
        // Campos derivados de quality (top-level pra facilitar)
        expected_ctr: qi.expected_clickthrough_rate ?? qi.expected_ctr ?? null,
        ad_relevance: qi.creative_quality_score ?? qi.ad_relevance ?? null,
        landing_page_experience:
          qi.post_click_quality_score ?? qi.landing_page_experience ?? null,
        first_page_cpc_brl: null,
        top_of_page_cpc_brl: null,
      };
    });
  }

  /**
   * Quality Score history de uma keyword (Sprint 2.1, 2026-05-17).
   *
   * Sprint 2.1 implementou snapshot daily via QualityScoreSnapshotCron
   * em TrafficKeywordQualitySnapshot. Agora retorna SERIE TEMPORAL real
   * dos ultimos N dias (ate 365).
   *
   * `current` continua com snapshot do TrafficKeyword.quality_info pra
   * mostrar valor mais fresco (cron roda 03h Maceio — em horarios fora
   * disso, current pode estar 1d a frente do ultimo entry em history).
   */
  async getKeywordQualityScoreHistory(
    tenantId: string,
    keywordId: string,
    days = 30,
  ): Promise<{
    keyword_id: string;
    text: string;
    current: {
      quality_score: number | null;
      expected_ctr: string | null;
      ad_relevance: string | null;
      landing_page_experience: string | null;
      last_seen_at: Date;
    };
    history: Array<{
      captured_at: Date;
      captured_at_date: Date;
      quality_score: number;
      expected_ctr: string | null;
      ad_relevance: string | null;
      landing_page_experience: string | null;
    }>;
    note?: string;
  }> {
    const keyword = await this.prisma.trafficKeyword.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [{ id: keywordId }, { google_criterion_id: keywordId }],
      },
    });
    if (!keyword) {
      throw new NotFoundException(`Keyword nao encontrada (id="${keywordId}")`);
    }
    const qi = (keyword.quality_info as any) ?? {};

    // Busca snapshots dos ultimos N dias
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - Math.min(Math.max(days, 1), 365));
    const snapshots = await this.prisma.trafficKeywordQualitySnapshot.findMany({
      where: {
        keyword_id: keyword.id,
        captured_at: { gte: since },
      },
      orderBy: { captured_at: 'desc' },
      select: {
        captured_at: true,
        captured_at_date: true,
        quality_score: true,
        expected_ctr: true,
        ad_relevance: true,
        landing_page_experience: true,
      },
    });

    return {
      keyword_id: keyword.id,
      text: keyword.text,
      current: {
        quality_score: keyword.quality_score,
        expected_ctr: qi.expected_clickthrough_rate ?? qi.expected_ctr ?? null,
        ad_relevance: qi.creative_quality_score ?? qi.ad_relevance ?? null,
        landing_page_experience:
          qi.post_click_quality_score ?? qi.landing_page_experience ?? null,
        last_seen_at: keyword.last_seen_at,
      },
      history: snapshots,
      ...(snapshots.length === 0 && {
        note:
          `Sem snapshots cacheados ainda. Cron QualityScoreSnapshotCron roda 03h Maceio diario; ` +
          `primeiro snapshot vai aparecer na proxima execucao. Ate la, use o campo "current" ` +
          `pra ver o valor atual (do sync principal).`,
      }),
    };
  }

  /**
   * Sprint 2.1 (2026-05-17) — Lista extensions (assets) live via GAQL.
   *
   * Sprint 2 entregou placeholder. Agora reutiliza infra `trafego-read`
   * queue do Sprint 4: chama TrafegoController.enqueueReadJob('extensions')
   * que enfileira job + aguarda resultado do TrafegoReadProcessor.
   *
   * Implementacao real fica no controller (acesso a Queue), aqui mantemos
   * apenas a validacao basica de account existir. Service vira pass-through
   * (controller chama enqueueReadJob direto agora).
   *
   * Deprecated: este metodo permanece pra compat de callers internos que
   * NAO podem enfileirar (ex: testes). Retorna stub.
   */
  async listExtensions(
    tenantId: string,
    opts: {
      campaign_id?: string;
      ad_group_id?: string;
      type?: string;
      status?: string;
    } = {},
  ): Promise<{
    extensions: any[];
    note: string;
  }> {
    await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId },
    });
    void opts;
    return {
      extensions: [],
      note:
        'Use o endpoint REST GET /trafego/extensions (que chama enqueueReadJob) ' +
        'pra listagem live. Esse helper de service eh stub mantido apenas pra back-compat.',
    };
  }

  // ─── Ads ────────────────────────────────────────────────────────────────

  async listAds(tenantId: string, adGroupId: string) {
    return this.prisma.trafficAd.findMany({
      where: { tenant_id: tenantId, ad_group_id: adGroupId },
      orderBy: { last_seen_at: 'desc' },
    });
  }

  // ─── Budgets ────────────────────────────────────────────────────────────

  async listBudgets(tenantId: string) {
    const items = await this.prisma.trafficCampaignBudget.findMany({
      where: { tenant_id: tenantId },
      orderBy: { last_seen_at: 'desc' },
    });
    return items.map((i) => ({
      ...i,
      amount_micros: i.amount_micros.toString(),
      amount_brl: fromMicros(i.amount_micros),
    }));
  }

  // ─── Search Terms (Fase 4a) ─────────────────────────────────────────────

  /**
   * Lista termos de pesquisa cacheados pelo sync. Suporta filtros de
   * pior-performance (gasto sem conversao) — UI usa pra surface
   * candidatos a negativar.
   *
   * Filtros:
   *   - campaignId / adGroupId: escopa
   *   - minSpendBrl: descarta termos com gasto irrisorio (default 0)
   *   - zeroConvOnly: so termos com 0 conversoes (alvos prioritarios pra negativar)
   *   - search: substring no termo (case-insensitive)
   */
  async listSearchTerms(
    tenantId: string,
    opts: {
      campaignId?: string;
      adGroupId?: string;
      minSpendBrl?: number;
      zeroConvOnly?: boolean;
      search?: string;
      limit?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const where: any = { tenant_id: tenantId };
    if (opts.campaignId) where.campaign_id = opts.campaignId;
    if (opts.adGroupId) where.ad_group_id = opts.adGroupId;
    if (opts.zeroConvOnly) where.conversions = { lte: 0 };
    if (opts.minSpendBrl !== undefined && opts.minSpendBrl > 0) {
      where.cost_micros = {
        gte: BigInt(Math.round(opts.minSpendBrl * 1_000_000)),
      };
    }
    if (opts.search && opts.search.length > 0) {
      where.search_term = { contains: opts.search, mode: 'insensitive' };
    }

    const items = await this.prisma.trafficSearchTerm.findMany({
      where,
      orderBy: [{ cost_micros: 'desc' }, { last_seen_at: 'desc' }],
      take: limit,
      include: {
        campaign: { select: { id: true, name: true } },
        ad_group: { select: { id: true, name: true } },
      },
    });

    return items.map((i) => ({
      id: i.id,
      search_term: i.search_term,
      match_type: i.match_type,
      status: i.status,
      campaign_id: i.campaign_id,
      campaign_name: i.campaign?.name ?? null,
      ad_group_id: i.ad_group_id,
      ad_group_name: i.ad_group?.name ?? null,
      impressions: i.impressions,
      clicks: i.clicks,
      cost_micros: i.cost_micros.toString(),
      cost_brl: Number(i.cost_micros) / 1_000_000,
      conversions: i.conversions,
      conversions_value: i.conversions_value,
      cpl_brl:
        i.conversions > 0
          ? Number(i.cost_micros) / 1_000_000 / i.conversions
          : 0,
      ctr: i.impressions > 0 ? i.clicks / i.impressions : 0,
      last_seen_at: i.last_seen_at,
    }));
  }

  // ─── Conversion Actions ─────────────────────────────────────────────────

  /**
   * Lista ConversionActions sincronizadas, com indicacao de quais estao
   * mapeadas a eventos CRM.
   */
  async listConversionActions(tenantId: string) {
    const items = await this.prisma.trafficConversionAction.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return items.map((i) => ({
      ...i,
      default_value_micros: i.default_value_micros?.toString() ?? null,
      default_value_brl: fromMicros(i.default_value_micros),
    }));
  }

  /**
   * Mapeia ConversionAction → evento CRM. crm_event_kind=null desfaz.
   * Tambem permite ajustar default_value_brl.
   */
  async mapConversionAction(
    tenantId: string,
    conversionActionId: string,
    dto: { crm_event_kind?: string | null; default_value_brl?: number | null },
  ) {
    const ca = await this.prisma.trafficConversionAction.findFirst({
      where: { id: conversionActionId, tenant_id: tenantId },
    });
    if (!ca) throw new NotFoundException('Conversion action nao encontrada');

    const updated = await this.prisma.trafficConversionAction.update({
      where: { id: conversionActionId },
      data: {
        ...(dto.crm_event_kind !== undefined
          ? { crm_event_kind: dto.crm_event_kind }
          : {}),
        ...(dto.default_value_brl !== undefined
          ? {
              default_value_micros:
                dto.default_value_brl === null
                  ? null
                  : BigInt(Math.round(dto.default_value_brl * 1_000_000)),
            }
          : {}),
      },
    });
    return {
      ...updated,
      default_value_micros: updated.default_value_micros?.toString() ?? null,
      default_value_brl: fromMicros(updated.default_value_micros),
    };
  }

  // ─── Mutate Logs (audit trail) ──────────────────────────────────────────

  async listMutateLogs(
    tenantId: string,
    opts: { limit?: number; initiator?: string; status?: string } = {},
  ) {
    const items = await this.prisma.trafficMutateLog.findMany({
      where: {
        tenant_id: tenantId,
        ...(opts.initiator ? { initiator: opts.initiator } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: opts.limit ?? 50,
    });

    // Enriquecimento humanizado — 3 campos novos pro frontend renderizar
    // sem expor JSON/codigos crus:
    //   - summary: frase PT-BR ("Claude criou headline 'XXX' em ...")
    //   - friendly_resource: rotulo legivel do recurso ("Campanha: Trabalhista Arap")
    //   - friendly_error: tradução do error_message JSON pra PT-BR
    //
    // Precisa enriquecer campaign/ad_group/conversion_action names dos
    // logs com lookup local (context.campaign_id_local + cache em map).
    const campaignIds = new Set<string>();
    const adGroupIds = new Set<string>();
    const conversionIds = new Set<string>();
    for (const log of items) {
      const ctx = (log.context ?? {}) as any;
      if (ctx?.campaign_id_local) campaignIds.add(ctx.campaign_id_local);
      if (ctx?.base_campaign_id_local) campaignIds.add(ctx.base_campaign_id_local);
      if (ctx?.trial_campaign_id_local) campaignIds.add(ctx.trial_campaign_id_local);
      if (ctx?.ad_group_id_local) adGroupIds.add(ctx.ad_group_id_local);
      if (ctx?.conversion_action_id_local)
        conversionIds.add(ctx.conversion_action_id_local);
    }
    const [campaigns, adGroups, conversions] = await Promise.all([
      campaignIds.size > 0
        ? this.prisma.trafficCampaign.findMany({
            where: { id: { in: [...campaignIds] } },
            select: { id: true, name: true, google_campaign_id: true },
          })
        : Promise.resolve([]),
      adGroupIds.size > 0
        ? this.prisma.trafficAdGroup.findMany({
            where: { id: { in: [...adGroupIds] } },
            select: { id: true, name: true, google_ad_group_id: true },
          })
        : Promise.resolve([]),
      conversionIds.size > 0
        ? this.prisma.trafficConversionAction.findMany({
            where: { id: { in: [...conversionIds] } },
            select: { id: true, name: true, google_conversion_id: true },
          })
        : Promise.resolve([]),
    ]);
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
    const adGroupMap = new Map(adGroups.map((g) => [g.id, g]));
    const conversionMap = new Map(conversions.map((c) => [c.id, c]));

    return items.map((i) => {
      const ctx = (i.context ?? {}) as any;
      const payload = (i.payload ?? {}) as any;
      const enriched = {
        summary: this.buildMutateSummary(
          i.resource_type,
          i.operation,
          ctx,
          payload,
          campaignMap,
          adGroupMap,
          conversionMap,
        ),
        friendly_resource: this.buildFriendlyResource(
          i.resource_type,
          ctx,
          campaignMap,
          adGroupMap,
          conversionMap,
        ),
        friendly_error: i.error_message
          ? this.buildFriendlyError(i.error_message)
          : null,
      };
      return {
        ...i,
        confidence: i.confidence ? Number(i.confidence) : null,
        ...enriched,
      };
    });
  }

  // ─── Mutate log humanization helpers ────────────────────────────────────

  /**
   * Gera frase PT-BR resumindo o que a mutate fez/tentou fazer.
   *
   * Regra geral: "<verbo> <recurso humanizado> [em <campanha/grupo>]".
   * Cobre Sprint 1-4.2 (todos resource_types possiveis).
   */
  private buildMutateSummary(
    resourceType: string,
    operation: string,
    context: Record<string, any>,
    payload: any,
    campaignMap: Map<string, { id: string; name: string }>,
    adGroupMap: Map<string, { id: string; name: string }>,
    conversionMap: Map<string, { id: string; name: string }>,
  ): string {
    const campName = (id?: string) =>
      id && campaignMap.get(id) ? `"${campaignMap.get(id)!.name}"` : null;
    const adGroupName = (id?: string) =>
      id && adGroupMap.get(id) ? `"${adGroupMap.get(id)!.name}"` : null;
    const convName = (id?: string) =>
      id && conversionMap.get(id) ? `"${conversionMap.get(id)!.name}"` : null;

    // Verbos PT-BR por operation
    const verb = (op: string): string => {
      const v: Record<string, string> = {
        create: 'Criou',
        update: 'Atualizou',
        remove: 'Removeu',
        // Sprint 4.2 — experiment lifecycle ops customizados
        schedule_experiment: 'Agendou',
        end_experiment: 'Encerrou',
        promote_experiment: 'Promoveu',
        graduate_experiment: 'Graduou',
      };
      return v[op] ?? op;
    };

    const camp = campName(context.campaign_id_local);
    const ag = adGroupName(context.ad_group_id_local);

    switch (resourceType) {
      case 'campaign': {
        if (operation === 'create')
          return `Criou campanha ${context.channel_type === 'PERFORMANCE_MAX' ? 'Performance Max ' : ''}"${payload?.[0]?.name ?? context.campaign_name ?? '(sem nome)'}"`;
        if (operation === 'update') {
          if (context.new_bidding_strategy)
            return `Mudou estrategia de lance da campanha ${camp ?? '?'} pra ${context.new_bidding_strategy}`;
          if (context.new_status)
            return `${context.new_status === 'PAUSED' ? 'Pausou' : 'Reativou'} campanha ${camp ?? '?'}`;
          return `Atualizou campanha ${camp ?? '?'}`;
        }
        if (operation === 'remove') return `Removeu campanha ${camp ?? '?'}`;
        return `${verb(operation)} campanha ${camp ?? ''}`;
      }
      case 'campaign_budget': {
        if (operation === 'update' && context.new_amount_brl)
          return `Mudou budget da campanha ${camp ?? '?'} pra R$${Number(context.new_amount_brl).toFixed(2)}/dia`;
        if (operation === 'create')
          return `Criou budget pra campanha "${context.campaign_name ?? '?'}"`;
        return `${verb(operation)} budget ${camp ?? ''}`;
      }
      case 'ad_group': {
        if (operation === 'create')
          return `Criou grupo de anuncios "${payload?.[0]?.name ?? '?'}" em ${camp ?? '?'}`;
        if (operation === 'remove') return `Removeu grupo de anuncios ${ag ?? '?'}`;
        if (operation === 'update' && context.new_status)
          return `${context.new_status === 'PAUSED' ? 'Pausou' : 'Reativou'} grupo ${ag ?? '?'}`;
        return `${verb(operation)} grupo de anuncios ${ag ?? ''}`;
      }
      case 'ad_group_ad': {
        if (operation === 'create')
          return `Criou anuncio (RSA) no grupo ${ag ?? '?'}`;
        if (operation === 'update' && context.new_status)
          return `${context.new_status === 'PAUSED' ? 'Pausou' : 'Reativou'} anuncio em ${ag ?? '?'}`;
        if (operation === 'remove') return `Removeu anuncio em ${ag ?? '?'}`;
        return `${verb(operation)} anuncio ${ag ?? ''}`;
      }
      case 'ad_group_criterion': {
        const kwCount = context.kw_count ?? context.keyword_count;
        if (operation === 'create') {
          if (context.is_negative)
            return `Adicionou ${kwCount ?? '?'} palavra(s) negativa(s) no grupo ${ag ?? '?'}`;
          return `Adicionou ${kwCount ?? '?'} palavra(s)-chave no grupo ${ag ?? '?'}`;
        }
        if (operation === 'remove')
          return `Removeu palavra(s)-chave do grupo ${ag ?? '?'}`;
        return `${verb(operation)} criterio no grupo ${ag ?? ''}`;
      }
      case 'campaign_criterion': {
        if (context.step === 'create_pmax_criteria')
          return `Adicionou geo + idioma na PMax "${context.campaign_name ?? '?'}"`;
        if (context.step === 'create_geo_target' || context.target_count)
          return `Atualizou targeting geografico da campanha ${camp ?? '?'} (${context.target_count ?? '?'} alvos)`;
        if (context.modifier_count)
          return `Ajustou ${context.modifier_count} modificador(es) de lance por localizacao em ${camp ?? '?'}`;
        if (operation === 'create')
          return `Adicionou criterio na campanha ${camp ?? '?'}`;
        if (operation === 'remove')
          return `Removeu criterio da campanha ${camp ?? '?'}`;
        return `${verb(operation)} criterio na campanha ${camp ?? ''}`;
      }
      case 'conversion_action': {
        if (operation === 'create')
          return `Criou acao de conversao "${payload?.[0]?.name ?? '?'}"`;
        if (operation === 'update')
          return `Atualizou acao de conversao ${convName(context.conversion_action_id_local) ?? '?'}`;
        if (operation === 'remove')
          return `Removeu acao de conversao ${convName(context.conversion_action_id_local) ?? '?'}`;
        return `${verb(operation)} acao de conversao`;
      }
      case 'customer': {
        if (operation === 'update' && context.field === 'enhanced_conversions')
          return `${context.enabled ? 'Ativou' : 'Desativou'} Enhanced Conversions for Leads na conta`;
        if (operation === 'update')
          return `Atualizou configuracao da conta`;
        return `${verb(operation)} conta`;
      }
      case 'asset': {
        if (operation === 'create') {
          if (context.step === 'create_assets')
            return `Criou ${context.asset_count ?? '?'} asset(s) pra ${context.asset_group_resource_name ? 'asset group PMax' : 'extensoes'}`;
          if (context.step === 'create_call_asset')
            return `Criou Call Asset (telefone)`;
          return `Criou asset (${payload?.[0]?.type ?? context.asset_type ?? '?'})`;
        }
        if (operation === 'remove') {
          if (context.step === 'rollback_orphan_asset')
            return `Rollback automatico — removeu asset orfao apos attach falhar`;
          return `Removeu asset ${context.asset_resource_name ?? '(extensao)'}`;
        }
        return `${verb(operation)} asset`;
      }
      case 'customer_asset':
      case 'campaign_asset':
      case 'ad_group_asset': {
        const scope =
          resourceType === 'customer_asset'
            ? 'conta'
            : resourceType === 'campaign_asset'
              ? `campanha ${camp ?? '?'}`
              : `grupo ${ag ?? '?'}`;
        if (operation === 'create') {
          if (context.field_type === 'CALL')
            return `Anexou Call Asset (telefone) na ${scope}`;
          return `Anexou extensao na ${scope}`;
        }
        if (operation === 'remove') return `Desanexou extensao da ${scope}`;
        return `${verb(operation)} link de asset na ${scope}`;
      }
      case 'shared_set': {
        if (operation === 'create')
          return `Criou lista compartilhada de negativas "${context.list_name ?? '?'}" (${context.kw_count ?? '?'} palavras, anexada a ${context.attach_count ?? 0} campanha(s))`;
        return `${verb(operation)} lista compartilhada`;
      }
      case 'shared_criterion': {
        if (operation === 'create')
          return `Adicionou ${context.kw_count ?? '?'} negativa(s) na lista compartilhada`;
        return `${verb(operation)} criterio compartilhado`;
      }
      case 'campaign_shared_set': {
        if (operation === 'create')
          return `Anexou lista compartilhada a ${context.campaign_count ?? '?'} campanha(s)`;
        if (operation === 'remove')
          return `Desanexou lista compartilhada de campanha(s)`;
        return `${verb(operation)} link de lista compartilhada`;
      }
      case 'asset_group': {
        if (operation === 'create')
          return `Criou asset group "${context.asset_group_name ?? '?'}" na PMax ${camp ?? '?'}`;
        return `${verb(operation)} asset group`;
      }
      case 'asset_group_asset': {
        if (operation === 'create')
          return `Vinculou ${context.link_count ?? '?'} asset(s) ao asset group PMax`;
        return `${verb(operation)} link de asset no asset group`;
      }
      case 'experiment': {
        if (operation === 'create')
          return `Criou experimento "${context.experiment_name ?? '?'}" (${context.experiment_type ?? 'SEARCH_CUSTOM'}) usando campanha base ${campName(context.base_campaign_id_local) ?? '?'}`;
        if (operation === 'schedule_experiment')
          return `Agendou experimento ${context.experiment_id ?? '?'} (SETUP -> ENABLED async)`;
        if (operation === 'end_experiment')
          return `Encerrou experimento ${context.experiment_id ?? '?'} (HALTED — sem promover)`;
        if (operation === 'promote_experiment')
          return `Promoveu experimento ${context.experiment_id ?? '?'} — treatment aplicado na base`;
        if (operation === 'graduate_experiment')
          return `Graduou experimento ${context.experiment_id ?? '?'} — ${context.mapping_count ?? '?'} trial(s) viraram standalone`;
        return `${verb(operation)} experimento`;
      }
      case 'experiment_arm': {
        if (operation === 'create')
          return `Adicionou ExperimentArm "${context.arm_role ?? 'arm'}" ao experimento (traffic_split: ${context.traffic_split ?? '?'}%)`;
        return `${verb(operation)} arm de experimento`;
      }
      default:
        return `${verb(operation)} ${resourceType}`;
    }
  }

  /**
   * Retorna o rotulo "humano" do recurso pra coluna RECURSO da tabela.
   * Ex: "Campanha: Trabalhista Arap" em vez de só "campaign".
   */
  private buildFriendlyResource(
    resourceType: string,
    context: Record<string, any>,
    campaignMap: Map<string, { id: string; name: string }>,
    adGroupMap: Map<string, { id: string; name: string }>,
    conversionMap: Map<string, { id: string; name: string }>,
  ): string {
    const camp = context.campaign_id_local
      ? campaignMap.get(context.campaign_id_local)
      : null;
    const ag = context.ad_group_id_local
      ? adGroupMap.get(context.ad_group_id_local)
      : null;
    const conv = context.conversion_action_id_local
      ? conversionMap.get(context.conversion_action_id_local)
      : null;

    // Labels PT-BR por resource_type
    const LABELS: Record<string, string> = {
      campaign: 'Campanha',
      campaign_budget: 'Budget',
      ad_group: 'Grupo de anuncios',
      ad_group_ad: 'Anuncio',
      ad_group_criterion: 'Palavra-chave',
      campaign_criterion: 'Targeting de campanha',
      conversion_action: 'Acao de conversao',
      customer: 'Conta',
      asset: 'Asset (extensao)',
      customer_asset: 'Extensao da conta',
      campaign_asset: 'Extensao da campanha',
      ad_group_asset: 'Extensao do grupo',
      shared_set: 'Lista compartilhada',
      shared_criterion: 'Item de lista compartilhada',
      campaign_shared_set: 'Vinculo lista-campanha',
      asset_group: 'Asset group PMax',
      asset_group_asset: 'Asset em PMax',
      experiment: 'Experimento A/B',
      experiment_arm: 'Arm de experimento',
      customer_match_user_list: 'Customer Match list',
      remarketing_action: 'Tag de remarketing',
    };

    const label = LABELS[resourceType] ?? resourceType;

    if (camp) return `${label}: ${camp.name}`;
    if (ag) return `${label}: ${ag.name}`;
    if (conv) return `${label}: ${conv.name}`;
    if (context.list_name) return `${label}: ${context.list_name}`;
    if (context.asset_group_name) return `${label}: ${context.asset_group_name}`;
    if (context.experiment_name)
      return `${label}: ${context.experiment_name}`;
    if (context.campaign_name) return `${label}: ${context.campaign_name}`;
    return label;
  }

  /**
   * Traduz JSON cru de error_message do Google em mensagem PT-BR util.
   *
   * Cobre:
   *   - mutate_error.MUTATE_NOT_ALLOWED → "Permissao negada (provavelmente conta sem Standard access)"
   *   - validation_error.* → mensagem original (geralmente clara)
   *   - field_mask_error.* → "Erro no field mask: <detalhe>"
   *   - rate_limit_error → "Cota Google Ads excedida"
   *   - Em geral: pega 1a mensagem do array errors[]
   *
   * Se mensagem nao for JSON parseavel, retorna ela mesma truncada.
   */
  private buildFriendlyError(rawErrorMessage: string): string {
    // Fix BUG-F (2026-05-18): erros gRPC top-level (PERMISSION_DENIED,
    // UNAUTHENTICATED, etc) vem como string "<code> <NAME>: <message>"
    // sem JSON estruturado. Tradutor PT-BR pra esses primeiro.
    const GRPC_CODE_TRANSLATIONS: Array<{ pattern: RegExp; translation: string }> = [
      {
        pattern: /^7 PERMISSION_DENIED|PERMISSION_DENIED.*caller does not have permission/i,
        translation:
          'Permissao negada pelo Google Ads. Checklist (do mais ao menos provavel):\n' +
          '1. Developer token em Test/Basic access — Enhanced Conversions, customer-level settings e features sensiveis exigem STANDARD ACCESS. Confira em https://ads.google.com/aw/apicenter > sua tier de acesso.\n' +
          '2. MCC (login_customer_id) sem Admin no client account — confira em https://ads.google.com/aw/accountaccess > permissoes do usuario MCC no account 4464129633.\n' +
          '3. OAuth scope insuficiente — refresh_token precisa ter sido autorizado com scope adwords (cobre tudo). Reconecte via /trafego/oauth/reconnect-link se necessario.\n' +
          '4. Feature especifica nao habilitada pro developer_token — algumas features (Customer Match, Enhanced Conv) exigem aprovacao adicional. Solicite via API Center.\n' +
          'SOLUCAO TEMPORARIA: ative Enhanced Conversions for Leads direto via Google Ads UI (Tools > Conversions > Customer data) enquanto resolve permissoes.',
      },
      {
        pattern: /^16 UNAUTHENTICATED|UNAUTHENTICATED|invalid_grant/i,
        translation:
          'Autenticacao falhou. Refresh_token OAuth provavelmente expirou OU foi revogado. Reconecte a conta via traffic_reconnect_oauth_link.',
      },
      {
        pattern: /^8 RESOURCE_EXHAUSTED|quota exceeded|too many requests/i,
        translation:
          'Cota da Google Ads API excedida. Aguarde 1-5 minutos e tente novamente. Se persistir, considere reduzir frequencia de polling/sync.',
      },
      {
        pattern: /^14 UNAVAILABLE|UNAVAILABLE|temporarily unavailable/i,
        translation:
          'Google Ads API temporariamente indisponivel. Retry recomendado em 30s.',
      },
    ];

    for (const { pattern, translation } of GRPC_CODE_TRANSLATIONS) {
      if (pattern.test(rawErrorMessage)) return translation;
    }

    // Tenta parsear como JSON (formato GoogleAdsFailure)
    let parsed: any = null;
    try {
      parsed = JSON.parse(rawErrorMessage);
    } catch {
      // Nao eh JSON — retorna direto, mas trim
      return rawErrorMessage.length > 200
        ? rawErrorMessage.slice(0, 200) + '...'
        : rawErrorMessage;
    }

    const errors = parsed?.errors ?? [];
    if (!Array.isArray(errors) || errors.length === 0) {
      // Sem errors[] — devolve o que tiver
      return parsed?.message ?? rawErrorMessage.slice(0, 200);
    }

    // Pega 1o erro estruturado
    const first = errors[0];
    const errorCode = first?.error_code ?? {};
    const codeKey = Object.keys(errorCode)[0]; // ex: "mutate_error"
    const codeValue = errorCode[codeKey]; // ex: "MUTATE_NOT_ALLOWED"

    // Traducoes PT-BR pra codigos comuns
    const TRANSLATIONS: Record<string, string> = {
      'mutate_error.MUTATE_NOT_ALLOWED':
        'Operacao nao permitida (provavelmente conta sem Standard access do Google Ads ou recurso bloqueado pelo seu nivel de developer token).',
      'mutate_error.RESOURCE_NOT_FOUND':
        'Recurso nao encontrado no Google Ads (pode ter sido removido por terceiro ou nunca existiu).',
      'authentication_error.OAUTH_TOKEN_INVALID':
        'Token OAuth invalido. Reconecte a conta Google Ads via Configuracoes.',
      'authentication_error.OAUTH_TOKEN_EXPIRED':
        'Token OAuth expirado. Reconecte a conta Google Ads via Configuracoes.',
      'authorization_error.DEVELOPER_TOKEN_NOT_APPROVED':
        'Developer token nao aprovado pra essa operacao. Confira em https://ads.google.com/aw/apicenter — recursos sensiveis (Enhanced Conversions, customer-level settings) exigem Standard access (nao Basic/Test).',
      'authorization_error.DEVELOPER_TOKEN_PROHIBITED':
        'Developer token proibido pra essa API/feature. Algumas features (Enhanced Conversions for Leads, Customer Match) exigem aprovacao adicional do Google. Solicite via API Center.',
      'authorization_error.USER_PERMISSION_DENIED':
        'Sem permissao no Google Ads pra esse usuario. Confira: (1) MCC tem Admin no client account, (2) usuario OAuth tem permissao adequada.',
      'authorization_error.CUSTOMER_NOT_ENABLED':
        'Conta cliente nao habilitada pra essa operacao. Pode precisar de habilitacao manual via Google Ads UI primeiro.',
      'authorization_error.ACCESS_DENIED':
        'Acesso negado. Confira nivel do developer_token (Standard pra mutate de customer settings) + permissao MCC (Admin no client account).',
      'authorization_error.PROJECT_DISABLED':
        'Projeto Google Cloud desabilitado pra Google Ads API.',
      'customer_error.CUSTOMER_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS':
        'Conta nao habilitada pra Enhanced Conversions for Leads. Ative primeiro via traffic_enable_enhanced_conversions_for_leads OU via Google Ads UI (Tools > Conversions > Customer data).',
      'enhanced_conversions_error.NO_CONVERSION_ACTION_FOUND':
        'Nenhuma conversion action encontrada pra Enhanced Conversions. Crie uma via traffic_create_conversion_action antes.',
      'enhanced_conversions_error.INVALID_CONVERSION_ACTION_TYPE':
        'Tipo de conversion action invalido pra Enhanced Conversions (precisa ser WEBPAGE ou LEAD_FORM_SUBMIT).',
      'quota_error.RESOURCE_EXHAUSTED':
        'Cota da API Google Ads excedida. Tente novamente em alguns minutos.',
      'rate_limit_error.RESOURCE_TEMPORARILY_EXHAUSTED':
        'Limite de requisicoes excedido temporariamente. Aguarde 1 minuto.',
      'field_error.REQUIRED':
        'Campo obrigatorio faltando no payload.',
      'field_error.INVALID_VALUE':
        'Valor invalido em um dos campos.',
      'campaign_error.DUPLICATE_CAMPAIGN_NAME':
        'Ja existe uma campanha com esse nome.',
      'ad_group_error.DUPLICATE_ADGROUP_NAME':
        'Ja existe um grupo de anuncios com esse nome nessa campanha.',
      'criterion_error.INVALID_KEYWORD_TEXT':
        'Palavra-chave invalida (provavelmente caracteres especiais nao suportados).',
      'criterion_error.KEYWORD_HAS_INVALID_CHARS':
        'Palavra-chave contem caracteres invalidos.',
      'asset_error.URL_FORMAT_NOT_ALLOWED':
        'URL invalida — provavelmente sem https:// ou com caracteres especiais.',
      'budget_error.INVALID_BUDGET_AMOUNT':
        'Valor de budget invalido (minimo Google: R$1/dia).',
      'bidding_error.BIDDING_STRATEGY_NOT_COMPATIBLE_WITH_CAMPAIGN_TYPE':
        'Essa estrategia de lance nao eh compativel com esse tipo de campanha.',
      'partial_failure_error':
        'Algumas operacoes falharam dentro do batch. Ver detalhes pra cada uma.',
    };

    const fullKey = codeKey && codeValue ? `${codeKey}.${codeValue}` : codeKey;
    const translation = TRANSLATIONS[fullKey] ?? TRANSLATIONS[codeKey];

    if (translation) return translation;

    // Fallback: mensagem original do Google (geralmente em ingles, mas
    // direta)
    const msg = first?.message ?? `Erro: ${fullKey}`;
    return msg.length > 250 ? msg.slice(0, 250) + '...' : msg;
  }

  // ─── Mutate payload builder ─────────────────────────────────────────────
  /**
   * Resolve IDs locais → resource_names da Google Ads API + monta payload
   * que o TrafegoMutateProcessor consome. Isolado aqui pra controller ficar
   * fino e centralizar conversao BRL→micros.
   */
  async buildMutatePayload(
    tenantId: string,
    accountId: string,
    customerId: string,
    jobName: string,
    raw: any,
    initiator: string,
    validateOnly: boolean,
  ): Promise<any> {
    const base = {
      tenantId,
      accountId,
      initiator,
      validateOnly,
      confidence: null as number | null,
      context: {
        triggered_by: initiator,
        reason: raw.reason,
      } as Record<string, any>,
    };

    switch (jobName) {
      case 'trafego-mutate-pause-campaign':
      case 'trafego-mutate-resume-campaign':
      case 'trafego-mutate-remove-campaign': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          context: { ...base.context, campaign_id_local: camp.id },
        };
      }
      case 'trafego-mutate-update-ai-max': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          enabled: !!raw.enabled,
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            ai_max_enabled: !!raw.enabled,
          },
        };
      }
      case 'trafego-mutate-update-budget': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        if (!camp.daily_budget_micros) {
          throw new HttpException(
            'Campanha sem budget identificado. Sincronize antes.',
            HttpStatus.BAD_REQUEST,
          );
        }
        // budget_resource_name eh populado pelo sync (campaign.campaign_budget
        // vem na GAQL). Sem ele nao temos como atualizar via mutate, e o
        // processor falharia silenciosamente — preferimos 409 explicito.
        if (!camp.budget_resource_name) {
          throw new HttpException(
            'Campanha ainda sem budget vinculado em cache. Rode "Sincronizar agora" antes de atualizar o orçamento.',
            HttpStatus.CONFLICT,
          );
        }
        const newAmountMicros = BigInt(
          Math.round(raw.new_amount_brl * 1_000_000),
        );
        return {
          ...base,
          budgetResourceName: camp.budget_resource_name,
          newAmountMicros: newAmountMicros.toString(),
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            new_amount_brl: raw.new_amount_brl,
          },
        };
      }
      case 'trafego-mutate-pause-ad-group':
      case 'trafego-mutate-resume-ad-group':
      case 'trafego-mutate-remove-ad-group': {
        const ag = await this.requireAdGroup(tenantId, raw.adGroupId);
        return {
          ...base,
          adGroupResourceName: `customers/${customerId}/adGroups/${ag.google_ad_group_id}`,
          context: { ...base.context, ad_group_id_local: ag.id },
        };
      }
      case 'trafego-mutate-add-keywords': {
        const ag = await this.requireAdGroup(tenantId, raw.adGroupId);
        return {
          ...base,
          adGroupResourceName: `customers/${customerId}/adGroups/${ag.google_ad_group_id}`,
          keywords: (raw.keywords ?? []).map((kw: any) => ({
            text: kw.text,
            matchType: kw.match_type,
            cpcBidMicros: kw.cpc_bid_brl
              ? String(Math.round(kw.cpc_bid_brl * 1_000_000))
              : null,
          })),
          context: { ...base.context, ad_group_id_local: ag.id },
        };
      }
      case 'trafego-mutate-add-negatives': {
        if (raw.scope === 'CAMPAIGN') {
          const camp = await this.requireCampaign(tenantId, raw.campaignId);
          return {
            ...base,
            scope: 'CAMPAIGN',
            scopeResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
            negatives: (raw.negatives ?? []).map((kw: any) => ({
              text: kw.text,
              matchType: kw.match_type,
            })),
            context: { ...base.context, campaign_id_local: camp.id },
          };
        }
        const ag = await this.requireAdGroup(tenantId, raw.adGroupId);
        return {
          ...base,
          scope: 'AD_GROUP',
          scopeResourceName: `customers/${customerId}/adGroups/${ag.google_ad_group_id}`,
          negatives: (raw.negatives ?? []).map((kw: any) => ({
            text: kw.text,
            matchType: kw.match_type,
          })),
          context: { ...base.context, ad_group_id_local: ag.id },
        };
      }
      case 'trafego-mutate-remove-keywords': {
        const ids = (raw.keywordIds ?? []) as string[];
        const kws = await this.prisma.trafficKeyword.findMany({
          where: { tenant_id: tenantId, id: { in: ids } },
          select: {
            id: true,
            ad_group: { select: { google_ad_group_id: true } },
            google_criterion_id: true,
          },
        });
        return {
          ...base,
          criterionResourceNames: kws.map(
            (k) =>
              `customers/${customerId}/adGroupCriteria/${k.ad_group.google_ad_group_id}~${k.google_criterion_id}`,
          ),
          context: { ...base.context, keyword_ids_local: kws.map((k) => k.id) },
        };
      }
      case 'trafego-mutate-create-search-campaign': {
        // Validação: TARGET_CPA exige target_cpa_brl
        if (raw.bidding_strategy === 'TARGET_CPA' && !raw.target_cpa_brl) {
          throw new HttpException(
            'TARGET_CPA exige target_cpa_brl.',
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          ...base,
          customerId,
          name: raw.name,
          dailyBudgetMicros: BigInt(
            Math.round(raw.daily_budget_brl * 1_000_000),
          ).toString(),
          biddingStrategy: raw.bidding_strategy,
          targetCpaMicros: raw.target_cpa_brl
            ? BigInt(Math.round(raw.target_cpa_brl * 1_000_000)).toString()
            : null,
          // Se vier geo_target_names, NAO injeta o default Brasil — deixa o
          // worker resolver os nomes (senao mirava Brasil + a cidade junto).
          geoTargetIds:
            raw.geo_target_ids ??
            (raw.geo_target_names?.length ? [] : ['1001775']),
          geoTargetNames: raw.geo_target_names ?? [],
          geoTargetTypeSetting: raw.geo_target_type ?? null,
          languageIds: raw.language_ids ?? ['1014'], // Portuguese
          finalUrl: raw.final_url ?? null,
          initialStatus: raw.initial_status ?? 'PAUSED',
          // Propaganda política UE — obrigatório no create (API v23+). Default
          // false → DOES_NOT_CONTAIN no worker (advocacia não é política).
          containsEuPoliticalAdvertising: !!raw.contains_eu_political_advertising,
          context: {
            ...base.context,
            campaign_name: raw.name,
            daily_budget_brl: raw.daily_budget_brl,
          },
        };
      }
      case 'trafego-mutate-update-bidding-strategy': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        if (raw.bidding_strategy === 'TARGET_CPA' && !raw.target_cpa_brl) {
          throw new HttpException(
            'TARGET_CPA exige target_cpa_brl.',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (raw.bidding_strategy === 'TARGET_ROAS' && !raw.target_roas) {
          throw new HttpException(
            'TARGET_ROAS exige target_roas.',
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          biddingStrategy: raw.bidding_strategy,
          targetCpaMicros: raw.target_cpa_brl
            ? BigInt(Math.round(raw.target_cpa_brl * 1_000_000)).toString()
            : null,
          targetRoas: raw.target_roas ?? null,
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            new_bidding_strategy: raw.bidding_strategy,
          },
        };
      }
      case 'trafego-mutate-update-ad-schedule': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        // Pega resource_names dos schedules existentes pra remoção atômica
        const existing = await this.prisma.trafficAdSchedule.findMany({
          where: { campaign_id: camp.id },
          select: { google_criterion_id: true },
        });
        const existingResourceNames = existing.map(
          (s) =>
            `customers/${customerId}/campaignCriteria/${camp.google_campaign_id}~${s.google_criterion_id}`,
        );
        // Sanitização defensiva dos slots vindos do front
        const newSlots = ((raw.slots ?? []) as any[]).map((s) => ({
          dayOfWeek: s.day_of_week,
          startHour: Number(s.start_hour),
          startMinute: Number(s.start_minute) as 0 | 15 | 30 | 45,
          endHour: Number(s.end_hour),
          endMinute: Number(s.end_minute) as 0 | 15 | 30 | 45,
          bidModifier:
            s.bid_modifier !== null && s.bid_modifier !== undefined
              ? Number(s.bid_modifier)
              : null,
        }));
        return {
          ...base,
          customerId,
          googleCampaignId: camp.google_campaign_id,
          existingResourceNames,
          newSlots,
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            slot_count: newSlots.length,
            removing: existingResourceNames.length,
          },
        };
      }
      case 'trafego-mutate-create-rsa': {
        const ag = await this.requireAdGroup(tenantId, raw.adGroupId);
        // Validação básica de tamanho — Google exige 3..15 headlines, 2..4 desc
        const headlines = (raw.headlines ?? []) as string[];
        const descriptions = (raw.descriptions ?? []) as string[];
        if (headlines.length < 3 || headlines.length > 15) {
          throw new HttpException(
            'RSA exige 3 a 15 headlines.',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (descriptions.length < 2 || descriptions.length > 4) {
          throw new HttpException(
            'RSA exige 2 a 4 descrições.',
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          ...base,
          adGroupResourceName: `customers/${customerId}/adGroups/${ag.google_ad_group_id}`,
          ad: {
            headlines,
            descriptions,
            final_url: raw.final_url,
            path1: raw.path1,
            path2: raw.path2,
          },
          preview: !!raw.preview,
          context: {
            ...base.context,
            ad_group_id_local: ag.id,
            final_url: raw.final_url,
          },
        };
      }
      // ═══════════════════════════════════════════════════════════════════
      // Sprint 1 backlog (2026-05-17) — Conversion Actions, Ad Groups, RSAs
      // ═══════════════════════════════════════════════════════════════════

      case 'trafego-mutate-create-conversion-action': {
        return {
          ...base,
          customerId,
          name: raw.name,
          category: raw.category,
          type: raw.type,
          includeInConversions: raw.include_in_conversions,
          defaultValueMicros: raw.default_value_brl
            ? String(Math.round(raw.default_value_brl * 1_000_000))
            : null,
          countingType: raw.counting_type,
          clickThroughLookbackDays: raw.click_through_lookback_days,
          viewThroughLookbackDays: raw.view_through_lookback_days,
          phoneCallDurationSeconds: raw.phone_call_duration_seconds,
          context: { ...base.context, ca_name: raw.name, ca_category: raw.category },
        };
      }

      case 'trafego-mutate-update-conversion-action': {
        const ca = await this.requireConversionAction(tenantId, raw.conversionActionId);

        // Fix 2026-05-17 (BUG-B reportado pelo gestor de trafego):
        // detecta tipos imutaveis ANTES de gastar chamada API. Antes,
        // mandavamos updates pra conversion actions tipo GOOGLE_HOSTED
        // (Clicks to call gerenciada pelo Google) e Google rejeitava
        // com IMMUTABLE_FIELD + MUTATE_NOT_ALLOWED — sem contexto pro
        // gestor entender por que.
        const IMMUTABLE_TYPES = new Set([
          'GOOGLE_HOSTED',
          'SMART_CAMPAIGN_TRACKED_CALLS',
          'SMART_CAMPAIGN_AD_CLICKS_TO_CALL',
          'SMART_CAMPAIGN_MAP_CLICKS_TO_CALL',
          'SMART_CAMPAIGN_MAP_DIRECTIONS',
          'ANDROID_INSTALLS_ALL_OTHER_APPS',
          'ANDROID_APP_PRE_REGISTRATION',
          'FIREBASE_ANDROID_FIRST_OPEN',
          'FIREBASE_ANDROID_IN_APP_PURCHASE',
          'FIREBASE_ANDROID_CUSTOM',
          'FIREBASE_IOS_FIRST_OPEN',
          'FIREBASE_IOS_IN_APP_PURCHASE',
          'FIREBASE_IOS_CUSTOM',
          'THIRD_PARTY_APP_ANALYTICS_ANDROID_FIRST_OPEN',
          'THIRD_PARTY_APP_ANALYTICS_ANDROID_IN_APP_PURCHASE',
          'THIRD_PARTY_APP_ANALYTICS_ANDROID_CUSTOM',
          'THIRD_PARTY_APP_ANALYTICS_IOS_FIRST_OPEN',
          'THIRD_PARTY_APP_ANALYTICS_IOS_IN_APP_PURCHASE',
          'THIRD_PARTY_APP_ANALYTICS_IOS_CUSTOM',
          'STORE_VISITS',
          'STORE_SALES',
          'STORE_SALES_DIRECT_UPLOAD',
          'FLOODLIGHT_ACTION',
          'FLOODLIGHT_TRANSACTION',
          'SEARCH_ADS_360',
          'UNIVERSAL_ANALYTICS_GOAL',
          'UNIVERSAL_ANALYTICS_TRANSACTION',
          'GOOGLE_ANALYTICS_4_CUSTOM',
          'GOOGLE_ANALYTICS_4_PURCHASE',
        ]);
        const IMMUTABLE_FIELDS = new Set([
          'include_in_conversions',
          'status',
          'attribution_model',
        ]);

        const isImmutableType =
          ca.type && IMMUTABLE_TYPES.has(ca.type);
        const requestedImmutableFields: string[] = [];
        for (const field of IMMUTABLE_FIELDS) {
          if (raw[field] !== undefined) requestedImmutableFields.push(field);
        }

        if (isImmutableType && requestedImmutableFields.length > 0) {
          throw new HttpException(
            `Conversion action "${ca.name}" eh do tipo ${ca.type} (gerenciada pelo Google). ` +
              `Os campos ${requestedImmutableFields.join(', ')} sao IMUTAVEIS em conv actions ` +
              `dos tipos: GOOGLE_HOSTED, SMART_CAMPAIGN_*, ANDROID_INSTALLS_*, ANDROID_FIRST_OPEN, ` +
              `ANDROID_IN_APP_PURCHASE, MOBILE_APP, FIREBASE_*, THIRD_PARTY_APP_*, ` +
              `STORE_*, FLOODLIGHT_*, SEARCH_ADS_360, UNIVERSAL_ANALYTICS_*, GOOGLE_ANALYTICS_4_*. ` +
              `Apenas WEBPAGE, UPLOAD_CLICKS, UPLOAD_CALLS, CLICK_TO_CALL, WEBSITE_CALL, ` +
              `AD_CALL e LEAD_FORM_SUBMIT podem ter esses campos alterados via API. ` +
              `Pra ajustar essa conv action, use o Google Ads UI ou edite a configuracao ` +
              `na fonte original (GA4, Firebase, etc).`,
            HttpStatus.BAD_REQUEST,
          );
        }

        const patch: any = {};
        if (raw.name !== undefined) patch.name = raw.name;
        if (raw.include_in_conversions !== undefined)
          patch.include_in_conversions = raw.include_in_conversions;
        if (raw.primary_for_goal !== undefined)
          patch.primary_for_goal = raw.primary_for_goal;
        if (raw.default_value_brl !== undefined) {
          patch.default_value_micros = String(
            Math.round(raw.default_value_brl * 1_000_000),
          );
        }
        if (raw.always_use_default_value !== undefined)
          patch.always_use_default_value = raw.always_use_default_value;
        if (raw.attribution_model !== undefined)
          patch.attribution_model = raw.attribution_model;
        if (raw.click_through_lookback_days !== undefined)
          patch.click_through_lookback_days = raw.click_through_lookback_days;
        if (raw.view_through_lookback_days !== undefined)
          patch.view_through_lookback_days = raw.view_through_lookback_days;
        if (raw.counting_type !== undefined)
          patch.counting_type = raw.counting_type;
        if (raw.status !== undefined) patch.status = raw.status;
        return {
          ...base,
          conversionActionResourceName: `customers/${customerId}/conversionActions/${ca.google_conversion_id}`,
          patch,
          context: {
            ...base.context,
            conversion_action_id_local: ca.id,
            ca_type: ca.type,
          },
        };
      }

      case 'trafego-mutate-remove-conversion-action': {
        const ca = await this.requireConversionAction(tenantId, raw.conversionActionId);
        return {
          ...base,
          conversionActionResourceName: `customers/${customerId}/conversionActions/${ca.google_conversion_id}`,
          context: { ...base.context, conversion_action_id_local: ca.id, reason: raw.reason },
        };
      }

      case 'trafego-mutate-enable-enhanced-conversions': {
        return {
          ...base,
          customerId,
          mode: raw.mode,
          context: { ...base.context, mode: raw.mode },
        };
      }

      case 'trafego-mutate-create-ad-group': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          name: raw.name,
          type: raw.type,
          status: raw.status,
          cpcBidMicros: raw.cpc_bid_brl
            ? String(Math.round(raw.cpc_bid_brl * 1_000_000))
            : null,
          targetCpaMicros: raw.target_cpa_brl
            ? String(Math.round(raw.target_cpa_brl * 1_000_000))
            : null,
          targetRoas: raw.target_roas ?? null,
          context: { ...base.context, campaign_id_local: camp.id, ag_name: raw.name },
        };
      }

      case 'trafego-mutate-update-ad-group': {
        const ag = await this.requireAdGroup(tenantId, raw.adGroupId);
        const patch: any = {};
        if (raw.name !== undefined) patch.name = raw.name;
        if (raw.status !== undefined) patch.status = raw.status;
        if (raw.cpc_bid_brl !== undefined) {
          patch.cpc_bid_micros = String(Math.round(raw.cpc_bid_brl * 1_000_000));
        }
        if (raw.target_cpa_brl !== undefined) {
          patch.target_cpa_micros = String(
            Math.round(raw.target_cpa_brl * 1_000_000),
          );
        }
        if (raw.target_roas !== undefined) patch.target_roas = raw.target_roas;
        if (raw.rotation !== undefined) patch.ad_rotation_mode = raw.rotation;
        return {
          ...base,
          adGroupResourceName: `customers/${customerId}/adGroups/${ag.google_ad_group_id}`,
          patch,
          context: { ...base.context, ad_group_id_local: ag.id },
        };
      }

      case 'trafego-mutate-update-rsa': {
        const oldAd = await this.requireAd(tenantId, raw.adId);
        // Validacoes basicas
        const headlines = (raw.headlines ?? []) as string[];
        const descriptions = (raw.descriptions ?? []) as string[];
        if (headlines.length < 3 || headlines.length > 15) {
          throw new HttpException(
            'RSA exige 3 a 15 headlines.',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (descriptions.length < 2 || descriptions.length > 4) {
          throw new HttpException(
            'RSA exige 2 a 4 descriptions.',
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          ...base,
          oldAdGroupAdResourceName: `customers/${customerId}/adGroupAds/${oldAd.ad_group.google_ad_group_id}~${oldAd.google_ad_id}`,
          adGroupResourceName: `customers/${customerId}/adGroups/${oldAd.ad_group.google_ad_group_id}`,
          newAd: {
            headlines,
            descriptions,
            final_url: raw.final_url,
            path1: raw.path1,
            path2: raw.path2,
          },
          context: {
            ...base.context,
            ad_id_local: oldAd.id,
            ad_group_id_local: oldAd.ad_group_id,
          },
        };
      }

      case 'trafego-mutate-remove-ad': {
        const ad = await this.requireAd(tenantId, raw.adId);
        return {
          ...base,
          adGroupAdResourceName: `customers/${customerId}/adGroupAds/${ad.ad_group.google_ad_group_id}~${ad.google_ad_id}`,
          context: {
            ...base.context,
            ad_id_local: ad.id,
            reason: raw.reason,
          },
        };
      }

      case 'trafego-mutate-attach-call-asset': {
        // Resolve phone do TrafficSettings se nao explicito
        let phoneNumber: string | undefined = raw.phone_number;
        if (!phoneNumber) {
          const settings = await this.prisma.trafficSettings.findUnique({
            where: { tenant_id: tenantId },
          });
          phoneNumber = settings?.business_phone_e164 ?? undefined;
        }
        if (!phoneNumber) {
          throw new HttpException(
            'phone_number nao informado e TrafficSettings.business_phone_e164 nao configurado.',
            HttpStatus.BAD_REQUEST,
          );
        }
        const countryCode = raw.country_code ?? 'BR';

        // Resolve resource_name do scope alvo
        let campaignResourceName: string | undefined;
        let adGroupResourceName: string | undefined;
        if (raw.level === 'CAMPAIGN') {
          if (!raw.campaign_id) {
            throw new HttpException(
              'level=CAMPAIGN exige campaign_id.',
              HttpStatus.BAD_REQUEST,
            );
          }
          const camp = await this.requireCampaign(tenantId, raw.campaign_id);
          campaignResourceName = `customers/${customerId}/campaigns/${camp.google_campaign_id}`;
        }
        if (raw.level === 'AD_GROUP') {
          if (!raw.ad_group_id) {
            throw new HttpException(
              'level=AD_GROUP exige ad_group_id.',
              HttpStatus.BAD_REQUEST,
            );
          }
          const ag = await this.requireAdGroup(tenantId, raw.ad_group_id);
          adGroupResourceName = `customers/${customerId}/adGroups/${ag.google_ad_group_id}`;
        }

        return {
          ...base,
          customerId,
          phoneNumber,
          countryCode,
          level: raw.level,
          campaignResourceName,
          adGroupResourceName,
          callTracked: raw.call_tracked ?? true,
          context: { ...base.context, level: raw.level },
        };
      }

      // ═══════════════════════════════════════════════════════════════════
      // Sprint 2 backlog (2026-05-17) — Extensions / Assets
      // ═══════════════════════════════════════════════════════════════════

      case 'trafego-mutate-create-extension': {
        let attachCampaignResourceName: string | undefined;
        let attachAdGroupResourceName: string | undefined;
        if (raw.attach_level === 'CAMPAIGN') {
          if (!raw.campaign_id) {
            throw new HttpException(
              'attach_level=CAMPAIGN exige campaign_id',
              HttpStatus.BAD_REQUEST,
            );
          }
          const camp = await this.requireCampaign(tenantId, raw.campaign_id);
          attachCampaignResourceName = `customers/${customerId}/campaigns/${camp.google_campaign_id}`;
        }
        if (raw.attach_level === 'AD_GROUP') {
          if (!raw.ad_group_id) {
            throw new HttpException(
              'attach_level=AD_GROUP exige ad_group_id',
              HttpStatus.BAD_REQUEST,
            );
          }
          const ag = await this.requireAdGroup(tenantId, raw.ad_group_id);
          attachAdGroupResourceName = `customers/${customerId}/adGroups/${ag.google_ad_group_id}`;
        }
        return {
          ...base,
          customerId,
          type: raw.type,
          data: raw.data,
          attachLevel: raw.attach_level,
          attachCampaignResourceName,
          attachAdGroupResourceName,
          context: {
            ...base.context,
            asset_type: raw.type,
            attach_level: raw.attach_level,
          },
        };
      }

      case 'trafego-mutate-attach-extension': {
        let campaignResourceName: string | undefined;
        let adGroupResourceName: string | undefined;
        if (raw.level === 'CAMPAIGN') {
          if (!raw.campaign_id) {
            throw new HttpException(
              'level=CAMPAIGN exige campaign_id',
              HttpStatus.BAD_REQUEST,
            );
          }
          const camp = await this.requireCampaign(tenantId, raw.campaign_id);
          campaignResourceName = `customers/${customerId}/campaigns/${camp.google_campaign_id}`;
        }
        if (raw.level === 'AD_GROUP') {
          if (!raw.ad_group_id) {
            throw new HttpException(
              'level=AD_GROUP exige ad_group_id',
              HttpStatus.BAD_REQUEST,
            );
          }
          const ag = await this.requireAdGroup(tenantId, raw.ad_group_id);
          adGroupResourceName = `customers/${customerId}/adGroups/${ag.google_ad_group_id}`;
        }
        // asset_id pode ser resource_name (customers/X/assets/Y) ou apenas
        // o ID numerico. Aceita ambos.
        const assetResourceName = raw.asset_id.startsWith('customers/')
          ? raw.asset_id
          : `customers/${customerId}/assets/${raw.asset_id}`;
        // Tipo do asset precisa ser resolvido pra field_type. Como nao temos
        // cache local, exigimos que o caller passe via raw.field_type
        // (preenchido pela tool MCP). Default SITELINK pra compat — Google
        // valida e retorna erro estruturado se errado.
        const fieldType = raw.field_type || raw.type || 'SITELINK';
        return {
          ...base,
          customerId,
          assetResourceName,
          level: raw.level,
          campaignResourceName,
          adGroupResourceName,
          fieldType,
          context: {
            ...base.context,
            asset_id: raw.asset_id,
            level: raw.level,
          },
        };
      }

      case 'trafego-mutate-detach-extension': {
        // assetLinkResourceName eh do CustomerAsset/CampaignAsset/AdGroupAsset
        // — formato: customers/X/{customerAssets|campaignAssets|adGroupAssets}/Y
        // Caller passa direto via raw.asset_link_resource_name OU monta via
        // campos individuais (asset_id + scope_id + level).
        if (!raw.asset_link_resource_name) {
          throw new HttpException(
            'detach exige asset_link_resource_name (do CustomerAsset/CampaignAsset/AdGroupAsset). ' +
              'Obtem via traffic_list_extensions.',
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          ...base,
          assetLinkResourceName: raw.asset_link_resource_name,
          level: raw.level,
          context: { ...base.context, level: raw.level },
        };
      }

      case 'trafego-mutate-remove-extension': {
        const assetResourceName = raw.asset_id.startsWith('customers/')
          ? raw.asset_id
          : `customers/${customerId}/assets/${raw.asset_id}`;
        return {
          ...base,
          assetResourceName,
          context: {
            ...base.context,
            asset_id: raw.asset_id,
            reason: raw.reason,
          },
        };
      }

      // ═══════════════════════════════════════════════════════════════════
      // Sprint 3 backlog (2026-05-17) — Targeting + Bulk
      // ═══════════════════════════════════════════════════════════════════

      case 'trafego-mutate-update-geo-targets': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          addResourceNames: (raw.add ?? []).map((id: string) =>
            id.startsWith('geoTargetConstants/')
              ? id
              : `geoTargetConstants/${id}`,
          ),
          geoTargetNames: raw.geo_target_names ?? [],
          geoTargetTypeSetting: raw.geo_target_type ?? null,
          removeResourceNames: raw.remove ?? [],
          negative: !!raw.negative,
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            add_count: (raw.add ?? []).length,
            remove_count: (raw.remove ?? []).length,
          },
        };
      }

      case 'trafego-mutate-update-language-targets': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          addResourceNames: (raw.add ?? []).map((id: string) =>
            id.startsWith('languageConstants/')
              ? id
              : `languageConstants/${id}`,
          ),
          removeResourceNames: raw.remove ?? [],
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            add_count: (raw.add ?? []).length,
            remove_count: (raw.remove ?? []).length,
          },
        };
      }

      case 'trafego-mutate-update-device-targeting': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          mobileModifier: raw.mobile_modifier,
          desktopModifier: raw.desktop_modifier,
          tabletModifier: raw.tablet_modifier,
          context: { ...base.context, campaign_id_local: camp.id },
        };
      }

      case 'trafego-mutate-bulk-add-negatives': {
        const targets: Array<{
          scope: 'CAMPAIGN' | 'AD_GROUP';
          resourceName: string;
        }> = [];
        for (const t of raw.targets ?? []) {
          if (t.campaign_id) {
            const c = await this.requireCampaign(tenantId, t.campaign_id);
            targets.push({
              scope: 'CAMPAIGN',
              resourceName: `customers/${customerId}/campaigns/${c.google_campaign_id}`,
            });
          } else if (t.ad_group_id) {
            const g = await this.requireAdGroup(tenantId, t.ad_group_id);
            targets.push({
              scope: 'AD_GROUP',
              resourceName: `customers/${customerId}/adGroups/${g.google_ad_group_id}`,
            });
          } else {
            throw new HttpException(
              'bulk_add_negatives: cada target precisa de campaign_id OR ad_group_id',
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        return {
          ...base,
          targets,
          keywords: raw.keywords ?? [],
          matchType: raw.match_type,
          context: {
            ...base.context,
            target_count: targets.length,
            kw_count: (raw.keywords ?? []).length,
          },
        };
      }

      case 'trafego-mutate-create-shared-negative-list': {
        const attachCampaignResourceNames: string[] = [];
        for (const cid of raw.attach_campaign_ids ?? []) {
          const c = await this.requireCampaign(tenantId, cid);
          attachCampaignResourceNames.push(
            `customers/${customerId}/campaigns/${c.google_campaign_id}`,
          );
        }
        return {
          ...base,
          customerId,
          name: raw.name,
          keywords: raw.keywords ?? [],
          matchType: raw.match_type,
          attachCampaignResourceNames,
          context: {
            ...base.context,
            list_name: raw.name,
            kw_count: (raw.keywords ?? []).length,
            attach_count: attachCampaignResourceNames.length,
          },
        };
      }

      case 'trafego-mutate-attach-shared-negative-list': {
        const sharedSetResourceName = raw.shared_set_id.startsWith('customers/')
          ? raw.shared_set_id
          : `customers/${customerId}/sharedSets/${raw.shared_set_id}`;
        const campaignResourceNames: string[] = [];
        for (const cid of raw.campaign_ids ?? []) {
          const c = await this.requireCampaign(tenantId, cid);
          campaignResourceNames.push(
            `customers/${customerId}/campaigns/${c.google_campaign_id}`,
          );
        }
        return {
          ...base,
          sharedSetResourceName,
          campaignResourceNames,
          context: {
            ...base.context,
            shared_set_id: raw.shared_set_id,
            campaign_count: campaignResourceNames.length,
          },
        };
      }

      case 'trafego-mutate-update-location-bid-modifiers': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          modifiers: (raw.modifiers ?? []).map((m: any) => ({
            geoTargetConstantResourceName: m.geo_target_id.startsWith(
              'geoTargetConstants/',
            )
              ? m.geo_target_id
              : `geoTargetConstants/${m.geo_target_id}`,
            bidModifier: Number(m.bid_modifier),
          })),
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            modifier_count: (raw.modifiers ?? []).length,
          },
        };
      }

      case 'trafego-mutate-create-pmax-campaign': {
        return {
          ...base,
          customerId,
          name: raw.name,
          dailyBudgetMicros: String(
            Math.round(Number(raw.daily_budget_brl) * 1_000_000),
          ),
          biddingStrategy: raw.bidding_strategy ?? 'MAXIMIZE_CONVERSIONS',
          targetCpaMicros: raw.target_cpa_brl
            ? String(Math.round(Number(raw.target_cpa_brl) * 1_000_000))
            : null,
          targetRoas: raw.target_roas ?? null,
          finalUrl: raw.final_url,
          geoTargetIds: raw.geo_target_ids ?? ['1001775'],
          languageIds: raw.language_ids ?? ['1014'],
          initialStatus: raw.initial_status ?? 'PAUSED',
          // Propaganda política UE — obrigatório no create (API v23+).
          containsEuPoliticalAdvertising: !!raw.contains_eu_political_advertising,
          context: { ...base.context, channel_type: 'PERFORMANCE_MAX' },
        };
      }

      // ═══════════════════════════════════════════════════════════════════
      // Sprint 4.1 (2026-05-17) — PMax asset groups + Experiments
      // ═══════════════════════════════════════════════════════════════════

      case 'trafego-mutate-create-pmax-asset-group': {
        const camp = await this.requireCampaign(tenantId, raw.campaign_id);
        if (camp.channel_type && camp.channel_type !== 'PERFORMANCE_MAX') {
          throw new HttpException(
            `Asset group so pode ser criado em PMax. Campanha ${camp.id} eh tipo ${camp.channel_type}.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          ...base,
          customerId,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          name: raw.name,
          finalUrls: raw.final_urls ?? [],
          finalMobileUrls: raw.final_mobile_urls,
          path1: raw.path1,
          path2: raw.path2,
          status: raw.status ?? 'PAUSED',
          context: {
            ...base.context,
            campaign_id_local: camp.id,
            asset_group_name: raw.name,
          },
        };
      }

      case 'trafego-mutate-add-assets-to-pmax-asset-group': {
        const assetGroupResourceName = raw.asset_group_id.startsWith(
          'customers/',
        )
          ? raw.asset_group_id
          : `customers/${customerId}/assetGroups/${raw.asset_group_id}`;
        return {
          ...base,
          customerId,
          assetGroupResourceName,
          assets: (raw.assets ?? []).map((a: any) => ({
            source: a.source,
            fieldType: a.field_type,
            payload: a.payload ?? {},
          })),
          context: {
            ...base.context,
            asset_group_id: raw.asset_group_id,
            asset_count: (raw.assets ?? []).length,
          },
        };
      }

      case 'trafego-mutate-create-experiment': {
        const baseCamp = await this.requireCampaign(
          tenantId,
          raw.base_campaign_id,
        );
        return {
          ...base,
          customerId,
          baseCampaignResourceName: `customers/${customerId}/campaigns/${baseCamp.google_campaign_id}`,
          name: raw.name,
          type: raw.type ?? 'SEARCH_CUSTOM',
          description: raw.description,
          suffix: raw.suffix,
          goals: raw.goals,
          context: {
            ...base.context,
            base_campaign_id_local: baseCamp.id,
            experiment_name: raw.name,
            experiment_type: raw.type ?? 'SEARCH_CUSTOM',
          },
        };
      }

      // ═══════════════════════════════════════════════════════════════════
      // Sprint 4.2 (2026-05-17) — Experiments lifecycle
      // ═══════════════════════════════════════════════════════════════════

      case 'trafego-mutate-add-treatment-arm': {
        const trialCamp = await this.requireCampaign(
          tenantId,
          raw.trial_campaign_id,
        );
        const experimentResourceName = raw.experiment_id.startsWith(
          'customers/',
        )
          ? raw.experiment_id
          : `customers/${customerId}/experiments/${raw.experiment_id}`;
        return {
          ...base,
          customerId,
          experimentResourceName,
          name: raw.name,
          trialCampaignResourceName: `customers/${customerId}/campaigns/${trialCamp.google_campaign_id}`,
          trafficSplit: raw.traffic_split ?? 50,
          context: {
            ...base.context,
            experiment_id: raw.experiment_id,
            trial_campaign_id_local: trialCamp.id,
            traffic_split: raw.traffic_split ?? 50,
          },
        };
      }

      case 'trafego-mutate-schedule-experiment':
      case 'trafego-mutate-end-experiment':
      case 'trafego-mutate-promote-experiment': {
        const experimentResourceName = raw.experiment_id.startsWith(
          'customers/',
        )
          ? raw.experiment_id
          : `customers/${customerId}/experiments/${raw.experiment_id}`;
        return {
          ...base,
          customerId,
          experimentResourceName,
          context: {
            ...base.context,
            experiment_id: raw.experiment_id,
          },
        };
      }

      case 'trafego-mutate-graduate-experiment': {
        const experimentResourceName = raw.experiment_id.startsWith(
          'customers/',
        )
          ? raw.experiment_id
          : `customers/${customerId}/experiments/${raw.experiment_id}`;
        const mappings: Array<{
          experimentCampaignResourceName: string;
          campaignBudgetResourceName: string;
        }> = [];
        for (const m of raw.mappings ?? []) {
          // experiment_campaign_id pode ser resource_name OR ID numerico OR
          // ID interno do CRM (resolve via requireCampaign)
          let expCampRn: string;
          if (m.experiment_campaign_id.startsWith('customers/')) {
            expCampRn = m.experiment_campaign_id;
          } else {
            try {
              const camp = await this.requireCampaign(
                tenantId,
                m.experiment_campaign_id,
              );
              expCampRn = `customers/${customerId}/campaigns/${camp.google_campaign_id}`;
            } catch {
              // Se nao acha local, assume que eh google_campaign_id puro
              expCampRn = `customers/${customerId}/campaigns/${m.experiment_campaign_id}`;
            }
          }
          // budget_id: aceita resource_name OR google_budget_id numerico
          const budgetRn = m.campaign_budget_id.startsWith('customers/')
            ? m.campaign_budget_id
            : `customers/${customerId}/campaignBudgets/${m.campaign_budget_id}`;
          mappings.push({
            experimentCampaignResourceName: expCampRn,
            campaignBudgetResourceName: budgetRn,
          });
        }
        return {
          ...base,
          customerId,
          experimentResourceName,
          mappings,
          context: {
            ...base.context,
            experiment_id: raw.experiment_id,
            mapping_count: mappings.length,
          },
        };
      }

      case 'trafego-mutate-remove-asset': {
        // Fix 2026-05-18 v3 (BUG-E definitivo): Google Ads API v23 NAO PERMITE
        // remove de Asset. AssetOperation proto so tem `create` e `update`
        // — NAO TEM `remove` field. Asset eh imutavel uma vez criado.
        // Pra "limpar" um asset, voce so pode remover suas ASSOCIACOES
        // (CampaignAsset, AdGroupAsset, CustomerAsset) via traffic_detach_extension.
        // O Asset em si fica permanente na conta.
        //
        // Confirmado em https://developers.google.com/google-ads/api/reference/rpc/v23/AssetOperation
        // (proto so tem create + update, sem remove field).
        //
        // Tentativas anteriores de remove em rounds 1/2/3:
        //  - round 1 (5b84fc5): svc.remove is not a function (Opteo nao expoe)
        //  - round 2 (8109a00): OPERATION_REQUIRED (mutateResources mal-serializa)
        //  - round 3 (aa29fa8): INVALID_ARGUMENT (proto rejeita campo remove)
        // Todos falharam pq estavamos tentando o impossivel.
        throw new HttpException(
          `Google Ads API NAO permite remover Asset diretamente — proto AssetOperation so tem create e update. ` +
            `Asset ${raw.asset_id} eh imutavel uma vez criado. ` +
            `Pra remover apenas a ASSOCIACAO de um asset a uma campanha/grupo/conta, ` +
            `use traffic_detach_extension passando o link_resource_name (CampaignAsset/AdGroupAsset/CustomerAsset). ` +
            `O Asset em si fica permanente na conta (sem custo, mas vivel na lista de assets). ` +
            `Refs: https://developers.google.com/google-ads/api/reference/rpc/v23/AssetOperation`,
          HttpStatus.BAD_REQUEST,
        );
      }

      case 'trafego-mutate-bulk-update-status': {
        const targets: Array<{
          resourceType: 'campaign' | 'ad_group';
          resourceName: string;
        }> = [];
        for (const t of raw.targets ?? []) {
          if (t.type === 'campaign') {
            const c = await this.requireCampaign(tenantId, t.id);
            targets.push({
              resourceType: 'campaign',
              resourceName: `customers/${customerId}/campaigns/${c.google_campaign_id}`,
            });
          } else if (t.type === 'ad_group') {
            const g = await this.requireAdGroup(tenantId, t.id);
            targets.push({
              resourceType: 'ad_group',
              resourceName: `customers/${customerId}/adGroups/${g.google_ad_group_id}`,
            });
          } else {
            throw new HttpException(
              `bulk_update_status: type invalido "${t.type}" (esperado campaign|ad_group)`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        return {
          ...base,
          targets,
          status: raw.status,
          context: { ...base.context, target_count: targets.length },
        };
      }

      default:
        throw new HttpException(
          `Job de mutate nao suportado: ${jobName}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 1 backlog (2026-05-17) — helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Resolve ConversionAction por UUID interno OR google_conversion_id.
   */
  private async requireConversionAction(tenantId: string, idOrGoogleId: string) {
    const ca = await this.prisma.trafficConversionAction.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [
          { id: idOrGoogleId },
          { google_conversion_id: idOrGoogleId },
        ],
      },
    });
    if (!ca) {
      throw new NotFoundException(
        `ConversionAction nao encontrada (id="${idOrGoogleId}")`,
      );
    }
    return ca;
  }

  /**
   * Resolve Ad por UUID interno OR google_ad_id. Inclui ad_group pra
   * formar o resource_name composto (customers/X/adGroupAds/AG~AD).
   */
  private async requireAd(tenantId: string, idOrGoogleId: string) {
    const ad = await this.prisma.trafficAd.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [{ id: idOrGoogleId }, { google_ad_id: idOrGoogleId }],
      },
      include: { ad_group: true },
    });
    if (!ad) {
      throw new NotFoundException(
        `Ad nao encontrado (id="${idOrGoogleId}")`,
      );
    }
    return ad;
  }

  /**
   * Liga toggle local de upload de Enhanced Conversions for Leads via API
   * (cron BullMQ diario sobe userIdentifiers de leads recentes).
   */
  async setEnhancedConvUploadEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.trafficSettings.upsert({
      where: { tenant_id: tenantId },
      update: { enhanced_conv_for_leads_upload_enabled: enabled },
      create: {
        tenant_id: tenantId,
        enhanced_conv_for_leads_upload_enabled: enabled,
      },
    });
  }

  /**
   * Resolve referencia a campanha aceitando AMBOS:
   *   - UUID interno do CRM (id)
   *   - google_campaign_id numerico
   *
   * Antes (ate 2026-05-17), so aceitava UUID. Mas as tools do MCP exibem o
   * google_campaign_id na listagem (esse eh o ID natural pra quem trabalha
   * no console Google Ads), e quando o operador/agente passava o google_id
   * em pause/budget/etc, retornava 404 "Campanha nao encontrada" sem dica.
   *
   * O `listAdGroups` ja aceitava ambos via campaign_id query, entao essa
   * mudanca alinha o comportamento das outras rotas com o que ja existia.
   */
  private async requireCampaign(tenantId: string, campaignIdOrGoogleId: string) {
    const camp = await this.prisma.trafficCampaign.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [
          { id: campaignIdOrGoogleId },
          { google_campaign_id: campaignIdOrGoogleId },
        ],
      },
    });
    if (!camp) throw new NotFoundException('Campanha nao encontrada');
    return camp;
  }

  /**
   * AI Max for Search — leitura do estado atual (preenchido pelo sync de
   * campanha via campaign.ai_max_setting.enable_ai_max). AI Max so se aplica
   * a campanhas de Pesquisa (SEARCH); para outros tipos `available=false` e
   * `ai_max_enabled` tende a vir null.
   */
  async getAiMaxSettings(tenantId: string, campaignId: string) {
    const camp = await this.requireCampaign(tenantId, campaignId);
    const isSearch = String(camp.channel_type ?? '').toUpperCase() === 'SEARCH';
    return {
      campaign_id: camp.id,
      google_campaign_id: camp.google_campaign_id,
      name: camp.name,
      channel_type: camp.channel_type,
      status: camp.status,
      ai_max_enabled: (camp as any).ai_max_enabled ?? null,
      available: isSearch,
      reason: isSearch
        ? null
        : 'AI Max for Search só se aplica a campanhas do tipo Pesquisa (SEARCH).',
      last_sync_at: (camp as any).last_seen_at ?? null,
    };
  }

  /**
   * Mesmo padrao do requireCampaign: aceita UUID interno OU google_ad_group_id.
   */
  private async requireAdGroup(tenantId: string, adGroupIdOrGoogleId: string) {
    const ag = await this.prisma.trafficAdGroup.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [
          { id: adGroupIdOrGoogleId },
          { google_ad_group_id: adGroupIdOrGoogleId },
        ],
      },
    });
    if (!ag) throw new NotFoundException('Ad group nao encontrado');
    return ag;
  }

  /**
   * Resolve campaign UUID interno OR google_campaign_id em google_campaign_id.
   * Usado em reads (extensions, etc) que precisam passar pro GAQL `campaign.id`
   * (int64). Se ja for google ID, retorna ele mesmo. Se for UUID, faz lookup.
   * Throw 404 se nao encontrar.
   * Fix BUG-G (2026-05-18).
   */
  async resolveCampaignGoogleId(
    tenantId: string,
    idOrGoogleId: string,
  ): Promise<string> {
    // Heuristica: se for inteiro puro, ja eh google_id — skip lookup
    if (/^\d+$/.test(idOrGoogleId)) return idOrGoogleId;
    const camp = await this.requireCampaign(tenantId, idOrGoogleId);
    return camp.google_campaign_id;
  }

  /**
   * Idem pra ad_group. Fix BUG-G (2026-05-18).
   */
  async resolveAdGroupGoogleId(
    tenantId: string,
    idOrGoogleId: string,
  ): Promise<string> {
    if (/^\d+$/.test(idOrGoogleId)) return idOrGoogleId;
    const ag = await this.requireAdGroup(tenantId, idOrGoogleId);
    return ag.google_ad_group_id;
  }

  // ─── Bidding Strategy: lookup publico + validacoes ─────────────────────

  /**
   * Versao publica do requireCampaign — retorna null em vez de throw
   * pra que o controller possa montar mensagens de erro customizadas.
   * Aceita UUID interno ou google_campaign_id (matching requireCampaign).
   */
  async getCampaignByEither(tenantId: string, idOrGoogleId: string) {
    return this.prisma.trafficCampaign.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [{ id: idOrGoogleId }, { google_campaign_id: idOrGoogleId }],
      },
    });
  }

  /**
   * Valida mudanca de bidding strategy ANTES de enfileirar.
   *
   * Retorna { blockingErrors[], warnings[], learningPeriodDays } pra o
   * controller decidir entre 400 (blockingErrors), continuar com warnings
   * (lista nao vazia mas sem blockers), ou seguir limpo.
   *
   * Regras implementadas:
   *   1. Noop (strategy igual atual)
   *   2. Params condicionais (TARGET_CPA exige target_cpa_brl, etc)
   *   3. TARGET_SPEND bloqueado (a menos que env override)
   *   4. MANUAL_CPC exige confirm
   *   5. Smart Bidding exige >=1 conversion action ativa
   *   6. TARGET_ROAS/MAXIMIZE_CONVERSION_VALUE exige value > 0 em
   *      conv actions (warning soft, nao bloqueio)
   *   7. Histórico baixo de conversoes (<15 conv/30d) -> warning
   *   8. Valores suspeitos (target_cpa < 0.5 ou target_roas > 50)
   *      exigem confirm
   *   9. Sair de Smart Bidding com >=30 conv/30d exige confirm
   */
  async validateBiddingStrategyChange(
    tenantId: string,
    campaign: { id: string; bidding_strategy: string | null; name: string },
    dto: {
      bidding_strategy: string;
      target_cpa_brl?: number;
      target_roas?: number;
      target_impression_share_pct?: number;
      max_cpc_bid_ceiling_brl?: number;
      confirm?: boolean;
    },
    opts: { allowDeprecatedTargetSpend?: boolean } = {},
  ): Promise<{
    blockingErrors: string[];
    warnings: string[];
    learningPeriodDays: number;
  }> {
    const blockingErrors: string[] = [];
    const warnings: string[] = [];

    const SMART_BIDDING = new Set([
      'MAXIMIZE_CONVERSIONS',
      'MAXIMIZE_CONVERSION_VALUE',
      'TARGET_CPA',
      'TARGET_ROAS',
    ]);
    const VALUE_BASED = new Set(['MAXIMIZE_CONVERSION_VALUE', 'TARGET_ROAS']);

    // 1. Noop check
    if (campaign.bidding_strategy === dto.bidding_strategy) {
      blockingErrors.push(
        `Campanha "${campaign.name}" ja esta em ${dto.bidding_strategy}. Operacao noop.`,
      );
    }

    // 2. Params condicionais obrigatorios
    if (dto.bidding_strategy === 'TARGET_CPA' && dto.target_cpa_brl == null) {
      blockingErrors.push('target_cpa_brl eh obrigatorio para TARGET_CPA.');
    }
    if (dto.bidding_strategy === 'TARGET_ROAS' && dto.target_roas == null) {
      blockingErrors.push('target_roas eh obrigatorio para TARGET_ROAS.');
    }
    if (
      dto.bidding_strategy === 'TARGET_IMPRESSION_SHARE' &&
      dto.target_impression_share_pct == null
    ) {
      blockingErrors.push(
        'target_impression_share_pct eh obrigatorio para TARGET_IMPRESSION_SHARE.',
      );
    }

    // 3. TARGET_SPEND deprecated
    if (dto.bidding_strategy === 'TARGET_SPEND' && !opts.allowDeprecatedTargetSpend) {
      blockingErrors.push(
        'TARGET_SPEND eh depreciada pelo Google para campanhas Search. Use MAXIMIZE_CLICKS ou MAXIMIZE_CONVERSIONS.',
      );
    }

    // 4. MANUAL_CPC exige confirm (raro hoje, geralmente erro de digitacao)
    if (dto.bidding_strategy === 'MANUAL_CPC' && !dto.confirm) {
      blockingErrors.push(
        'MANUAL_CPC eh uma estrategia legada que entrega menos automacao. Re-envie com confirm=true se isso eh proposital.',
      );
    }

    // 5. Smart Bidding exige conversion actions ativas
    if (SMART_BIDDING.has(dto.bidding_strategy)) {
      const activeConvActions = await this.prisma.trafficConversionAction.count({
        where: {
          tenant_id: tenantId,
          status: 'ENABLED',
          include_in_conversions: true,
        },
      });
      if (activeConvActions === 0) {
        blockingErrors.push(
          'Smart Bidding (' +
            dto.bidding_strategy +
            ') requer ao menos uma ConversionAction ativa com include_in_conversions=true. Configure em Configuracoes > Tracking de Conversoes.',
        );
      } else if (VALUE_BASED.has(dto.bidding_strategy)) {
        // 6. Value-based: ao menos uma conv action com value default > 0
        // default_value_micros eh BigInt — usar literal bigint na comparacao
        const withValue = await this.prisma.trafficConversionAction.count({
          where: {
            tenant_id: tenantId,
            status: 'ENABLED',
            include_in_conversions: true,
            default_value_micros: { gt: BigInt(0) },
          },
        });
        if (withValue === 0) {
          warnings.push(
            'Estrategia por valor (' +
              dto.bidding_strategy +
              ') configurada mas nenhuma ConversionAction tem default_value_micros > 0. Sem valor, o Google nao consegue otimizar — defina valores nas conv actions.',
          );
        }
      }
    }

    // 7. Histórico de conversoes na campanha (30d) — soft signal
    const last30d = new Date();
    last30d.setUTCDate(last30d.getUTCDate() - 30);
    const recentMetrics = await this.prisma.trafficMetricDaily.aggregate({
      where: { tenant_id: tenantId, campaign_id: campaign.id, date: { gte: last30d } },
      _sum: { conversions: true },
    });
    const conv30d = Number(recentMetrics._sum?.conversions ?? 0);
    const currentIsSmart = SMART_BIDDING.has(campaign.bidding_strategy ?? '');
    const nextIsSmart = SMART_BIDDING.has(dto.bidding_strategy);

    if (nextIsSmart && conv30d < 15) {
      warnings.push(
        `Histórico baixo: ${conv30d} conversoes em 30d. Google recomenda >=30 pra Smart Bidding performar bem. Considere acumular mais dados antes ou usar MAXIMIZE_CLICKS por enquanto.`,
      );
    }

    // 8. Valores suspeitos — heuristica simples (sem media CPC da conta)
    if (
      dto.bidding_strategy === 'TARGET_CPA' &&
      dto.target_cpa_brl != null &&
      dto.target_cpa_brl < 0.5 &&
      !dto.confirm
    ) {
      blockingErrors.push(
        `target_cpa_brl=${dto.target_cpa_brl} parece suspeito (< R$ 0.50). Se for proposital, re-envie com confirm=true.`,
      );
    }
    if (
      dto.bidding_strategy === 'TARGET_ROAS' &&
      dto.target_roas != null &&
      dto.target_roas > 50 &&
      !dto.confirm
    ) {
      blockingErrors.push(
        `target_roas=${dto.target_roas} (${dto.target_roas * 100}%) parece suspeito (> 5000%). Se for proposital, re-envie com confirm=true.`,
      );
    }

    // 9. Sair de Smart Bidding consolidado exige confirm
    if (currentIsSmart && !nextIsSmart && conv30d >= 30 && !dto.confirm) {
      blockingErrors.push(
        `Mudanca de Smart Bidding (${campaign.bidding_strategy} -> ${dto.bidding_strategy}) em campanha com aprendizado consolidado (${conv30d} conv/30d). Voce vai perder o learning. Re-envie com confirm=true se for proposital.`,
      );
    }

    // Estimativa de learning period — heuristica do Google (7-14 dias).
    // Mais alto se mudando ENTRE Smart Biddings, menor se saindo pra MANUAL.
    let learningPeriodDays = 7;
    if (nextIsSmart && !currentIsSmart) learningPeriodDays = 14;
    if (nextIsSmart && currentIsSmart) learningPeriodDays = 10;
    if (!nextIsSmart) learningPeriodDays = 0;

    return { blockingErrors, warnings, learningPeriodDays };
  }

  // ─── Remove (campanha + ad_group): validacao + preview ─────────────────

  /**
   * Valida remocao de campanha ANTES de enfileirar. Calcula preview do
   * cascade (ad_groups, ads, keywords que vao junto) + metricas lifetime
   * pra decidir se exige confirm_with_history.
   *
   * Retorna { blockingErrors[], warnings[], preview{} } pra controller decidir.
   *
   * Regras:
   *   1. Status REMOVED (noop): bloqueia.
   *   2. confirm != true: bloqueia (DTO ja faria mas mensagem padrao do
   *      class-validator nao explica a operacao — repetir aqui pra mensagem clara).
   *   3. ENABLED sem force_if_enabled: bloqueia (garante que admin pause primeiro).
   *   4. Historico relevante (>=10 conv lifetime OR >=R$500 gasto historico OR
   *      esteve ENABLED nos ultimos 7 dias) sem confirm_with_history: bloqueia.
   */
  async validateCampaignRemoval(
    tenantId: string,
    campaign: { id: string; name: string; status: string },
    dto: {
      confirm: boolean;
      confirm_with_history?: boolean;
      force_if_enabled?: boolean;
      reason: string;
    },
  ): Promise<{
    blockingErrors: string[];
    warnings: string[];
    preview: {
      campaign_name: string;
      campaign_id_local: string;
      current_status: string;
      lifetime_conversions: number;
      lifetime_spend_brl: number;
      enabled_recently: boolean;
      cascade: {
        ad_groups: number;
        ads: number;
        keywords: number;
        negative_keywords: number;
      };
    };
  }> {
    const blockingErrors: string[] = [];
    const warnings: string[] = [];

    // 1. Status REMOVED — noop
    if (campaign.status === 'REMOVED') {
      blockingErrors.push(
        `Campanha "${campaign.name}" ja esta em status REMOVED. Operacao noop.`,
      );
    }

    // 2. Confirm reforco (DTO ja valida, mas mensagem aqui eh mais util)
    if (!dto.confirm) {
      blockingErrors.push(
        'Remocao exige confirm=true (operacao irreversivel pela UI). Re-envie com confirm=true e reason explicando o motivo.',
      );
    }

    // 3. ENABLED sem force_if_enabled
    if (campaign.status === 'ENABLED' && !dto.force_if_enabled) {
      blockingErrors.push(
        `Campanha "${campaign.name}" esta ENABLED gastando agora. Pause primeiro (traffic_pause_campaign) ou re-envie com force_if_enabled=true.`,
      );
    }

    // 4. Calcular metricas lifetime + atividade recente
    const lifetime = await this.prisma.trafficMetricDaily.aggregate({
      where: { tenant_id: tenantId, campaign_id: campaign.id },
      _sum: { conversions: true, cost_micros: true },
    });
    const lifetimeConv = Number(lifetime._sum?.conversions ?? 0);
    const lifetimeSpendMicros = BigInt(
      (lifetime._sum?.cost_micros as bigint | null) ?? 0n,
    );
    const lifetimeSpendBrl =
      Number(lifetimeSpendMicros / 1_000n) / 1_000;

    // Atividade nos ultimos 7d (impressoes > 0 = esteve enabled)
    const last7d = new Date();
    last7d.setUTCDate(last7d.getUTCDate() - 7);
    const recent = await this.prisma.trafficMetricDaily.aggregate({
      where: {
        tenant_id: tenantId,
        campaign_id: campaign.id,
        date: { gte: last7d },
      },
      _sum: { impressions: true },
    });
    const enabledRecently = Number(recent._sum?.impressions ?? 0) > 0;

    const hasRelevantHistory =
      lifetimeConv >= 10 || lifetimeSpendBrl >= 500 || enabledRecently;

    if (hasRelevantHistory && !dto.confirm_with_history) {
      blockingErrors.push(
        `Campanha "${campaign.name}" tem historico relevante (${lifetimeConv.toFixed(1)} conv lifetime, R$ ${lifetimeSpendBrl.toFixed(2)} gastos${enabledRecently ? ', ativa nos ultimos 7d' : ''}). Re-envie com confirm_with_history=true se realmente quer apagar.`,
      );
    } else if (hasRelevantHistory) {
      warnings.push(
        `Historico relevante: ${lifetimeConv.toFixed(1)} conv lifetime, R$ ${lifetimeSpendBrl.toFixed(2)} gastos. Dados de aprendizado serao perdidos.`,
      );
    }

    // 5. Cascade: count ad_groups, ads, keywords ativos
    // Cada query agrupa por status != REMOVED pra refletir o que vai
    // efetivamente "sumir" da operacao normal (REMOVED ja invisivel).
    const adGroupsCount = await this.prisma.trafficAdGroup.count({
      where: {
        tenant_id: tenantId,
        campaign_id: campaign.id,
        status: { not: 'REMOVED' },
      },
    });

    const adGroupIds = (
      await this.prisma.trafficAdGroup.findMany({
        where: {
          tenant_id: tenantId,
          campaign_id: campaign.id,
          status: { not: 'REMOVED' },
        },
        select: { id: true },
      })
    ).map((x) => x.id);

    const [adsCount, kwTotal, kwNegativeCount] = await Promise.all([
      this.prisma.trafficAd.count({
        where: {
          tenant_id: tenantId,
          ad_group_id: { in: adGroupIds },
          status: { not: 'REMOVED' },
        },
      }),
      this.prisma.trafficKeyword.count({
        where: {
          tenant_id: tenantId,
          ad_group_id: { in: adGroupIds },
          status: { not: 'REMOVED' },
        },
      }),
      this.prisma.trafficKeyword.count({
        where: {
          tenant_id: tenantId,
          ad_group_id: { in: adGroupIds },
          status: { not: 'REMOVED' },
          negative: true,
        },
      }),
    ]);

    return {
      blockingErrors,
      warnings,
      preview: {
        campaign_name: campaign.name,
        campaign_id_local: campaign.id,
        current_status: campaign.status,
        lifetime_conversions: lifetimeConv,
        lifetime_spend_brl: lifetimeSpendBrl,
        enabled_recently: enabledRecently,
        cascade: {
          ad_groups: adGroupsCount,
          ads: adsCount,
          keywords: kwTotal - kwNegativeCount,
          negative_keywords: kwNegativeCount,
        },
      },
    };
  }

  /**
   * Valida remocao de ad_group ANTES de enfileirar. Mesmo padrao da
   * campanha mas com check adicional: bloqueia se for o UNICO ad_group
   * ativo da campanha (sem isso a campanha fica orfã, sem onde servir).
   */
  async validateAdGroupRemoval(
    tenantId: string,
    adGroup: {
      id: string;
      name: string;
      status: string;
      campaign_id: string;
    },
    dto: {
      confirm: boolean;
      force_if_enabled?: boolean;
      reason: string;
    },
  ): Promise<{
    blockingErrors: string[];
    warnings: string[];
    preview: {
      ad_group_name: string;
      ad_group_id_local: string;
      campaign_id_local: string;
      current_status: string;
      cascade: { ads: number; keywords: number; negative_keywords: number };
      is_only_active: boolean;
    };
  }> {
    const blockingErrors: string[] = [];
    const warnings: string[] = [];

    if (adGroup.status === 'REMOVED') {
      blockingErrors.push(
        `Ad group "${adGroup.name}" ja esta em status REMOVED. Operacao noop.`,
      );
    }

    if (!dto.confirm) {
      blockingErrors.push(
        'Remocao exige confirm=true (operacao irreversivel). Re-envie com confirm=true e reason explicando o motivo.',
      );
    }

    if (adGroup.status === 'ENABLED' && !dto.force_if_enabled) {
      blockingErrors.push(
        `Ad group "${adGroup.name}" esta ENABLED gastando agora. Pause primeiro (traffic_pause_ad_group) ou re-envie com force_if_enabled=true.`,
      );
    }

    // Check: eh o unico ad_group ativo da campanha?
    const otherActiveAdGroups = await this.prisma.trafficAdGroup.count({
      where: {
        tenant_id: tenantId,
        campaign_id: adGroup.campaign_id,
        status: { not: 'REMOVED' },
        id: { not: adGroup.id },
      },
    });
    const isOnlyActive = otherActiveAdGroups === 0;
    if (isOnlyActive) {
      blockingErrors.push(
        `Este eh o unico ad group ativo da campanha. Remover deixa a campanha sem onde servir. Considere pausar ou remover a campanha inteira (traffic_remove_campaign).`,
      );
    }

    // Cascade
    const [adsCount, kwTotal, kwNegativeCount] = await Promise.all([
      this.prisma.trafficAd.count({
        where: {
          tenant_id: tenantId,
          ad_group_id: adGroup.id,
          status: { not: 'REMOVED' },
        },
      }),
      this.prisma.trafficKeyword.count({
        where: {
          tenant_id: tenantId,
          ad_group_id: adGroup.id,
          status: { not: 'REMOVED' },
        },
      }),
      this.prisma.trafficKeyword.count({
        where: {
          tenant_id: tenantId,
          ad_group_id: adGroup.id,
          status: { not: 'REMOVED' },
          negative: true,
        },
      }),
    ]);

    return {
      blockingErrors,
      warnings,
      preview: {
        ad_group_name: adGroup.name,
        ad_group_id_local: adGroup.id,
        campaign_id_local: adGroup.campaign_id,
        current_status: adGroup.status,
        cascade: {
          ads: adsCount,
          keywords: kwTotal - kwNegativeCount,
          negative_keywords: kwNegativeCount,
        },
        is_only_active: isOnlyActive,
      },
    };
  }

  /**
   * Lookup publico de ad_group (UUID ou google_ad_group_id). Espelha
   * getCampaignByEither — retorna null em vez de throw pra controller
   * customizar mensagem.
   */
  async getAdGroupByEither(tenantId: string, idOrGoogleId: string) {
    return this.prisma.trafficAdGroup.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [{ id: idOrGoogleId }, { google_ad_group_id: idOrGoogleId }],
      },
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

  /**
   * Upsert direto dos campos de Lead Form Asset (Sprint D). Endpoint
   * separado de updateSettings pra manter granularidade de permissão e
   * não inflar o DTO geral.
   */
  async upsertLeadFormSettings(
    tenantId: string,
    data: Record<string, unknown>,
  ) {
    const settings = await this.prisma.trafficSettings.upsert({
      where: { tenant_id: tenantId },
      update: data as any,
      create: { tenant_id: tenantId, ...(data as any) },
    });
    return this.serializeSettings(settings);
  }

  private serializeSettings(s: any) {
    return {
      ...s,
      target_cpl_micros: s.target_cpl_micros?.toString() ?? null,
      target_cpl_brl: fromMicros(s.target_cpl_micros),
      target_daily_budget_micros:
        s.target_daily_budget_micros?.toString() ?? null,
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

  /**
   * BUG-F treatment (2026-05-18) — diagnose Enhanced Conversions for Leads.
   *
   * Combina 3 checks:
   *   1. Estado atual via GAQL (customer.conversion_tracking_setting)
   *   2. TrafficSettings local (user_data_fields, business_phone_e164, etc)
   *   3. Mutate logs recentes de enable_enhanced_conv pra ver se ja tentou
   *
   * Retorna estrutura com status PT-BR e proximos passos sugeridos.
   * NAO faz mutate — somente leitura + analise.
   */
  async diagnoseEnhancedConversions(tenantId: string): Promise<{
    enabled_in_google: boolean;
    test_account: boolean;
    account_name: string | null;
    crm_settings: {
      enhanced_conv_for_leads_upload_enabled: boolean;
      business_phone_e164: string | null;
      business_name: string | null;
    } | null;
    recent_attempts: Array<{
      id: string;
      created_at: string;
      status: string;
      error_message: string | null;
      validate_only: boolean;
    }>;
    overall_status: 'OK' | 'NOT_ENABLED' | 'PERMISSION_ISSUE' | 'CONFIG_INCOMPLETE' | 'UNKNOWN';
    next_steps: string[];
  }> {
    const account = await this.getAccount(tenantId);
    if (!account) {
      return {
        enabled_in_google: false,
        test_account: false,
        account_name: null,
        crm_settings: null,
        recent_attempts: [],
        overall_status: 'CONFIG_INCOMPLETE',
        next_steps: [
          'Conta Google Ads nao conectada ao CRM. Conecte via /trafego/oauth/start primeiro.',
        ],
      };
    }

    // 1. Settings locais do CRM
    const settings = await this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantId },
      select: {
        enhanced_conv_for_leads_upload_enabled: true,
        business_phone_e164: true,
        business_name: true,
      },
    });

    // 2. Recent mutate attempts (resource_type='customer' + operation='update')
    const attempts = await this.prisma.trafficMutateLog.findMany({
      where: {
        tenant_id: tenantId,
        resource_type: 'customer',
        operation: 'update',
      },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: {
        id: true,
        created_at: true,
        status: true,
        error_message: true,
        validate_only: true,
      },
    });

    // 3. Estado atual via GAQL — enfileira read job (resolve via worker que
    // tem o customer SDK)
    // Nota: precisamos do read processor pra fazer essa query. Pra simplificar,
    // retornamos sem o estado do Google se nao conseguir e o caller decide
    // se vai chamar diagnose com kind=customer_settings via outra rota.
    // Pra rota dedicada do diagnose, fazemos a chamada via enqueueReadJob
    // (que tem o customer setup).
    // POR ENQUANTO: monta resposta sem estado Google, deixa caller
    // hidratar via tool MCP que chama getEnhancedConvSettings separadamente.
    const enabledInGoogle = false; // sera populado pelo controller
    const testAccount = false; // sera populado pelo controller

    const lastAttempt = attempts[0];
    const hasPermissionError =
      lastAttempt?.error_message &&
      /PERMISSION_DENIED|developer_token|not approved|access_denied/i.test(
        lastAttempt.error_message,
      );

    // Determine overall status + next steps
    const nextSteps: string[] = [];
    let overallStatus:
      | 'OK'
      | 'NOT_ENABLED'
      | 'PERMISSION_ISSUE'
      | 'CONFIG_INCOMPLETE'
      | 'UNKNOWN' = 'UNKNOWN';

    if (!settings?.business_phone_e164 || !settings?.business_name) {
      overallStatus = 'CONFIG_INCOMPLETE';
      nextSteps.push(
        'Preencha business_phone_e164 + business_name em TrafficSettings (use traffic_update_settings ou UI). Sem isso, attach_call_asset e enhanced_conv ficam sem defaults.',
      );
    }

    if (hasPermissionError) {
      overallStatus = 'PERMISSION_ISSUE';
      nextSteps.push(
        '1. Verifique tier do developer_token em https://ads.google.com/aw/apicenter — Enhanced Conversions for Leads exige STANDARD ACCESS (nao Test/Basic).',
        '2. Verifique permissao do MCC (login_customer_id) no client account: precisa ser ADMIN. Acesse https://ads.google.com/aw/accountaccess via MCC e confira se o account 4464129633 (ou seu customer_id) aparece com permissao Admin.',
        '3. Se ambos OK, refaca OAuth via /trafego/oauth/reconnect-link pra garantir scope adwords completo.',
        '4. SOLUCAO TEMPORARIA: ative manualmente via Google Ads UI: Tools & Settings > Conversions > Customer data > Enable Enhanced Conversions for Leads. UI funciona com permissoes diferentes da API.',
      );
    }

    if (overallStatus === 'UNKNOWN') {
      overallStatus = 'NOT_ENABLED';
      nextSteps.push(
        'Tente ativar via traffic_enable_enhanced_conversions_for_leads({mode:"BOTH", user_data_fields:["email","phone"], confirm:true, validate_only:true}) primeiro.',
        'Se validate_only retornar OK, repita sem validate_only pra ativar de verdade.',
      );
    }

    return {
      enabled_in_google: enabledInGoogle,
      test_account: testAccount,
      account_name: account.account_name ?? null,
      crm_settings: settings
        ? {
            enhanced_conv_for_leads_upload_enabled:
              settings.enhanced_conv_for_leads_upload_enabled ?? false,
            business_phone_e164: settings.business_phone_e164 ?? null,
            business_name: settings.business_name ?? null,
          }
        : null,
      recent_attempts: attempts.map((a) => ({
        id: a.id,
        created_at: a.created_at.toISOString(),
        status: a.status,
        error_message: a.error_message,
        validate_only: a.validate_only,
      })),
      overall_status: overallStatus,
      next_steps: nextSteps,
    };
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
      period?: 'today' | '7d' | '30d' | 'month' | 'prev_month';
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

    // ─── Período selecionável (atalho que sobrepoe date_from/to) ─────────
    // 'today'/'7d'/'30d'/'month'/'prev_month' definem rangeFrom..rangeTo;
    // os KPIs agregados (spend, cpl, ctr, avg_cpc) sao calculados sobre
    // ESSE range em vez do default fixo de 7d.
    const period = _opts.period ?? '7d';
    let rangeFrom = sevenDaysAgo;
    let rangeTo = today;
    if (period === 'today') {
      rangeFrom = today;
    } else if (period === '30d') {
      rangeFrom = thirtyDaysAgo;
    } else if (period === 'month') {
      rangeFrom = monthStart;
    } else if (period === 'prev_month') {
      const prevMonthEnd = new Date(monthStart);
      prevMonthEnd.setUTCDate(prevMonthEnd.getUTCDate() - 1);
      const prevMonthStart = new Date(prevMonthEnd);
      prevMonthStart.setUTCDate(1);
      rangeFrom = prevMonthStart;
      rangeTo = prevMonthEnd;
    }

    // BUG-M/N fix (2026-05-30): honrar date_from/date_to explícitos (MCP/compare).
    // Sem `period`, o default caía em '7d' → KPIs idênticos pra qualquer janela
    // (traffic_compare_periods retornava period_a == period_b). Agora a janela
    // explícita sobrepõe o range usado nas agregações de KPI.
    if (!_opts.period && (_opts.dateFrom || _opts.dateTo)) {
      if (_opts.dateFrom) {
        const f = new Date(`${_opts.dateFrom}T00:00:00.000Z`);
        if (!Number.isNaN(f.getTime())) rangeFrom = f;
      }
      if (_opts.dateTo) {
        const t = new Date(`${_opts.dateTo}T00:00:00.000Z`);
        if (!Number.isNaN(t.getTime())) rangeTo = t;
      }
    }

    // ─── Período comparativo (mesma duração imediatamente antes) ─────────
    // Pra deltas vs período anterior. Ex: "7d" atual → 7d anteriores ao
    // rangeFrom. "Mês atual" → mês anterior completo.
    const rangeMs = rangeTo.getTime() - rangeFrom.getTime();
    const compareTo = new Date(rangeFrom);
    compareTo.setUTCMilliseconds(compareTo.getUTCMilliseconds() - 1);
    const compareFrom = new Date(rangeFrom);
    compareFrom.setUTCMilliseconds(
      compareFrom.getUTCMilliseconds() - rangeMs - 1,
    );

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
      rangeAgg,
      compareAgg,
      cpcCplTimeseries,
      campaignsCount,
      timeseries,
      topCampaigns,
    ] = await Promise.all([
      // Hoje
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: today },
        _sum: {
          cost_micros: true,
          conversions: true,
          clicks: true,
          impressions: true,
        },
      }),
      // Mes corrente — usado pra pacing mensal independente do period
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: { gte: monthStart } },
        _sum: { cost_micros: true, conversions: true },
      }),
      // 7 dias — sempre calculado pra mostrar "média 7d" ao lado do "leads hoje"
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: { gte: sevenDaysAgo } },
        _sum: {
          cost_micros: true,
          clicks: true,
          impressions: true,
          conversions: true,
        },
      }),
      // 30 dias (ROAS) — janela fixa porque ROAS precisa de massa critica
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: { gte: thirtyDaysAgo } },
        _sum: { cost_micros: true, conversions_value: true },
      }),
      // Período selecionado — KPIs principais (spend, cpl, ctr, cpc)
      this.prisma.trafficMetricDaily.aggregate({
        where: {
          tenant_id: tenantId,
          date: { gte: rangeFrom, lte: rangeTo },
        },
        _sum: {
          cost_micros: true,
          clicks: true,
          impressions: true,
          conversions: true,
        },
      }),
      // Período comparativo (mesma duração imediatamente antes) — usado
      // pra calcular deltas (▲/▼ %) em cada KPI no front
      this.prisma.trafficMetricDaily.aggregate({
        where: {
          tenant_id: tenantId,
          date: { gte: compareFrom, lt: rangeFrom },
        },
        _sum: {
          cost_micros: true,
          clicks: true,
          impressions: true,
          conversions: true,
        },
      }),
      // Timeseries diária do período RANGE (não 30d fixo) — pra gráfico
      // CPC×CPL ao longo do tempo. Usa o mesmo range dos KPIs.
      this.prisma.trafficMetricDaily.groupBy({
        by: ['date'],
        where: {
          tenant_id: tenantId,
          date: { gte: rangeFrom, lte: rangeTo },
        },
        _sum: {
          cost_micros: true,
          conversions: true,
          clicks: true,
        },
        orderBy: { date: 'asc' },
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
        _sum: {
          cost_micros: true,
          conversions: true,
          clicks: true,
          impressions: true,
        },
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
    const sumCostRange = microsToBRL(rangeAgg._sum.cost_micros);

    const conversions7d = Number(last7dAgg._sum.conversions ?? 0);
    const conversions30dValue = Number(last30dAgg._sum.conversions_value ?? 0);
    const conversionsRange = Number(rangeAgg._sum.conversions ?? 0);
    const clicksRange = Number(rangeAgg._sum.clicks ?? 0);
    const impressionsRange = Number(rangeAgg._sum.impressions ?? 0);

    // KPIs do período selecionado
    const cplRange = conversionsRange > 0 ? sumCostRange / conversionsRange : 0;
    const ctrRange = impressionsRange > 0 ? clicksRange / impressionsRange : 0;
    const avgCpcRange = clicksRange > 0 ? sumCostRange / clicksRange : 0;
    const roas30d = sumCost30d > 0 ? conversions30dValue / sumCost30d : 0;
    // Tx conversão = conversions/clicks (não conversions/impressions)
    const conversionRateRange =
      clicksRange > 0 ? conversionsRange / clicksRange : 0;

    // ─── Período comparativo ─────────────────────────────────────────────
    const sumCostCompare = microsToBRL(compareAgg._sum.cost_micros);
    const conversionsCompare = Number(compareAgg._sum.conversions ?? 0);
    const clicksCompare = Number(compareAgg._sum.clicks ?? 0);
    const impressionsCompare = Number(compareAgg._sum.impressions ?? 0);

    const cplCompare =
      conversionsCompare > 0 ? sumCostCompare / conversionsCompare : 0;
    const ctrCompare =
      impressionsCompare > 0 ? clicksCompare / impressionsCompare : 0;
    const avgCpcCompare =
      clicksCompare > 0 ? sumCostCompare / clicksCompare : 0;
    const conversionRateCompare =
      clicksCompare > 0 ? conversionsCompare / clicksCompare : 0;

    // Média de leads/dia nos últimos 7d (excluindo hoje pra comparativo limpo).
    // Divisor 7 (não 6) — manter consistente com a janela.
    const leadsAvg7d = conversions7d / 7;

    // ─── Pacing mensal ──────────────────────────────────────────────────
    // Compara gasto-mes vs orcamento esperado (target_daily_budget × dias).
    // Se admin nao configurou meta, retorna null.
    const settings = await this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantId },
      select: { target_daily_budget_micros: true },
    });
    const dayOfMonth = today.getUTCDate();
    let pacing: {
      target_monthly_brl: number;
      target_to_date_brl: number;
      spent_brl: number;
      pct_used: number;
      pct_expected: number;
      status: 'AHEAD' | 'ON_TRACK' | 'BEHIND';
    } | null = null;
    if (settings?.target_daily_budget_micros) {
      const targetDailyBrl =
        Number(settings.target_daily_budget_micros) / 1_000_000;
      // Dias no mês corrente: usa Date(year, month+1, 0).getDate()
      const daysInMonth = new Date(
        today.getUTCFullYear(),
        today.getUTCMonth() + 1,
        0,
      ).getDate();
      const targetMonthly = targetDailyBrl * daysInMonth;
      const targetToDate = targetDailyBrl * dayOfMonth;
      const pctUsed = targetMonthly > 0 ? sumCostMonth / targetMonthly : 0;
      const pctExpected = dayOfMonth / daysInMonth;
      const ratio = pctExpected > 0 ? pctUsed / pctExpected : 0;
      pacing = {
        target_monthly_brl: targetMonthly,
        target_to_date_brl: targetToDate,
        spent_brl: sumCostMonth,
        pct_used: pctUsed,
        pct_expected: pctExpected,
        status: ratio > 1.1 ? 'AHEAD' : ratio < 0.85 ? 'BEHIND' : 'ON_TRACK',
      };
    }

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
      period,
      kpis: {
        spend_today_brl: sumCostToday,
        spend_month_brl: sumCostMonth,
        spend_range_brl: sumCostRange,
        leads_today: Number(todayAgg._sum.conversions ?? 0),
        leads_avg_7d: leadsAvg7d,
        leads_range: conversionsRange,
        clicks_range: clicksRange,
        impressions_range: impressionsRange,
        conversion_rate: conversionRateRange,
        cpl_brl: cplRange,
        ctr: ctrRange,
        avg_cpc_brl: avgCpcRange,
        roas_estimated: roas30d,
        active_campaigns: activeCount,
        paused_campaigns: pausedCount,
      },
      // Métricas do período COMPARATIVO (mesma duração antes do range).
      // Front calcula delta % em cada KPI quando toggle "comparar" ON.
      compare: {
        spend_brl: sumCostCompare,
        leads: conversionsCompare,
        clicks: clicksCompare,
        impressions: impressionsCompare,
        cpl_brl: cplCompare,
        ctr: ctrCompare,
        avg_cpc_brl: avgCpcCompare,
        conversion_rate: conversionRateCompare,
        range_from: compareFrom.toISOString().slice(0, 10),
        range_to: compareTo.toISOString().slice(0, 10),
      },
      pacing,
      timeseries: timeseries.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        spend_brl: microsToBRL(d._sum.cost_micros),
        leads: Number(d._sum.conversions ?? 0),
      })),
      // Timeseries CPC×CPL no range selecionado (gráfico 2x2 — tendência)
      cpc_cpl_timeseries: cpcCplTimeseries.map((d) => {
        const spend = microsToBRL(d._sum.cost_micros);
        const conv = Number(d._sum.conversions ?? 0);
        const clk = Number(d._sum.clicks ?? 0);
        return {
          date: d.date.toISOString().slice(0, 10),
          cpc_brl: clk > 0 ? spend / clk : 0,
          cpl_brl: conv > 0 ? spend / conv : 0,
          spend_brl: spend,
          clicks: clk,
        };
      }),
      top_campaigns: topCampaignsEnriched,
      at_risk_campaigns: [],
      ranges: {
        today: todayStr,
        month_start: monthStart.toISOString().slice(0, 10),
        seven_days_ago: sevenDaysAgo.toISOString().slice(0, 10),
        thirty_days_ago: thirtyDaysAgo.toISOString().slice(0, 10),
        range_from: rangeFrom.toISOString().slice(0, 10),
        range_to: rangeTo.toISOString().slice(0, 10),
        compare_from: compareFrom.toISOString().slice(0, 10),
        compare_to: compareTo.toISOString().slice(0, 10),
      },
    };
  }

  // ─── Relatorios PDF (Fase 4B) ───────────────────────────────────────────

  /**
   * Gera PDF de snapshot do trafego pra um periodo. Coleta dados do banco
   * e chama o template `trafego-snapshot.ts`. Tambem registra no historico
   * (Report table) pra usuario re-baixar/listar.
   */
  async generateReport(
    tenantId: string,
    actorId: string,
    actorName: string,
    fromIso: string,
    toIso: string,
    label?: string,
  ): Promise<Buffer> {
    const account = await this.getAccount(tenantId);
    if (!account) {
      throw new NotFoundException('Conta de trafego nao conectada');
    }

    const dateFrom = new Date(fromIso);
    dateFrom.setUTCHours(0, 0, 0, 0);
    const dateTo = new Date(toIso);
    dateTo.setUTCHours(0, 0, 0, 0);

    if (dateFrom > dateTo) {
      throw new NotFoundException('Periodo invalido (from > to)');
    }

    // ─── Coleta de dados ──────────────────────────────────────────────
    const [totalAgg, campaignAggs, dailyAggs, campaignsCount] =
      await Promise.all([
        this.prisma.trafficMetricDaily.aggregate({
          where: {
            tenant_id: tenantId,
            date: { gte: dateFrom, lte: dateTo },
          },
          _sum: {
            cost_micros: true,
            impressions: true,
            clicks: true,
            conversions: true,
            conversions_value: true,
          },
        }),
        this.prisma.trafficMetricDaily.groupBy({
          by: ['campaign_id'],
          where: {
            tenant_id: tenantId,
            date: { gte: dateFrom, lte: dateTo },
          },
          _sum: {
            cost_micros: true,
            impressions: true,
            clicks: true,
            conversions: true,
          },
        }),
        this.prisma.trafficMetricDaily.groupBy({
          by: ['date'],
          where: {
            tenant_id: tenantId,
            date: { gte: dateFrom, lte: dateTo },
          },
          _sum: {
            cost_micros: true,
            impressions: true,
            clicks: true,
            conversions: true,
          },
          orderBy: { date: 'asc' },
        }),
        this.prisma.trafficCampaign.groupBy({
          by: ['status'],
          where: { tenant_id: tenantId, is_archived_internal: false },
          _count: { _all: true },
        }),
      ]);

    // Enriquecer agregados de campanha com nome/status/canal
    const campaignIds = campaignAggs.map((a) => a.campaign_id);
    const campaignDetails = await this.prisma.trafficCampaign.findMany({
      where: { id: { in: campaignIds } },
      select: { id: true, name: true, status: true, channel_type: true },
    });
    const detailMap = new Map(campaignDetails.map((c) => [c.id, c]));

    // ─── Calcula KPIs ─────────────────────────────────────────────────
    const microsToBRL = (m: bigint | null | undefined): number =>
      m ? Number(m) / 1_000_000 : 0;

    const totalSpend = microsToBRL(totalAgg._sum.cost_micros);
    const totalImpressions = Number(totalAgg._sum.impressions ?? 0);
    const totalClicks = Number(totalAgg._sum.clicks ?? 0);
    const totalConversions = Number(totalAgg._sum.conversions ?? 0);
    const totalConvValue = Number(totalAgg._sum.conversions_value ?? 0);

    const cpl = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const roas = totalSpend > 0 ? totalConvValue / totalSpend : 0;

    const activeCount =
      campaignsCount.find((c) => c.status === 'ENABLED')?._count._all ?? 0;
    const pausedCount =
      campaignsCount.find((c) => c.status === 'PAUSED')?._count._all ?? 0;

    const periodLabel =
      label ||
      `${dateFrom.toISOString().slice(0, 10)} a ${dateTo.toISOString().slice(0, 10)}`;

    // ─── Monta dados pro template ─────────────────────────────────────
    const reportData: TrafegoSnapshotData = {
      period: {
        from: dateFrom.toISOString().slice(0, 10),
        to: dateTo.toISOString().slice(0, 10),
        label: periodLabel,
      },
      account: {
        customer_id: account.customer_id,
        account_name: account.account_name,
        last_sync_at: account.last_sync_at?.toISOString() ?? null,
      },
      generatedBy: actorName,
      kpis: {
        spend_brl: totalSpend,
        leads: Math.round(totalConversions),
        cpl_brl: cpl,
        ctr,
        avg_cpc_brl: avgCpc,
        roas,
        impressions: totalImpressions,
        clicks: totalClicks,
        active_campaigns: activeCount,
        paused_campaigns: pausedCount,
      },
      byCampaign: campaignAggs
        .map((a) => {
          const meta = detailMap.get(a.campaign_id);
          const cost = microsToBRL(a._sum.cost_micros);
          const conv = Number(a._sum.conversions ?? 0);
          return {
            name: meta?.name ?? '(removida)',
            status: meta?.status ?? 'UNSPECIFIED',
            channel_type: meta?.channel_type ?? null,
            impressions: Number(a._sum.impressions ?? 0),
            clicks: Number(a._sum.clicks ?? 0),
            cost_brl: cost,
            conversions: conv,
            cpl_brl: conv > 0 ? cost / conv : 0,
          };
        })
        .sort((a, b) => b.cost_brl - a.cost_brl), // mais gasto primeiro
      byDay: dailyAggs.map((d) => {
        const impressions = Number(d._sum.impressions ?? 0);
        const clicks = Number(d._sum.clicks ?? 0);
        return {
          date: d.date.toISOString().slice(0, 10),
          impressions,
          clicks,
          cost_brl: microsToBRL(d._sum.cost_micros),
          conversions: Number(d._sum.conversions ?? 0),
          ctr: impressions > 0 ? clicks / impressions : 0,
        };
      }),
    };

    // ─── Gera PDF + registra historico (fire-and-forget) ─────────────
    const buffer = await buildTrafegoSnapshotPdf(reportData);

    this.prisma.report
      .create({
        data: {
          tenant_id: tenantId,
          user_id: actorId,
          kind: 'trafego-snapshot',
          display_name: `Trafego — ${periodLabel}`,
          params: {
            from: reportData.period.from,
            to: reportData.period.to,
            label: periodLabel,
          },
        },
      })
      .catch((e) => {
        this.logger.warn(
          `[REPORTS] Falha registrando historico (silencioso): ${e.message}`,
        );
      });

    return buffer;
  }

  /** Lista historico de relatorios de trafego do tenant. */
  async listReports(tenantId: string, limit = 50) {
    return this.prisma.report.findMany({
      where: { tenant_id: tenantId, kind: 'trafego-snapshot' },
      orderBy: { generated_at: 'desc' },
      take: limit,
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
