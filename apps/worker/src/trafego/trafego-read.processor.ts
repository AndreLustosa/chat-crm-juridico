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
  kind: 'call_history' | 'billing_status' | 'extensions';
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
    // Query principal: assets
    const typeFilter = params.type
      ? `AND asset.type = '${params.type}'`
      : '';

    const assetQuery = `
      SELECT
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
      FROM asset
      WHERE asset.type IN (
        'SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'CALL',
        'LOCATION', 'PRICE', 'PROMOTION', 'LEAD_FORM'
      )
      ${typeFilter}
      LIMIT 500
    `;

    let assets: any[] = [];
    try {
      assets = (await customer.query(assetQuery)) as any[];
    } catch (e: any) {
      throw new Error(`Listagem de assets falhou: ${e.message}`);
    }

    // Queries auxiliares: links em 3 niveis (skip os que nao se aplicam
    // ao filtro do caller — ex: se ad_group_id passado, so query ad_group_asset)
    const linksByAsset = new Map<string, any[]>();

    const addLink = (
      assetResourceName: string,
      link: {
        link_resource_name: string;
        level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
        scope_resource_name: string;
        field_type: string;
        status: string;
      },
    ) => {
      const arr = linksByAsset.get(assetResourceName) ?? [];
      arr.push(link);
      linksByAsset.set(assetResourceName, arr);
    };

    // CustomerAsset (account-level) — so se nao tiver filtro de scope
    if (!params.campaign_id && !params.ad_group_id) {
      try {
        const r = (await customer.query(`
          SELECT customer_asset.resource_name, customer_asset.asset,
                 customer_asset.field_type, customer_asset.status
          FROM customer_asset
          LIMIT 200
        `)) as any[];
        for (const row of r) {
          addLink(row.customer_asset?.asset ?? '', {
            link_resource_name: row.customer_asset?.resource_name ?? '',
            level: 'ACCOUNT',
            scope_resource_name: '',
            field_type: row.customer_asset?.field_type ?? '',
            status: row.customer_asset?.status ?? '',
          });
        }
      } catch (e: any) {
        /* soft-fail — continua sem account-level */
      }
    }

    // CampaignAsset
    if (!params.ad_group_id) {
      try {
        const filter = params.campaign_id
          ? `WHERE campaign.id = ${params.campaign_id}`
          : '';
        const r = (await customer.query(`
          SELECT campaign_asset.resource_name, campaign_asset.asset,
                 campaign_asset.field_type, campaign_asset.status,
                 campaign_asset.campaign
          FROM campaign_asset
          ${filter}
          LIMIT 500
        `)) as any[];
        for (const row of r) {
          addLink(row.campaign_asset?.asset ?? '', {
            link_resource_name: row.campaign_asset?.resource_name ?? '',
            level: 'CAMPAIGN',
            scope_resource_name: row.campaign_asset?.campaign ?? '',
            field_type: row.campaign_asset?.field_type ?? '',
            status: row.campaign_asset?.status ?? '',
          });
        }
      } catch (e: any) {
        /* soft-fail */
      }
    }

    // AdGroupAsset
    try {
      const filter = params.ad_group_id
        ? `WHERE ad_group.id = ${params.ad_group_id}`
        : '';
      const r = (await customer.query(`
        SELECT ad_group_asset.resource_name, ad_group_asset.asset,
               ad_group_asset.field_type, ad_group_asset.status,
               ad_group_asset.ad_group
        FROM ad_group_asset
        ${filter}
        LIMIT 500
      `)) as any[];
      for (const row of r) {
        addLink(row.ad_group_asset?.asset ?? '', {
          link_resource_name: row.ad_group_asset?.resource_name ?? '',
          level: 'AD_GROUP',
          scope_resource_name: row.ad_group_asset?.ad_group ?? '',
          field_type: row.ad_group_asset?.field_type ?? '',
          status: row.ad_group_asset?.status ?? '',
        });
      }
    } catch (e: any) {
      /* soft-fail */
    }

    // Joina assets + attachments. Se filtro de scope foi passado, retorna
    // SO os assets que tem pelo menos 1 attachment naquele scope (caller
    // espera ver "o que esta anexado naquela campanha").
    const hasScope = !!params.campaign_id || !!params.ad_group_id;
    const extensions = assets
      .map((row: any) => ({
        asset_resource_name: row.asset?.resource_name ?? '',
        asset_id: String(row.asset?.id ?? ''),
        type: row.asset?.type ?? 'UNKNOWN',
        status: row.asset?.policy_summary?.review_status ?? 'UNKNOWN',
        name: row.asset?.name ?? null,
        attachments: linksByAsset.get(row.asset?.resource_name ?? '') ?? [],
        payload: this.extractAssetPayload(row.asset),
      }))
      .filter((ext) => {
        if (params.status && ext.status !== params.status) return false;
        if (hasScope && ext.attachments.length === 0) return false;
        return true;
      });

    return { extensions };
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
}
