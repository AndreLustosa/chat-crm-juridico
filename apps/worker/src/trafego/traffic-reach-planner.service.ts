import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { Prisma } from '@prisma/client';

/**
 * TrafficReachPlannerService — Reach Planning (Sprint F).
 *
 * Reach Planner é puramente sob-demanda (admin clica "calcular forecast"
 * na UI antes de criar uma campanha branding em YouTube/Demand Gen).
 *
 * Fluxo:
 *   1. UI envia parâmetros (locations, age, gender, devices, products,
 *      budgets, duration_days)
 *   2. Persiste TrafficReachForecast em status=PENDING
 *   3. Chama generateReachForecast no SDK
 *   4. Salva response_payload completo + summary extraído
 *   5. Marca READY (ou ERROR se falhou)
 *
 * Helpers expostos:
 *   - listPlannableLocations(accountId)  — pra dropdown de locations
 *   - listPlannableProducts(accountId, locationId) — pra dropdown de produtos
 */
@Injectable()
export class TrafficReachPlannerService {
  private readonly logger = new Logger(TrafficReachPlannerService.name);

  constructor(
    private prisma: PrismaService,
    private adsClient: GoogleAdsClientService,
  ) {}

  /**
   * Helpers pra dropdowns da UI. Cacheia leve em memória pra evitar bater
   * a API a cada abertura do diálogo.
   */
  private cachedLocations = new Map<string, { at: number; data: any[] }>();

  async listPlannableLocations(accountId: string): Promise<any[]> {
    const cached = this.cachedLocations.get(accountId);
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) {
      return cached.data;
    }
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new HttpException('Conta não encontrada.', HttpStatus.NOT_FOUND);
    }
    const customer = await this.adsClient.getCustomer(
      account.tenant_id,
      account.id,
    );
    const response: any = await (customer as any).reachPlanService.listPlannableLocations();
    const items = response?.plannable_locations ?? response?.results ?? [];
    this.cachedLocations.set(accountId, { at: Date.now(), data: items });
    return items;
  }

  async listPlannableProducts(
    accountId: string,
    plannableLocationId: string,
  ): Promise<any[]> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new HttpException('Conta não encontrada.', HttpStatus.NOT_FOUND);
    }
    const customer = await this.adsClient.getCustomer(
      account.tenant_id,
      account.id,
    );
    const response: any = await (customer as any).reachPlanService.listPlannableProducts(
      { plannable_location_id: plannableLocationId },
    );
    return response?.product_metadata ?? response?.results ?? [];
  }

  /**
   * Gera um forecast — persiste o request, chama API, persiste resposta.
   */
  async generateForecast(
    accountId: string,
    params: ForecastParams,
    createdBy: string,
  ): Promise<{ id: string; summary: ForecastSummary }> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new HttpException('Conta não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (!account.customer_id) {
      throw new HttpException(
        'Conta sem customer_id alvo configurado.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // 1. Persist em PENDING
    const forecast = await this.prisma.trafficReachForecast.create({
      data: {
        tenant_id: account.tenant_id,
        account_id: account.id,
        name: params.name ?? `Forecast ${new Date().toISOString().slice(0, 10)}`,
        request_params: params as unknown as Prisma.InputJsonValue,
        response_payload: {} as Prisma.InputJsonValue,
        summary: {} as Prisma.InputJsonValue,
        status: 'PENDING',
        created_by: createdBy,
      },
    });

    try {
      const customer = await this.adsClient.getCustomer(
        account.tenant_id,
        account.id,
      );

      const request = this.buildForecastRequest(account.customer_id, params);

      const response: any = await (
        customer as any
      ).reachPlanService.generateReachForecast(request);

      const summary = extractSummary(response);

      await this.prisma.trafficReachForecast.update({
        where: { id: forecast.id },
        data: {
          status: 'READY',
          response_payload: response as Prisma.InputJsonValue,
          summary: summary as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `[reach-planner] forecast=${forecast.id} on_target_reach=${summary.on_target_reach} cost_brl=${summary.total_cost_brl}`,
      );

      return { id: forecast.id, summary };
    } catch (err: any) {
      const fmt = this.adsClient.formatError(err);
      await this.prisma.trafficReachForecast.update({
        where: { id: forecast.id },
        data: { status: 'ERROR', error_message: fmt.message },
      });
      this.logger.warn(
        `[reach-planner] forecast=${forecast.id} falhou: ${fmt.message}`,
      );
      throw new HttpException(fmt.message, HttpStatus.BAD_GATEWAY);
    }
  }

  private buildForecastRequest(customerId: string, p: ForecastParams) {
    return {
      customer_id: customerId,
      campaign_duration: { duration_in_days: p.duration_days ?? 30 },
      cookie_frequency_cap_setting: p.frequency_cap
        ? {
            impressions: p.frequency_cap.impressions,
            time_unit: p.frequency_cap.time_unit ?? 'WEEK',
            time_amount: p.frequency_cap.time_amount ?? 1,
          }
        : undefined,
      targeting: {
        plannable_location_ids: p.location_ids ?? [],
        age_ranges: p.age_ranges ?? ['AGE_RANGE_25_54'],
        genders:
          p.genders ??
          ['MALE', 'FEMALE'].map((g) => ({ type: g })),
        devices: (
          p.devices ?? ['DESKTOP', 'MOBILE', 'TABLET', 'CONNECTED_TV']
        ).map((d) => ({ device: d })),
        network: p.network ?? 'YOUTUBE',
      },
      planned_products: (p.products ?? []).map((prod) => ({
        plannable_product_code: prod.code,
        budget_micros: BigInt(Math.round(prod.budget_brl * 1_000_000)).toString(),
      })),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function extractSummary(response: any): ForecastSummary {
  // Estrutura da resposta tem `curves` ou `forecast` dependendo da versão.
  // Tentamos extrair os totais agregados.
  const baseForecast =
    response?.curves?.plannable_age_range_curves?.[0]?.forecast ??
    response?.forecast_metrics ??
    response?.results?.[0] ??
    {};

  const num = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'string' ? Number(v) : (v as number);
    return Number.isFinite(n) ? n : null;
  };

  const totalCostMicros = num(baseForecast?.cost_micros) ?? 0;

  return {
    on_target_reach: num(baseForecast?.on_target_reach),
    total_reach: num(baseForecast?.total_reach),
    on_target_impressions: num(baseForecast?.on_target_impressions),
    total_impressions: num(baseForecast?.total_impressions),
    views: num(baseForecast?.views),
    total_cost_micros: totalCostMicros,
    total_cost_brl: totalCostMicros / 1_000_000,
    cpm_micros: num(baseForecast?.cpm_micros),
    on_target_cpm_micros: num(baseForecast?.on_target_cpm_micros),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

export type ForecastParams = {
  name?: string;
  duration_days?: number;
  frequency_cap?: {
    impressions: number;
    time_unit?: 'WEEK' | 'MONTH' | 'DAY';
    time_amount?: number;
  };
  location_ids?: string[];
  age_ranges?: string[];
  genders?: any[];
  devices?: Array<'DESKTOP' | 'MOBILE' | 'TABLET' | 'CONNECTED_TV'>;
  network?: 'YOUTUBE' | 'GOOGLE_VIDEO_PARTNERS' | 'YOUTUBE_AND_PARTNERS';
  products: Array<{
    code: string;
    budget_brl: number;
  }>;
};

export type ForecastSummary = {
  on_target_reach: number | null;
  total_reach: number | null;
  on_target_impressions: number | null;
  total_impressions: number | null;
  views: number | null;
  total_cost_micros: number;
  total_cost_brl: number;
  cpm_micros: number | null;
  on_target_cpm_micros: number | null;
};
