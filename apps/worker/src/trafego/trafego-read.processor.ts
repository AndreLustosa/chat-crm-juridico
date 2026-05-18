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
  kind: 'call_history' | 'billing_status';
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
