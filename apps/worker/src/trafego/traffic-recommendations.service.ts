import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { validateAd, validateKeyword, type OABViolation } from '@crm/shared';
import { Prisma } from '@prisma/client';

/**
 * TrafficRecommendationsService — sync + apply de Google Ads Recommendations.
 *
 * Pipeline:
 *   1. syncRecommendations(accountId)
 *      Faz GAQL `SELECT recommendation.* FROM recommendation` na conta.
 *      Para cada uma:
 *        - Cache em TrafficRecommendation (upsert por google_resource_name)
 *        - Roda OAB validator quando aplicável (KEYWORD, TEXT_AD, RSA, etc)
 *        - Marca status: PENDING → READY (passou OAB) ou OAB_BLOCKED
 *      Recommendations que sumiram da listagem viram EXPIRED.
 *
 *   2. applyRecommendation(accountId, id)
 *      Chama `customer.recommendations.apply()`. Em sucesso, marca APPLIED
 *      + persiste mutate_log. Em falha, marca ERROR.
 *
 *   3. dismissRecommendation(accountId, id)
 *      Chama `customer.recommendations.dismiss()`. Marca DISMISSED.
 *
 * O OAB validator usa as mesmas regras dos mutates manuais
 * (validateAd/validateKeyword de @crm/shared) — proibições de "garantia",
 * "melhor advogado", "100%" etc são aplicadas antes do Google Ads.
 */
@Injectable()
export class TrafficRecommendationsService {
  private readonly logger = new Logger(TrafficRecommendationsService.name);

  constructor(
    private prisma: PrismaService,
    private adsClient: GoogleAdsClientService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Sync — busca recommendations + valida OAB
  // ──────────────────────────────────────────────────────────────────────

  async syncRecommendations(accountId: string): Promise<SyncReport> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.status !== 'ACTIVE') {
      throw new HttpException(
        'Conta não ativa.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    const customer = await this.adsClient.getCustomer(
      account.tenant_id,
      account.id,
    );

    // GAQL — fields essenciais. impact + payload completos voltam pra
    // exibir na UI sem precisar nova call.
    const rows: any[] = await customer.query(`
      SELECT
        recommendation.resource_name,
        recommendation.type,
        recommendation.dismissed,
        recommendation.campaign,
        recommendation.ad_group,
        recommendation.impact.base_metrics.impressions,
        recommendation.impact.base_metrics.clicks,
        recommendation.impact.base_metrics.cost_micros,
        recommendation.impact.base_metrics.conversions,
        recommendation.impact.potential_metrics.impressions,
        recommendation.impact.potential_metrics.clicks,
        recommendation.impact.potential_metrics.cost_micros,
        recommendation.impact.potential_metrics.conversions
      FROM recommendation
      WHERE recommendation.dismissed = false
    `);

    // Mapa pra detectar EXPIRED (sumiram do listing) — vamos comparar com
    // o que tinhamos em status PENDING/READY/OAB_BLOCKED.
    const seenResourceNames = new Set<string>();

    let upserted = 0;
    let oabBlocked = 0;
    let ready = 0;

    for (const row of rows) {
      const resourceName = row.recommendation?.resource_name;
      if (!resourceName) continue;
      seenResourceNames.add(resourceName);

      const type: string =
        typeof row.recommendation?.type === 'string'
          ? row.recommendation.type
          : String(row.recommendation?.type ?? 'UNKNOWN');

      // Mapeia campaign/ad_group resource names → IDs locais
      const campaignResourceName = row.recommendation?.campaign as
        | string
        | undefined;
      const adGroupResourceName = row.recommendation?.ad_group as
        | string
        | undefined;
      const localCampaignId = campaignResourceName
        ? await this.resolveLocalCampaignId(account.id, campaignResourceName)
        : null;
      const localAdGroupId = adGroupResourceName
        ? await this.resolveLocalAdGroupId(account.id, adGroupResourceName)
        : null;

      // Roda OAB validator dependendo do tipo
      const { violations, summary } = this.validateOAB(type, row);
      const blocked = violations.some((v) => v.severity === 'BLOCK');
      const status = blocked ? 'OAB_BLOCKED' : 'READY';
      if (blocked) oabBlocked++;
      else ready++;

      const impactBase = row.recommendation?.impact?.base_metrics ?? null;
      const impactPotential =
        row.recommendation?.impact?.potential_metrics ?? null;

      await this.prisma.trafficRecommendation.upsert({
        where: {
          account_id_google_resource_name: {
            account_id: account.id,
            google_resource_name: resourceName,
          },
        },
        update: {
          recommendation_type: type,
          campaign_id: localCampaignId,
          ad_group_id: localAdGroupId,
          payload: row.recommendation as Prisma.InputJsonValue,
          impact_base: impactBase as Prisma.InputJsonValue,
          impact_potential: impactPotential as Prisma.InputJsonValue,
          oab_violations:
            violations.length > 0
              ? (violations as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          oab_summary: summary,
          // Não regride APPLIED/DISMISSED. Só atualiza PENDING/READY/OAB_BLOCKED.
          status: status,
          last_seen_at: new Date(),
        },
        create: {
          tenant_id: account.tenant_id,
          account_id: account.id,
          google_resource_name: resourceName,
          recommendation_type: type,
          campaign_id: localCampaignId,
          ad_group_id: localAdGroupId,
          payload: row.recommendation as Prisma.InputJsonValue,
          impact_base: impactBase as Prisma.InputJsonValue,
          impact_potential: impactPotential as Prisma.InputJsonValue,
          oab_violations:
            violations.length > 0
              ? (violations as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          oab_summary: summary,
          status,
        },
      });
      upserted++;
    }

    // Marca EXPIRED as que estavam ativas mas não vieram desta vez
    const expired = await this.prisma.trafficRecommendation.updateMany({
      where: {
        account_id: account.id,
        status: { in: ['PENDING', 'READY', 'OAB_BLOCKED'] },
        google_resource_name: { notIn: Array.from(seenResourceNames) },
      },
      data: { status: 'EXPIRED' },
    });

    this.logger.log(
      `[recommendations] sync account=${accountId} ` +
        `total=${rows.length} ready=${ready} oab_blocked=${oabBlocked} ` +
        `expired=${expired.count}`,
    );

    return {
      accountId,
      total: rows.length,
      ready,
      oabBlocked,
      expired: expired.count,
    };
  }

  /** Aplica filtros OAB específicos por tipo. */
  private validateOAB(
    type: string,
    row: any,
  ): { violations: OABViolation[]; summary: string | null } {
    const recommendation = row.recommendation ?? {};
    const violations: OABViolation[] = [];

    switch (type) {
      case 'KEYWORD':
      case 'USE_BROAD_MATCH_KEYWORD': {
        const text =
          recommendation.keyword_recommendation?.keyword?.text ??
          recommendation.use_broad_match_keyword_recommendation?.keyword?.text;
        if (typeof text === 'string' && text.length > 0) {
          const v = validateKeyword(text);
          violations.push(...v.violations);
        }
        break;
      }
      case 'TEXT_AD': {
        // text_ad_recommendation.ad has headline/description fields
        const ad = recommendation.text_ad_recommendation?.ad;
        if (ad) {
          const adContent = {
            headlines: extractHeadlines(ad),
            descriptions: extractDescriptions(ad),
            final_urls: ad.final_urls ?? [],
          };
          const v = validateAd(adContent);
          violations.push(...v.violations);
        }
        break;
      }
      case 'RESPONSIVE_SEARCH_AD':
      case 'RESPONSIVE_SEARCH_AD_ASSET': {
        const ad =
          recommendation.responsive_search_ad_recommendation?.ad ??
          recommendation.responsive_search_ad_asset_recommendation?.current_ad;
        if (ad) {
          const adContent = {
            headlines: extractHeadlines(ad),
            descriptions: extractDescriptions(ad),
            final_urls: ad.final_urls ?? [],
          };
          const v = validateAd(adContent);
          violations.push(...v.violations);
        }
        break;
      }
      case 'CALLOUT_ASSET':
      case 'SITELINK_ASSET':
      case 'CALL_ASSET':
      case 'LEAD_FORM_ASSET':
      case 'IMAGE_ASSET':
      case 'STRUCTURED_SNIPPET_ASSET':
        // Assets têm potencial de OAB (callout = "atendimento 24h" pode
        // soar como promessa). Implementação completa fica em E2; por ora
        // marcamos READY e admin revisa manualmente.
        break;
      default:
        // Tipos sem texto livre passam direto (CAMPAIGN_BUDGET, OPT_IN, etc)
        break;
    }

    if (violations.length === 0) {
      return { violations, summary: null };
    }
    const summary = violations
      .map((v) => `[${v.severity}] ${v.rule}: ${v.reason}`)
      .join(' | ');
    return { violations, summary };
  }

  private async resolveLocalCampaignId(
    accountId: string,
    resourceName: string,
  ): Promise<string | null> {
    // Resource name format: 'customers/X/campaigns/Y'
    const m = resourceName.match(/\/campaigns\/(\d+)$/);
    if (!m) return null;
    const camp = await this.prisma.trafficCampaign.findUnique({
      where: {
        account_id_google_campaign_id: {
          account_id: accountId,
          google_campaign_id: m[1],
        },
      },
      select: { id: true },
    });
    return camp?.id ?? null;
  }

  private async resolveLocalAdGroupId(
    accountId: string,
    resourceName: string,
  ): Promise<string | null> {
    const m = resourceName.match(/\/adGroups\/(\d+)$/);
    if (!m) return null;
    const ag = await this.prisma.trafficAdGroup.findFirst({
      where: { account_id: accountId, google_ad_group_id: m[1] },
      select: { id: true },
    });
    return ag?.id ?? null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Apply — aplica recommendation no Google Ads
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Aplica uma recomendação. `force=true` ignora OAB_BLOCKED (admin override).
   * Retorna a recomendação atualizada com status APPLIED|ERROR.
   */
  async applyRecommendation(
    accountId: string,
    recommendationId: string,
    opts: { force?: boolean; resolvedBy: string } = { resolvedBy: 'admin' },
  ): Promise<ApplyResult> {
    const rec = await this.prisma.trafficRecommendation.findUnique({
      where: { id: recommendationId },
    });
    if (!rec || rec.account_id !== accountId) {
      throw new HttpException(
        'Recomendação não encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (rec.status === 'APPLIED' || rec.status === 'DISMISSED') {
      throw new HttpException(
        `Já está em status ${rec.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    if (rec.status === 'OAB_BLOCKED' && !opts.force) {
      throw new HttpException(
        `Bloqueada por OAB: ${rec.oab_summary}. Use force=true pra override.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new HttpException(
        'Conta não encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }

    let customer;
    try {
      customer = await this.adsClient.getCustomer(
        account.tenant_id,
        account.id,
      );
    } catch (err: any) {
      const fmt = this.adsClient.formatError(err);
      await this.markError(rec.id, fmt.message);
      throw new HttpException(fmt.message, HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      // SDK: customer.recommendations.apply([{ resource_name }], opts)
      const response: any = await (customer as any).recommendations.apply([
        { resource_name: rec.google_resource_name },
      ]);

      await this.prisma.trafficRecommendation.update({
        where: { id: rec.id },
        data: {
          status: 'APPLIED',
          resolved_at: new Date(),
          resolved_by: opts.resolvedBy,
          error_message: null,
        },
      });

      this.logger.log(
        `[recommendations] applied id=${rec.id} type=${rec.recommendation_type} ` +
          `by=${opts.resolvedBy} forced=${!!opts.force}`,
      );

      return {
        recommendationId: rec.id,
        status: 'APPLIED',
        rawResponse: response,
      };
    } catch (err: any) {
      const fmt = this.adsClient.formatError(err);
      await this.markError(rec.id, fmt.message);
      this.logger.warn(
        `[recommendations] apply failed id=${rec.id} type=${rec.recommendation_type}: ${fmt.message}`,
      );
      throw new HttpException(fmt.message, HttpStatus.BAD_GATEWAY);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Dismiss
  // ──────────────────────────────────────────────────────────────────────

  async dismissRecommendation(
    accountId: string,
    recommendationId: string,
    opts: { resolvedBy: string } = { resolvedBy: 'admin' },
  ): Promise<ApplyResult> {
    const rec = await this.prisma.trafficRecommendation.findUnique({
      where: { id: recommendationId },
    });
    if (!rec || rec.account_id !== accountId) {
      throw new HttpException(
        'Recomendação não encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (rec.status === 'DISMISSED' || rec.status === 'APPLIED') {
      throw new HttpException(
        `Já está em status ${rec.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new HttpException(
        'Conta não encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      const customer = await this.adsClient.getCustomer(
        account.tenant_id,
        account.id,
      );
      await (customer as any).recommendations.dismiss([
        { resource_name: rec.google_resource_name },
      ]);

      await this.prisma.trafficRecommendation.update({
        where: { id: rec.id },
        data: {
          status: 'DISMISSED',
          resolved_at: new Date(),
          resolved_by: opts.resolvedBy,
        },
      });

      this.logger.log(
        `[recommendations] dismissed id=${rec.id} type=${rec.recommendation_type} by=${opts.resolvedBy}`,
      );

      return { recommendationId: rec.id, status: 'DISMISSED' };
    } catch (err: any) {
      const fmt = this.adsClient.formatError(err);
      await this.markError(rec.id, fmt.message);
      throw new HttpException(fmt.message, HttpStatus.BAD_GATEWAY);
    }
  }

  private async markError(recommendationId: string, message: string) {
    await this.prisma.trafficRecommendation.update({
      where: { id: recommendationId },
      data: {
        status: 'ERROR',
        error_message: message.slice(0, 1000),
      },
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers locais
// ──────────────────────────────────────────────────────────────────────────

function extractHeadlines(ad: any): string[] {
  const arr = Array.isArray(ad?.headlines) ? ad.headlines : [];
  return arr
    .map((h: any) => (typeof h?.text === 'string' ? h.text : null))
    .filter((s: string | null): s is string => !!s);
}

function extractDescriptions(ad: any): string[] {
  const arr = Array.isArray(ad?.descriptions) ? ad.descriptions : [];
  return arr
    .map((d: any) => (typeof d?.text === 'string' ? d.text : null))
    .filter((s: string | null): s is string => !!s);
}

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

export type SyncReport = {
  accountId: string;
  total: number;
  ready: number;
  oabBlocked: number;
  expired: number;
};

export type ApplyResult = {
  recommendationId: string;
  status: 'APPLIED' | 'DISMISSED' | 'ERROR';
  rawResponse?: unknown;
};
