import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

    const [campaigns, perCampaignAgg, perCampaignShareAvg, adStrengthAgg] =
      await Promise.all([
        this.prisma.trafficCampaign.findMany({
          where: {
            tenant_id: tenantId,
            ...(opts.includeArchived ? {} : { is_archived_internal: false }),
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
      ]);

    const aggMap = new Map(
      perCampaignAgg.map((a) => [a.campaign_id, a._sum]),
    );
    const shareMap = new Map(
      perCampaignShareAvg.map((a) => [a.campaign_id, a._avg]),
    );

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
      return {
        ...c,
        daily_budget_micros: c.daily_budget_micros?.toString() ?? null,
        daily_budget_brl: fromMicros(c.daily_budget_micros),
        // Best ad_strength entre os ads ENABLED dessa campanha
        ad_strength: bestStrengthByCampaign.get(c.id) ?? null,
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
        const cost = a._sum.cost_micros ? Number(a._sum.cost_micros) / 1_000_000 : 0;
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
          spend_share: totalCost > 0 ? Number(a._sum.cost_micros) / totalCost : 0,
          conv_share: totalConv > 0 ? conv / totalConv : 0,
        };
      }),
    };
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

  async listKeywords(
    tenantId: string,
    adGroupId: string,
    opts: { negative?: boolean } = {},
  ) {
    const items = await this.prisma.trafficKeyword.findMany({
      where: {
        tenant_id: tenantId,
        ad_group_id: adGroupId,
        ...(typeof opts.negative === 'boolean' ? { negative: opts.negative } : {}),
      },
      orderBy: { last_seen_at: 'desc' },
    });
    return items.map((i) => ({
      ...i,
      cpc_bid_micros: i.cpc_bid_micros?.toString() ?? null,
      cpc_bid_brl: fromMicros(i.cpc_bid_micros),
    }));
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
      cpl_brl: i.conversions > 0 ? Number(i.cost_micros) / 1_000_000 / i.conversions : 0,
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
    return items.map((i) => ({
      ...i,
      confidence: i.confidence ? Number(i.confidence) : null,
    }));
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
      case 'trafego-mutate-resume-campaign': {
        const camp = await this.requireCampaign(tenantId, raw.campaignId);
        return {
          ...base,
          campaignResourceName: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
          context: { ...base.context, campaign_id_local: camp.id },
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
      case 'trafego-mutate-resume-ad-group': {
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
          geoTargetIds: raw.geo_target_ids ?? ['1001775'], // Brasil
          languageIds: raw.language_ids ?? ['1014'], // Portuguese
          finalUrl: raw.final_url ?? null,
          initialStatus: raw.initial_status ?? 'PAUSED',
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
      default:
        throw new HttpException(
          `Job de mutate nao suportado: ${jobName}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  private async requireCampaign(tenantId: string, campaignId: string) {
    const camp = await this.prisma.trafficCampaign.findFirst({
      where: { id: campaignId, tenant_id: tenantId },
    });
    if (!camp) throw new NotFoundException('Campanha nao encontrada');
    return camp;
  }

  private async requireAdGroup(tenantId: string, adGroupId: string) {
    const ag = await this.prisma.trafficAdGroup.findFirst({
      where: { id: adGroupId, tenant_id: tenantId },
    });
    if (!ag) throw new NotFoundException('Ad group nao encontrado');
    return ag;
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
        _sum: { cost_micros: true, conversions: true, clicks: true, impressions: true },
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
    const [
      totalAgg,
      campaignAggs,
      dailyAggs,
      campaignsCount,
    ] = await Promise.all([
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
