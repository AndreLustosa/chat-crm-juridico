import { Injectable, Logger } from '@nestjs/common';
import type { Customer } from 'google-ads-api';
import { enums } from 'google-ads-api';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Helpers locais (espelham os do trafego-sync.service.ts — pra evitar
 * dependencia circular ou export complicado).
 */
function enumToStr<E extends Record<number | string, any>>(
  enumObj: E,
  value: number | undefined | null,
  fallback: string | null = null,
): string | null {
  if (value === undefined || value === null) return fallback;
  return (enumObj[value] as string) ?? fallback;
}

function toBigIntSafe(
  value: number | string | bigint | null | undefined,
): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return null;
  return BigInt(Math.round(num));
}

function toNumberSafe(
  value: number | string | null | undefined,
  fallback: number | null = null,
): number | null {
  if (value === null || value === undefined || value === '') return fallback;
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Sync das tabelas hierarquicas: ad_groups, keywords, ads, budgets.
 * Chamada apos o sync de campanhas (TrafegoSyncService.syncAccount).
 *
 * Resiliente: cada subquery falha de forma independente. Se ad_groups falhar,
 * keywords e ads ainda tentam (sem hierarquia, mas com info crua).
 *
 * Idempotente: upsert por chave natural unica.
 *
 * NAO faz delete de coisas que sumiram da API — apenas marca last_seen_at
 * desatualizado. Decidir purge fica a cargo do operador (ou cron de limpeza
 * separado, futuro).
 */
@Injectable()
export class TrafegoSyncExtendedService {
  private readonly logger = new Logger(TrafegoSyncExtendedService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Sync expandido. Recebe o Customer ja autenticado + IDs locais
   * (account.id, tenant_id) + mapa de campaign google_id -> our id.
   *
   * Retorna estatistica resumida (pra registrar no SyncLog).
   */
  async syncExtended(
    customer: Customer,
    tenantId: string,
    accountId: string,
    campaignByGoogleId: Map<string, string>,
  ): Promise<{
    budgets: number;
    adGroups: number;
    keywords: number;
    ads: number;
    conversionActions: number;
    assetGroups: number;
    assetGroupAssets: number;
    searchTerms: number;
    errors: string[];
  }> {
    const stats = {
      budgets: 0,
      adGroups: 0,
      keywords: 0,
      ads: 0,
      conversionActions: 0,
      assetGroups: 0,
      assetGroupAssets: 0,
      searchTerms: 0,
      errors: [] as string[],
    };

    // ─── 1. Campaign Budgets ─────────────────────────────────────────────
    try {
      stats.budgets = await this.syncBudgets(customer, tenantId, accountId);
    } catch (e: any) {
      const msg = `budgets: ${e?.message ?? e}`;
      this.logger.warn(`[sync-extended] ${msg}`);
      stats.errors.push(msg);
    }

    // ─── 2. Ad Groups ───────────────────────────────────────────────────
    const adGroupByGoogleId = new Map<string, string>(); // google_id -> our id
    try {
      const result = await this.syncAdGroups(
        customer,
        tenantId,
        accountId,
        campaignByGoogleId,
      );
      stats.adGroups = result.count;
      for (const [k, v] of result.mapping) adGroupByGoogleId.set(k, v);
    } catch (e: any) {
      const msg = `ad_groups: ${e?.message ?? e}`;
      this.logger.warn(`[sync-extended] ${msg}`);
      stats.errors.push(msg);
    }

    // ─── 3. Keywords (ad_group_criterion type=KEYWORD) ────────────────────
    try {
      stats.keywords = await this.syncKeywords(
        customer,
        tenantId,
        accountId,
        adGroupByGoogleId,
      );
    } catch (e: any) {
      const msg = `keywords: ${e?.message ?? e}`;
      this.logger.warn(`[sync-extended] ${msg}`);
      stats.errors.push(msg);
    }

    // ─── 4. Ads (ad_group_ad) ────────────────────────────────────────────
    try {
      stats.ads = await this.syncAds(
        customer,
        tenantId,
        accountId,
        adGroupByGoogleId,
      );
    } catch (e: any) {
      const msg = `ads: ${e?.message ?? e}`;
      this.logger.warn(`[sync-extended] ${msg}`);
      stats.errors.push(msg);
    }

    // ─── 5. Conversion Actions ──────────────────────────────────────────
    try {
      stats.conversionActions = await this.syncConversionActions(
        customer,
        tenantId,
        accountId,
      );
    } catch (e: any) {
      const msg = `conversion_actions: ${e?.message ?? e}`;
      this.logger.warn(`[sync-extended] ${msg}`);
      stats.errors.push(msg);
    }

    // ─── 6. Asset Groups (PMax + Demand Gen) ────────────────────────────
    const assetGroupByGoogleId = new Map<string, string>();
    try {
      const result = await this.syncAssetGroups(
        customer,
        tenantId,
        accountId,
        campaignByGoogleId,
      );
      stats.assetGroups = result.count;
      for (const [k, v] of result.mapping) assetGroupByGoogleId.set(k, v);
    } catch (e: any) {
      const msg = `asset_groups: ${e?.message ?? e}`;
      this.logger.warn(`[sync-extended] ${msg}`);
      stats.errors.push(msg);
    }

    // ─── 7. Asset Group Assets (link N:N com performance_label) ─────────
    if (assetGroupByGoogleId.size > 0) {
      try {
        stats.assetGroupAssets = await this.syncAssetGroupAssets(
          customer,
          tenantId,
          accountId,
          assetGroupByGoogleId,
        );
      } catch (e: any) {
        const msg = `asset_group_assets: ${e?.message ?? e}`;
        this.logger.warn(`[sync-extended] ${msg}`);
        stats.errors.push(msg);
      }
    }

    // ─── 8. Search Terms (Fase 4a) ─────────────────────────────────────
    // search_term_view: termos REAIS digitados no Google que dispararam
    // clicks. Janela 30d. Permite ao admin negativar termos off-topic.
    try {
      stats.searchTerms = await this.syncSearchTerms(
        customer,
        tenantId,
        accountId,
        campaignByGoogleId,
        adGroupByGoogleId,
      );
    } catch (e: any) {
      const msg = `search_terms: ${e?.message ?? e}`;
      this.logger.warn(`[sync-extended] ${msg}`);
      stats.errors.push(msg);
    }

    return stats;
  }

  /**
   * Sincroniza search_term_view dos ultimos 30 dias. Idempotente via
   * @@unique([campaign_id, ad_group_id, search_term]). Re-sync atualiza
   * metricas; termos que nao apareceram no novo sync ficam com
   * last_seen_at desatualizado (sem auto-purge — admin decide).
   */
  private async syncSearchTerms(
    customer: Customer,
    tenantId: string,
    accountId: string,
    campaignByGoogleId: Map<string, string>,
    adGroupByGoogleId: Map<string, string>,
  ): Promise<number> {
    const rows: any[] = await customer.query(`
      SELECT
        search_term_view.search_term,
        search_term_view.status,
        segments.search_term_match_type,
        ad_group.id,
        campaign.id,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM search_term_view
      WHERE segments.date DURING LAST_30_DAYS
      LIMIT 5000
    `);

    // Agrega por (campaign, ad_group, term) — search_term_view retorna 1
    // linha por dia, e queremos snapshot agregado.
    type Bucket = {
      tenantId: string;
      accountId: string;
      campaignId: string | null;
      adGroupId: string | null;
      term: string;
      matchType: string | null;
      status: string | null;
      impressions: number;
      clicks: number;
      cost_micros: bigint;
      conversions: number;
      conversions_value: number;
    };
    const buckets = new Map<string, Bucket>();
    for (const row of rows) {
      const term = row.search_term_view?.search_term;
      if (!term || typeof term !== 'string') continue;
      const googleCampaignId = String(row.campaign?.id ?? '');
      const googleAdGroupId = String(row.ad_group?.id ?? '');
      const localCampaignId = campaignByGoogleId.get(googleCampaignId) ?? null;
      const localAdGroupId = adGroupByGoogleId.get(googleAdGroupId) ?? null;
      const key = `${localCampaignId ?? '_'}|${localAdGroupId ?? '_'}|${term}`;

      const cost = toBigIntSafe(row.metrics?.cost_micros) ?? 0n;
      const impressions = toNumberSafe(row.metrics?.impressions, 0) ?? 0;
      const clicks = toNumberSafe(row.metrics?.clicks, 0) ?? 0;
      const conversions = toNumberSafe(row.metrics?.conversions, 0) ?? 0;
      const conversionsValue =
        toNumberSafe(row.metrics?.conversions_value, 0) ?? 0;

      const matchType =
        enumToStr(
          enums.SearchTermMatchType,
          row.segments?.search_term_match_type,
          null,
        ) ?? null;
      const status =
        enumToStr(
          enums.SearchTermTargetingStatus,
          row.search_term_view?.status,
          null,
        ) ?? null;

      const existing = buckets.get(key);
      if (existing) {
        existing.impressions += impressions;
        existing.clicks += clicks;
        existing.cost_micros += cost;
        existing.conversions += conversions;
        existing.conversions_value += conversionsValue;
        // Match type pode variar entre dias — guarda o "mais amplo" só se
        // ainda nao tem; senao mantem o primeiro visto (estavel).
        if (!existing.matchType && matchType) existing.matchType = matchType;
        if (!existing.status && status) existing.status = status;
      } else {
        buckets.set(key, {
          tenantId,
          accountId,
          campaignId: localCampaignId,
          adGroupId: localAdGroupId,
          term,
          matchType,
          status,
          impressions,
          clicks,
          cost_micros: cost,
          conversions,
          conversions_value: conversionsValue,
        });
      }
    }

    // Upsert um a um — postgres unique constraint cobre dedupe.
    let count = 0;
    for (const b of buckets.values()) {
      // unique key requer campaign_id e ad_group_id setados pra dedupe
      // funcionar (NULLs em postgres nao se igualam). Pulamos termos
      // sem mapping local — sao raros e sem context util.
      if (!b.campaignId || !b.adGroupId) continue;
      const data = {
        match_type: b.matchType,
        status: b.status,
        impressions: b.impressions,
        clicks: b.clicks,
        cost_micros: b.cost_micros,
        conversions: b.conversions,
        conversions_value: b.conversions_value,
        last_seen_at: new Date(),
      };
      await this.prisma.trafficSearchTerm.upsert({
        where: {
          campaign_id_ad_group_id_search_term: {
            campaign_id: b.campaignId,
            ad_group_id: b.adGroupId,
            search_term: b.term,
          },
        },
        update: data,
        create: {
          tenant_id: b.tenantId,
          account_id: b.accountId,
          campaign_id: b.campaignId,
          ad_group_id: b.adGroupId,
          search_term: b.term,
          ...data,
        },
      });
      count++;
    }
    return count;
  }

  private async syncConversionActions(
    customer: Customer,
    tenantId: string,
    accountId: string,
  ): Promise<number> {
    const rows: any[] = await customer.query(`
      SELECT
        conversion_action.id,
        conversion_action.name,
        conversion_action.category,
        conversion_action.status,
        conversion_action.type,
        conversion_action.counting_type,
        conversion_action.click_through_lookback_window_days,
        conversion_action.include_in_conversions_metric,
        conversion_action.value_settings.default_value,
        conversion_action.value_settings.default_currency_code
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
    `);
    let count = 0;
    for (const row of rows) {
      const googleId = String(row.conversion_action?.id);
      if (!googleId) continue;

      const defaultValue = toNumberSafe(
        row.conversion_action?.value_settings?.default_value,
      );
      const defaultValueMicros =
        defaultValue !== null && defaultValue !== undefined
          ? toBigIntSafe(defaultValue * 1_000_000)
          : null;

      const data = {
        name: row.conversion_action?.name ?? '(sem nome)',
        category:
          enumToStr(
            enums.ConversionActionCategory,
            row.conversion_action?.category,
            'DEFAULT',
          ) ?? 'DEFAULT',
        status:
          enumToStr(
            enums.ConversionActionStatus,
            row.conversion_action?.status,
            'ENABLED',
          ) ?? 'ENABLED',
        type: enumToStr(
          enums.ConversionActionType,
          row.conversion_action?.type,
        ),
        counting_type: enumToStr(
          enums.ConversionActionCountingType,
          row.conversion_action?.counting_type,
        ),
        click_through_lookback: toNumberSafe(
          row.conversion_action?.click_through_lookback_window_days,
        ),
        include_in_conversions:
          row.conversion_action?.include_in_conversions_metric !== false,
        default_value_micros: defaultValueMicros,
        last_seen_at: new Date(),
      };

      await this.prisma.trafficConversionAction.upsert({
        where: {
          account_id_google_conversion_id: {
            account_id: accountId,
            google_conversion_id: googleId,
          },
        },
        update: data,
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          google_conversion_id: googleId,
          ...data,
        },
      });
      count++;
    }
    return count;
  }

  // ─── Sub-syncs ──────────────────────────────────────────────────────────

  private async syncBudgets(
    customer: Customer,
    tenantId: string,
    accountId: string,
  ): Promise<number> {
    const rows: any[] = await customer.query(`
      SELECT
        campaign_budget.id,
        campaign_budget.name,
        campaign_budget.amount_micros,
        campaign_budget.delivery_method,
        campaign_budget.explicitly_shared,
        campaign_budget.reference_count,
        campaign_budget.status
      FROM campaign_budget
      WHERE campaign_budget.status != 'REMOVED'
    `);
    let count = 0;
    for (const row of rows) {
      const googleId = String(row.campaign_budget?.id);
      if (!googleId) continue;
      const data = {
        name: row.campaign_budget?.name ?? null,
        amount_micros: toBigIntSafe(row.campaign_budget?.amount_micros) ?? 0n,
        delivery_method: enumToStr(
          enums.BudgetDeliveryMethod,
          row.campaign_budget?.delivery_method,
        ),
        is_shared: !!row.campaign_budget?.explicitly_shared,
        reference_count: toNumberSafe(row.campaign_budget?.reference_count, 0) ?? 0,
        status:
          enumToStr(enums.BudgetStatus, row.campaign_budget?.status, 'ENABLED') ??
          'ENABLED',
        last_seen_at: new Date(),
      };
      await this.prisma.trafficCampaignBudget.upsert({
        where: {
          account_id_google_budget_id: {
            account_id: accountId,
            google_budget_id: googleId,
          },
        },
        update: data,
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          google_budget_id: googleId,
          ...data,
        },
      });
      count++;
    }
    return count;
  }

  private async syncAdGroups(
    customer: Customer,
    tenantId: string,
    accountId: string,
    campaignByGoogleId: Map<string, string>,
  ): Promise<{ count: number; mapping: Map<string, string> }> {
    const rows: any[] = await customer.query(`
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group.cpc_bid_micros,
        ad_group.cpm_bid_micros,
        ad_group.target_cpa_micros,
        ad_group.target_roas,
        ad_group.campaign,
        campaign.id
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
    `);
    const mapping = new Map<string, string>();
    let count = 0;
    for (const row of rows) {
      const googleId = String(row.ad_group?.id);
      const googleCampaignId = String(row.campaign?.id);
      if (!googleId || !googleCampaignId) continue;
      const ourCampaignId = campaignByGoogleId.get(googleCampaignId);
      if (!ourCampaignId) continue; // campanha nao cacheada — ignora

      const targetRoasRaw = toNumberSafe(row.ad_group?.target_roas);
      const data = {
        name: row.ad_group?.name ?? '(sem nome)',
        status:
          enumToStr(enums.AdGroupStatus, row.ad_group?.status, 'UNSPECIFIED') ??
          'UNSPECIFIED',
        type: enumToStr(enums.AdGroupType, row.ad_group?.type),
        cpc_bid_micros: toBigIntSafe(row.ad_group?.cpc_bid_micros),
        cpm_bid_micros: toBigIntSafe(row.ad_group?.cpm_bid_micros),
        target_cpa_micros: toBigIntSafe(row.ad_group?.target_cpa_micros),
        target_roas: targetRoasRaw,
        last_seen_at: new Date(),
      };

      const upserted = await this.prisma.trafficAdGroup.upsert({
        where: {
          campaign_id_google_ad_group_id: {
            campaign_id: ourCampaignId,
            google_ad_group_id: googleId,
          },
        },
        update: data,
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          campaign_id: ourCampaignId,
          google_ad_group_id: googleId,
          ...data,
        },
      });
      mapping.set(googleId, upserted.id);
      count++;
    }
    return { count, mapping };
  }

  private async syncKeywords(
    customer: Customer,
    tenantId: string,
    accountId: string,
    adGroupByGoogleId: Map<string, string>,
  ): Promise<number> {
    const rows: any[] = await customer.query(`
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.negative,
        ad_group_criterion.status,
        ad_group_criterion.cpc_bid_micros,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group.id
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED'
    `);
    let count = 0;
    for (const row of rows) {
      const googleAdGroupId = String(row.ad_group?.id);
      const ourAdGroupId = adGroupByGoogleId.get(googleAdGroupId);
      if (!ourAdGroupId) continue;
      const criterionId = String(row.ad_group_criterion?.criterion_id);
      const text = row.ad_group_criterion?.keyword?.text;
      if (!criterionId || !text) continue;

      const qualityInfo = row.ad_group_criterion?.quality_info ?? null;

      const data = {
        text,
        match_type:
          enumToStr(
            enums.KeywordMatchType,
            row.ad_group_criterion?.keyword?.match_type,
            'BROAD',
          ) ?? 'BROAD',
        negative: !!row.ad_group_criterion?.negative,
        status:
          enumToStr(
            enums.AdGroupCriterionStatus,
            row.ad_group_criterion?.status,
            'ENABLED',
          ) ?? 'ENABLED',
        cpc_bid_micros: toBigIntSafe(row.ad_group_criterion?.cpc_bid_micros),
        quality_score: toNumberSafe(qualityInfo?.quality_score),
        quality_info: qualityInfo ? (qualityInfo as any) : undefined,
        last_seen_at: new Date(),
      };

      await this.prisma.trafficKeyword.upsert({
        where: {
          ad_group_id_google_criterion_id: {
            ad_group_id: ourAdGroupId,
            google_criterion_id: criterionId,
          },
        },
        update: data,
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          ad_group_id: ourAdGroupId,
          google_criterion_id: criterionId,
          ...data,
        },
      });
      count++;
    }
    return count;
  }

  private async syncAds(
    customer: Customer,
    tenantId: string,
    accountId: string,
    adGroupByGoogleId: Map<string, string>,
  ): Promise<number> {
    const rows: any[] = await customer.query(`
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group.id
      FROM ad_group_ad
      WHERE ad_group_ad.status != 'REMOVED'
    `);
    let count = 0;
    for (const row of rows) {
      const googleAdGroupId = String(row.ad_group?.id);
      const ourAdGroupId = adGroupByGoogleId.get(googleAdGroupId);
      if (!ourAdGroupId) continue;
      const googleAdId = String(row.ad_group_ad?.ad?.id);
      if (!googleAdId) continue;

      const adType = enumToStr(enums.AdType, row.ad_group_ad?.ad?.type) ?? 'UNKNOWN';
      const headlines = Array.isArray(row.ad_group_ad?.ad?.responsive_search_ad?.headlines)
        ? row.ad_group_ad.ad.responsive_search_ad.headlines.map((h: any) => ({
            text: h?.text,
            pinned_field: h?.pinned_field,
          }))
        : [];
      const descriptions = Array.isArray(
        row.ad_group_ad?.ad?.responsive_search_ad?.descriptions,
      )
        ? row.ad_group_ad.ad.responsive_search_ad.descriptions.map((d: any) => ({
            text: d?.text,
            pinned_field: d?.pinned_field,
          }))
        : [];
      const finalUrls = Array.isArray(row.ad_group_ad?.ad?.final_urls)
        ? row.ad_group_ad.ad.final_urls
        : [];

      const data = {
        ad_type: adType,
        status:
          enumToStr(enums.AdGroupAdStatus, row.ad_group_ad?.status, 'ENABLED') ??
          'ENABLED',
        approval_status: enumToStr(
          enums.PolicyApprovalStatus,
          row.ad_group_ad?.policy_summary?.approval_status,
        ),
        final_urls: finalUrls as any,
        headlines: headlines as any,
        descriptions: descriptions as any,
        path1: row.ad_group_ad?.ad?.responsive_search_ad?.path1 ?? null,
        path2: row.ad_group_ad?.ad?.responsive_search_ad?.path2 ?? null,
        last_seen_at: new Date(),
      };

      await this.prisma.trafficAd.upsert({
        where: {
          ad_group_id_google_ad_id: {
            ad_group_id: ourAdGroupId,
            google_ad_id: googleAdId,
          },
        },
        update: data,
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          ad_group_id: ourAdGroupId,
          google_ad_id: googleAdId,
          ...data,
        },
      });
      count++;
    }
    return count;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sprint F — Asset Groups (PMax + Demand Gen)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Sincroniza asset_group das campanhas PMax e Demand Gen. Retorna
   * mapping google_asset_group_id → local id pra usar no sync de assets.
   */
  private async syncAssetGroups(
    customer: Customer,
    tenantId: string,
    accountId: string,
    campaignByGoogleId: Map<string, string>,
  ): Promise<{ count: number; mapping: Map<string, string> }> {
    const rows: any[] = await customer.query(`
      SELECT
        asset_group.id,
        asset_group.name,
        asset_group.status,
        asset_group.ad_strength,
        asset_group.primary_status,
        asset_group.campaign,
        campaign.id
      FROM asset_group
      WHERE asset_group.status != 'REMOVED'
    `);

    const mapping = new Map<string, string>();
    let count = 0;
    for (const row of rows) {
      const googleId = String(row.asset_group?.id);
      if (!googleId) continue;
      const campaignGoogleId = String(row.campaign?.id ?? '');
      const localCampaignId = campaignByGoogleId.get(campaignGoogleId);
      if (!localCampaignId) continue; // campanha não veio no main sync — skip

      const resourceName =
        typeof row.asset_group?.resource_name === 'string'
          ? row.asset_group.resource_name
          : `customers/${(customer as any).credentials?.customer_id ?? ''}/assetGroups/${googleId}`;

      const data = {
        google_resource_name: resourceName,
        campaign_id: localCampaignId,
        name: row.asset_group?.name ?? '(sem nome)',
        status:
          enumToStr(enums.AssetGroupStatus, row.asset_group?.status, 'UNSPECIFIED') ??
          'UNSPECIFIED',
        ad_strength: enumToStr(
          enums.AdStrength,
          row.asset_group?.ad_strength,
          null,
        ),
        primary_status: enumToStr(
          enums.AssetGroupPrimaryStatus,
          row.asset_group?.primary_status,
          null,
        ),
      };

      const upserted = await this.prisma.trafficAssetGroup.upsert({
        where: {
          account_id_google_asset_group_id: {
            account_id: accountId,
            google_asset_group_id: googleId,
          },
        },
        update: { ...data, last_seen_at: new Date() },
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          google_asset_group_id: googleId,
          ...data,
        },
      });
      mapping.set(googleId, upserted.id);
      count++;
    }
    return { count, mapping };
  }

  /**
   * Sincroniza asset_group_asset (link N:N entre AssetGroup × Asset).
   * Traz performance_label que o Google calcula → identifica assets LOW
   * pra serem trocados.
   */
  private async syncAssetGroupAssets(
    customer: Customer,
    tenantId: string,
    accountId: string,
    assetGroupByGoogleId: Map<string, string>,
  ): Promise<number> {
    const rows: any[] = await customer.query(`
      SELECT
        asset_group_asset.asset_group,
        asset_group_asset.asset,
        asset_group_asset.field_type,
        asset_group_asset.performance_label,
        asset_group_asset.status,
        asset_group.id,
        asset.id,
        asset.type,
        asset.name,
        asset.text_asset.text,
        asset.image_asset.full_size.url,
        asset.youtube_video_asset.youtube_video_id,
        asset.call_to_action_asset.call_to_action
      FROM asset_group_asset
    `);

    let count = 0;
    for (const row of rows) {
      const agGoogleId = String(row.asset_group?.id ?? '');
      const localAg = assetGroupByGoogleId.get(agGoogleId);
      if (!localAg) continue;

      const assetResourceName = row.asset_group_asset?.asset as string | undefined;
      const googleAssetId = String(row.asset?.id ?? '');
      if (!assetResourceName || !googleAssetId) continue;

      const fieldType =
        enumToStr(enums.AssetFieldType, row.asset_group_asset?.field_type, 'UNSPECIFIED') ??
        'UNSPECIFIED';

      const assetType = enumToStr(enums.AssetType, row.asset?.type, null);
      const youtubeId = row.asset?.youtube_video_asset?.youtube_video_id;

      const text =
        typeof row.asset?.text_asset?.text === 'string'
          ? row.asset.text_asset.text
          : typeof row.asset?.call_to_action_asset?.call_to_action === 'string'
            ? row.asset.call_to_action_asset.call_to_action
            : null;

      const url =
        typeof row.asset?.image_asset?.full_size?.url === 'string'
          ? row.asset.image_asset.full_size.url
          : youtubeId
            ? `https://www.youtube.com/watch?v=${youtubeId}`
            : null;

      const data = {
        asset_resource_name: assetResourceName,
        google_asset_id: googleAssetId,
        asset_type: assetType,
        asset_text: text,
        asset_url: url,
        field_type: fieldType,
        performance_label: enumToStr(
          enums.AssetPerformanceLabel,
          row.asset_group_asset?.performance_label,
          null,
        ),
        status: enumToStr(
          enums.AssetLinkStatus,
          row.asset_group_asset?.status,
          null,
        ),
      };

      await this.prisma.trafficAssetGroupAsset.upsert({
        where: {
          asset_group_id_google_asset_id_field_type: {
            asset_group_id: localAg,
            google_asset_id: googleAssetId,
            field_type: fieldType,
          },
        },
        update: { ...data, last_seen_at: new Date() },
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          asset_group_id: localAg,
          ...data,
        },
      });
      count++;
    }
    return count;
  }
}
