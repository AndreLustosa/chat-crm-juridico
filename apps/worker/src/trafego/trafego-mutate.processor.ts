import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { enums } from 'google-ads-api';
import { PrismaService } from '../prisma/prisma.service';
import {
  GoogleAdsMutateService,
  type MutateRequest,
  type MutateResult,
} from './google-ads-mutate.service';
import { type AdContent } from '@crm/shared';

/**
 * Jobs supportados — uma constante por acao, prefixadas com `trafego-mutate-`.
 * O `process()` faz dispatch baseado em job.name.
 */
export const MUTATE_JOBS = {
  PAUSE_CAMPAIGN: 'trafego-mutate-pause-campaign',
  RESUME_CAMPAIGN: 'trafego-mutate-resume-campaign',
  UPDATE_BUDGET: 'trafego-mutate-update-budget',
  PAUSE_AD_GROUP: 'trafego-mutate-pause-ad-group',
  RESUME_AD_GROUP: 'trafego-mutate-resume-ad-group',
  PAUSE_AD: 'trafego-mutate-pause-ad',
  RESUME_AD: 'trafego-mutate-resume-ad',
  ADD_KEYWORDS: 'trafego-mutate-add-keywords',
  ADD_NEGATIVES: 'trafego-mutate-add-negatives',
  REMOVE_KEYWORDS: 'trafego-mutate-remove-keywords',
  CREATE_RSA: 'trafego-mutate-create-rsa',
} as const;

/**
 * Payload base — sempre vem tenantId, accountId e initiator.
 */
type BaseMutatePayload = {
  tenantId: string;
  accountId: string;
  initiator: string;
  /// Override de validate_only (modo conselheiro). Default false.
  validateOnly?: boolean;
  /// Confidence da IA (null = humano)
  confidence?: number | null;
  /// IDs CRM correlacionados pra audit
  context?: Record<string, any>;
};

export type PauseCampaignPayload = BaseMutatePayload & {
  /// resource_name 'customers/X/campaigns/Y'
  campaignResourceName: string;
};

export type ResumeCampaignPayload = PauseCampaignPayload;

export type UpdateBudgetPayload = BaseMutatePayload & {
  /// resource_name do campaign_budget existente
  budgetResourceName: string;
  /// novo valor em micros
  newAmountMicros: bigint | string;
};

export type PauseAdGroupPayload = BaseMutatePayload & {
  adGroupResourceName: string;
};

export type ResumeAdGroupPayload = PauseAdGroupPayload;

export type PauseAdPayload = BaseMutatePayload & {
  /// ad_group_ad resource_name
  adGroupAdResourceName: string;
};

export type ResumeAdPayload = PauseAdPayload;

export type AddKeywordsPayload = BaseMutatePayload & {
  adGroupResourceName: string;
  keywords: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
    cpcBidMicros?: bigint | string | null;
  }>;
};

export type AddNegativesPayload = BaseMutatePayload & {
  /// Adicionar como negative em CAMPAIGN ou em AD_GROUP
  scope: 'CAMPAIGN' | 'AD_GROUP';
  /// resource_name do scope (campaign ou ad_group)
  scopeResourceName: string;
  /// keywords com matchType
  negatives: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;
};

export type RemoveKeywordsPayload = BaseMutatePayload & {
  /// ad_group_criterion resource_names a remover
  criterionResourceNames: string[];
};

export type CreateRsaPayload = BaseMutatePayload & {
  adGroupResourceName: string;
  ad: AdContent;
  /// Se true, dispara em modo dry-run (validate_only=true) so pra preview
  preview?: boolean;
};

/**
 * Processor de mutates. concurrency:1 garante ordem na conta.
 *
 * Quando IA opera em modo "Conselheiro", o caller passa validateOnly=true
 * — mutate roda em dry-run e o resultado eh registrado no log com flag
 * validate_only=true (UI mostra como "sugerido, nao executado").
 */
@Injectable()
@Processor('trafego-mutate', { concurrency: 1 })
export class TrafegoMutateProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafegoMutateProcessor.name);

  constructor(
    private prisma: PrismaService,
    private mutate: GoogleAdsMutateService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<MutateResult> {
    this.logger.log(`[mutate-processor] job=${job.name} id=${job.id}`);

    switch (job.name) {
      case MUTATE_JOBS.PAUSE_CAMPAIGN:
        return await this.pauseCampaign(job.data);
      case MUTATE_JOBS.RESUME_CAMPAIGN:
        return await this.resumeCampaign(job.data);
      case MUTATE_JOBS.UPDATE_BUDGET:
        return await this.updateBudget(job.data);
      case MUTATE_JOBS.PAUSE_AD_GROUP:
        return await this.pauseAdGroup(job.data);
      case MUTATE_JOBS.RESUME_AD_GROUP:
        return await this.resumeAdGroup(job.data);
      case MUTATE_JOBS.PAUSE_AD:
        return await this.pauseAd(job.data);
      case MUTATE_JOBS.RESUME_AD:
        return await this.resumeAd(job.data);
      case MUTATE_JOBS.ADD_KEYWORDS:
        return await this.addKeywords(job.data);
      case MUTATE_JOBS.ADD_NEGATIVES:
        return await this.addNegatives(job.data);
      case MUTATE_JOBS.REMOVE_KEYWORDS:
        return await this.removeKeywords(job.data);
      case MUTATE_JOBS.CREATE_RSA:
        return await this.createRsa(job.data);
      default:
        throw new Error(`[mutate-processor] job desconhecido: ${job.name}`);
    }
  }

  // ─── Acoes ──────────────────────────────────────────────────────────────

  private async pauseCampaign(p: PauseCampaignPayload): Promise<MutateResult> {
    const result = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.campaignResourceName,
          status: enums.CampaignStatus.PAUSED,
        },
      ],
    });
    if (result.status === 'SUCCESS' && !p.validateOnly) {
      // Mirror local — atualiza cache TrafficCampaign sem esperar proximo sync
      await this.updateLocalCampaignStatus(
        p.tenantId,
        p.accountId,
        p.campaignResourceName,
        'PAUSED',
      );
    }
    return result;
  }

  private async resumeCampaign(p: ResumeCampaignPayload): Promise<MutateResult> {
    const result = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.campaignResourceName,
          status: enums.CampaignStatus.ENABLED,
        },
      ],
    });
    if (result.status === 'SUCCESS' && !p.validateOnly) {
      await this.updateLocalCampaignStatus(
        p.tenantId,
        p.accountId,
        p.campaignResourceName,
        'ENABLED',
      );
    }
    return result;
  }

  private async updateBudget(p: UpdateBudgetPayload): Promise<MutateResult> {
    const newMicros =
      typeof p.newAmountMicros === 'string'
        ? BigInt(p.newAmountMicros)
        : p.newAmountMicros;

    const result = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_budget',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.budgetResourceName,
          amount_micros: newMicros,
        },
      ],
    });
    if (result.status === 'SUCCESS' && !p.validateOnly) {
      const googleBudgetId = this.extractIdFromResourceName(p.budgetResourceName);
      if (googleBudgetId) {
        await this.prisma.trafficCampaignBudget.updateMany({
          where: {
            tenant_id: p.tenantId,
            account_id: p.accountId,
            google_budget_id: googleBudgetId,
          },
          data: { amount_micros: newMicros },
        });
      }
    }
    return result;
  }

  private async pauseAdGroup(p: PauseAdGroupPayload): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.adGroupResourceName,
          status: enums.AdGroupStatus.PAUSED,
        },
      ],
    });
  }

  private async resumeAdGroup(p: ResumeAdGroupPayload): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.adGroupResourceName,
          status: enums.AdGroupStatus.ENABLED,
        },
      ],
    });
  }

  private async pauseAd(p: PauseAdPayload): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_ad',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.adGroupAdResourceName,
          status: enums.AdGroupAdStatus.PAUSED,
        },
      ],
    });
  }

  private async resumeAd(p: ResumeAdPayload): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_ad',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.adGroupAdResourceName,
          status: enums.AdGroupAdStatus.ENABLED,
        },
      ],
    });
  }

  /**
   * Adiciona keywords positivas a um ad_group. Cada keyword vira um
   * ad_group_criterion com criterion.keyword.text + match_type.
   * SDK valida OAB nao se aplica em positives — keyword text vem de pesquisa
   * de termos, geralmente nao tem comparacao. Mas aplicamos por garantia.
   */
  private async addKeywords(p: AddKeywordsPayload): Promise<MutateResult> {
    const operations = p.keywords.map((kw) => {
      const op: any = {
        ad_group: p.adGroupResourceName,
        status: enums.AdGroupCriterionStatus.ENABLED,
        keyword: {
          text: kw.text,
          match_type: this.mapKeywordMatchType(kw.matchType),
        },
      };
      if (kw.cpcBidMicros) {
        op.cpc_bid_micros =
          typeof kw.cpcBidMicros === 'string'
            ? BigInt(kw.cpcBidMicros)
            : kw.cpcBidMicros;
      }
      return op;
    });

    // Validar OAB em cada keyword. Primeira BLOCK ja aborta o batch.
    for (const kw of p.keywords) {
      const result = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'ad_group_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: true, // round 1 — dry-run pra validar OAB de cada
        context: { ...p.context, validation_pass: true, kw_text: kw.text },
        operations: [
          {
            ad_group: p.adGroupResourceName,
            status: enums.AdGroupCriterionStatus.ENABLED,
            keyword: {
              text: kw.text,
              match_type: this.mapKeywordMatchType(kw.matchType),
            },
          },
        ],
        keywordText: kw.text,
      });
      if (result.status === 'FAILED') {
        // OAB block ou erro — devolve direto, nao manda batch real
        return result;
      }
    }

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_criterion',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations,
    });
  }

  /**
   * Adiciona negatives. Scope=AD_GROUP: vira ad_group_criterion com negative=true.
   * Scope=CAMPAIGN: vira campaign_criterion com negative=true.
   */
  private async addNegatives(p: AddNegativesPayload): Promise<MutateResult> {
    if (p.scope === 'AD_GROUP') {
      const operations = p.negatives.map((kw) => ({
        ad_group: p.scopeResourceName,
        negative: true,
        status: enums.AdGroupCriterionStatus.ENABLED,
        keyword: {
          text: kw.text,
          match_type: this.mapKeywordMatchType(kw.matchType),
        },
      }));
      return await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'ad_group_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: p.context,
        operations,
      });
    }

    // CAMPAIGN-level
    const operations = p.negatives.map((kw) => ({
      campaign: p.scopeResourceName,
      negative: true,
      keyword: {
        text: kw.text,
        match_type: this.mapKeywordMatchType(kw.matchType),
      },
    }));
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_criterion',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations,
    });
  }

  private async removeKeywords(p: RemoveKeywordsPayload): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_criterion',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: p.criterionResourceNames,
    });
  }

  /**
   * Cria RSA (Responsive Search Ad). Exige headlines + descriptions + final_urls.
   * Validador OAB roda automaticamente no GoogleAdsMutateService (resourceType=ad_group_ad).
   */
  private async createRsa(p: CreateRsaPayload): Promise<MutateResult> {
    const op: any = {
      ad_group: p.adGroupResourceName,
      status: enums.AdGroupAdStatus.ENABLED,
      ad: {
        responsive_search_ad: {
          headlines: p.ad.headlines.map((h) => ({ text: h })),
          descriptions: p.ad.descriptions.map((d) => ({ text: d })),
        },
        final_urls: p.ad.final_url ? [p.ad.final_url] : [],
      },
    };
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_ad',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly || !!p.preview,
      context: p.context,
      operations: [op],
      adContent: p.ad,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private mapKeywordMatchType(t: 'EXACT' | 'PHRASE' | 'BROAD'): number {
    if (t === 'EXACT') return enums.KeywordMatchType.EXACT;
    if (t === 'PHRASE') return enums.KeywordMatchType.PHRASE;
    return enums.KeywordMatchType.BROAD;
  }

  private extractIdFromResourceName(rn: string): string | null {
    const parts = rn.split('/');
    return parts[parts.length - 1] || null;
  }

  /**
   * Mirror local — atualiza TrafficCampaign.status sem esperar proximo sync.
   * Async fire-and-forget (erro nao trava o mutate principal).
   */
  private async updateLocalCampaignStatus(
    tenantId: string,
    accountId: string,
    resourceName: string,
    newStatus: 'ENABLED' | 'PAUSED' | 'REMOVED',
  ): Promise<void> {
    try {
      const googleId = this.extractIdFromResourceName(resourceName);
      if (!googleId) return;
      await this.prisma.trafficCampaign.updateMany({
        where: {
          tenant_id: tenantId,
          account_id: accountId,
          google_campaign_id: googleId,
        },
        data: { status: newStatus },
      });
    } catch (e: any) {
      this.logger.warn(`[mutate] mirror local status falhou: ${e.message}`);
    }
  }
}
