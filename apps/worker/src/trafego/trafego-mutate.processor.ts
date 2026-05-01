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
  CREATE_SEARCH_CAMPAIGN: 'trafego-mutate-create-search-campaign',
  UPDATE_BIDDING_STRATEGY: 'trafego-mutate-update-bidding-strategy',
  UPDATE_AD_SCHEDULE: 'trafego-mutate-update-ad-schedule',
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
   */
  private async updateBiddingStrategy(
    p: UpdateBiddingStrategyPayload,
  ): Promise<MutateResult> {
    const op: any = { resource_name: p.campaignResourceName };

    // Cada bidding strategy tem campo dedicado — Google espera APENAS um
    // populado por campanha. Limpamos os outros via clearedFields no proto
    // (o SDK trata via update_mask automaticamente).
    if (p.biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
      op.maximize_conversions = {};
    } else if (p.biddingStrategy === 'MAXIMIZE_CLICKS') {
      op.target_spend = {};
    } else if (p.biddingStrategy === 'MANUAL_CPC') {
      op.manual_cpc = { enhanced_cpc_enabled: false };
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
    } else if (p.biddingStrategy === 'TARGET_ROAS') {
      if (!p.targetRoas) {
        throw new Error('TARGET_ROAS exige targetRoas');
      }
      op.target_roas = { target_roas: p.targetRoas };
    } else if (p.biddingStrategy === 'MAXIMIZE_CONVERSION_VALUE') {
      op.maximize_conversion_value = {};
    }

    const result = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign',
      operation: 'update',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
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
