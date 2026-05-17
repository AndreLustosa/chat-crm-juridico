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
  REMOVE_CAMPAIGN: 'trafego-mutate-remove-campaign',
  UPDATE_BUDGET: 'trafego-mutate-update-budget',
  PAUSE_AD_GROUP: 'trafego-mutate-pause-ad-group',
  RESUME_AD_GROUP: 'trafego-mutate-resume-ad-group',
  PAUSE_AD: 'trafego-mutate-pause-ad',
  RESUME_AD: 'trafego-mutate-resume-ad',
  ADD_KEYWORDS: 'trafego-mutate-add-keywords',
  ADD_NEGATIVES: 'trafego-mutate-add-negatives',
  REMOVE_KEYWORDS: 'trafego-mutate-remove-keywords',
  CREATE_RSA: 'trafego-mutate-create-rsa',
  CREATE_SEARCH_CAMPAIGN: 'trafego-mutate-create-search-campaign',
  UPDATE_BIDDING_STRATEGY: 'trafego-mutate-update-bidding-strategy',
  UPDATE_AD_SCHEDULE: 'trafego-mutate-update-ad-schedule',
  REMOVE_AD_GROUP: 'trafego-mutate-remove-ad-group',
  // Sprint 1 backlog (2026-05-17) — Conversion Actions, Ad Groups, RSAs
  CREATE_CONVERSION_ACTION: 'trafego-mutate-create-conversion-action',
  UPDATE_CONVERSION_ACTION: 'trafego-mutate-update-conversion-action',
  REMOVE_CONVERSION_ACTION: 'trafego-mutate-remove-conversion-action',
  ENABLE_ENHANCED_CONVERSIONS: 'trafego-mutate-enable-enhanced-conversions',
  CREATE_AD_GROUP: 'trafego-mutate-create-ad-group',
  UPDATE_AD_GROUP: 'trafego-mutate-update-ad-group',
  UPDATE_RSA: 'trafego-mutate-update-rsa',
  REMOVE_AD: 'trafego-mutate-remove-ad',
  ATTACH_CALL_ASSET: 'trafego-mutate-attach-call-asset',
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
export type RemoveCampaignPayload = PauseCampaignPayload;

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

export type RemoveAdGroupPayload = PauseAdGroupPayload;

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

export type CreateSearchCampaignPayload = BaseMutatePayload & {
  /// Customer ID (sem traços) — necessário pro resource_name do budget
  customerId: string;
  /// Nome da campanha
  name: string;
  /// Orçamento diário em micros (1 BRL = 1.000.000)
  dailyBudgetMicros: bigint | string;
  /// Estratégia de lance — default MAXIMIZE_CONVERSIONS sem target_cpa
  biddingStrategy:
    | 'MAXIMIZE_CONVERSIONS'
    | 'MAXIMIZE_CLICKS'
    | 'MANUAL_CPC'
    | 'TARGET_CPA';
  /// Target CPA em micros (só obrigatório se biddingStrategy=TARGET_CPA)
  targetCpaMicros?: bigint | string | null;
  /// IDs numéricos do Google de geo_target (ex: "1001775" = Brasil)
  geoTargetIds: string[];
  /// IDs numéricos de language_constants (ex: "1014" = portuguese)
  languageIds: string[];
  /// Final URL alvo dos anúncios da campanha (opcional)
  finalUrl?: string;
  /// Status inicial — default 'PAUSED' por segurança (admin ativa depois)
  initialStatus?: 'ENABLED' | 'PAUSED';
};

export type UpdateBiddingStrategyPayload = BaseMutatePayload & {
  campaignResourceName: string;
  /// Nova estratégia
  biddingStrategy:
    | 'MAXIMIZE_CONVERSIONS'
    | 'MAXIMIZE_CLICKS'
    | 'MANUAL_CPC'
    | 'TARGET_CPA'
    | 'TARGET_ROAS'
    | 'MAXIMIZE_CONVERSION_VALUE';
  /// Target CPA em micros (se TARGET_CPA)
  targetCpaMicros?: bigint | string | null;
  /// Target ROAS multiplier (se TARGET_ROAS) — ex: 3.5
  targetRoas?: number | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 1 backlog — Payload types
// ═══════════════════════════════════════════════════════════════════════════

export type CreateConversionActionPayload = BaseMutatePayload & {
  /// Customer ID sem traços — pra montar resource_names
  customerId: string;
  name: string;
  category: string;
  type: string;
  includeInConversions?: boolean;
  defaultValueMicros?: bigint | string | null;
  countingType?: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';
  clickThroughLookbackDays?: number;
  viewThroughLookbackDays?: number;
  phoneCallDurationSeconds?: number;
};

export type UpdateConversionActionPayload = BaseMutatePayload & {
  /// resource_name 'customers/X/conversionActions/Y'
  conversionActionResourceName: string;
  /// Patch (apenas fields enviados sao alterados; mask auto-derivado)
  patch: {
    name?: string;
    include_in_conversions?: boolean;
    primary_for_goal?: boolean;
    default_value_micros?: bigint | string | null;
    always_use_default_value?: boolean;
    attribution_model?: string;
    click_through_lookback_days?: number;
    view_through_lookback_days?: number;
    counting_type?: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';
    status?: 'ENABLED' | 'HIDDEN';
  };
};

export type RemoveConversionActionPayload = BaseMutatePayload & {
  conversionActionResourceName: string;
};

export type EnableEnhancedConversionsPayload = BaseMutatePayload & {
  /// Customer ID sem traços — necessário pro resource_name
  customerId: string;
  mode: 'GOOGLE_TAG' | 'API' | 'BOTH';
};

export type CreateAdGroupPayload = BaseMutatePayload & {
  campaignResourceName: string;
  name: string;
  type?: 'SEARCH_STANDARD' | 'SEARCH_DYNAMIC_ADS' | 'DISPLAY_STANDARD';
  status?: 'ENABLED' | 'PAUSED';
  cpcBidMicros?: bigint | string | null;
  targetCpaMicros?: bigint | string | null;
  targetRoas?: number | null;
};

export type UpdateAdGroupPayload = BaseMutatePayload & {
  adGroupResourceName: string;
  patch: {
    name?: string;
    status?: 'ENABLED' | 'PAUSED';
    cpc_bid_micros?: bigint | string | null;
    target_cpa_micros?: bigint | string | null;
    target_roas?: number | null;
    ad_rotation_mode?: 'OPTIMIZE' | 'ROTATE_FOREVER';
  };
};

export type UpdateRsaPayload = BaseMutatePayload & {
  /// resource_name do ad_group_ad atual (sera REMOVED no final)
  oldAdGroupAdResourceName: string;
  /// ad_group resource_name pra criar o novo
  adGroupResourceName: string;
  /// Conteudo do novo RSA — passa por validateAd OAB
  newAd: AdContent;
};

export type RemoveAdPayload = BaseMutatePayload & {
  adGroupAdResourceName: string;
};

export type AttachCallAssetPayload = BaseMutatePayload & {
  /// Customer ID sem traços
  customerId: string;
  /// E.164 ex: +5582999999999
  phoneNumber: string;
  /// ISO 3166 alpha-2 — default "BR"
  countryCode: string;
  /// Onde anexar
  level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
  /// resource_name do campaign (se level=CAMPAIGN)
  campaignResourceName?: string;
  /// resource_name do ad_group (se level=AD_GROUP)
  adGroupResourceName?: string;
  /// Google injeta tracking number visivel + reporta calls como conv
  callTracked?: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════

export type UpdateAdSchedulePayload = BaseMutatePayload & {
  /// Customer ID (sem traços) pra montar resource_names
  customerId: string;
  /// google_campaign_id (numérico)
  googleCampaignId: string;
  /// Resource names dos schedules existentes a remover.
  /// Formato: customers/X/campaignCriteria/Y~Z
  existingResourceNames: string[];
  /// Novos slots a criar (substituição completa)
  newSlots: Array<{
    dayOfWeek:
      | 'MONDAY'
      | 'TUESDAY'
      | 'WEDNESDAY'
      | 'THURSDAY'
      | 'FRIDAY'
      | 'SATURDAY'
      | 'SUNDAY';
    startHour: number;
    startMinute: 0 | 15 | 30 | 45;
    endHour: number;
    endMinute: 0 | 15 | 30 | 45;
    bidModifier?: number | null;
  }>;
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
      case MUTATE_JOBS.REMOVE_CAMPAIGN:
        return await this.removeCampaign(job.data);
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
      case MUTATE_JOBS.CREATE_SEARCH_CAMPAIGN:
        return await this.createSearchCampaign(job.data);
      case MUTATE_JOBS.UPDATE_BIDDING_STRATEGY:
        return await this.updateBiddingStrategy(job.data);
      case MUTATE_JOBS.UPDATE_AD_SCHEDULE:
        return await this.updateAdSchedule(job.data);
      case MUTATE_JOBS.REMOVE_AD_GROUP:
        return await this.removeAdGroup(job.data);
      case MUTATE_JOBS.CREATE_CONVERSION_ACTION:
        return await this.createConversionAction(job.data);
      case MUTATE_JOBS.UPDATE_CONVERSION_ACTION:
        return await this.updateConversionAction(job.data);
      case MUTATE_JOBS.REMOVE_CONVERSION_ACTION:
        return await this.removeConversionAction(job.data);
      case MUTATE_JOBS.ENABLE_ENHANCED_CONVERSIONS:
        return await this.enableEnhancedConversions(job.data);
      case MUTATE_JOBS.CREATE_AD_GROUP:
        return await this.createAdGroup(job.data);
      case MUTATE_JOBS.UPDATE_AD_GROUP:
        return await this.updateAdGroup(job.data);
      case MUTATE_JOBS.UPDATE_RSA:
        return await this.updateRsa(job.data);
      case MUTATE_JOBS.REMOVE_AD:
        return await this.removeAd(job.data);
      case MUTATE_JOBS.ATTACH_CALL_ASSET:
        return await this.attachCallAsset(job.data);
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

  /**
   * Remove (soft-delete) uma campanha. Spec do gestor de trafego (2026-05-17)
   * pede operacao UPDATE com status=REMOVED + update_mask=["status"], em vez
   * do tradicional REMOVE operation. Equivalente server-side mas leverage o
   * mesmo audit log dos outros mutates (payload mostra `{status: REMOVED}`).
   *
   * Pra status (scalar enum), o auto-mask do SDK funciona corretamente
   * (recursiveFieldMaskSearch trata scalares OK — o bug 0137f49 era so pra
   * oneof empty messages). NAO precisa do bypass mutateCampaignWithExplicitMask.
   */
  private async removeCampaign(p: RemoveCampaignPayload): Promise<MutateResult> {
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
          status: enums.CampaignStatus.REMOVED,
        },
      ],
    });
    if (result.status === 'SUCCESS' && !p.validateOnly) {
      await this.updateLocalCampaignStatus(
        p.tenantId,
        p.accountId,
        p.campaignResourceName,
        'REMOVED',
      );
    }
    return result;
  }

  /**
   * Remove (soft-delete) um ad_group. Mesmo padrao de removeCampaign:
   * UPDATE com status=REMOVED + mask auto-derivado ["status"]. Cascade
   * (ads, keywords) eh server-side — Google REMOVE em cascata
   * automaticamente quando ad_group passa pra REMOVED.
   */
  private async removeAdGroup(p: RemoveAdGroupPayload): Promise<MutateResult> {
    const result = await this.mutate.execute({
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
          status: enums.AdGroupStatus.REMOVED,
        },
      ],
    });
    if (result.status === 'SUCCESS' && !p.validateOnly) {
      // Mirror local — atualiza TrafficAdGroup.status sem esperar proximo sync
      try {
        const googleId = this.extractIdFromResourceName(p.adGroupResourceName);
        if (googleId) {
          await this.prisma.trafficAdGroup.updateMany({
            where: {
              tenant_id: p.tenantId,
              account_id: p.accountId,
              google_ad_group_id: googleId,
            },
            data: { status: 'REMOVED' },
          });
        }
      } catch (e: any) {
        this.logger.warn(`[mutate] mirror remove ad_group falhou: ${e.message}`);
      }
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

  /**
   * Cria campanha Search do zero. Pipeline:
   *   1. Cria campaign_budget — pega resource_name retornado
   *   2. Cria campaign apontando pro budget
   *
   * Sempre PAUSED por padrão (admin ativa explícito depois). Bid strategy
   * sem target_cpa cai em MAXIMIZE_CONVERSIONS — Google sugere 50+ conv/mês
   * pra ativar TARGET_CPA real.
   *
   * Geo + language: Brasil (1001775) + pt-BR (1014) por default.
   * Falha em 1 dos passos: retorna FAILED do passo onde quebrou. NÃO faz
   * rollback de budget criado (audit-log no TrafficMutateLog deixa claro).
   */
  private async createSearchCampaign(
    p: CreateSearchCampaignPayload,
  ): Promise<MutateResult> {
    const dailyMicros =
      typeof p.dailyBudgetMicros === 'string'
        ? BigInt(p.dailyBudgetMicros)
        : p.dailyBudgetMicros;

    // Passo 1: Cria budget (recurso temporário com nome ligado à campanha)
    const budgetTempName = `Budget — ${p.name}`;
    const budgetResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_budget',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: { ...p.context, step: 'create_budget', campaign_name: p.name },
      operations: [
        {
          name: budgetTempName,
          amount_micros: dailyMicros,
          delivery_method: enums.BudgetDeliveryMethod.STANDARD,
          explicitly_shared: false,
        },
      ],
    });
    if (budgetResult.status !== 'SUCCESS' || !budgetResult.resourceNames?.[0]) {
      return budgetResult;
    }
    const budgetResourceName = budgetResult.resourceNames[0];

    // Passo 2: Cria campaign
    const campaignOp: any = {
      name: p.name,
      advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
      status:
        p.initialStatus === 'ENABLED'
          ? enums.CampaignStatus.ENABLED
          : enums.CampaignStatus.PAUSED,
      campaign_budget: budgetResourceName,
      // Network: search apenas (sem search_partners e display) — Maioria
      // dos juridicos perde dinheiro em search partners e display network.
      network_settings: {
        target_google_search: true,
        target_search_network: false,
        target_content_network: false,
        target_partner_search_network: false,
      },
      // Lance — defaults seguros conforme estratégia escolhida
      ...(p.biddingStrategy === 'MAXIMIZE_CONVERSIONS' && {
        maximize_conversions: {},
      }),
      ...(p.biddingStrategy === 'MAXIMIZE_CLICKS' && {
        target_spend: {},
      }),
      ...(p.biddingStrategy === 'MANUAL_CPC' && {
        manual_cpc: { enhanced_cpc_enabled: false },
      }),
      ...(p.biddingStrategy === 'TARGET_CPA' &&
        p.targetCpaMicros && {
          target_cpa: {
            target_cpa_micros:
              typeof p.targetCpaMicros === 'string'
                ? BigInt(p.targetCpaMicros)
                : p.targetCpaMicros,
          },
        }),
    };

    const campaignResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        step: 'create_campaign',
        budget_resource_name: budgetResourceName,
      },
      operations: [campaignOp],
    });
    if (
      campaignResult.status !== 'SUCCESS' ||
      !campaignResult.resourceNames?.[0]
    ) {
      return campaignResult;
    }
    const campaignResourceName = campaignResult.resourceNames[0];

    // Passo 3: Aplicar geo/language targeting via campaign_criterion
    const criterionOps: any[] = [];
    for (const geoId of p.geoTargetIds) {
      criterionOps.push({
        campaign: campaignResourceName,
        location: { geo_target_constant: `geoTargetConstants/${geoId}` },
      });
    }
    for (const langId of p.languageIds) {
      criterionOps.push({
        campaign: campaignResourceName,
        language: { language_constant: `languageConstants/${langId}` },
      });
    }
    if (criterionOps.length > 0) {
      await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: {
          ...p.context,
          step: 'create_criteria',
          campaign_resource_name: campaignResourceName,
        },
        operations: criterionOps,
      });
      // Não falha o todo se geo/lang falhar — admin pode adicionar depois
    }

    // Mirror local — cria TrafficCampaign + TrafficCampaignBudget pra UI
    // não esperar próximo sync. Async fire-and-forget.
    if (!p.validateOnly && campaignResult.resourceNames?.[0]) {
      void this.mirrorNewCampaign(
        p.tenantId,
        p.accountId,
        campaignResourceName,
        budgetResourceName,
        p.name,
        dailyMicros,
        p.biddingStrategy,
        p.initialStatus ?? 'PAUSED',
      );
    }

    return campaignResult;
  }

  /**
   * Atualiza estratégia de lance de uma campanha existente. Para
   * TARGET_CPA/TARGET_ROAS, exige o valor — sem isso o Google rejeita.
   *
   * NÃO popula bidding_strategy_resource_name (estratégia portfolio
   * compartilhada): apenas a versão "standard" embutida na campanha.
   *
   * Fix 2026-05-17 — TENTATIVA 7:
   * Ver `feedback_google_ads_sdk_fieldmask.md` pra cadeia completa das 6
   * tentativas anteriores que falharam em prod com sintomas distintos.
   *
   * Tentativa 6 (0c2ed08) com mask=["bidding_strategy_type"] retornou
   * `INVALID_ARGUMENT: Request contains an invalid argument.` sem
   * partial_failure_error — erro request-level. O bypass agora decoda
   * o GoogleAdsFailure trailer pra obter o detalhe estruturado (ver
   * `decodeGoogleAdsFailureFromMetadata` em google-ads-client.service.ts).
   *
   * Hipotese desta tentativa (workaround documentado em
   * googleads/google-ads-java#344): mask deve conter AMBOS
   *   - `bidding_strategy_type`           (signal de "trocar oneof")
   *   - `<oneof>.<subfield>`              (qual subfield popular)
   *
   * Body deve conter:
   *   - resource_name
   *   - bidding_strategy_type enum
   *   - oneof message com o subfield populado (mesmo que default 0)
   *
   * Esse eh o padrao confirmado funcionar em Java pra MANUAL_CPC com
   * enhanced_cpc_enabled=false (issue #344). Por simetria estrutural,
   * deveria funcionar pras outras estrategias com oneof "vazio".
   */
  private async updateBiddingStrategy(
    p: UpdateBiddingStrategyPayload,
  ): Promise<MutateResult> {
    const op: any = { resource_name: p.campaignResourceName };

    // (1) Enum de bidding_strategy_type no body
    const enumMap: Record<string, number> = {
      MAXIMIZE_CONVERSIONS: enums.BiddingStrategyType.MAXIMIZE_CONVERSIONS,
      MAXIMIZE_CONVERSION_VALUE: enums.BiddingStrategyType.MAXIMIZE_CONVERSION_VALUE,
      TARGET_CPA: enums.BiddingStrategyType.TARGET_CPA,
      TARGET_ROAS: enums.BiddingStrategyType.TARGET_ROAS,
      MAXIMIZE_CLICKS: enums.BiddingStrategyType.TARGET_SPEND,
      MANUAL_CPC: enums.BiddingStrategyType.MANUAL_CPC,
    };
    const enumValue = enumMap[p.biddingStrategy];
    if (enumValue === undefined) {
      throw new Error(`bidding_strategy desconhecida: ${p.biddingStrategy}`);
    }
    op.bidding_strategy_type = enumValue;

    // (2) Popula oneof message com subfield (mesmo que 0 default).
    // (3) Define o subfield path que vai no mask junto com bidding_strategy_type.
    let oneofSubfieldPath: string;

    if (p.biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
      // target_cpa_micros opcional (0 = sem CPA alvo)
      op.maximize_conversions = { target_cpa_micros: 0n };
      oneofSubfieldPath = 'maximize_conversions.target_cpa_micros';
    } else if (p.biddingStrategy === 'MAXIMIZE_CONVERSION_VALUE') {
      // target_roas opcional (0 = sem ROAS alvo)
      op.maximize_conversion_value = { target_roas: 0 };
      oneofSubfieldPath = 'maximize_conversion_value.target_roas';
    } else if (p.biddingStrategy === 'TARGET_CPA') {
      if (!p.targetCpaMicros) {
        throw new Error('TARGET_CPA exige targetCpaMicros');
      }
      op.target_cpa = {
        target_cpa_micros:
          typeof p.targetCpaMicros === 'string'
            ? BigInt(p.targetCpaMicros)
            : p.targetCpaMicros,
      };
      oneofSubfieldPath = 'target_cpa.target_cpa_micros';
    } else if (p.biddingStrategy === 'TARGET_ROAS') {
      if (!p.targetRoas) {
        throw new Error('TARGET_ROAS exige targetRoas');
      }
      op.target_roas = { target_roas: p.targetRoas };
      oneofSubfieldPath = 'target_roas.target_roas';
    } else if (p.biddingStrategy === 'MAXIMIZE_CLICKS') {
      // MaximizeClicks = TargetSpend protobuf (legado de nome).
      op.target_spend = { cpc_bid_ceiling_micros: 0n };
      oneofSubfieldPath = 'target_spend.cpc_bid_ceiling_micros';
    } else {
      // MANUAL_CPC — enhanced_cpc_enabled vai no body como false (default).
      // Mesmo bug do issue #344, mesma solucao: mask precisa do subfield.
      op.manual_cpc = { enhanced_cpc_enabled: false };
      oneofSubfieldPath = 'manual_cpc.enhanced_cpc_enabled';
    }

    // (4) Mask = [bidding_strategy_type, oneof.subfield] — workaround java#344
    const result = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      updateMask: ['bidding_strategy_type', oneofSubfieldPath],
      context: {
        ...p.context,
        new_bidding_strategy: p.biddingStrategy,
      },
      operations: [op],
    });
    if (result.status === 'SUCCESS' && !p.validateOnly) {
      const googleId = this.extractIdFromResourceName(p.campaignResourceName);
      if (googleId) {
        await this.prisma.trafficCampaign.updateMany({
          where: {
            tenant_id: p.tenantId,
            account_id: p.accountId,
            google_campaign_id: googleId,
          },
          data: { bidding_strategy: p.biddingStrategy },
        });
      }
    }
    return result;
  }

  /**
   * Atualiza ad_schedule (horário de veiculação) de uma campanha. Como
   * Google Ads não tem "update" pra ad_schedule criteria, fazemos
   * SUBSTITUIÇÃO ATÔMICA: remove TODOS os existentes + cria os novos.
   *
   * Importante:
   *   - Quando newSlots é vazio: campanha volta a rodar 24/7.
   *   - Falha em qualquer passo aborta sem rollback (audit_log mostra).
   *   - Mirror local: rola o sync do worker no próximo ciclo (não
   *     mexemos em TrafficAdSchedule aqui — sync do extended faz purge
   *     se forem removidos no Google).
   */
  private async updateAdSchedule(
    p: UpdateAdSchedulePayload,
  ): Promise<MutateResult> {
    // Passo 1: remove todos os existentes
    if (p.existingResourceNames.length > 0) {
      const removeResult = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_criterion',
        operation: 'remove',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: {
          ...p.context,
          step: 'remove_existing_schedules',
          count: p.existingResourceNames.length,
        },
        operations: p.existingResourceNames,
      });
      if (removeResult.status !== 'SUCCESS') {
        return removeResult;
      }
    }

    // Passo 2: cria novos slots (se houver)
    if (p.newSlots.length === 0) {
      // Sem slots novos = campanha 24/7. Registra um mutate vazio no
      // audit log pra ficar claro que foi intencional.
      return await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: {
          ...p.context,
          step: 'no_slots_24_7',
          note: 'Campanha volta a rodar 24/7 (todos os schedules removidos).',
        },
        operations: [],
      });
    }

    const minuteEnumKey = (m: number): keyof typeof enums.MinuteOfHour => {
      if (m === 15) return 'FIFTEEN';
      if (m === 30) return 'THIRTY';
      if (m === 45) return 'FORTY_FIVE';
      return 'ZERO';
    };

    const operations = p.newSlots.map((slot) => {
      const op: any = {
        campaign: `customers/${p.customerId}/campaigns/${p.googleCampaignId}`,
        ad_schedule: {
          day_of_week: enums.DayOfWeek[slot.dayOfWeek],
          start_hour: slot.startHour,
          start_minute: enums.MinuteOfHour[minuteEnumKey(slot.startMinute)],
          // end_hour 24 = TWENTY_FOUR no enum do Google
          end_hour: slot.endHour,
          end_minute: enums.MinuteOfHour[minuteEnumKey(slot.endMinute)],
        },
      };
      if (
        slot.bidModifier !== null &&
        slot.bidModifier !== undefined &&
        slot.bidModifier > 0
      ) {
        op.bid_modifier = slot.bidModifier;
      }
      return op;
    });

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_criterion',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        step: 'create_new_schedules',
        slot_count: p.newSlots.length,
      },
      operations,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 1 backlog (2026-05-17) — Conversion Actions, Ad Groups, RSAs
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Cria ConversionAction nova. Necessita name + category + type minimos;
   * outros campos opcionais com defaults sensatos do lado do Google.
   */
  private async createConversionAction(
    p: CreateConversionActionPayload,
  ): Promise<MutateResult> {
    const op: any = {
      name: p.name,
      category: this.mapConversionCategory(p.category),
      type: this.mapConversionType(p.type),
      status: enums.ConversionActionStatus.ENABLED,
      include_in_conversions_metric: p.includeInConversions ?? true,
    };
    if (p.countingType) {
      op.counting_type =
        p.countingType === 'ONE_PER_CLICK'
          ? enums.ConversionActionCountingType.ONE_PER_CLICK
          : enums.ConversionActionCountingType.MANY_PER_CLICK;
    }
    if (p.clickThroughLookbackDays) {
      op.click_through_lookback_window_days = p.clickThroughLookbackDays;
    }
    if (p.viewThroughLookbackDays) {
      op.view_through_lookback_window_days = p.viewThroughLookbackDays;
    }
    if (p.defaultValueMicros) {
      op.value_settings = {
        default_value_micros:
          typeof p.defaultValueMicros === 'string'
            ? BigInt(p.defaultValueMicros)
            : p.defaultValueMicros,
        always_use_default_value: false,
      };
    }
    if (
      p.phoneCallDurationSeconds != null &&
      p.phoneCallDurationSeconds > 0
    ) {
      // Phone call duration eh sub-objeto especifico de PHONE_CALL_LEAD type
      op.phone_call_duration_seconds = p.phoneCallDurationSeconds;
    }

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'conversion_action',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [op],
    });
  }

  /**
   * Atualiza ConversionAction. Patch parcial — auto-mask do SDK gera mask
   * baseado em quais campos vem populados.
   */
  private async updateConversionAction(
    p: UpdateConversionActionPayload,
  ): Promise<MutateResult> {
    const op: any = { resource_name: p.conversionActionResourceName };
    if (p.patch.name !== undefined) op.name = p.patch.name;
    if (p.patch.include_in_conversions !== undefined) {
      op.include_in_conversions_metric = p.patch.include_in_conversions;
    }
    if (p.patch.primary_for_goal !== undefined) {
      op.primary_for_goal = p.patch.primary_for_goal;
    }
    if (p.patch.counting_type !== undefined) {
      op.counting_type =
        p.patch.counting_type === 'ONE_PER_CLICK'
          ? enums.ConversionActionCountingType.ONE_PER_CLICK
          : enums.ConversionActionCountingType.MANY_PER_CLICK;
    }
    if (p.patch.click_through_lookback_days !== undefined) {
      op.click_through_lookback_window_days = p.patch.click_through_lookback_days;
    }
    if (p.patch.view_through_lookback_days !== undefined) {
      op.view_through_lookback_window_days = p.patch.view_through_lookback_days;
    }
    if (
      p.patch.default_value_micros !== undefined ||
      p.patch.always_use_default_value !== undefined
    ) {
      op.value_settings = {
        ...(p.patch.default_value_micros !== undefined && {
          default_value_micros:
            typeof p.patch.default_value_micros === 'string'
              ? BigInt(p.patch.default_value_micros)
              : p.patch.default_value_micros ?? BigInt(0),
        }),
        ...(p.patch.always_use_default_value !== undefined && {
          always_use_default_value: p.patch.always_use_default_value,
        }),
      };
    }
    if (p.patch.attribution_model !== undefined) {
      // Enum names do SDK seguem padrao Google: GOOGLE_ADS_LAST_CLICK +
      // GOOGLE_SEARCH_ATTRIBUTION_* pros outros.
      const map: Record<string, number> = {
        LAST_CLICK: enums.AttributionModel.GOOGLE_ADS_LAST_CLICK,
        DATA_DRIVEN: enums.AttributionModel.GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN,
        FIRST_CLICK: enums.AttributionModel.GOOGLE_SEARCH_ATTRIBUTION_FIRST_CLICK,
        LINEAR: enums.AttributionModel.GOOGLE_SEARCH_ATTRIBUTION_LINEAR,
        TIME_DECAY: enums.AttributionModel.GOOGLE_SEARCH_ATTRIBUTION_TIME_DECAY,
        POSITION_BASED:
          enums.AttributionModel.GOOGLE_SEARCH_ATTRIBUTION_POSITION_BASED,
      };
      const m = map[p.patch.attribution_model];
      if (m !== undefined) {
        op.attribution_model_settings = { attribution_model: m };
      }
    }
    if (p.patch.status !== undefined) {
      op.status =
        p.patch.status === 'ENABLED'
          ? enums.ConversionActionStatus.ENABLED
          : enums.ConversionActionStatus.HIDDEN;
    }

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'conversion_action',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [op],
    });
  }

  /**
   * Remove ConversionAction (soft-delete, status=REMOVED).
   */
  private async removeConversionAction(
    p: RemoveConversionActionPayload,
  ): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'conversion_action',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          resource_name: p.conversionActionResourceName,
          status: enums.ConversionActionStatus.REMOVED,
        },
      ],
    });
  }

  /**
   * Habilita Enhanced Conversions for Leads no customer. Modo GOOGLE_TAG /
   * BOTH muta a flag `enhanced_conversions_for_leads_enabled` no
   * conversion_tracking_setting. Modo API tambem liga toggle local
   * (TrafficSettings.enhanced_conv_for_leads_upload_enabled) — feito no
   * service layer antes do enqueue. Aqui no processor so cuidamos da flag
   * remota via CustomerService.mutate.
   *
   * NB: o Google docs notam que Enhanced Conv eh auto-enabled quando comeca
   * a receber userIdentifiers, mas setar a flag explicitamente garante o
   * comportamento e evita drift se admin desabilitar via UI.
   */
  private async enableEnhancedConversions(
    p: EnableEnhancedConversionsPayload,
  ): Promise<MutateResult> {
    if (p.mode === 'API') {
      // Modo API puro nao precisa de mutate remoto — flag local controla
      // o cron de upload. Retorna SUCCESS noop.
      return {
        logId: 'noop-api-only',
        status: 'SUCCESS',
        resourceNames: [`customers/${p.customerId}`],
        oabViolations: [],
        durationMs: 0,
      };
    }

    // GOOGLE_TAG ou BOTH — muta flag no customer
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'customer' as any, // tipo nao listado em MutateResourceType ainda — passamos via cast
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: { ...p.context, mode: p.mode },
      operations: [
        {
          resource_name: `customers/${p.customerId}`,
          conversion_tracking_setting: {
            enhanced_conversions_for_leads_enabled: true,
          },
        },
      ],
    });
  }

  /**
   * Cria AdGroup novo dentro de uma campanha. cpc_bid_micros e target_cpa
   * sao opcionais — Google decide defaults baseado na bidding strategy
   * da campanha.
   */
  private async createAdGroup(p: CreateAdGroupPayload): Promise<MutateResult> {
    const op: any = {
      campaign: p.campaignResourceName,
      name: p.name,
      status:
        p.status === 'ENABLED'
          ? enums.AdGroupStatus.ENABLED
          : enums.AdGroupStatus.PAUSED,
      type:
        p.type === 'SEARCH_DYNAMIC_ADS'
          ? enums.AdGroupType.SEARCH_DYNAMIC_ADS
          : p.type === 'DISPLAY_STANDARD'
            ? enums.AdGroupType.DISPLAY_STANDARD
            : enums.AdGroupType.SEARCH_STANDARD,
    };
    if (p.cpcBidMicros) {
      op.cpc_bid_micros =
        typeof p.cpcBidMicros === 'string'
          ? BigInt(p.cpcBidMicros)
          : p.cpcBidMicros;
    }
    if (p.targetCpaMicros) {
      op.target_cpa_micros =
        typeof p.targetCpaMicros === 'string'
          ? BigInt(p.targetCpaMicros)
          : p.targetCpaMicros;
    }
    if (p.targetRoas != null) {
      op.target_roas = p.targetRoas;
    }

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [op],
    });
  }

  /**
   * Atualiza AdGroup. Patch parcial.
   */
  private async updateAdGroup(p: UpdateAdGroupPayload): Promise<MutateResult> {
    const op: any = { resource_name: p.adGroupResourceName };
    if (p.patch.name !== undefined) op.name = p.patch.name;
    if (p.patch.status !== undefined) {
      op.status =
        p.patch.status === 'ENABLED'
          ? enums.AdGroupStatus.ENABLED
          : enums.AdGroupStatus.PAUSED;
    }
    if (p.patch.cpc_bid_micros !== undefined) {
      op.cpc_bid_micros =
        typeof p.patch.cpc_bid_micros === 'string'
          ? BigInt(p.patch.cpc_bid_micros)
          : p.patch.cpc_bid_micros;
    }
    if (p.patch.target_cpa_micros !== undefined) {
      op.target_cpa_micros =
        typeof p.patch.target_cpa_micros === 'string'
          ? BigInt(p.patch.target_cpa_micros)
          : p.patch.target_cpa_micros;
    }
    if (p.patch.target_roas !== undefined) {
      op.target_roas = p.patch.target_roas;
    }
    if (p.patch.ad_rotation_mode !== undefined) {
      op.ad_rotation_mode =
        p.patch.ad_rotation_mode === 'OPTIMIZE'
          ? enums.AdGroupAdRotationMode.OPTIMIZE
          : enums.AdGroupAdRotationMode.ROTATE_FOREVER;
    }

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [op],
    });
  }

  /**
   * Atualiza RSA via padrao "substituir": cria novo + remove antigo.
   * Atomico do ponto de vista do CRM (mesmo job, mesmo audit log).
   *
   * Em dry-run, valida apenas o novo (criacao do antigo nao acontece).
   */
  private async updateRsa(p: UpdateRsaPayload): Promise<MutateResult> {
    // Passo 1: cria novo RSA
    const createResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_ad',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: { ...p.context, step: 'create_new_rsa' },
      operations: [
        {
          ad_group: p.adGroupResourceName,
          status: enums.AdGroupAdStatus.ENABLED,
          ad: {
            responsive_search_ad: {
              headlines: p.newAd.headlines.map((h) => ({ text: h })),
              descriptions: p.newAd.descriptions.map((d) => ({ text: d })),
            },
            final_urls: p.newAd.final_url ? [p.newAd.final_url] : [],
          },
        },
      ],
      adContent: p.newAd,
    });

    if (createResult.status !== 'SUCCESS') {
      return createResult;
    }

    // Em dry-run, nao remove o antigo (validamos apenas o novo)
    if (p.validateOnly) {
      return createResult;
    }

    // Passo 2: remove antigo (status=REMOVED)
    await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_ad',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: false,
      context: { ...p.context, step: 'remove_old_rsa' },
      operations: [
        {
          resource_name: p.oldAdGroupAdResourceName,
          status: enums.AdGroupAdStatus.REMOVED,
        },
      ],
    });

    return createResult;
  }

  /**
   * Remove um ad individual (soft-delete, status=REMOVED).
   */
  private async removeAd(p: RemoveAdPayload): Promise<MutateResult> {
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
          status: enums.AdGroupAdStatus.REMOVED,
        },
      ],
    });
  }

  /**
   * Cria Call Asset + anexa via CustomerAsset / CampaignAsset / AdGroupAsset.
   *
   * Pipeline:
   *   1. Cria Asset (type=CALL com phone_number + country_code) → pega resource_name
   *   2. Cria associacao no nivel pedido (CustomerAsset / CampaignAsset / AdGroupAsset)
   *      com field_type=CALL
   *
   * Em dry-run, valida so o passo 1 (associacao nao roda).
   */
  private async attachCallAsset(
    p: AttachCallAssetPayload,
  ): Promise<MutateResult> {
    // Passo 1: cria Asset
    const assetResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'asset',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: { ...p.context, step: 'create_call_asset' },
      operations: [
        {
          call_asset: {
            country_code: p.countryCode || 'BR',
            phone_number: p.phoneNumber,
            call_conversion_reporting_state: p.callTracked
              ? enums.CallConversionReportingState.USE_RESOURCE_LEVEL_CALL_CONVERSION_ACTION
              : enums.CallConversionReportingState.DISABLED,
          },
        },
      ],
    });
    if (
      assetResult.status !== 'SUCCESS' ||
      !assetResult.resourceNames?.[0] ||
      p.validateOnly
    ) {
      return assetResult;
    }
    const assetResourceName = assetResult.resourceNames[0];

    // Passo 2: cria associacao no nivel certo
    if (p.level === 'CAMPAIGN' && p.campaignResourceName) {
      return await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_criterion' as any,
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: false,
        context: {
          ...p.context,
          step: 'attach_to_campaign',
          asset_resource_name: assetResourceName,
        },
        operations: [
          {
            campaign: p.campaignResourceName,
            asset: assetResourceName,
            field_type: enums.AssetFieldType.CALL,
          },
        ],
      });
    }

    if (p.level === 'AD_GROUP' && p.adGroupResourceName) {
      return await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'ad_group_criterion' as any,
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: false,
        context: {
          ...p.context,
          step: 'attach_to_ad_group',
          asset_resource_name: assetResourceName,
        },
        operations: [
          {
            ad_group: p.adGroupResourceName,
            asset: assetResourceName,
            field_type: enums.AssetFieldType.CALL,
          },
        ],
      });
    }

    // Level ACCOUNT — usa customer_asset
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'asset' as any, // re-use; backend mapa o servico certo
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: false,
      context: {
        ...p.context,
        step: 'attach_to_account',
        asset_resource_name: assetResourceName,
        attachment_type: 'customer_asset',
      },
      operations: [
        {
          customer: `customers/${p.customerId}`,
          asset: assetResourceName,
          field_type: enums.AssetFieldType.CALL,
        },
      ],
    });
  }

  /**
   * Mapeia categoria PT-BR → enum Google.
   */
  private mapConversionCategory(category: string): number {
    const map: Record<string, number> = {
      SUBMIT_LEAD_FORM: enums.ConversionActionCategory.SUBMIT_LEAD_FORM,
      CONTACT: enums.ConversionActionCategory.CONTACT,
      PHONE_CALL_LEAD: enums.ConversionActionCategory.PHONE_CALL_LEAD,
      SIGNUP: enums.ConversionActionCategory.SIGNUP,
      DOWNLOAD: enums.ConversionActionCategory.DOWNLOAD,
      PAGE_VIEW: enums.ConversionActionCategory.PAGE_VIEW,
      PURCHASE: enums.ConversionActionCategory.PURCHASE,
      ADD_TO_CART: enums.ConversionActionCategory.ADD_TO_CART,
      BEGIN_CHECKOUT: enums.ConversionActionCategory.BEGIN_CHECKOUT,
      BOOK_APPOINTMENT: enums.ConversionActionCategory.BOOK_APPOINTMENT,
      REQUEST_QUOTE: enums.ConversionActionCategory.REQUEST_QUOTE,
      GET_DIRECTIONS: enums.ConversionActionCategory.GET_DIRECTIONS,
      OUTBOUND_CLICK: enums.ConversionActionCategory.OUTBOUND_CLICK,
      ENGAGEMENT: enums.ConversionActionCategory.ENGAGEMENT,
      STORE_VISIT: enums.ConversionActionCategory.STORE_VISIT,
      STORE_SALE: enums.ConversionActionCategory.STORE_SALE,
      QUALIFIED_LEAD: enums.ConversionActionCategory.QUALIFIED_LEAD,
      CONVERTED_LEAD: enums.ConversionActionCategory.CONVERTED_LEAD,
      OTHER: enums.ConversionActionCategory.DEFAULT,
    };
    const m = map[category];
    if (m === undefined) {
      throw new Error(`Categoria de conversion action desconhecida: ${category}`);
    }
    return m;
  }

  /**
   * Mapeia type PT-BR → enum Google.
   */
  private mapConversionType(type: string): number {
    const map: Record<string, number> = {
      WEBPAGE: enums.ConversionActionType.WEBPAGE,
      AD_CALL: enums.ConversionActionType.AD_CALL,
      CLICK_TO_CALL: enums.ConversionActionType.CLICK_TO_CALL,
      WEBSITE_CALL: enums.ConversionActionType.WEBSITE_CALL,
      UPLOAD_CALLS: enums.ConversionActionType.UPLOAD_CALLS,
      UPLOAD_CLICKS: enums.ConversionActionType.UPLOAD_CLICKS,
      APP_INSTALL: enums.ConversionActionType.GOOGLE_PLAY_DOWNLOAD,
      IMPORT: enums.ConversionActionType.UPLOAD_CLICKS,
      GOOGLE_HOSTED: enums.ConversionActionType.WEBPAGE,
    };
    const m = map[type];
    if (m === undefined) {
      throw new Error(`Type de conversion action desconhecido: ${type}`);
    }
    return m;
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
   * Mirror local — cria TrafficCampaign + TrafficCampaignBudget no cache
   * pra UI mostrar a nova campanha sem aguardar próximo sync diário.
   * Async fire-and-forget — sync diário re-popula com os IDs reais e
   * outros campos.
   */
  private async mirrorNewCampaign(
    tenantId: string,
    accountId: string,
    campaignResourceName: string,
    budgetResourceName: string,
    name: string,
    dailyBudgetMicros: bigint,
    biddingStrategy: string,
    initialStatus: 'ENABLED' | 'PAUSED',
  ): Promise<void> {
    try {
      const googleCampaignId = this.extractIdFromResourceName(
        campaignResourceName,
      );
      const googleBudgetId = this.extractIdFromResourceName(budgetResourceName);
      if (!googleCampaignId || !googleBudgetId) return;

      // Cria TrafficCampaignBudget primeiro (FK não estritamente
      // necessária, campos do schema permitem)
      await this.prisma.trafficCampaignBudget.upsert({
        where: {
          account_id_google_budget_id: {
            account_id: accountId,
            google_budget_id: googleBudgetId,
          },
        },
        update: {
          amount_micros: dailyBudgetMicros,
          last_seen_at: new Date(),
        },
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          google_budget_id: googleBudgetId,
          name: `Budget — ${name}`,
          amount_micros: dailyBudgetMicros,
          delivery_method: 'STANDARD',
          is_shared: false,
          reference_count: 1,
          status: 'ENABLED',
        },
      });

      await this.prisma.trafficCampaign.upsert({
        where: {
          account_id_google_campaign_id: {
            account_id: accountId,
            google_campaign_id: googleCampaignId,
          },
        },
        update: {
          name,
          status: initialStatus,
          channel_type: 'SEARCH',
          daily_budget_micros: dailyBudgetMicros,
          budget_resource_name: budgetResourceName,
          bidding_strategy: biddingStrategy,
          last_seen_at: new Date(),
        },
        create: {
          tenant_id: tenantId,
          account_id: accountId,
          google_campaign_id: googleCampaignId,
          name,
          status: initialStatus,
          channel_type: 'SEARCH',
          daily_budget_micros: dailyBudgetMicros,
          budget_resource_name: budgetResourceName,
          bidding_strategy: biddingStrategy,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[mutate] mirror nova campanha falhou: ${e.message}`);
    }
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
