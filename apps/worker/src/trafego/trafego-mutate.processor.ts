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
import { GoogleAdsClientService } from './google-ads-client.service';
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
  // Sprint 2 backlog (2026-05-17) — Extensions/Assets
  CREATE_EXTENSION: 'trafego-mutate-create-extension',
  ATTACH_EXTENSION: 'trafego-mutate-attach-extension',
  DETACH_EXTENSION: 'trafego-mutate-detach-extension',
  REMOVE_EXTENSION: 'trafego-mutate-remove-extension',
  // Sprint 3 backlog (2026-05-17) — Targeting + Bulk
  UPDATE_GEO_TARGETS: 'trafego-mutate-update-geo-targets',
  UPDATE_LANGUAGE_TARGETS: 'trafego-mutate-update-language-targets',
  UPDATE_DEVICE_TARGETING: 'trafego-mutate-update-device-targeting',
  BULK_ADD_NEGATIVES: 'trafego-mutate-bulk-add-negatives',
  BULK_UPDATE_STATUS: 'trafego-mutate-bulk-update-status',
  // Sprint 4 backlog (2026-05-17) — Tier P2
  CREATE_PMAX_CAMPAIGN: 'trafego-mutate-create-pmax-campaign',
  // Sprint 3.1 backlog (2026-05-17) — Shared library + Location bid
  CREATE_SHARED_NEGATIVE_LIST: 'trafego-mutate-create-shared-negative-list',
  ATTACH_SHARED_NEGATIVE_LIST: 'trafego-mutate-attach-shared-negative-list',
  UPDATE_LOCATION_BID_MODIFIERS: 'trafego-mutate-update-location-bid-modifiers',
  // Sprint 4.1 backlog (2026-05-17) — PMax asset groups + Experiments
  CREATE_PMAX_ASSET_GROUP: 'trafego-mutate-create-pmax-asset-group',
  ADD_ASSETS_TO_PMAX_ASSET_GROUP:
    'trafego-mutate-add-assets-to-pmax-asset-group',
  CREATE_EXPERIMENT: 'trafego-mutate-create-experiment',
  // Sprint 4.2 backlog (2026-05-17) — Experiments lifecycle
  ADD_TREATMENT_ARM: 'trafego-mutate-add-treatment-arm',
  SCHEDULE_EXPERIMENT: 'trafego-mutate-schedule-experiment',
  END_EXPERIMENT: 'trafego-mutate-end-experiment',
  PROMOTE_EXPERIMENT: 'trafego-mutate-promote-experiment',
  GRADUATE_EXPERIMENT: 'trafego-mutate-graduate-experiment',
  // Bug-fix batch 2026-05-17 — cleanup asset orfaos
  REMOVE_ASSET: 'trafego-mutate-remove-asset',
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
// Sprint 3.1 backlog — Shared library + Location bid
// ═══════════════════════════════════════════════════════════════════════════

export type CreateSharedNegativeListPayload = BaseMutatePayload & {
  customerId: string;
  name: string;
  keywords: string[];
  matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  /** resource_names das campanhas a anexar (opcional). */
  attachCampaignResourceNames: string[];
};

export type AttachSharedNegativeListPayload = BaseMutatePayload & {
  sharedSetResourceName: string;
  campaignResourceNames: string[];
};

export type UpdateLocationBidModifiersPayload = BaseMutatePayload & {
  campaignResourceName: string;
  modifiers: Array<{
    geoTargetConstantResourceName: string;
    bidModifier: number;
  }>;
};

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 4 backlog — Tier P2
// ═══════════════════════════════════════════════════════════════════════════

export type CreatePmaxCampaignPayload = BaseMutatePayload & {
  customerId: string;
  name: string;
  dailyBudgetMicros: bigint | string;
  biddingStrategy: 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CONVERSION_VALUE';
  targetCpaMicros?: bigint | string | null;
  targetRoas?: number | null;
  finalUrl: string;
  geoTargetIds: string[];
  languageIds: string[];
  initialStatus?: 'ENABLED' | 'PAUSED';
};

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 4.1 backlog — PMax asset groups + Experiments
// ═══════════════════════════════════════════════════════════════════════════

export type CreatePmaxAssetGroupPayload = BaseMutatePayload & {
  customerId: string;
  /** resource_name customers/X/campaigns/Y — PMax campaign destino. */
  campaignResourceName: string;
  name: string;
  finalUrls: string[];
  finalMobileUrls?: string[];
  path1?: string;
  path2?: string;
  status?: 'ENABLED' | 'PAUSED';
};

export type AddAssetsToPmaxAssetGroupPayload = BaseMutatePayload & {
  customerId: string;
  /** resource_name customers/X/assetGroups/Y. */
  assetGroupResourceName: string;
  assets: Array<{
    source: 'text' | 'existing' | 'youtube';
    fieldType: string; // mapeado pra enums.AssetFieldType
    payload: Record<string, any>;
  }>;
};

export type CreateExperimentPayload = BaseMutatePayload & {
  customerId: string;
  /** resource_name customers/X/campaigns/Y — control arm. */
  baseCampaignResourceName: string;
  name: string;
  type: string; // SEARCH_CUSTOM, DISPLAY_CUSTOM, etc.
  description?: string;
  suffix?: string;
  goals?: Array<{
    metric: string; // ExperimentMetric enum name
    direction: string; // ExperimentMetricDirection enum name
  }>;
};

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 4.2 backlog — Experiments lifecycle
// ═══════════════════════════════════════════════════════════════════════════

export type AddTreatmentArmPayload = BaseMutatePayload & {
  customerId: string;
  experimentResourceName: string;
  name: string;
  /** resource_name customers/X/campaigns/Y do trial campaign (draft/clone). */
  trialCampaignResourceName: string;
  trafficSplit: number;
};

export type ScheduleExperimentPayload = BaseMutatePayload & {
  customerId: string;
  experimentResourceName: string;
};

export type EndExperimentPayload = BaseMutatePayload & {
  customerId: string;
  experimentResourceName: string;
};

export type PromoteExperimentPayload = BaseMutatePayload & {
  customerId: string;
  experimentResourceName: string;
};

export type GraduateExperimentPayload = BaseMutatePayload & {
  customerId: string;
  experimentResourceName: string;
  mappings: Array<{
    experimentCampaignResourceName: string;
    campaignBudgetResourceName: string;
  }>;
};

// ═══════════════════════════════════════════════════════════════════════════
// Bug-fix batch 2026-05-17 — cleanup asset orfaos
// ═══════════════════════════════════════════════════════════════════════════

export type RemoveAssetPayload = BaseMutatePayload & {
  /** resource_name customers/X/assets/Y */
  assetResourceName: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 3 backlog — Targeting + Bulk
// ═══════════════════════════════════════════════════════════════════════════

export type UpdateGeoTargetsPayload = BaseMutatePayload & {
  campaignResourceName: string;
  /** geo_target_constant resource_names a adicionar (ex: geoTargetConstants/1031620). */
  addResourceNames: string[];
  /** campaign_criterion resource_names a remover (ex: customers/X/campaignCriteria/Y~Z). */
  removeResourceNames: string[];
  negative?: boolean;
};

export type UpdateLanguageTargetsPayload = BaseMutatePayload & {
  campaignResourceName: string;
  addResourceNames: string[]; // languageConstants/{id}
  removeResourceNames: string[];
};

export type UpdateDeviceTargetingPayload = BaseMutatePayload & {
  campaignResourceName: string;
  mobileModifier?: number | null;
  desktopModifier?: number | null;
  tabletModifier?: number | null;
};

export type BulkAddNegativesPayload = BaseMutatePayload & {
  /** Pra cada target, scope eh campaign OU ad_group resource_name. */
  targets: Array<{
    scope: 'CAMPAIGN' | 'AD_GROUP';
    resourceName: string;
  }>;
  keywords: string[];
  matchType: 'EXACT' | 'PHRASE' | 'BROAD';
};

export type BulkUpdateStatusPayload = BaseMutatePayload & {
  /** Tuplas (resource_type, resource_name) — campaign OR ad_group. */
  targets: Array<{
    resourceType: 'campaign' | 'ad_group';
    resourceName: string;
  }>;
  status: 'ENABLED' | 'PAUSED';
};

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 2 backlog — Extensions / Assets Payload types
// ═══════════════════════════════════════════════════════════════════════════

export type CreateExtensionPayload = BaseMutatePayload & {
  customerId: string;
  type:
    | 'SITELINK'
    | 'CALLOUT'
    | 'STRUCTURED_SNIPPET'
    | 'CALL'
    | 'LOCATION'
    | 'PRICE'
    | 'PROMOTION'
    | 'LEAD_FORM';
  data: Record<string, any>;
  attachLevel?: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
  attachCampaignResourceName?: string;
  attachAdGroupResourceName?: string;
};

export type AttachExtensionPayload = BaseMutatePayload & {
  customerId: string;
  assetResourceName: string;
  level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
  campaignResourceName?: string;
  adGroupResourceName?: string;
  fieldType: string; // Resolved from asset.type — passed by service
};

export type DetachExtensionPayload = BaseMutatePayload & {
  /** resource_name do CustomerAsset/CampaignAsset/AdGroupAsset (NAO do asset em si). */
  assetLinkResourceName: string;
  level: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';
};

export type RemoveExtensionPayload = BaseMutatePayload & {
  /** resource_name do Asset (nao do link). Soft-delete via status=REMOVED. */
  assetResourceName: string;
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
    // Sprint 4.2 — usado pelos RPCs de experiment lifecycle (schedule/end/
    // promote/graduate) que nao sao CRUD padrao.
    private clientSvc: GoogleAdsClientService,
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
      case MUTATE_JOBS.CREATE_EXTENSION:
        return await this.createExtension(job.data);
      case MUTATE_JOBS.ATTACH_EXTENSION:
        return await this.attachExtension(job.data);
      case MUTATE_JOBS.DETACH_EXTENSION:
        return await this.detachExtension(job.data);
      case MUTATE_JOBS.REMOVE_EXTENSION:
        return await this.removeExtension(job.data);
      case MUTATE_JOBS.UPDATE_GEO_TARGETS:
        return await this.updateGeoTargets(job.data);
      case MUTATE_JOBS.UPDATE_LANGUAGE_TARGETS:
        return await this.updateLanguageTargets(job.data);
      case MUTATE_JOBS.UPDATE_DEVICE_TARGETING:
        return await this.updateDeviceTargeting(job.data);
      case MUTATE_JOBS.BULK_ADD_NEGATIVES:
        return await this.bulkAddNegatives(job.data);
      case MUTATE_JOBS.BULK_UPDATE_STATUS:
        return await this.bulkUpdateStatus(job.data);
      case MUTATE_JOBS.CREATE_PMAX_CAMPAIGN:
        return await this.createPmaxCampaign(job.data);
      case MUTATE_JOBS.CREATE_SHARED_NEGATIVE_LIST:
        return await this.createSharedNegativeList(job.data);
      case MUTATE_JOBS.ATTACH_SHARED_NEGATIVE_LIST:
        return await this.attachSharedNegativeList(job.data);
      case MUTATE_JOBS.UPDATE_LOCATION_BID_MODIFIERS:
        return await this.updateLocationBidModifiers(job.data);
      case MUTATE_JOBS.CREATE_PMAX_ASSET_GROUP:
        return await this.createPmaxAssetGroup(job.data);
      case MUTATE_JOBS.ADD_ASSETS_TO_PMAX_ASSET_GROUP:
        return await this.addAssetsToPmaxAssetGroup(job.data);
      case MUTATE_JOBS.CREATE_EXPERIMENT:
        return await this.createExperiment(job.data);
      // Sprint 4.2 — Experiments lifecycle
      case MUTATE_JOBS.ADD_TREATMENT_ARM:
        return await this.addTreatmentArm(job.data);
      case MUTATE_JOBS.SCHEDULE_EXPERIMENT:
        return await this.scheduleExperiment(job.data);
      case MUTATE_JOBS.END_EXPERIMENT:
        return await this.endExperiment(job.data);
      case MUTATE_JOBS.PROMOTE_EXPERIMENT:
        return await this.promoteExperiment(job.data);
      case MUTATE_JOBS.GRADUATE_EXPERIMENT:
        return await this.graduateExperiment(job.data);
      case MUTATE_JOBS.REMOVE_ASSET:
        return await this.removeAsset(job.data);
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
   * Remove (soft-delete) uma campanha.
   *
   * Fix 2026-05-17 (bug reportado pelo gestor de trafego): Google Ads
   * REJEITA `update` com `status=REMOVED` (INVALID_ENUM_VALUE — "Enum
   * value 'REMOVED' cannot be used"). O caminho correto eh a operacao
   * `remove` (passa apenas o resource_name como string), nao `update`.
   *
   * Spec original do gestor pedia UPDATE+status pra leverage o audit log
   * mostrar `{status: REMOVED}`, mas Google nao aceita esse padrao em
   * remocao via API. A operacao REMOVE retorna SUCCESS e atualiza o status
   * server-side equivalente.
   */
  private async removeCampaign(p: RemoveCampaignPayload): Promise<MutateResult> {
    const result = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [p.campaignResourceName],
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
   * Remove (soft-delete) um ad_group.
   *
   * Mesmo fix de removeCampaign — usa operacao REMOVE (resource_name string).
   * Cascade (ads, keywords) eh automatico no Google quando ad_group eh
   * removido.
   */
  private async removeAdGroup(p: RemoveAdGroupPayload): Promise<MutateResult> {
    const result = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [p.adGroupResourceName],
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
   * Remove ConversionAction (soft-delete).
   *
   * Fix 2026-05-17 — usar operacao REMOVE (resource_name string), nao
   * UPDATE com status=REMOVED. Google rejeita esse ultimo com
   * INVALID_ENUM_VALUE.
   */
  private async removeConversionAction(
    p: RemoveConversionActionPayload,
  ): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'conversion_action',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [p.conversionActionResourceName],
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

    // GOOGLE_TAG ou BOTH — muta flag no customer.
    //
    // Fix 2026-05-17 (BUG-A reportado pelo gestor de trafego): a chamada
    // mutate.execute({resourceType:'customer', operation:'update', ...})
    // caia no customer.customers.update do SDK Opteo, cujo auto-mask NAO
    // pega nested fields tipo conversion_tracking_setting.* — Google
    // rejeitava com "Mutate operations must have create/update/remove".
    //
    // Solucao: usar bypass mutateCustomerWithExplicitMask (espelha o
    // pattern do bidding strategy fix em 0137f49) + log manual em
    // TrafficMutateLog pra audit equivalente.
    const t0 = Date.now();
    const requestId = `enable-enh-conv-${p.customerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const log = await this.prisma.trafficMutateLog.create({
      data: {
        tenant_id: p.tenantId,
        account_id: p.accountId,
        request_id: requestId,
        resource_type: 'customer',
        operation: 'update',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        payload: [
          {
            resource_name: `customers/${p.customerId}`,
            conversion_tracking_setting: {
              enhanced_conversions_for_leads_enabled: true,
            },
          },
        ] as any,
        result: {} as any,
        status: 'PENDING',
        validate_only: !!p.validateOnly,
        context: {
          ...p.context,
          mode: p.mode,
          field: 'enhanced_conversions',
          enabled: true,
        } as any,
      },
    });

    try {
      const customer = await this.clientSvc.getCustomer(
        p.tenantId,
        p.accountId,
      );
      const result = await this.clientSvc.mutateCustomerWithExplicitMask(
        customer,
        p.customerId,
        {
          resource_name: `customers/${p.customerId}`,
          conversion_tracking_setting: {
            enhanced_conversions_for_leads_enabled: true,
          },
        },
        ['conversion_tracking_setting.enhanced_conversions_for_leads_enabled'],
        !!p.validateOnly,
      );
      const durationMs = Date.now() - t0;

      await this.prisma.trafficMutateLog.update({
        where: { id: log.id },
        data: {
          status: result.ok ? 'SUCCESS' : 'PARTIAL',
          duration_ms: durationMs,
          result: {
            ok: result.ok,
            resource_names: result.resourceNames,
            raw_snapshot: this.snapshotForLog(result.raw),
          } as any,
          error_message: result.error?.slice(0, 1500) ?? null,
        },
      });

      this.logger.log(
        `[enable-enhanced-conv] ${result.ok ? 'SUCCESS' : 'PARTIAL'} ${durationMs}ms`,
      );

      return {
        logId: log.id,
        status: result.ok ? 'SUCCESS' : 'PARTIAL',
        resourceNames: result.resourceNames,
        errorMessage: result.error ?? undefined,
        oabViolations: [],
        rawResponse: result.raw,
        durationMs,
      };
    } catch (e: any) {
      const durationMs = Date.now() - t0;
      const errorMessage = e?.message || 'enable_enhanced_conversions falhou';

      await this.prisma.trafficMutateLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          duration_ms: durationMs,
          error_message: errorMessage.slice(0, 1500),
        },
      });

      this.logger.warn(
        `[enable-enhanced-conv] FAILED ${durationMs}ms ${errorMessage}`,
      );

      return {
        logId: log.id,
        status: 'FAILED',
        resourceNames: [],
        errorMessage,
        oabViolations: [],
        durationMs,
      };
    }
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

    // Passo 2: remove antigo via operacao REMOVE (resource_name string).
    // Google rejeita UPDATE+status=REMOVED com INVALID_ENUM_VALUE.
    await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_ad',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: false,
      context: { ...p.context, step: 'remove_old_rsa' },
      operations: [p.oldAdGroupAdResourceName],
    });

    return createResult;
  }

  /**
   * Remove um ad individual (soft-delete).
   *
   * Fix 2026-05-17 — operacao REMOVE, nao UPDATE+status=REMOVED.
   */
  private async removeAd(p: RemoveAdPayload): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'ad_group_ad',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [p.adGroupAdResourceName],
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

    // Passo 2: cria associacao no nivel certo.
    //
    // Fix 2026-05-17 (BUG-C reportado pelo gestor de trafego): antes
    // estavamos usando resource_types ERRADOS (campaign_criterion,
    // ad_group_criterion, asset) pra anexar Asset. CallAsset attachment
    // usa CampaignAsset / AdGroupAsset / CustomerAsset (NAO criterion!).
    // CampaignCriterion eh pra keywords/geo/etc, nao pra asset links.
    //
    // Alem disso, agora envolvemos step 2 num try-catch com ROLLBACK
    // automatico do asset criado no step 1 — antes, se step 2 falhasse
    // o asset ficava orfao na conta (3 assets orfaos foram criados
    // antes do fix: 362094397446, 362094408834, 362094427521).
    const attachLevel = p.level;
    let attachResult: MutateResult;

    try {
      if (attachLevel === 'CAMPAIGN' && p.campaignResourceName) {
        attachResult = await this.mutate.execute({
          tenantId: p.tenantId,
          accountId: p.accountId,
          resourceType: 'campaign_asset',
          operation: 'create',
          initiator: p.initiator,
          confidence: p.confidence ?? null,
          validateOnly: false,
          context: {
            ...p.context,
            step: 'attach_to_campaign',
            asset_resource_name: assetResourceName,
            field_type: 'CALL',
          },
          operations: [
            {
              campaign: p.campaignResourceName,
              asset: assetResourceName,
              field_type: enums.AssetFieldType.CALL,
            },
          ],
        });
      } else if (attachLevel === 'AD_GROUP' && p.adGroupResourceName) {
        attachResult = await this.mutate.execute({
          tenantId: p.tenantId,
          accountId: p.accountId,
          resourceType: 'ad_group_asset',
          operation: 'create',
          initiator: p.initiator,
          confidence: p.confidence ?? null,
          validateOnly: false,
          context: {
            ...p.context,
            step: 'attach_to_ad_group',
            asset_resource_name: assetResourceName,
            field_type: 'CALL',
          },
          operations: [
            {
              ad_group: p.adGroupResourceName,
              asset: assetResourceName,
              field_type: enums.AssetFieldType.CALL,
            },
          ],
        });
      } else {
        // ACCOUNT-level → customer_asset
        attachResult = await this.mutate.execute({
          tenantId: p.tenantId,
          accountId: p.accountId,
          resourceType: 'customer_asset',
          operation: 'create',
          initiator: p.initiator,
          confidence: p.confidence ?? null,
          validateOnly: false,
          context: {
            ...p.context,
            step: 'attach_to_account',
            asset_resource_name: assetResourceName,
            field_type: 'CALL',
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
    } catch (e: any) {
      // Catch sincrono cobre erros de validacao (raros). Erros do Google
      // viram MutateResult com status FAILED/PARTIAL — tratamos abaixo.
      attachResult = {
        logId: 'attach-exception',
        status: 'FAILED',
        resourceNames: [],
        errorMessage: e?.message ?? 'erro desconhecido no attach',
        oabViolations: [],
        durationMs: 0,
      };
    }

    // Rollback transacional: se attach falhou, remove o asset orfao.
    // Best-effort — se rollback falhar, loga mas devolve o erro original
    // (o asset orfao pode ser limpo depois via traffic_remove_asset).
    if (attachResult.status === 'FAILED' || attachResult.status === 'PARTIAL') {
      this.logger.warn(
        `[attach-call-asset] step 2 falhou (status=${attachResult.status}) — fazendo rollback do asset ${assetResourceName}`,
      );
      try {
        await this.mutate.execute({
          tenantId: p.tenantId,
          accountId: p.accountId,
          resourceType: 'asset',
          operation: 'remove',
          initiator: p.initiator,
          confidence: null,
          validateOnly: false,
          context: {
            ...p.context,
            step: 'rollback_orphan_asset',
            original_request_id: assetResult.logId,
          },
          operations: [assetResourceName],
        });
        this.logger.log(
          `[attach-call-asset] rollback do asset ${assetResourceName} OK`,
        );
      } catch (rollbackErr: any) {
        this.logger.warn(
          `[attach-call-asset] rollback FALHOU pro asset ${assetResourceName}: ${rollbackErr?.message}. Asset ficou ORFAO na conta — limpe via traffic_remove_asset.`,
        );
      }
      // Adiciona contexto no errorMessage pra gestor entender que asset foi rollback
      return {
        ...attachResult,
        errorMessage:
          (attachResult.errorMessage ?? 'attach falhou') +
          ` | Rollback automatico do asset ${assetResourceName} executado.`,
      };
    }

    return attachResult;
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

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 2 backlog (2026-05-17) — Extensions / Assets
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Cria Asset via AssetService.create. Tipo definido por p.type — popula
   * sub-message correspondente (sitelink_asset, callout_asset, etc).
   * Se attachLevel fornecido, encadeia create + attach atomic.
   */
  private async createExtension(
    p: CreateExtensionPayload,
  ): Promise<MutateResult> {
    const assetOp = this.buildAssetPayload(p.type, p.data);

    const createResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'asset',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: { ...p.context, asset_type: p.type, step: 'create_asset' },
      operations: [assetOp],
    });

    // Se nao tem attach pendente, ou validate_only, ou criacao falhou → retorna
    if (
      !p.attachLevel ||
      p.validateOnly ||
      createResult.status !== 'SUCCESS' ||
      !createResult.resourceNames?.[0]
    ) {
      return createResult;
    }

    const assetResourceName = createResult.resourceNames[0];
    const fieldType = this.resolveAssetFieldType(p.type);

    return await this.attachExtension({
      ...p,
      assetResourceName,
      level: p.attachLevel,
      campaignResourceName: p.attachCampaignResourceName,
      adGroupResourceName: p.attachAdGroupResourceName,
      fieldType,
      validateOnly: false,
      context: {
        ...p.context,
        step: 'attach_after_create',
        asset_resource_name: assetResourceName,
      },
    });
  }

  /**
   * Anexa asset existente via CustomerAsset / CampaignAsset / AdGroupAsset.
   * field_type vem do tipo do asset (ja resolvido pelo caller — ver
   * resolveAssetFieldType).
   */
  private async attachExtension(
    p: AttachExtensionPayload,
  ): Promise<MutateResult> {
    if (p.level === 'CAMPAIGN' && p.campaignResourceName) {
      return await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_asset',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: p.context,
        operations: [
          {
            campaign: p.campaignResourceName,
            asset: p.assetResourceName,
            field_type: this.assetFieldTypeEnum(p.fieldType),
          },
        ],
      });
    }
    if (p.level === 'AD_GROUP' && p.adGroupResourceName) {
      return await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'ad_group_asset',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: p.context,
        operations: [
          {
            ad_group: p.adGroupResourceName,
            asset: p.assetResourceName,
            field_type: this.assetFieldTypeEnum(p.fieldType),
          },
        ],
      });
    }
    // ACCOUNT → customer_asset
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'customer_asset',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [
        {
          customer: `customers/${p.customerId}`,
          asset: p.assetResourceName,
          field_type: this.assetFieldTypeEnum(p.fieldType),
        },
      ],
    });
  }

  /**
   * Desanexa via remove no CustomerAsset/CampaignAsset/AdGroupAsset.
   * Passa o resource_name do LINK (nao do asset).
   */
  private async detachExtension(
    p: DetachExtensionPayload,
  ): Promise<MutateResult> {
    const resourceType =
      p.level === 'CAMPAIGN'
        ? 'campaign_asset'
        : p.level === 'AD_GROUP'
          ? 'ad_group_asset'
          : 'customer_asset';
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType,
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [p.assetLinkResourceName],
    });
  }

  /**
   * Remove (soft-delete) o Asset. Cascade — Google remove vinculos automatico.
   */
  private async removeExtension(
    p: RemoveExtensionPayload,
  ): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'asset',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: [p.assetResourceName],
    });
  }

  /**
   * Constroi payload do AssetService.create baseado em type + data livre.
   *
   * Cada tipo tem fields obrigatorios diferentes. Validacoes basicas aqui
   * (campos mandatorios); Google API valida o resto (tamanho max, URL
   * format, etc) e o decoder de GoogleAdsFailure surface o erro.
   */
  private buildAssetPayload(
    type: string,
    data: Record<string, any>,
  ): Record<string, any> {
    switch (type) {
      case 'SITELINK': {
        if (!data.link_text || !data.final_url) {
          throw new Error(
            'SITELINK exige data.link_text e data.final_url (string, URL).',
          );
        }
        return {
          sitelink_asset: {
            link_text: String(data.link_text).slice(0, 25),
            description1: data.description1
              ? String(data.description1).slice(0, 35)
              : undefined,
            description2: data.description2
              ? String(data.description2).slice(0, 35)
              : undefined,
          },
          final_urls: [data.final_url],
        };
      }
      case 'CALLOUT': {
        if (!data.text) {
          throw new Error('CALLOUT exige data.text (max 25 chars).');
        }
        return {
          callout_asset: { callout_text: String(data.text).slice(0, 25) },
        };
      }
      case 'STRUCTURED_SNIPPET': {
        if (!data.header || !Array.isArray(data.values) || data.values.length < 3) {
          throw new Error(
            'STRUCTURED_SNIPPET exige data.header e data.values[] (3-10 itens, max 25 chars cada).',
          );
        }
        return {
          structured_snippet_asset: {
            header: String(data.header),
            values: data.values.slice(0, 10).map((v: any) => String(v).slice(0, 25)),
          },
        };
      }
      case 'CALL': {
        if (!data.phone_number) {
          throw new Error('CALL exige data.phone_number (E.164).');
        }
        return {
          call_asset: {
            phone_number: data.phone_number,
            country_code: data.country_code || 'BR',
            call_conversion_reporting_state: data.call_tracked
              ? enums.CallConversionReportingState.USE_RESOURCE_LEVEL_CALL_CONVERSION_ACTION
              : enums.CallConversionReportingState.DISABLED,
          },
        };
      }
      case 'PRICE': {
        if (!data.type || !Array.isArray(data.items) || data.items.length === 0) {
          throw new Error(
            'PRICE exige data.type (BRANDS|EVENTS|LOCATIONS|...) e data.items[] (1+ itens).',
          );
        }
        return {
          price_asset: {
            type: data.type,
            price_qualifier: data.price_qualifier || 'UNSPECIFIED',
            language_code: data.language_code || 'pt',
            price_offerings: data.items.map((item: any) => ({
              header: item.header,
              description: item.description,
              price: {
                amount_micros: Math.round(
                  Number(item.amount_brl || 0) * 1_000_000,
                ),
                currency_code: 'BRL',
              },
              unit: item.unit || 'UNSPECIFIED',
              final_urls: item.final_url ? [item.final_url] : undefined,
            })),
          },
        };
      }
      case 'PROMOTION': {
        if (!data.promotion_target || !data.occasion) {
          throw new Error(
            'PROMOTION exige data.promotion_target (texto) e data.occasion (NEW_YEARS|MOTHERS_DAY|...).',
          );
        }
        const promo: any = {
          promotion_asset: {
            promotion_target: String(data.promotion_target).slice(0, 20),
            discount_modifier: data.discount_modifier || 'UNSPECIFIED',
            occasion: data.occasion,
            language_code: data.language_code || 'pt',
          },
          final_urls: data.final_url ? [data.final_url] : undefined,
        };
        if (data.percent_off) {
          promo.promotion_asset.percent_off = Math.round(
            Number(data.percent_off) * 1_000_000,
          );
        } else if (data.money_amount_off_brl) {
          promo.promotion_asset.money_amount_off = {
            amount_micros: Math.round(
              Number(data.money_amount_off_brl) * 1_000_000,
            ),
            currency_code: 'BRL',
          };
        } else {
          throw new Error(
            'PROMOTION exige percent_off OU money_amount_off_brl.',
          );
        }
        return promo;
      }
      case 'LOCATION': {
        // Location asset eh complexo no Google Ads — geralmente vem via
        // sync com Google Business Profile. Aqui aceitamos place_id minimo.
        if (!data.place_id) {
          throw new Error(
            'LOCATION exige data.place_id (Google Place ID do GBP). Locations geralmente vem sync do Google Business Profile.',
          );
        }
        return {
          location_asset: { place_id: data.place_id },
        };
      }
      case 'LEAD_FORM': {
        if (!data.business_name || !data.call_to_action_type) {
          throw new Error(
            'LEAD_FORM exige data.business_name e data.call_to_action_type (LEARN_MORE|GET_QUOTE|APPLY_NOW|...).',
          );
        }
        return {
          lead_form_asset: {
            business_name: String(data.business_name).slice(0, 25),
            call_to_action_type: data.call_to_action_type,
            call_to_action_text: data.call_to_action_text || 'Saiba mais',
            headline: String(data.headline || data.business_name).slice(0, 30),
            description: String(
              data.description || 'Preencha o formulario',
            ).slice(0, 200),
            privacy_policy_url: data.privacy_policy_url,
            fields: (data.fields || []).map((f: any) => ({
              input_type: f.input_type,
              single_choice_answers: f.single_choice_answers || [],
            })),
          },
        };
      }
      default:
        throw new Error(`Tipo de asset desconhecido: ${type}`);
    }
  }

  /**
   * Mapeia type do asset → AssetFieldType pra attachment.
   */
  private resolveAssetFieldType(type: string): string {
    const map: Record<string, string> = {
      SITELINK: 'SITELINK',
      CALLOUT: 'CALLOUT',
      STRUCTURED_SNIPPET: 'STRUCTURED_SNIPPET',
      CALL: 'CALL',
      LOCATION: 'LOCATION',
      PRICE: 'PRICE',
      PROMOTION: 'PROMOTION',
      LEAD_FORM: 'LEAD_FORM',
    };
    return map[type] ?? type;
  }

  /**
   * Resolve string → enum AssetFieldType do SDK.
   *
   * NB: LOCATION asset NAO eh attachable via campaign_asset/ad_group_asset
   * com field_type=LOCATION (esse field_type nao existe no enum). Location
   * asset eh anexado via account-level link com Google Business Profile.
   * Pra simplicidade desta entrega, location asset CRIA mas nao da pra
   * attach com essa tool — caller usa Google Ads UI pra anexar.
   */
  private assetFieldTypeEnum(fieldType: string): number {
    const map: Record<string, number> = {
      SITELINK: enums.AssetFieldType.SITELINK,
      CALLOUT: enums.AssetFieldType.CALLOUT,
      STRUCTURED_SNIPPET: enums.AssetFieldType.STRUCTURED_SNIPPET,
      CALL: enums.AssetFieldType.CALL,
      PRICE: enums.AssetFieldType.PRICE,
      PROMOTION: enums.AssetFieldType.PROMOTION,
      LEAD_FORM: enums.AssetFieldType.LEAD_FORM,
    };
    const v = map[fieldType];
    if (v === undefined) {
      throw new Error(
        `AssetFieldType ${fieldType} nao suportado pra attach via API. ` +
          `LOCATION asset: anexa via Google Business Profile link. ` +
          `Use Google Ads UI pra anexar manual.`,
      );
    }
    return v;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 3 backlog (2026-05-17) — Targeting + Bulk
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Atualiza geo targets via CampaignCriterion (location). Add cria
   * criterios novos; remove deleta os existentes. 1 mutate batch combina
   * tudo (mais eficiente + atomic).
   */
  private async updateGeoTargets(
    p: UpdateGeoTargetsPayload,
  ): Promise<MutateResult> {
    // Pra ter add+remove na MESMA chamada precisamos de svc.mutateResources
    // (batch). Pra simplicidade, fazemos 2 chamadas: add primeiro (create),
    // depois remove. Audit log ganha 2 entradas distintas.
    const ops: any[] = [];
    if (p.addResourceNames.length > 0) {
      ops.push({
        kind: 'add',
        operations: p.addResourceNames.map((rn) => ({
          campaign: p.campaignResourceName,
          location: { geo_target_constant: rn },
          ...(p.negative ? { negative: true } : {}),
        })),
      });
    }
    if (p.removeResourceNames.length > 0) {
      ops.push({ kind: 'remove', operations: p.removeResourceNames });
    }
    return await this.executeMultiOps(p, ops, 'campaign_criterion');
  }

  /**
   * Atualiza language targets. Mesmo padrao do geo, mas com language_constant.
   */
  private async updateLanguageTargets(
    p: UpdateLanguageTargetsPayload,
  ): Promise<MutateResult> {
    const ops: any[] = [];
    if (p.addResourceNames.length > 0) {
      ops.push({
        kind: 'add',
        operations: p.addResourceNames.map((rn) => ({
          campaign: p.campaignResourceName,
          language: { language_constant: rn },
        })),
      });
    }
    if (p.removeResourceNames.length > 0) {
      ops.push({ kind: 'remove', operations: p.removeResourceNames });
    }
    return await this.executeMultiOps(p, ops, 'campaign_criterion');
  }

  /**
   * Atualiza bid modifiers por device. Cria/atualiza CampaignCriterion
   * com device. Pra cada device, se modifier passado, faz CREATE
   * (Google tem upsert via criterion_id deterministico baseado em device).
   *
   * Pra modifier=null (remover): seria remove do criterion existente,
   * mas pra simplicidade do MVP, modifier=null vira modifier=1.0
   * (sem ajuste — efeito equivalente).
   */
  private async updateDeviceTargeting(
    p: UpdateDeviceTargetingPayload,
  ): Promise<MutateResult> {
    const ops: any[] = [];
    const buildOp = (deviceEnum: number, modifier: number) => ({
      campaign: p.campaignResourceName,
      device: { type: deviceEnum },
      bid_modifier: modifier,
    });
    if (p.mobileModifier != null) {
      ops.push(buildOp(enums.Device.MOBILE, p.mobileModifier));
    }
    if (p.desktopModifier != null) {
      ops.push(buildOp(enums.Device.DESKTOP, p.desktopModifier));
    }
    if (p.tabletModifier != null) {
      ops.push(buildOp(enums.Device.TABLET, p.tabletModifier));
    }
    if (ops.length === 0) {
      return {
        logId: 'noop-device-targeting',
        status: 'SUCCESS',
        resourceNames: [],
        oabViolations: [],
        durationMs: 0,
      };
    }
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_criterion',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: p.context,
      operations: ops,
    });
  }

  /**
   * Bulk add negatives — replica mesmo conjunto de keywords em N targets
   * (campaigns OR ad_groups), numa unica operacao batch.
   */
  private async bulkAddNegatives(
    p: BulkAddNegativesPayload,
  ): Promise<MutateResult> {
    const matchTypeEnum =
      p.matchType === 'EXACT'
        ? enums.KeywordMatchType.EXACT
        : p.matchType === 'PHRASE'
          ? enums.KeywordMatchType.PHRASE
          : enums.KeywordMatchType.BROAD;

    // Pra cada target × keyword, 1 operation. Total = N × M.
    const campaignOps: any[] = [];
    const adGroupOps: any[] = [];
    for (const target of p.targets) {
      for (const kw of p.keywords) {
        const opBase = {
          negative: true,
          keyword: { text: kw, match_type: matchTypeEnum },
        };
        if (target.scope === 'CAMPAIGN') {
          campaignOps.push({ ...opBase, campaign: target.resourceName });
        } else {
          adGroupOps.push({
            ...opBase,
            ad_group: target.resourceName,
            status: enums.AdGroupCriterionStatus.ENABLED,
          });
        }
      }
    }

    // Roda em ate 2 mutates (1 campaign_criterion, 1 ad_group_criterion).
    // Retorna o ultimo resultado (em PARTIAL/FAILED, o primeiro a quebrar
    // ja foi capturado no log).
    let lastResult: MutateResult | null = null;
    if (campaignOps.length > 0) {
      lastResult = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: {
          ...p.context,
          bulk_targets: campaignOps.length,
          bulk_scope: 'CAMPAIGN',
        },
        operations: campaignOps,
      });
    }
    if (adGroupOps.length > 0) {
      lastResult = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'ad_group_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: {
          ...p.context,
          bulk_targets: adGroupOps.length,
          bulk_scope: 'AD_GROUP',
        },
        operations: adGroupOps,
      });
    }
    return (
      lastResult ?? {
        logId: 'noop-bulk-negatives',
        status: 'SUCCESS',
        resourceNames: [],
        oabViolations: [],
        durationMs: 0,
      }
    );
  }

  /**
   * Bulk update status — pausa/reativa N campanhas ou ad_groups em batch.
   */
  private async bulkUpdateStatus(
    p: BulkUpdateStatusPayload,
  ): Promise<MutateResult> {
    const campaignStatusEnum =
      p.status === 'ENABLED'
        ? enums.CampaignStatus.ENABLED
        : enums.CampaignStatus.PAUSED;
    const adGroupStatusEnum =
      p.status === 'ENABLED'
        ? enums.AdGroupStatus.ENABLED
        : enums.AdGroupStatus.PAUSED;

    const campaignOps = p.targets
      .filter((t) => t.resourceType === 'campaign')
      .map((t) => ({ resource_name: t.resourceName, status: campaignStatusEnum }));
    const adGroupOps = p.targets
      .filter((t) => t.resourceType === 'ad_group')
      .map((t) => ({ resource_name: t.resourceName, status: adGroupStatusEnum }));

    let lastResult: MutateResult | null = null;
    if (campaignOps.length > 0) {
      lastResult = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign',
        operation: 'update',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: { ...p.context, bulk_count: campaignOps.length },
        operations: campaignOps,
      });
    }
    if (adGroupOps.length > 0) {
      lastResult = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'ad_group',
        operation: 'update',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: { ...p.context, bulk_count: adGroupOps.length },
        operations: adGroupOps,
      });
    }
    return (
      lastResult ?? {
        logId: 'noop-bulk-status',
        status: 'SUCCESS',
        resourceNames: [],
        oabViolations: [],
        durationMs: 0,
      }
    );
  }

  /**
   * Helper — executa N mutates sequenciais de mesmo resourceType,
   * agrupados por kind (add=create, remove=remove). Usado em geo/language.
   */
  private async executeMultiOps(
    p: BaseMutatePayload,
    ops: Array<{ kind: 'add' | 'remove'; operations: any[] }>,
    resourceType: any,
  ): Promise<MutateResult> {
    let lastResult: MutateResult | null = null;
    for (const op of ops) {
      lastResult = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType,
        operation: op.kind === 'add' ? 'create' : 'remove',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: { ...p.context, multi_op_kind: op.kind, count: op.operations.length },
        operations: op.operations,
      });
      if (lastResult.status === 'FAILED') break;
    }
    return (
      lastResult ?? {
        logId: 'noop-multi-ops',
        status: 'SUCCESS',
        resourceNames: [],
        oabViolations: [],
        durationMs: 0,
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 4 backlog (2026-05-17) — Performance Max
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Cria campanha Performance Max (MVP simplificado).
   *
   * Pipeline:
   *   1. Cria campaign_budget dedicado
   *   2. Cria PMax campaign (advertising_channel_type=PERFORMANCE_MAX)
   *   3. Aplica geo + language targeting
   *
   * NAO cria asset_group nesta versao — pra ficar serveable, admin precisa
   * popular asset_group via Google Ads UI (5+ headlines, 5+ descriptions,
   * 1 logo, 1 business name, 1+ images). Sprint 4.1 implementa
   * traffic_manage_pmax_asset_group pra automatizar.
   *
   * Status inicial sempre PAUSED por seguranca.
   */
  private async createPmaxCampaign(
    p: CreatePmaxCampaignPayload,
  ): Promise<MutateResult> {
    const dailyMicros =
      typeof p.dailyBudgetMicros === 'string'
        ? BigInt(p.dailyBudgetMicros)
        : p.dailyBudgetMicros;

    // Passo 1: budget
    const budgetResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_budget',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        step: 'create_pmax_budget',
        campaign_name: p.name,
      },
      operations: [
        {
          name: `Budget — ${p.name}`,
          amount_micros: dailyMicros,
          delivery_method: enums.BudgetDeliveryMethod.STANDARD,
          explicitly_shared: false,
        },
      ],
    });
    if (
      budgetResult.status !== 'SUCCESS' ||
      !budgetResult.resourceNames?.[0]
    ) {
      return budgetResult;
    }
    const budgetResourceName = budgetResult.resourceNames[0];

    // Passo 2: PMax campaign
    const campaignOp: any = {
      name: p.name,
      advertising_channel_type: enums.AdvertisingChannelType.PERFORMANCE_MAX,
      status:
        p.initialStatus === 'ENABLED'
          ? enums.CampaignStatus.ENABLED
          : enums.CampaignStatus.PAUSED,
      campaign_budget: budgetResourceName,
      // Bidding — PMax suporta MAXIMIZE_CONVERSIONS e MAXIMIZE_CONVERSION_VALUE
      ...(p.biddingStrategy === 'MAXIMIZE_CONVERSIONS' && {
        maximize_conversions: p.targetCpaMicros
          ? {
              target_cpa_micros:
                typeof p.targetCpaMicros === 'string'
                  ? BigInt(p.targetCpaMicros)
                  : p.targetCpaMicros,
            }
          : { target_cpa_micros: 0n },
      }),
      ...(p.biddingStrategy === 'MAXIMIZE_CONVERSION_VALUE' && {
        maximize_conversion_value: p.targetRoas
          ? { target_roas: p.targetRoas }
          : { target_roas: 0 },
      }),
      // url_expansion_opt_out: false (default — PMax expande URLs do final_url)
      url_expansion_opt_out: false,
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
        step: 'create_pmax_campaign',
        budget_resource_name: budgetResourceName,
        channel_type: 'PERFORMANCE_MAX',
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

    // Passo 3: geo + language criteria
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
    if (criterionOps.length > 0 && !p.validateOnly) {
      await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: false,
        context: {
          ...p.context,
          step: 'create_pmax_criteria',
          campaign_resource_name: campaignResourceName,
        },
        operations: criterionOps,
      });
      // Nao falha o todo se criterion falhar — admin pode adicionar depois
    }

    return campaignResult;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 3.1 backlog (2026-05-17) — Shared library + Location bid
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Cria SharedSet (type=NEGATIVE_KEYWORDS) + N SharedCriterion + N
   * CampaignSharedSet atomico em 3 passos sequenciais.
   *
   * Pipeline (per Google Ads docs):
   *   1. SharedSet.mutate create — pega resource_name retornado
   *   2. SharedCriterion.mutate create N items apontando pro shared_set
   *   3. CampaignSharedSet.mutate create N items vinculando shared_set
   *      a cada campaign passada
   *
   * Em dry-run, so o passo 1 valida. Passos 2/3 pulam (precisam
   * resource_name real).
   */
  private async createSharedNegativeList(
    p: CreateSharedNegativeListPayload,
  ): Promise<MutateResult> {
    // Passo 1: cria SharedSet
    const setResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'shared_set',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        step: 'create_shared_set',
        list_name: p.name,
      },
      operations: [
        {
          name: p.name,
          type: enums.SharedSetType.NEGATIVE_KEYWORDS,
          status: enums.SharedSetStatus.ENABLED,
        },
      ],
    });
    if (
      setResult.status !== 'SUCCESS' ||
      !setResult.resourceNames?.[0] ||
      p.validateOnly
    ) {
      return setResult;
    }
    const sharedSetResourceName = setResult.resourceNames[0];

    // Passo 2: cria N SharedCriterion
    const matchTypeEnum =
      p.matchType === 'EXACT'
        ? enums.KeywordMatchType.EXACT
        : p.matchType === 'PHRASE'
          ? enums.KeywordMatchType.PHRASE
          : enums.KeywordMatchType.BROAD;

    const criterionOps = p.keywords.map((kw) => ({
      shared_set: sharedSetResourceName,
      keyword: { text: kw, match_type: matchTypeEnum },
    }));

    if (criterionOps.length > 0) {
      await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'shared_criterion',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: false,
        context: {
          ...p.context,
          step: 'add_shared_criteria',
          shared_set_resource_name: sharedSetResourceName,
          kw_count: criterionOps.length,
        },
        operations: criterionOps,
      });
    }

    // Passo 3: anexa a campanhas (CampaignSharedSet)
    if (p.attachCampaignResourceNames.length > 0) {
      const attachOps = p.attachCampaignResourceNames.map((camp) => ({
        campaign: camp,
        shared_set: sharedSetResourceName,
      }));
      await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'campaign_shared_set',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: false,
        context: {
          ...p.context,
          step: 'attach_shared_set_to_campaigns',
          shared_set_resource_name: sharedSetResourceName,
          campaign_count: attachOps.length,
        },
        operations: attachOps,
      });
    }

    return setResult;
  }

  /**
   * Anexa SharedSet ja existente a N campanhas via CampaignSharedSet.
   */
  private async attachSharedNegativeList(
    p: AttachSharedNegativeListPayload,
  ): Promise<MutateResult> {
    const ops = p.campaignResourceNames.map((camp) => ({
      campaign: camp,
      shared_set: p.sharedSetResourceName,
    }));
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_shared_set',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        shared_set_resource_name: p.sharedSetResourceName,
        campaign_count: ops.length,
      },
      operations: ops,
    });
  }

  /**
   * Define bid modifiers por location via CampaignCriterion.
   *
   * Cada modifier vira 1 CampaignCriterion com location + bid_modifier.
   * Range valido pelo Google: 0.1 a 10.0 (DTO ja valida).
   *
   * Se ja existir CampaignCriterion pra mesma location, Google atualiza
   * via upsert deterministico baseado em criterion_id.
   */
  private async updateLocationBidModifiers(
    p: UpdateLocationBidModifiersPayload,
  ): Promise<MutateResult> {
    const ops = p.modifiers.map((m) => ({
      campaign: p.campaignResourceName,
      location: { geo_target_constant: m.geoTargetConstantResourceName },
      bid_modifier: m.bidModifier,
    }));
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'campaign_criterion',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: { ...p.context, modifier_count: ops.length },
      operations: ops,
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

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 4.1 backlog (2026-05-17) — PMax asset groups + Experiments
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Cria asset_group VAZIO numa campanha PMax existente.
   *
   * IMPORTANTE: pra ficar serveable, o asset_group precisa ter assets
   * mínimos (5 headlines, 5 descriptions, 1 long_headline, 1 business_name,
   * 1 logo, 1 marketing_image, 1 square_marketing_image). Esta tool só
   * cria o container — popule depois via addAssetsToPmaxAssetGroup.
   *
   * Status default PAUSED por seguranca (asset group sem assets não veicula
   * de qualquer forma, mas PAUSED evita warnings na UI).
   */
  private async createPmaxAssetGroup(
    p: CreatePmaxAssetGroupPayload,
  ): Promise<MutateResult> {
    const op: any = {
      name: p.name,
      campaign: p.campaignResourceName,
      final_urls: p.finalUrls,
      status:
        p.status === 'ENABLED'
          ? enums.AssetGroupStatus.ENABLED
          : enums.AssetGroupStatus.PAUSED,
    };
    if (p.finalMobileUrls && p.finalMobileUrls.length > 0) {
      op.final_mobile_urls = p.finalMobileUrls;
    }
    if (p.path1) op.path1 = p.path1;
    if (p.path2) op.path2 = p.path2;

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'asset_group',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        campaign_resource_name: p.campaignResourceName,
        asset_group_name: p.name,
      },
      operations: [op],
    });
  }

  /**
   * Adiciona assets a um asset_group de PMax.
   *
   * Faz em DOIS mutates:
   *   1. Cria Assets[] novos (text/youtube) — bypassa se source=existing
   *   2. Cria AssetGroupAssets[] vinculando Asset → AssetGroup com field_type
   *
   * Best practice Google é usar SequentialMutate (Asset[] + AssetGroupAsset[]
   * num único request com temp resource_names), mas SDK alto-nivel não expõe.
   * Usamos 2 mutates sequenciais — equivalente em garantias (validate-only no
   * step 1 é validado pelo Google antes de continuar).
   *
   * Pra source=existing, passa asset_resource_name no payload e pula step 1.
   */
  private async addAssetsToPmaxAssetGroup(
    p: AddAssetsToPmaxAssetGroupPayload,
  ): Promise<MutateResult> {
    // Step 1: cria Assets novos (text + youtube)
    const newAssetOps: any[] = [];
    const newAssetIndexMap: number[] = []; // map asset[i] → newAssetOps[j]

    for (let i = 0; i < p.assets.length; i++) {
      const a = p.assets[i];
      if (a.source === 'existing') {
        newAssetIndexMap.push(-1);
        continue;
      }
      const assetOp = this.buildAssetPayloadForPmax(a);
      newAssetIndexMap.push(newAssetOps.length);
      newAssetOps.push(assetOp);
    }

    let createdAssetResourceNames: string[] = [];
    if (newAssetOps.length > 0) {
      const assetResult = await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'asset',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: !!p.validateOnly,
        context: {
          ...p.context,
          asset_group_resource_name: p.assetGroupResourceName,
          step: 'create_assets',
          asset_count: newAssetOps.length,
        },
        operations: newAssetOps,
      });
      if (assetResult.status !== 'SUCCESS') {
        return assetResult;
      }
      createdAssetResourceNames = assetResult.resourceNames;
    }

    // Em validate_only sem criar nada, não temos resource_names — pulamos step 2.
    if (p.validateOnly && newAssetOps.length > 0) {
      return {
        logId: 'pmax-asset-group-validate-only',
        status: 'SUCCESS',
        resourceNames: [],
        oabViolations: [],
        durationMs: 0,
      };
    }

    // Step 2: cria AssetGroupAssets[] vinculando
    const linkOps: any[] = [];
    for (let i = 0; i < p.assets.length; i++) {
      const a = p.assets[i];
      const assetResourceName =
        a.source === 'existing'
          ? a.payload.asset_resource_name
          : createdAssetResourceNames[newAssetIndexMap[i]];

      if (!assetResourceName) {
        this.logger.warn(
          `[mutate] addAssetsToPmaxAssetGroup: asset[${i}] sem resource_name (source=${a.source}), pulando`,
        );
        continue;
      }

      const fieldTypeEnum = this.resolvePmaxAssetFieldType(a.fieldType);
      if (fieldTypeEnum == null) {
        throw new Error(
          `field_type invalido pra PMax asset_group: ${a.fieldType}`,
        );
      }

      linkOps.push({
        asset_group: p.assetGroupResourceName,
        asset: assetResourceName,
        field_type: fieldTypeEnum,
      });
    }

    if (linkOps.length === 0) {
      return {
        logId: 'pmax-asset-group-noop',
        status: 'SUCCESS',
        resourceNames: createdAssetResourceNames,
        oabViolations: [],
        durationMs: 0,
      };
    }

    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'asset_group_asset',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        asset_group_resource_name: p.assetGroupResourceName,
        step: 'link_assets',
        link_count: linkOps.length,
      },
      operations: linkOps,
    });
  }

  /**
   * Helper — constroi Asset op pra PMax. Suporta source=text (text_asset)
   * e source=youtube (youtube_video_asset).
   *
   * Note: imagens NAO são suportadas em criação direta (precisam upload via
   * UI ou via Asset.create com image_asset.data como Buffer — não cobrimos
   * pra MVP, gestor de tráfego deve referenciar imagens já uploadeadas via
   * source=existing).
   */
  private buildAssetPayloadForPmax(a: {
    source: 'text' | 'existing' | 'youtube';
    fieldType: string;
    payload: Record<string, any>;
  }): any {
    if (a.source === 'text') {
      const text = a.payload?.text;
      if (typeof text !== 'string' || text.length === 0) {
        throw new Error(
          `source=text requer payload.text (field_type=${a.fieldType})`,
        );
      }
      return { text_asset: { text } };
    }
    if (a.source === 'youtube') {
      const videoId = a.payload?.youtube_video_id;
      if (typeof videoId !== 'string' || videoId.length === 0) {
        throw new Error(
          `source=youtube requer payload.youtube_video_id (field_type=${a.fieldType})`,
        );
      }
      return {
        youtube_video_asset: {
          youtube_video_id: videoId,
          youtube_video_title: a.payload?.title ?? '',
        },
      };
    }
    throw new Error(`source nao suportada em buildAssetPayloadForPmax: ${a.source}`);
  }

  /**
   * Helper — resolve field_type string -> enum value.
   * Cobre todos os field_types validos pra PMax asset_group.
   */
  private resolvePmaxAssetFieldType(fieldType: string): number | undefined {
    const map: Record<string, number | undefined> = {
      HEADLINE: enums.AssetFieldType.HEADLINE,
      DESCRIPTION: enums.AssetFieldType.DESCRIPTION,
      LONG_HEADLINE: enums.AssetFieldType.LONG_HEADLINE,
      BUSINESS_NAME: enums.AssetFieldType.BUSINESS_NAME,
      LOGO: enums.AssetFieldType.LOGO,
      LANDSCAPE_LOGO: enums.AssetFieldType.LANDSCAPE_LOGO,
      MARKETING_IMAGE: enums.AssetFieldType.MARKETING_IMAGE,
      SQUARE_MARKETING_IMAGE: enums.AssetFieldType.SQUARE_MARKETING_IMAGE,
      PORTRAIT_MARKETING_IMAGE: enums.AssetFieldType.PORTRAIT_MARKETING_IMAGE,
      YOUTUBE_VIDEO: enums.AssetFieldType.YOUTUBE_VIDEO,
      // CALL_TO_ACTION existe em AssetFieldType?
      // Em v23: pode estar como CALL_TO_ACTION_SELECTION. Skip se nao mapeado.
      CALL_TO_ACTION: (enums.AssetFieldType as any).CALL_TO_ACTION_SELECTION,
    };
    return map[fieldType];
  }

  /**
   * Cria Experiment (A/B test) na nova API v23. MVP — só cria em estado
   * SETUP com control arm. Treatment arm + scheduling/promotion ficam pra
   * Sprint 4.2.
   *
   * Pipeline:
   *   1. Cria Experiment (status=SETUP)
   *   2. Cria ExperimentArm "control" apontando pra base_campaign
   *
   * O gestor de tráfego ou admin precisa configurar o treatment arm via UI
   * (criando uma cópia/draft da campanha com modificações) e depois usar a
   * tool de schedule (futura) pra ativar.
   *
   * NOTA: em v23 o flow correto é:
   *   - Experiment.create (SETUP)
   *   - ExperimentArm.create (control = base campaign, trial campaigns vazio)
   *   - ExperimentArm.create (treatment = nome diferente, trial campaigns
   *     populado depois com Campaign clonado/editado)
   *   - Experiment.scheduleAsync (passa pra ENABLED, splits traffic)
   *   - Experiment.promote (encerra com vencedor)
   */
  private async createExperiment(
    p: CreateExperimentPayload,
  ): Promise<MutateResult> {
    // Step 1: cria Experiment em SETUP
    const expOp: any = {
      name: p.name,
      type: this.resolveExperimentType(p.type),
      status: enums.ExperimentStatus.SETUP,
      suffix: p.suffix || '[experiment]',
    };
    if (p.description) expOp.description = p.description;
    if (p.goals && p.goals.length > 0) {
      expOp.goals = p.goals.map((g) => ({
        metric: this.resolveExperimentMetric(g.metric),
        direction: this.resolveExperimentDirection(g.direction),
      }));
    }

    const expResult = await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'experiment',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        base_campaign_resource_name: p.baseCampaignResourceName,
        experiment_name: p.name,
        step: 'create_experiment',
      },
      operations: [expOp],
    });
    if (expResult.status !== 'SUCCESS' || !expResult.resourceNames?.[0]) {
      return expResult;
    }

    // Em dry-run paramos aqui (não temos resource_name real pra arm)
    if (p.validateOnly) {
      return expResult;
    }

    const experimentResourceName = expResult.resourceNames[0];

    // Step 2: cria ExperimentArm control. Note: Google exige que arms sejam
    // criados separadamente do Experiment, e o "control" arm aponta pra
    // base_campaign via in_design_campaigns vazio (control herda base).
    try {
      await this.mutate.execute({
        tenantId: p.tenantId,
        accountId: p.accountId,
        resourceType: 'experiment_arm',
        operation: 'create',
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        validateOnly: false,
        context: {
          ...p.context,
          experiment_resource_name: experimentResourceName,
          step: 'create_control_arm',
        },
        operations: [
          {
            experiment: experimentResourceName,
            name: 'control',
            control: true,
            traffic_split: 50,
            campaigns: [p.baseCampaignResourceName],
          },
        ],
      });
    } catch (e: any) {
      this.logger.warn(
        `[mutate] createExperiment: control arm falhou (experiment criado em SETUP, gestor precisa configurar arms via UI): ${e.message}`,
      );
      // Soft-fail — experimento existe em SETUP, admin pode completar via UI
    }

    return expResult;
  }

  private resolveExperimentType(type: string): number {
    const map: Record<string, number> = {
      SEARCH_CUSTOM: enums.ExperimentType.SEARCH_CUSTOM,
      DISPLAY_CUSTOM: enums.ExperimentType.DISPLAY_CUSTOM,
      SEARCH_AUTOMATED_BIDDING_STRATEGY:
        enums.ExperimentType.SEARCH_AUTOMATED_BIDDING_STRATEGY,
      DISPLAY_AUTOMATED_BIDDING_STRATEGY:
        enums.ExperimentType.DISPLAY_AUTOMATED_BIDDING_STRATEGY,
      AD_VARIATION: enums.ExperimentType.AD_VARIATION,
    };
    return map[type] ?? enums.ExperimentType.SEARCH_CUSTOM;
  }

  private resolveExperimentMetric(metric: string): number | undefined {
    const m = (enums as any).ExperimentMetric ?? {};
    return m[metric];
  }

  private resolveExperimentDirection(direction: string): number | undefined {
    const m = (enums as any).ExperimentMetricDirection ?? {};
    return m[direction];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 4.2 backlog (2026-05-17) — Experiments lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Adiciona ExperimentArm de "treatment" a um experiment em SETUP.
   *
   * Pattern Google: treatment arm passa o trial campaign em
   * `in_design_campaigns` (auto-materializado em trial real quando schedule
   * rodar). Control arm ja foi criado por createExperiment com `campaigns:
   * [base_campaign]`. Soma de traffic_split deve dar 100 (control herda
   * 100 - treatment.traffic_split).
   */
  private async addTreatmentArm(
    p: AddTreatmentArmPayload,
  ): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'experiment_arm',
      operation: 'create',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        experiment_resource_name: p.experimentResourceName,
        arm_role: 'treatment',
        trial_campaign_resource_name: p.trialCampaignResourceName,
        traffic_split: p.trafficSplit,
      },
      operations: [
        {
          experiment: p.experimentResourceName,
          name: p.name,
          control: false,
          traffic_split: p.trafficSplit,
          in_design_campaigns: [p.trialCampaignResourceName],
        },
      ],
    });
  }

  /**
   * Schedule experiment — passa SETUP -> INITIATED (async) -> ENABLED.
   * Usa RPC custom do ExperimentService (NAO mutate CRUD). Persiste manual
   * em TrafficMutateLog pra audit equivalente.
   */
  private async scheduleExperiment(
    p: ScheduleExperimentPayload,
  ): Promise<MutateResult> {
    return await this.executeExperimentLifecycleAction(
      p,
      'schedule_experiment',
      async (customer) =>
        await this.clientSvc.scheduleExperiment(
          customer,
          p.customerId,
          p.experimentResourceName,
          !!p.validateOnly,
        ),
    );
  }

  private async endExperiment(
    p: EndExperimentPayload,
  ): Promise<MutateResult> {
    return await this.executeExperimentLifecycleAction(
      p,
      'end_experiment',
      async (customer) =>
        await this.clientSvc.endExperiment(
          customer,
          p.customerId,
          p.experimentResourceName,
        ),
    );
  }

  private async promoteExperiment(
    p: PromoteExperimentPayload,
  ): Promise<MutateResult> {
    return await this.executeExperimentLifecycleAction(
      p,
      'promote_experiment',
      async (customer) =>
        await this.clientSvc.promoteExperiment(
          customer,
          p.customerId,
          p.experimentResourceName,
        ),
    );
  }

  private async graduateExperiment(
    p: GraduateExperimentPayload,
  ): Promise<MutateResult> {
    return await this.executeExperimentLifecycleAction(
      p,
      'graduate_experiment',
      async (customer) =>
        await this.clientSvc.graduateExperiment(
          customer,
          p.customerId,
          p.experimentResourceName,
          p.mappings,
        ),
    );
  }

  /**
   * Helper compartilhado pra os 4 RPCs de experiment lifecycle.
   *
   * Faz:
   *   1. Cria TrafficMutateLog entry (resource_type='experiment') antes de chamar
   *   2. Chama o RPC via clientSvc
   *   3. Atualiza log com SUCCESS ou FAILED + mensagem
   *
   * Retorna MutateResult compatible com o pattern dos outros mutates pro
   * enqueueMutate funcionar igual (status, errorMessage, etc).
   */
  private async executeExperimentLifecycleAction(
    p:
      | ScheduleExperimentPayload
      | EndExperimentPayload
      | PromoteExperimentPayload
      | GraduateExperimentPayload,
    operation: string,
    rpc: (customer: any) => Promise<{ ok: boolean; raw: unknown; error?: string }>,
  ): Promise<MutateResult> {
    const t0 = Date.now();
    const requestId = `experiment-${operation}-${p.experimentResourceName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 1. Cria log em PENDING
    const log = await this.prisma.trafficMutateLog.create({
      data: {
        tenant_id: p.tenantId,
        account_id: p.accountId,
        request_id: requestId,
        resource_type: 'experiment',
        operation,
        initiator: p.initiator,
        confidence: p.confidence ?? null,
        payload: {
          experiment_resource_name: p.experimentResourceName,
          ...(operation === 'graduate_experiment' && {
            mappings: (p as GraduateExperimentPayload).mappings,
          }),
        } as any,
        result: {} as any,
        status: 'PENDING',
        validate_only:
          operation === 'schedule_experiment' && !!(p as any).validateOnly,
        context: (p.context ?? {}) as any,
      },
    });

    // 2. Chama RPC
    try {
      const customer = await this.clientSvc.getCustomer(
        p.tenantId,
        p.accountId,
      );
      const result = await rpc(customer);
      const durationMs = Date.now() - t0;

      await this.prisma.trafficMutateLog.update({
        where: { id: log.id },
        data: {
          status: result.ok ? 'SUCCESS' : 'PARTIAL',
          duration_ms: durationMs,
          result: {
            ok: result.ok,
            raw_snapshot: this.snapshotForLog(result.raw),
          } as any,
          error_message: result.error?.slice(0, 1500) ?? null,
        },
      });

      this.logger.log(
        `[experiment-${operation}] ${result.ok ? 'SUCCESS' : 'PARTIAL'} ${durationMs}ms`,
      );

      return {
        logId: log.id,
        status: result.ok ? 'SUCCESS' : 'PARTIAL',
        resourceNames: [p.experimentResourceName],
        errorMessage: result.error ?? undefined,
        oabViolations: [],
        rawResponse: result.raw,
        durationMs,
      };
    } catch (e: any) {
      const durationMs = Date.now() - t0;
      const errorMessage = e?.message || `experiment ${operation} falhou`;

      await this.prisma.trafficMutateLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          duration_ms: durationMs,
          error_message: errorMessage.slice(0, 1500),
        },
      });

      this.logger.warn(
        `[experiment-${operation}] FAILED ${durationMs}ms ${errorMessage}`,
      );

      return {
        logId: log.id,
        status: 'FAILED',
        resourceNames: [],
        errorMessage,
        oabViolations: [],
        durationMs,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bug-fix batch (2026-05-17) — cleanup asset orfaos
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Remove um Asset da conta — pra limpeza de assets orfaos (criados via
   * attach_call_asset que falhou em step 2 antes do fix do BUG-C, ou via
   * UI antes de anexar). Asset removido nao pode ser anexado depois.
   *
   * Aceita resource_name customers/X/assets/Y. Se asset ainda esta anexado
   * a alguma campanha/grupo/conta, Google rejeita com erro claro.
   */
  private async removeAsset(p: RemoveAssetPayload): Promise<MutateResult> {
    return await this.mutate.execute({
      tenantId: p.tenantId,
      accountId: p.accountId,
      resourceType: 'asset',
      operation: 'remove',
      initiator: p.initiator,
      confidence: p.confidence ?? null,
      validateOnly: !!p.validateOnly,
      context: {
        ...p.context,
        asset_resource_name: p.assetResourceName,
      },
      operations: [p.assetResourceName],
    });
  }

  private snapshotForLog(raw: unknown): unknown {
    try {
      const json = JSON.stringify(raw, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      return JSON.parse(json.length > 2000 ? json.slice(0, 2000) + '...[truncated]' : json);
    } catch {
      return '(unserializable)';
    }
  }
}
