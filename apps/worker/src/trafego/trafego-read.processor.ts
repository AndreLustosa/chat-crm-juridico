import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { GoogleAdsClientService } from './google-ads-client.service';

export const READ_JOB = 'trafego-read';

/**
 * Sprint 4 (2026-05-17) — Processor genérico de reads live ao Google Ads.
 *
 * Pra reads que precisam do Customer SDK (GAQL queries), o API enfileira
 * job aqui e aguarda via job.waitUntilFinished. Isso evita duplicar o
 * GoogleAdsClientService no API module (mantém crialibility dentro do
 * worker onde a infra de auth + token já está estabilizada).
 *
 * Job shape:
 *   { tenantId, accountId, kind: 'call_history' | 'billing_status', params: {...} }
 *
 * Retorna: estrutura específica do kind.
 */
export type ReadJobInput = {
  tenantId: string;
  accountId: string;
  kind:
    | 'call_history'
    | 'billing_status'
    | 'extensions'
    | 'shared_negative_lists'
    // Sprint 4.1 — PMax asset groups
    | 'pmax_asset_groups'
    // Sprint 4.2 — Experiment results comparativas
    | 'experiment_results';
  params: Record<string, any>;
};

@Injectable()
@Processor('trafego-read', { concurrency: 4 })
export class TrafegoReadProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafegoReadProcessor.name);

  constructor(private clientSvc: GoogleAdsClientService) {
    super();
  }

  async process(job: Job<ReadJobInput>): Promise<any> {
    if (job.name !== READ_JOB) {
      throw new Error(`[trafego-read] job desconhecido: ${job.name}`);
    }
    const { tenantId, accountId, kind, params } = job.data;
    this.logger.log(`[trafego-read] kind=${kind} tenantId=${tenantId}`);

    const customer = await this.clientSvc.getCustomer(tenantId, accountId);

    switch (kind) {
      case 'call_history':
        return await this.callHistory(customer, params);
      case 'billing_status':
        return await this.billingStatus(customer);
      case 'extensions':
        return await this.extensions(customer, params);
      case 'shared_negative_lists':
        return await this.sharedNegativeLists(customer);
      case 'pmax_asset_groups':
        return await this.pmaxAssetGroups(customer, params);
      case 'experiment_results':
        return await this.experimentResults(customer, params as any);
      default:
        throw new Error(`[trafego-read] kind desconhecido: ${kind}`);
    }
  }

  /**
   * Lista chamadas (call_view) — dados telefonicos vindos via call tracking
   * do Google. Filtra por janela de dias retroativos.
   *
   * Campos retornados: call_duration_seconds, call_status, start_call_date_time,
   * caller_area_code, caller_country_code, type, campaign, ad_group.
   *
   * Limite Google: 90 dias de history.
   */
  private async callHistory(
    customer: any,
    params: { days_back?: number; campaign_id?: string },
  ): Promise<{
    calls: Array<{
      duration_seconds: number;
      status: string;
      started_at: string;
      caller_country: string | null;
      caller_area: string | null;
      type: string;
      campaign_resource_name: string | null;
      ad_group_resource_name: string | null;
    }>;
    total: number;
    note?: string;
  }> {
    const daysBack = Math.min(Math.max(params.days_back ?? 30, 1), 90);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - daysBack);
    const sinceStr = since.toISOString().slice(0, 10);

    const campaignFilter = params.campaign_id
      ? `AND campaign.id = ${params.campaign_id}`
      : '';

    const query = `
      SELECT
        call_view.resource_name,
        call_view.caller_area_code,
        call_view.caller_country_code,
        call_view.call_duration_seconds,
        call_view.call_status,
        call_view.start_call_date_time,
        call_view.end_call_date_time,
        call_view.type,
        campaign.resource_name,
        ad_group.resource_name
      FROM call_view
      WHERE segments.date >= '${sinceStr}'
      ${campaignFilter}
      ORDER BY call_view.start_call_date_time DESC
      LIMIT 500
    `;

    try {
      const rows = (await customer.query(query)) as any[];
      const calls = rows.map((r) => ({
        duration_seconds: Number(r.call_view?.call_duration_seconds ?? 0),
        status: r.call_view?.call_status ?? 'UNKNOWN',
        started_at: r.call_view?.start_call_date_time ?? '',
        caller_country: r.call_view?.caller_country_code ?? null,
        caller_area: r.call_view?.caller_area_code ?? null,
        type: r.call_view?.type ?? 'UNKNOWN',
        campaign_resource_name: r.campaign?.resource_name ?? null,
        ad_group_resource_name: r.ad_group?.resource_name ?? null,
      }));
      return {
        calls,
        total: calls.length,
        note:
          calls.length === 500
            ? 'Limite de 500 chamadas atingido. Reduza days_back ou filtre por campaign_id pra ver mais.'
            : undefined,
      };
    } catch (e: any) {
      throw new Error(`call_view query falhou: ${e.message}`);
    }
  }

  /**
   * Lista extensions (assets) — Sprint 2.1 (2026-05-17).
   *
   * Faz 1 query principal em `asset` (filtrado por tipos suportados) +
   * 3 queries auxiliares em customer_asset/campaign_asset/ad_group_asset
   * pra mapear attachments. Joina resultado pra estrutura unificada.
   *
   * Filtros: type (opcional, SITELINK|CALLOUT|etc), campaign_id ou
   * ad_group_id (limita scope das attachment queries).
   */
  private async extensions(
    customer: any,
    params: {
      type?: string;
      campaign_id?: string;
      ad_group_id?: string;
      status?: string;
    },
  ): Promise<{
    extensions: Array<{
      asset_resource_name: string;
      asset_id: string;
      type: string;
      status: string;
      name: string | null;
      attachments: Array<{
        link_resource_name: string;
        level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
        scope_resource_name: string;
        field_type: string;
        status: string;
      }>;
      payload: any;
    }>;
    note?: string;
  }> {
    // Fix 2026-05-18 (BUG-G v2): rewrite total. Antes faziamos:
    //   1) query asset FROM asset WHERE asset.type IN (...) — perdia call
    //      assets (asset.type pode nao ser populado quando criados via
    //      sub-message call_asset)
    //   2) 3 queries auxiliares de link
    //   3) joinava client-side, filtrava por scope — devolvia [] se nada
    //      batia
    //
    // Novo approach: INVERTE — query por scope (campaign_asset, customer_asset,
    // ad_group_asset) PRIMEIRO, com asset.* via JOIN inline no SELECT. GAQL
    // permite selecionar campos de resources relacionados via foreign key
    // (campaign_asset.asset_field_resource_name aponta pra asset.resource_name,
    // o que viabiliza SELECT asset.call_asset.phone_number FROM campaign_asset).
    //
    // Vantagens:
    //  - NAO depende de asset.type estar populado (filtramos pelo link, nao
    //    pelo asset)
    //  - Garante que so retorna assets que estao ANEXADOS (que eh o que o
    //    caller espera)
    //  - 1 query por scope-level em vez de 4 (1 principal + 3 aux)

    const ASSET_FIELDS = `
      asset.resource_name,
      asset.id,
      asset.type,
      asset.name,
      asset.policy_summary.review_status,
      asset.sitelink_asset.link_text,
      asset.sitelink_asset.description1,
      asset.sitelink_asset.description2,
      asset.callout_asset.callout_text,
      asset.structured_snippet_asset.header,
      asset.structured_snippet_asset.values,
      asset.call_asset.phone_number,
      asset.call_asset.country_code,
      asset.promotion_asset.promotion_target,
      asset.promotion_asset.occasion,
      asset.price_asset.type,
      asset.price_asset.price_qualifier,
      asset.lead_form_asset.business_name,
      asset.lead_form_asset.headline,
      asset.final_urls
    `;

    type Ext = {
      asset_resource_name: string;
      asset_id: string;
      type: string;
      status: string;
      name: string | null;
      attachments: Array<{
        link_resource_name: string;
        level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
        scope_resource_name: string;
        field_type: string;
        status: string;
      }>;
      payload: any;
    };

    // Agrupa por asset_resource_name (1 asset pode estar em multiplos
    // attachments, ex: mesma sitelink em 2 campanhas)
    const byAsset = new Map<string, Ext>();

    const ensureAsset = (assetRn: string, assetData: any): Ext => {
      const existing = byAsset.get(assetRn);
      if (existing) return existing;
      // Normaliza type pra string ANTES de passar pro extractAssetPayload
      // (que faz switch case por string).
      const typeStr = this.formatAssetType(assetData?.type);
      const ext: Ext = {
        asset_resource_name: assetRn,
        asset_id: String(assetData?.id ?? ''),
        type: typeStr,
        status: this.formatPolicyReviewStatus(
          assetData?.policy_summary?.review_status,
        ),
        name: assetData?.name ?? null,
        attachments: [],
        payload: this.extractAssetPayload({
          ...(assetData ?? {}),
          type: typeStr,
        }),
      };
      byAsset.set(assetRn, ext);
      return ext;
    };

    // Fix 2026-05-18 v3 (BUG-G v3): SPLIT queries em vez de JOIN inline.
    // O JOIN inline (campaign_asset + asset.*) parecia certo mas estava
    // retornando vazio em prod. Pode ser:
    //  - resource campaign_asset nao retornando asset.* via JOIN (GAQL
    //    limitation que nao achei doc clara)
    //  - asset com status diferente que filter exclui
    //
    // Approach v3: 1 query SO em campaign_asset (sem JOIN) + query
    // separada em asset pra hidratar details. Logging extenso pra debug
    // se ainda falhar.

    const linkRows: Array<{
      level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
      link_resource_name: string;
      asset_resource_name: string;
      scope_resource_name: string;
      field_type: any;
      status: string;
    }> = [];

    // Helper de WHERE pra link (sem ASSET filters — esses vem na 2a query)
    const buildLinkWhere = (
      linkAlias: string,
      scopeClause?: string,
    ): string => {
      const clauses: string[] = [];
      if (scopeClause) clauses.push(scopeClause);
      if (params.status) {
        clauses.push(`${linkAlias}.status = '${params.status}'`);
      } else {
        clauses.push(`${linkAlias}.status != 'REMOVED'`);
      }
      return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    };

    // ─── Helper: extrai erro estruturado do SDK Opteo ──────────────────
    // Fix 2026-05-18 v4 (BUG-G v4): catch handler antes era `e?.message ??
    // 'unknown'` — escondia erros estruturados. SDK Opteo lança erros com
    // shape { failure: { errors: [{error_code, message, location}] } } OR
    // { errors: [...] } OR plain Error. Loga TUDO em JSON pra debug.
    const formatGaqlError = (e: any): string => {
      try {
        const structured = {
          message: e?.message,
          code: e?.code,
          failure_errors: e?.failure?.errors,
          errors: e?.errors,
          stack: e?.stack?.split('\n').slice(0, 3).join(' | '),
        };
        return JSON.stringify(structured).slice(0, 1500);
      } catch {
        return String(e).slice(0, 500);
      }
    };

    // Resolve resource_names PRA usar em WHERE — Google Ads docs recomendam
    // filtrar campos do link via resource_name COMPLETO (mais seguro que
    // filtrar via implicit resource campaign.id). Pra resolver, precisamos
    // do customer_id (no customerOptions).
    const customerId = (customer as any).customerOptions?.customer_id;

    // ─── Query 1A: CampaignAsset ────────────────────────────────────────
    if (!params.ad_group_id) {
      // Pra evitar GAQL ambiguity, filtra via campaign_asset.campaign
      // (resource_name completo) quando campaign_id passado. Implicit
      // resource campaign.id tambem deveria funcionar mas ja deu problema
      // em prod (round 3).
      const scopeClause =
        params.campaign_id && customerId
          ? `campaign_asset.campaign = 'customers/${customerId}/campaigns/${params.campaign_id}'`
          : params.campaign_id
            ? `campaign.id = ${params.campaign_id}`
            : undefined;
      const whereClause = buildLinkWhere('campaign_asset', scopeClause);
      const q = `
        SELECT
          campaign_asset.resource_name,
          campaign_asset.asset,
          campaign_asset.field_type,
          campaign_asset.status,
          campaign_asset.campaign
        FROM campaign_asset
        ${whereClause}
        LIMIT 500
      `;
      this.logger.log(
        `[extensions] campaign_asset query DISPATCH: ${q.replace(/\s+/g, ' ').trim()}`,
      );
      try {
        const rows = (await customer.query(q)) as any[];
        this.logger.log(
          `[extensions] campaign_asset query OK: ${rows.length} rows (campaign_id=${params.campaign_id ?? 'all'}, status=${params.status ?? 'not REMOVED'})`,
        );
        for (const row of rows) {
          const ca = row.campaign_asset;
          if (!ca?.asset) continue;
          linkRows.push({
            level: 'CAMPAIGN',
            link_resource_name: ca.resource_name ?? '',
            asset_resource_name: ca.asset,
            scope_resource_name: ca.campaign ?? '',
            field_type: ca.field_type,
            status: ca.status ?? '',
          });
        }
      } catch (e: any) {
        this.logger.warn(
          `[extensions] campaign_asset query FALHOU: ${formatGaqlError(e)}`,
        );
      }
    }

    // ─── Query 1B: AdGroupAsset ─────────────────────────────────────────
    {
      const scopeClause = params.ad_group_id && customerId
        ? `ad_group_asset.ad_group = 'customers/${customerId}/adGroups/${params.ad_group_id}'`
        : params.ad_group_id
          ? `ad_group.id = ${params.ad_group_id}`
          : params.campaign_id
            ? `campaign.id = ${params.campaign_id}`
            : undefined;
      const whereClause = buildLinkWhere('ad_group_asset', scopeClause);
      const q = `
        SELECT
          ad_group_asset.resource_name,
          ad_group_asset.asset,
          ad_group_asset.field_type,
          ad_group_asset.status,
          ad_group_asset.ad_group
        FROM ad_group_asset
        ${whereClause}
        LIMIT 500
      `;
      this.logger.log(
        `[extensions] ad_group_asset query DISPATCH: ${q.replace(/\s+/g, ' ').trim()}`,
      );
      try {
        const rows = (await customer.query(q)) as any[];
        this.logger.log(
          `[extensions] ad_group_asset query OK: ${rows.length} rows`,
        );
        for (const row of rows) {
          const aga = row.ad_group_asset;
          if (!aga?.asset) continue;
          linkRows.push({
            level: 'AD_GROUP',
            link_resource_name: aga.resource_name ?? '',
            asset_resource_name: aga.asset,
            scope_resource_name: aga.ad_group ?? '',
            field_type: aga.field_type,
            status: aga.status ?? '',
          });
        }
      } catch (e: any) {
        this.logger.warn(
          `[extensions] ad_group_asset query FALHOU: ${formatGaqlError(e)}`,
        );
      }
    }

    // ─── Query 1C: CustomerAsset ────────────────────────────────────────
    if (!params.campaign_id && !params.ad_group_id) {
      const whereClause = buildLinkWhere('customer_asset');
      const q = `
        SELECT
          customer_asset.resource_name,
          customer_asset.asset,
          customer_asset.field_type,
          customer_asset.status
        FROM customer_asset
        ${whereClause}
        LIMIT 200
      `;
      this.logger.log(
        `[extensions] customer_asset query DISPATCH: ${q.replace(/\s+/g, ' ').trim()}`,
      );
      try {
        const rows = (await customer.query(q)) as any[];
        this.logger.log(
          `[extensions] customer_asset query OK: ${rows.length} rows`,
        );
        for (const row of rows) {
          const ca = row.customer_asset;
          if (!ca?.asset) continue;
          linkRows.push({
            level: 'ACCOUNT',
            link_resource_name: ca.resource_name ?? '',
            asset_resource_name: ca.asset,
            scope_resource_name: '',
            field_type: ca.field_type,
            status: ca.status ?? '',
          });
        }
      } catch (e: any) {
        this.logger.warn(
          `[extensions] customer_asset query FALHOU: ${formatGaqlError(e)}`,
        );
      }
    }

    this.logger.log(
      `[extensions] total link rows: ${linkRows.length} — asset_resource_names: ${linkRows.map((l) => l.asset_resource_name).slice(0, 5).join(', ')}${linkRows.length > 5 ? '...' : ''}`,
    );

    // ─── Query 2: Asset details pros assets que aparecem em algum link ─
    const uniqueAssetRns = [
      ...new Set(linkRows.map((l) => l.asset_resource_name).filter(Boolean)),
    ];
    if (uniqueAssetRns.length > 0) {
      // Filtra por resource_name IN (...) - chunks de 100 pra evitar query
      // muito grande (limit GAQL ~10kb)
      const CHUNK = 100;
      for (let i = 0; i < uniqueAssetRns.length; i += CHUNK) {
        const chunk = uniqueAssetRns.slice(i, i + CHUNK);
        const inList = chunk.map((rn) => `'${rn}'`).join(', ');
        const typeWhere = params.type
          ? ` AND asset.type = '${params.type}'`
          : '';
        const q = `
          SELECT
            ${ASSET_FIELDS}
          FROM asset
          WHERE asset.resource_name IN (${inList})
          ${typeWhere}
        `;
        this.logger.log(
          `[extensions] asset details query DISPATCH: ${q.replace(/\s+/g, ' ').trim().slice(0, 300)}...`,
        );
        try {
          const rows = (await customer.query(q)) as any[];
          this.logger.log(
            `[extensions] asset details query OK: ${rows.length}/${chunk.length} rows hidratados`,
          );
          for (const row of rows) {
            const assetRn = row.asset?.resource_name ?? '';
            if (!assetRn) continue;
            ensureAsset(assetRn, row.asset);
          }
        } catch (e: any) {
          // Reuse formatGaqlError style
          const errFormatted = (() => {
            try {
              return JSON.stringify({
                message: e?.message,
                code: e?.code,
                failure_errors: e?.failure?.errors,
                errors: e?.errors,
              }).slice(0, 1500);
            } catch {
              return String(e).slice(0, 500);
            }
          })();
          this.logger.warn(
            `[extensions] asset details query FALHOU: ${errFormatted}`,
          );
        }
      }
    }

    // ─── Joina links + asset details ───────────────────────────────────
    // Se algum link aponta pra asset que nao apareceu na query 2 (ex:
    // asset.type filter excluiu), cria stub ensureAsset com type UNKNOWN
    // pra mostrar o link MAS marcando asset como nao-hidratado.
    for (const link of linkRows) {
      if (!byAsset.has(link.asset_resource_name)) {
        ensureAsset(link.asset_resource_name, {
          resource_name: link.asset_resource_name,
          id: null,
          type: 'UNKNOWN',
          name: null,
        });
      }
      byAsset.get(link.asset_resource_name)!.attachments.push({
        link_resource_name: link.link_resource_name,
        level: link.level,
        scope_resource_name: link.scope_resource_name,
        field_type: this.formatFieldType(link.field_type),
        status: this.formatAssetLinkStatus(link.status),
      });
    }

    const extensions = [...byAsset.values()];
    this.logger.log(
      `[extensions] FINAL: ${extensions.length} unique assets retornando (com ${linkRows.length} attachments totais)`,
    );
    return {
      extensions,
      note:
        extensions.length === 0 && (params.campaign_id || params.ad_group_id)
          ? `Nenhuma extension anexada a ${params.campaign_id ? `campaign ${params.campaign_id}` : `ad_group ${params.ad_group_id}`}. Use traffic_attach_call_asset ou traffic_attach_extension pra anexar.`
          : undefined,
    };
  }

  /**
   * Formata field_type retornado pelo Google. Aceita int (enum value)
   * OR string (enum name) — sempre devolve string PT-BR/Google amigavel.
   *
   * Fix 2026-05-18 v5: enum completo do AssetFieldType v23 (antes faltavam
   * PRICE=24, AD_IMAGE=26, BUSINESS_LOGO=27, BUSINESS_MESSAGE=31, etc —
   * apareciam como "field_type_26" no audit log).
   */
  private formatFieldType(val: any): string {
    if (typeof val === 'string') return val;
    if (typeof val !== 'number') return '';
    // AssetFieldType v23 — completo, conferido via probe SDK
    const MAP: Record<number, string> = {
      0: 'UNSPECIFIED',
      1: 'UNKNOWN',
      2: 'HEADLINE',
      3: 'DESCRIPTION',
      4: 'MANDATORY_AD_TEXT',
      5: 'MARKETING_IMAGE',
      6: 'MEDIA_BUNDLE',
      7: 'YOUTUBE_VIDEO',
      8: 'BOOK_ON_GOOGLE',
      9: 'LEAD_FORM',
      10: 'PROMOTION',
      11: 'CALLOUT',
      12: 'STRUCTURED_SNIPPET',
      13: 'SITELINK',
      14: 'MOBILE_APP',
      15: 'HOTEL_CALLOUT',
      16: 'CALL',
      17: 'LONG_HEADLINE',
      18: 'BUSINESS_NAME',
      19: 'SQUARE_MARKETING_IMAGE',
      20: 'PORTRAIT_MARKETING_IMAGE',
      21: 'LOGO',
      22: 'LANDSCAPE_LOGO',
      23: 'VIDEO',
      24: 'PRICE',
      25: 'CALL_TO_ACTION_SELECTION',
      26: 'AD_IMAGE',
      27: 'BUSINESS_LOGO',
      28: 'HOTEL_PROPERTY',
      30: 'DEMAND_GEN_CAROUSEL_CARD',
      31: 'BUSINESS_MESSAGE',
      32: 'TALL_PORTRAIT_MARKETING_IMAGE',
      33: 'RELATED_YOUTUBE_VIDEOS',
      38: 'LANDING_PAGE_PREVIEW',
      39: 'LONG_DESCRIPTION',
      40: 'CALL_TO_ACTION',
    };
    return MAP[val] ?? `field_type_${val}`;
  }

  /**
   * AssetType enum (v23). Diferente de AssetFieldType — eh o tipo do asset
   * em si (TEXT/IMAGE/CALL/CALLOUT/etc), nao o slot de uso.
   * Adicionado em 2026-05-18 v5.
   */
  private formatAssetType(val: any): string {
    if (typeof val === 'string') return val;
    if (typeof val !== 'number') return 'UNKNOWN';
    const MAP: Record<number, string> = {
      0: 'UNSPECIFIED',
      1: 'UNKNOWN',
      2: 'YOUTUBE_VIDEO',
      3: 'MEDIA_BUNDLE',
      4: 'IMAGE',
      5: 'TEXT',
      6: 'LEAD_FORM',
      7: 'BOOK_ON_GOOGLE',
      8: 'PROMOTION',
      9: 'CALLOUT',
      10: 'STRUCTURED_SNIPPET',
      11: 'SITELINK',
      12: 'PAGE_FEED',
      13: 'DYNAMIC_EDUCATION',
      14: 'MOBILE_APP',
      15: 'HOTEL_CALLOUT',
      16: 'CALL',
      17: 'PRICE',
      18: 'CALL_TO_ACTION',
      19: 'DYNAMIC_REAL_ESTATE',
      20: 'DYNAMIC_CUSTOM',
      21: 'DYNAMIC_HOTELS_AND_RENTALS',
      22: 'DYNAMIC_FLIGHTS',
      24: 'DYNAMIC_TRAVEL',
      25: 'DYNAMIC_LOCAL',
      26: 'DYNAMIC_JOBS',
      27: 'LOCATION',
      28: 'HOTEL_PROPERTY',
      29: 'DEMAND_GEN_CAROUSEL_CARD',
      30: 'BUSINESS_MESSAGE',
      31: 'APP_DEEP_LINK',
      32: 'YOUTUBE_VIDEO_LIST',
    };
    return MAP[val] ?? `asset_type_${val}`;
  }

  /**
   * AssetLinkStatus enum (v23) — usado no status do CampaignAsset/
   * AdGroupAsset/CustomerAsset link.
   */
  private formatAssetLinkStatus(val: any): string {
    if (typeof val === 'string') return val;
    if (typeof val !== 'number') return 'UNKNOWN';
    const MAP: Record<number, string> = {
      0: 'UNSPECIFIED',
      1: 'UNKNOWN',
      2: 'ENABLED',
      3: 'REMOVED',
      4: 'PAUSED',
    };
    return MAP[val] ?? `link_status_${val}`;
  }

  /**
   * PolicyReviewStatus enum (v23) — usado no asset.policy_summary.review_status.
   * Diferente de AssetLinkStatus (que eh do link).
   */
  private formatPolicyReviewStatus(val: any): string {
    if (typeof val === 'string') return val;
    if (typeof val !== 'number') return 'UNKNOWN';
    const MAP: Record<number, string> = {
      0: 'UNSPECIFIED',
      1: 'UNKNOWN',
      2: 'REVIEW_IN_PROGRESS',
      3: 'REVIEWED',
      4: 'UNDER_APPEAL',
      5: 'ELIGIBLE_MAY_SERVE',
    };
    return MAP[val] ?? `review_status_${val}`;
  }

  /**
   * Helper — extrai payload type-specific de um row do Asset.
   */
  private extractAssetPayload(asset: any): any {
    if (!asset) return null;
    switch (asset.type) {
      case 'SITELINK':
        return {
          link_text: asset.sitelink_asset?.link_text,
          description1: asset.sitelink_asset?.description1,
          description2: asset.sitelink_asset?.description2,
          final_urls: asset.final_urls,
        };
      case 'CALLOUT':
        return { text: asset.callout_asset?.callout_text };
      case 'STRUCTURED_SNIPPET':
        return {
          header: asset.structured_snippet_asset?.header,
          values: asset.structured_snippet_asset?.values,
        };
      case 'CALL':
        return {
          phone_number: asset.call_asset?.phone_number,
          country_code: asset.call_asset?.country_code,
        };
      case 'PROMOTION':
        return {
          promotion_target: asset.promotion_asset?.promotion_target,
          occasion: asset.promotion_asset?.occasion,
        };
      case 'PRICE':
        return {
          type: asset.price_asset?.type,
          price_qualifier: asset.price_asset?.price_qualifier,
        };
      case 'LEAD_FORM':
        return {
          business_name: asset.lead_form_asset?.business_name,
          headline: asset.lead_form_asset?.headline,
        };
      default:
        return null;
    }
  }

  /**
   * Lista SharedSet (NEGATIVE_KEYWORDS) + suas associacoes a campanhas.
   * Sprint 3.1 (2026-05-17).
   *
   * Faz 2 GAQL queries:
   *   1. shared_set WHERE type='NEGATIVE_KEYWORDS' AND status='ENABLED'
   *   2. campaign_shared_set pra mapear quais campanhas usam cada set
   *
   * Retorna estrutura com sets[] + attachments por set.
   */
  private async sharedNegativeLists(
    customer: any,
  ): Promise<{
    shared_sets: Array<{
      resource_name: string;
      id: string;
      name: string;
      member_count: number;
      reference_count: number;
      status: string;
      attached_campaigns: Array<{
        link_resource_name: string;
        campaign_resource_name: string;
        status: string;
      }>;
    }>;
    note?: string;
  }> {
    let sets: any[] = [];
    let links: any[] = [];

    try {
      sets = (await customer.query(`
        SELECT
          shared_set.resource_name,
          shared_set.id,
          shared_set.name,
          shared_set.type,
          shared_set.status,
          shared_set.member_count,
          shared_set.reference_count
        FROM shared_set
        WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
        ORDER BY shared_set.name
        LIMIT 200
      `)) as any[];
    } catch (e: any) {
      throw new Error(`shared_set query falhou: ${e.message}`);
    }

    try {
      links = (await customer.query(`
        SELECT
          campaign_shared_set.resource_name,
          campaign_shared_set.shared_set,
          campaign_shared_set.campaign,
          campaign_shared_set.status
        FROM campaign_shared_set
        LIMIT 500
      `)) as any[];
    } catch (e: any) {
      /* soft-fail — sets sem attachments info */
    }

    const linksBySet = new Map<string, any[]>();
    for (const link of links) {
      const sharedSetRn = link.campaign_shared_set?.shared_set ?? '';
      const arr = linksBySet.get(sharedSetRn) ?? [];
      arr.push({
        link_resource_name: link.campaign_shared_set?.resource_name ?? '',
        campaign_resource_name: link.campaign_shared_set?.campaign ?? '',
        status: link.campaign_shared_set?.status ?? 'UNKNOWN',
      });
      linksBySet.set(sharedSetRn, arr);
    }

    return {
      shared_sets: sets.map((r) => ({
        resource_name: r.shared_set?.resource_name ?? '',
        id: String(r.shared_set?.id ?? ''),
        name: r.shared_set?.name ?? '',
        member_count: Number(r.shared_set?.member_count ?? 0),
        reference_count: Number(r.shared_set?.reference_count ?? 0),
        status: r.shared_set?.status ?? 'UNKNOWN',
        attached_campaigns: linksBySet.get(r.shared_set?.resource_name ?? '') ?? [],
      })),
    };
  }

  /**
   * Lista billing setups + account budgets do customer. Util pra ver
   * status de pagamento, limites, datas.
   */
  private async billingStatus(customer: any): Promise<{
    billing_setups: any[];
    account_budgets: any[];
    note?: string;
  }> {
    let billingSetups: any[] = [];
    let accountBudgets: any[] = [];

    try {
      const bs = (await customer.query(`
        SELECT
          billing_setup.resource_name,
          billing_setup.id,
          billing_setup.status,
          billing_setup.start_date_time,
          billing_setup.end_date_time,
          billing_setup.payments_account,
          billing_setup.payments_account_info.payments_account_id,
          billing_setup.payments_account_info.payments_account_name,
          billing_setup.payments_account_info.payments_profile_id
        FROM billing_setup
        ORDER BY billing_setup.start_date_time DESC
        LIMIT 50
      `)) as any[];
      billingSetups = bs.map((r) => r.billing_setup);
    } catch (e: any) {
      // Billing setup pode falhar por permissoes — soft-fail
    }

    try {
      const ab = (await customer.query(`
        SELECT
          account_budget.resource_name,
          account_budget.id,
          account_budget.name,
          account_budget.status,
          account_budget.amount_served_micros,
          account_budget.total_adjustments_micros,
          account_budget.approved_start_date_time,
          account_budget.approved_end_date_time,
          account_budget.proposed_end_date_time
        FROM account_budget
        ORDER BY account_budget.approved_start_date_time DESC
        LIMIT 50
      `)) as any[];
      accountBudgets = ab.map((r) => r.account_budget);
    } catch (e: any) {
      /* soft-fail */
    }

    return {
      billing_setups: billingSetups,
      account_budgets: accountBudgets,
      note:
        billingSetups.length === 0 && accountBudgets.length === 0
          ? 'Nenhum billing_setup/account_budget retornado. Conta pode usar billing manual ou esta sem setup. Confira via Google Ads UI.'
          : undefined,
    };
  }

  /**
   * Lista PMax asset groups + counts de assets por field_type.
   * Sprint 4.1 (2026-05-17).
   *
   * Faz 2 GAQL queries:
   *   1. asset_group (filtra por campaign_id opcional)
   *   2. asset_group_asset pra contar assets agrupados por (asset_group, field_type)
   *
   * Retorna asset_groups[] com counts indicando quais field_types estao
   * abaixo do minimo Google (5 headlines, 5 desc, 1 long_headline, etc) —
   * util pro gestor de tráfego ver quais groups ainda nao estao serveable.
   */
  private async pmaxAssetGroups(
    customer: any,
    params: { campaign_id?: string },
  ): Promise<{
    asset_groups: Array<{
      resource_name: string;
      id: string;
      name: string;
      status: string;
      campaign_resource_name: string;
      final_urls: string[];
      path1: string | null;
      path2: string | null;
      asset_counts: Record<string, number>;
      readiness_warnings: string[];
    }>;
    note?: string;
  }> {
    const campaignFilter = params.campaign_id
      ? `AND campaign.id = ${params.campaign_id}`
      : '';

    let groups: any[] = [];
    try {
      groups = (await customer.query(`
        SELECT
          asset_group.resource_name,
          asset_group.id,
          asset_group.name,
          asset_group.status,
          asset_group.final_urls,
          asset_group.path1,
          asset_group.path2,
          campaign.resource_name,
          campaign.advertising_channel_type
        FROM asset_group
        WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        ${campaignFilter}
        LIMIT 200
      `)) as any[];
    } catch (e: any) {
      throw new Error(`asset_group query falhou: ${e.message}`);
    }

    // Conta assets agrupados por (asset_group, field_type)
    const countsByGroup = new Map<string, Map<string, number>>();
    try {
      const links = (await customer.query(`
        SELECT
          asset_group_asset.asset_group,
          asset_group_asset.field_type,
          asset_group_asset.status,
          asset_group_asset.resource_name
        FROM asset_group_asset
        ${campaignFilter ? `WHERE ${campaignFilter.replace('AND', '').trim()}` : ''}
        LIMIT 5000
      `)) as any[];
      for (const link of links) {
        if (link.asset_group_asset?.status === 'REMOVED') continue;
        const group = link.asset_group_asset?.asset_group ?? '';
        const fieldType = link.asset_group_asset?.field_type ?? 'UNKNOWN';
        const map = countsByGroup.get(group) ?? new Map<string, number>();
        map.set(fieldType, (map.get(fieldType) ?? 0) + 1);
        countsByGroup.set(group, map);
      }
    } catch (e: any) {
      /* soft-fail — devolve groups sem counts */
    }

    const MIN_REQUIREMENTS: Record<string, number> = {
      HEADLINE: 3, // Google exige 3-5 (5 recomendado)
      DESCRIPTION: 2, // Google exige 2-5 (5 recomendado)
      LONG_HEADLINE: 1,
      BUSINESS_NAME: 1,
      MARKETING_IMAGE: 1,
      SQUARE_MARKETING_IMAGE: 1,
      LOGO: 1,
    };

    const asset_groups = groups.map((r) => {
      const ag = r.asset_group;
      const counts = countsByGroup.get(ag?.resource_name ?? '') ?? new Map();
      const countsObj: Record<string, number> = {};
      for (const [k, v] of counts.entries()) countsObj[k] = v;

      const warnings: string[] = [];
      for (const [fieldType, minCount] of Object.entries(MIN_REQUIREMENTS)) {
        const have = countsObj[fieldType] ?? 0;
        if (have < minCount) {
          warnings.push(
            `${fieldType}: ${have}/${minCount} (faltam ${minCount - have})`,
          );
        }
      }

      return {
        resource_name: ag?.resource_name ?? '',
        id: String(ag?.id ?? ''),
        name: ag?.name ?? '',
        status: ag?.status ?? 'UNKNOWN',
        campaign_resource_name: r.campaign?.resource_name ?? '',
        final_urls: Array.isArray(ag?.final_urls) ? ag.final_urls : [],
        path1: ag?.path1 ?? null,
        path2: ag?.path2 ?? null,
        asset_counts: countsObj,
        readiness_warnings: warnings,
      };
    });

    return {
      asset_groups,
      note:
        asset_groups.length === 0
          ? 'Nenhum asset_group encontrado. Crie via traffic_create_pmax_asset_group.'
          : undefined,
    };
  }

  /**
   * Experiment results — metrics comparativas control vs treatment.
   * Sprint 4.2 (2026-05-17).
   *
   * Pipeline:
   *   1. Query experiment (status, dates, type)
   *   2. Query experiment_arm (control + treatment, com trial campaigns)
   *   3. Pra cada campaign nos arms, query metrics na janela days_back
   *   4. Calcula deltas (treatment vs control: spend, conv, cpl, ctr)
   *
   * Aceita experiment_id em params como:
   *  - resource_name: "customers/X/experiments/Y"
   *  - ID numerico: "12345" (vira customers/<from_customer_id>/experiments/12345)
   */
  private async experimentResults(
    customer: any,
    params: { experiment_id: string; days_back?: number },
  ): Promise<{
    experiment: any;
    control_arm: any;
    treatment_arm: any;
    deltas: Record<string, { control: number; treatment: number; abs: number; pct: number | null }>;
    days_back: number;
    note?: string;
  }> {
    const daysBack = Math.min(90, Math.max(1, params.days_back ?? 30));
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - daysBack);
    const sinceStr = since.toISOString().slice(0, 10);

    const experimentRn = params.experiment_id.startsWith('customers/')
      ? params.experiment_id
      : `customers/${customer.customerOptions?.customer_id}/experiments/${params.experiment_id}`;

    // 1. Experiment metadata
    let experiment: any = null;
    try {
      const rows = (await customer.query(`
        SELECT
          experiment.resource_name,
          experiment.id,
          experiment.name,
          experiment.type,
          experiment.status,
          experiment.suffix,
          experiment.description,
          experiment.start_date,
          experiment.end_date
        FROM experiment
        WHERE experiment.resource_name = '${experimentRn}'
        LIMIT 1
      `)) as any[];
      experiment = rows[0]?.experiment ?? null;
    } catch (e: any) {
      throw new Error(`experiment query falhou: ${e.message}`);
    }

    if (!experiment) {
      return {
        experiment: null,
        control_arm: null,
        treatment_arm: null,
        deltas: {},
        days_back: daysBack,
        note: `Experiment ${experimentRn} nao encontrado.`,
      };
    }

    // 2. ExperimentArms + suas campaigns
    let arms: any[] = [];
    try {
      arms = (await customer.query(`
        SELECT
          experiment_arm.resource_name,
          experiment_arm.experiment,
          experiment_arm.name,
          experiment_arm.control,
          experiment_arm.traffic_split,
          experiment_arm.campaigns,
          experiment_arm.in_design_campaigns
        FROM experiment_arm
        WHERE experiment_arm.experiment = '${experimentRn}'
        LIMIT 10
      `)) as any[];
    } catch (e: any) {
      throw new Error(`experiment_arm query falhou: ${e.message}`);
    }

    const controlArm = arms.find((r) => r.experiment_arm?.control === true);
    const treatmentArm = arms.find((r) => r.experiment_arm?.control !== true);

    // 3. Metrics por campaign na janela
    const aggregateCampaignMetrics = async (
      campaignResourceNames: string[],
    ): Promise<{
      spend: number;
      clicks: number;
      impressions: number;
      conversions: number;
      cpl: number;
      ctr: number;
    }> => {
      if (campaignResourceNames.length === 0) {
        return { spend: 0, clicks: 0, impressions: 0, conversions: 0, cpl: 0, ctr: 0 };
      }
      const inClause = campaignResourceNames
        .map((rn) => `'${rn}'`)
        .join(', ');
      const rows = (await customer.query(`
        SELECT
          metrics.cost_micros,
          metrics.clicks,
          metrics.impressions,
          metrics.conversions
        FROM campaign
        WHERE campaign.resource_name IN (${inClause})
          AND segments.date >= '${sinceStr}'
      `)) as any[];
      let spendMicros = 0n;
      let clicks = 0;
      let impressions = 0;
      let conversions = 0;
      for (const r of rows) {
        spendMicros += BigInt(r.metrics?.cost_micros ?? 0);
        clicks += Number(r.metrics?.clicks ?? 0);
        impressions += Number(r.metrics?.impressions ?? 0);
        conversions += Number(r.metrics?.conversions ?? 0);
      }
      const spend = Number(spendMicros) / 1_000_000;
      return {
        spend,
        clicks,
        impressions,
        conversions,
        cpl: conversions > 0 ? spend / conversions : 0,
        ctr: impressions > 0 ? clicks / impressions : 0,
      };
    };

    const controlCampaigns: string[] = [
      ...(controlArm?.experiment_arm?.campaigns ?? []),
      ...(controlArm?.experiment_arm?.in_design_campaigns ?? []),
    ];
    const treatmentCampaigns: string[] = [
      ...(treatmentArm?.experiment_arm?.campaigns ?? []),
      ...(treatmentArm?.experiment_arm?.in_design_campaigns ?? []),
    ];

    const [controlMetrics, treatmentMetrics] = await Promise.all([
      aggregateCampaignMetrics(controlCampaigns),
      aggregateCampaignMetrics(treatmentCampaigns),
    ]);

    // 4. Calcula deltas
    const computeDelta = (control: number, treatment: number) => ({
      control,
      treatment,
      abs: treatment - control,
      pct: control !== 0 ? ((treatment - control) / control) * 100 : null,
    });

    const deltas = {
      spend: computeDelta(controlMetrics.spend, treatmentMetrics.spend),
      clicks: computeDelta(controlMetrics.clicks, treatmentMetrics.clicks),
      impressions: computeDelta(
        controlMetrics.impressions,
        treatmentMetrics.impressions,
      ),
      conversions: computeDelta(
        controlMetrics.conversions,
        treatmentMetrics.conversions,
      ),
      cpl: computeDelta(controlMetrics.cpl, treatmentMetrics.cpl),
      ctr: computeDelta(controlMetrics.ctr, treatmentMetrics.ctr),
    };

    return {
      experiment,
      control_arm: controlArm
        ? {
            ...controlArm.experiment_arm,
            metrics: controlMetrics,
            campaign_count: controlCampaigns.length,
          }
        : null,
      treatment_arm: treatmentArm
        ? {
            ...treatmentArm.experiment_arm,
            metrics: treatmentMetrics,
            campaign_count: treatmentCampaigns.length,
          }
        : null,
      deltas,
      days_back: daysBack,
      note:
        !treatmentArm
          ? 'Experiment sem treatment arm — adicione via traffic_add_treatment_arm + schedule.'
          : experiment.status === 'SETUP' || experiment.status === 'INITIATED'
            ? `Experiment em status=${experiment.status} — metrics ainda nao acumularam (precisa ENABLED).`
            : undefined,
    };
  }
}
