import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Customer, enums, errors, GoogleAdsApi } from 'google-ads-api';
import { config } from '../config.js';
import { fromMicros } from '../utils/format.js';

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

export class GoogleAdsService {
  private readonly api: GoogleAdsApi;
  private readonly cache = new Map<string, CacheEntry>();
  private reportCount = 0;
  private reportCountDate = new Date().toISOString().slice(0, 10);

  constructor() {
    const credentials = requireGoogleAdsCredentials();
    this.api = new GoogleAdsApi({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      developer_token: credentials.developerToken,
    });
  }

  get customerId(): string {
    return config.googleAds.customerId;
  }

  customer(): Customer {
    const credentials = requireGoogleAdsCredentials();
    return this.api.Customer({
      customer_id: config.googleAds.customerId,
      login_customer_id: config.googleAds.loginCustomerId,
      refresh_token: credentials.refreshToken,
    });
  }

  async query<T = any>(gaql: string, opts: { cache?: boolean } = { cache: true }): Promise<T[]> {
    this.bumpRateCounter();
    const key = normalizeQuery(gaql);
    const cached = opts.cache !== false ? this.cache.get(key) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.value as T[];

    const rows = await this.customer().query(gaql) as T[];
    if (opts.cache !== false) {
      this.cache.set(key, { expiresAt: Date.now() + config.cacheTtlMs, value: rows });
    }
    return rows;
  }

  async safeQuery<T = any>(primaryGaql: string, fallbackGaql: string): Promise<T[]> {
    try {
      return await this.query<T>(primaryGaql);
    } catch (error) {
      if (this.isFieldCompatibilityError(error)) {
        return await this.query<T>(fallbackGaql);
      }
      throw error;
    }
  }

  async mutate(
    resourceType: 'campaign' | 'campaign_budget' | 'campaign_criterion',
    operation: 'create' | 'update' | 'remove',
    operations: any[],
    context: Record<string, unknown>,
  ): Promise<{ resource_names: string[]; raw: unknown }> {
    const customer = this.customer();
    const service = this.resolveMutateService(customer, resourceType);
    if (!service) throw new Error(`Tipo de recurso nao suportado: ${resourceType}`);

    let result: any;
    const opts = { partial_failure: true, validate_only: false };
    if (operation === 'create') result = await service.create(operations, opts);
    if (operation === 'update') result = await service.update(operations, opts);
    if (operation === 'remove') result = await service.remove(operations, opts);
    if (!result) throw new Error(`Operacao invalida: ${operation}`);

    this.invalidateCache();
    await this.auditWrite({ resourceType, operation, operations, context, result });
    return { resource_names: extractResourceNames(result), raw: safeJson(result) };
  }

  async getCampaignBudget(campaignId: string): Promise<{
    campaign_name: string;
    budget_resource_name: string;
    old_budget: number;
  }> {
    const rows = await this.query<any>(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.campaign_budget,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.id = ${campaignId}
      LIMIT 1
    `, { cache: false });
    const row = rows[0];
    if (!row?.campaign?.campaign_budget) {
      throw new Error(`Campanha ${campaignId} nao encontrada ou sem budget associado.`);
    }
    return {
      campaign_name: row.campaign.name ?? campaignId,
      budget_resource_name: row.campaign.campaign_budget,
      old_budget: fromMicros(row.campaign_budget?.amount_micros),
    };
  }

  campaignResource(campaignId: string): string {
    return `customers/${this.customerId}/campaigns/${campaignId}`;
  }

  campaignCriterionResource(campaignId: string, criterionId: string): string {
    return `customers/${this.customerId}/campaignCriteria/${campaignId}~${criterionId}`;
  }

  enumCampaignStatus(status: 'ENABLED' | 'PAUSED'): number {
    return status === 'ENABLED' ? enums.CampaignStatus.ENABLED : enums.CampaignStatus.PAUSED;
  }

  enumMatchType(matchType: 'BROAD' | 'PHRASE' | 'EXACT'): number {
    if (matchType === 'PHRASE') return enums.KeywordMatchType.PHRASE;
    if (matchType === 'EXACT') return enums.KeywordMatchType.EXACT;
    return enums.KeywordMatchType.BROAD;
  }

  rateStatus() {
    this.resetCounterIfNeeded();
    return {
      date: this.reportCountDate,
      used: this.reportCount,
      limit: config.reportDailyLimit,
      remaining: Math.max(config.reportDailyLimit - this.reportCount, 0),
    };
  }

  private bumpRateCounter() {
    this.resetCounterIfNeeded();
    if (this.reportCount >= config.reportDailyLimit) {
      throw new Error('Limite diario interno de relatorios atingido para proteger a quota da Google Ads API.');
    }
    this.reportCount += 1;
  }

  private resetCounterIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.reportCountDate) {
      this.reportCountDate = today;
      this.reportCount = 0;
    }
  }

  private invalidateCache() {
    this.cache.clear();
  }

  private resolveMutateService(customer: Customer, resourceType: string): any {
    const map: Record<string, string> = {
      campaign: 'campaigns',
      campaign_budget: 'campaignBudgets',
      campaign_criterion: 'campaignCriteria',
    };
    return (customer as any)[map[resourceType]];
  }

  private isFieldCompatibilityError(error: any): boolean {
    if (error instanceof errors.GoogleAdsFailure) return true;
    const msg = String(error?.message ?? '');
    return msg.includes('UNRECOGNIZED_FIELD') || msg.includes('PROHIBITED') || msg.includes('invalid field');
  }

  private async auditWrite(entry: Record<string, unknown>) {
    await mkdir(dirname(config.auditLogPath), { recursive: true });
    await appendFile(
      config.auditLogPath,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry }, safeReplacer)}\n`,
      'utf8',
    );
  }
}

export const googleAdsService = new GoogleAdsService();

function requireGoogleAdsCredentials() {
  const credentials = config.googleAds;
  if (!credentials.clientId || !credentials.clientSecret || !credentials.developerToken || !credentials.refreshToken || !credentials.customerId) {
    throw new Error('Credenciais Google Ads ausentes. Configure CRM_API_URL/CRM_API_KEY para modo CRM ou preencha as variaveis GOOGLE_ADS_* para modo direto.');
  }
  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    developerToken: credentials.developerToken,
    refreshToken: credentials.refreshToken,
  };
}

function normalizeQuery(gaql: string): string {
  return gaql.replace(/\s+/g, ' ').trim();
}

function extractResourceNames(apiResult: any): string[] {
  const results = apiResult?.results ?? apiResult;
  if (!Array.isArray(results)) return [];
  return results.map((r: any) => r?.resource_name).filter(Boolean);
}

function safeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, safeReplacer));
}

function safeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
