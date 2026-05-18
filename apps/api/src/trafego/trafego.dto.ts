import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  IsIn,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── OAuth ──────────────────────────────────────────────────────────────────

export class OAuthCallbackDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;
}

// ─── Conta ──────────────────────────────────────────────────────────────────

export class UpdateAccountDto {
  @IsString()
  @IsOptional()
  account_name?: string;

  @IsString()
  @IsIn(['ACTIVE', 'REVOKED', 'ERROR', 'PENDING'])
  @IsOptional()
  status?: string;
}

// ─── Campanha (apenas anotacoes internas — nada que va pra Google) ─────────

export class UpdateCampaignDto {
  @IsBoolean()
  @IsOptional()
  is_favorite?: boolean;

  @IsBoolean()
  @IsOptional()
  is_archived_internal?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export class UpdateSettingsDto {
  /** CPL alvo em REAIS (BRL). Convertido pra micros internamente. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  target_cpl_brl?: number;

  /** CTR alvo (0..1) — ex 0.03 = 3%. */
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  target_ctr?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  target_roas?: number;

  /** Orcamento diario alvo em REAIS. null pra remover. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  target_daily_budget_brl?: number | null;

  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  cpl_alert_threshold?: number;

  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  ctr_alert_threshold?: number;

  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  alert_window_days?: number;

  @IsBoolean()
  @IsOptional()
  notify_email?: boolean;

  @IsBoolean()
  @IsOptional()
  notify_whatsapp?: boolean;

  @IsString()
  @IsOptional()
  notify_whatsapp_phone?: string;

  @IsBoolean()
  @IsOptional()
  notify_inapp?: boolean;

  @IsInt()
  @Min(0)
  @Max(23)
  @IsOptional()
  sync_hour_local?: number;

  @IsBoolean()
  @IsOptional()
  sync_enabled?: boolean;
}

// ─── Alertas ────────────────────────────────────────────────────────────────

export class AcknowledgeAlertDto {
  @IsString()
  @IsIn(['ACKNOWLEDGED', 'RESOLVED', 'MUTED'])
  status!: string;
}

// ─── Sync manual ────────────────────────────────────────────────────────────

export class TriggerSyncDto {
  /** ISO date (YYYY-MM-DD). Default: 7 dias atras. */
  @IsString()
  @IsOptional()
  date_from?: string;

  /** ISO date (YYYY-MM-DD). Default: hoje. */
  @IsString()
  @IsOptional()
  date_to?: string;
}

// ─── Credenciais Google Ads (UI admin) ──────────────────────────────────────

/**
 * Atualiza credenciais Google Ads via UI.
 * - undefined: preserva valor atual
 * - null: apaga (cai no fallback de env)
 * - string: armazena (secrets criptografados)
 */
export class UpdateCredentialsDto {
  /** Developer Token da MCC (criptografado em repouso). */
  @IsString()
  @IsOptional()
  google_ads_developer_token?: string | null;

  /** Customer ID da MCC (sem tracos), ex: "2736107831". */
  @IsString()
  @IsOptional()
  google_ads_login_customer_id?: string | null;

  /** Customer ID da conta-alvo (anunciante), sem tracos. Ex: "4464129633". */
  @IsString()
  @IsOptional()
  google_ads_customer_id?: string | null;

  /** OAuth Client ID (publico), termina em ".apps.googleusercontent.com". */
  @IsString()
  @IsOptional()
  oauth_client_id?: string | null;

  /** OAuth Client Secret (criptografado), comeca com "GOCSPX-". */
  @IsString()
  @IsOptional()
  oauth_client_secret?: string | null;

  /** Redirect URI registrado no Cloud Console. */
  @IsString()
  @IsOptional()
  oauth_redirect_uri?: string | null;

  /** Base URL do frontend pra redirect pos-OAuth. */
  @IsString()
  @IsOptional()
  frontend_base_url?: string | null;
}

// ─── Mutate (escrita na Google Ads API) ────────────────────────────────────

/**
 * Body comum dos endpoints de mutate. validate_only=true roda em dry-run
 * (modo Conselheiro).
 */
export class MutateBaseDto {
  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Atualizacao de orcamento. Recebe valor em REAIS (BRL) e converte
 * pra micros internamente.
 */
export class UpdateBudgetDto {
  @IsNumber()
  @Min(1)
  @Max(100000) // 100k BRL/dia eh teto sanity
  new_amount_brl!: number;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 1 do backlog (2026-05-17) — Conversion Actions, Ad Groups, RSAs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cria uma ConversionAction nova no Google Ads. Categoria + tipo definem o
 * comportamento (webpage tracking, click-to-call, phone call, etc).
 *
 * `category` define a "semantica" da conversao (SUBMIT_LEAD_FORM, CONTACT, etc)
 * — afeta como Google agrupa relatorios e quais bidding strategies aceitam.
 * `type` define o mecanismo tecnico de coleta (WEBPAGE, PHONE_CALL_LEADS, etc).
 *
 * `include_in_conversions` (default true): entra no Smart Bidding. False =
 * secundaria (so visualizacao em relatorios).
 *
 * `default_value_brl`: valor monetario default por evento (usado em OCI sem
 * value e em bidding TARGET_ROAS / MAXIMIZE_CONVERSION_VALUE).
 *
 * `phone_call_duration_seconds`: se type=PHONE_CALL_LEADS, conta conversao
 * so se ligacao durar >= X segundos.
 */
export class CreateConversionActionDto {
  @IsString()
  name!: string;

  @IsString()
  @IsIn([
    'SUBMIT_LEAD_FORM',
    'CONTACT',
    'PHONE_CALL_LEAD',
    'SIGNUP',
    'DOWNLOAD',
    'PAGE_VIEW',
    'PURCHASE',
    'ADD_TO_CART',
    'BEGIN_CHECKOUT',
    'BOOK_APPOINTMENT',
    'REQUEST_QUOTE',
    'GET_DIRECTIONS',
    'OUTBOUND_CLICK',
    'ENGAGEMENT',
    'STORE_VISIT',
    'STORE_SALE',
    'QUALIFIED_LEAD',
    'CONVERTED_LEAD',
    'OTHER',
  ])
  category!: string;

  @IsString()
  @IsIn([
    'WEBPAGE',
    'AD_CALL',
    'CLICK_TO_CALL',
    'WEBSITE_CALL',
    'UPLOAD_CALLS',
    'UPLOAD_CLICKS',
    'APP_INSTALL',
    'IMPORT',
    'GOOGLE_HOSTED',
  ])
  type!: string;

  @IsBoolean()
  @IsOptional()
  include_in_conversions?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  default_value_brl?: number;

  @IsString()
  @IsIn(['ONE_PER_CLICK', 'MANY_PER_CLICK'])
  @IsOptional()
  counting_type?: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';

  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  click_through_lookback_days?: number;

  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  view_through_lookback_days?: number;

  /** So PHONE_CALL_LEAD type: duracao minima da ligacao pra contar conversao. */
  @IsInt()
  @Min(0)
  @Max(3600)
  @IsOptional()
  phone_call_duration_seconds?: number;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Atualiza ConversionAction existente. Apenas campos enviados sao alterados
 * (mask auto-derivado do payload). Mudanca de `include_in_conversions` em
 * acao com >=50 conv/30d ou de `default_value_brl` em ROAS-using campaigns
 * exige confirm=true (reset de aprendizado).
 */
export class UpdateConversionActionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  include_in_conversions?: boolean;

  @IsBoolean()
  @IsOptional()
  primary_for_goal?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  default_value_brl?: number;

  @IsBoolean()
  @IsOptional()
  always_use_default_value?: boolean;

  @IsString()
  @IsIn([
    'LAST_CLICK',
    'DATA_DRIVEN',
    'FIRST_CLICK',
    'LINEAR',
    'TIME_DECAY',
    'POSITION_BASED',
  ])
  @IsOptional()
  attribution_model?: string;

  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  click_through_lookback_days?: number;

  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  view_through_lookback_days?: number;

  @IsString()
  @IsIn(['ONE_PER_CLICK', 'MANY_PER_CLICK'])
  @IsOptional()
  counting_type?: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';

  @IsString()
  @IsIn(['ENABLED', 'HIDDEN'])
  @IsOptional()
  status?: 'ENABLED' | 'HIDDEN';

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Remove (soft-delete) uma ConversionAction. Status=REMOVED. Bloqueia
 * remocao de acao em uso por bidding strategy ativa sem force_if_used=true.
 */
export class RemoveConversionActionDto {
  @IsBoolean()
  confirm!: boolean;

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsBoolean()
  @IsOptional()
  force_if_used?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 3.1 do backlog (2026-05-17) — Shared library + Location bid
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cria SharedSet de tipo NEGATIVE_KEYWORDS + adiciona N keywords + opcionalmente
 * anexa a N campanhas (atomico em 3 passos sequenciais).
 *
 * Diferenca vs traffic_bulk_add_negatives:
 *   - bulk_add_negatives: replica MESMA lista de keywords em N campanhas
 *     (cada campanha tem suas proprias campaign_criterion negative)
 *   - shared_negative_list: cria UMA lista compartilhada, anexa a N campanhas.
 *     Adicionar keyword nova na lista depois propaga AUTOMATIC pra todas.
 *     Mais higienico pra manter quando lista cresce.
 */
export class CreateSharedNegativeListDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsString()
  @IsIn(['EXACT', 'PHRASE', 'BROAD'])
  match_type!: 'EXACT' | 'PHRASE' | 'BROAD';

  /** IDs internos OR google_campaign_id das campanhas a anexar. Opcional. */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attach_campaign_ids?: string[];

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Anexa SharedSet (negative list) existente a N campanhas.
 * Util quando a lista ja existe (criada via UI ou create anterior) e
 * quer aplicar a campanhas novas.
 */
export class AttachSharedNegativeListDto {
  /** resource_name do SharedSet (customers/X/sharedSets/Y) OU ID numerico. */
  @IsString()
  shared_set_id!: string;

  /** IDs internos OR google_campaign_id das campanhas. */
  @IsArray()
  @IsString({ each: true })
  campaign_ids!: string[];

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Define bid modifiers por localizacao (cidade/regiao especifica).
 * Cria CampaignCriterion location + bid_modifier (1.0=sem ajuste,
 * 1.5=+50%, 0.5=-50%, range 0.1-10.0).
 *
 * geo_target_id: IDs numericos do Google ou resource_name
 * (geoTargetConstants/X). Lista em developers.google.com/google-ads/api/data/geotargets.
 */
export class UpdateLocationBidModifiersDto {
  @IsArray()
  modifiers!: Array<{
    geo_target_id: string;
    bid_modifier: number;
  }>;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 4 do backlog (2026-05-17) — Tier P2 (PMax, calls, oauth, billing)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cria campanha Performance Max nova. MVP simplificado: cria campaign +
 * budget + asset_group placeholder VAZIO. Pra ficar serveable, admin
 * precisa popular o asset_group depois via Google Ads UI (5+ headlines,
 * 5+ descriptions, 1+ logo, 1+ business name, 1+ images).
 *
 * Pra MVP nao recebe assets — admin completa via Google Ads UI.
 * Sprint 4.1 implementa traffic_manage_pmax_asset_group pra automacao.
 */
export class CreatePmaxCampaignDto {
  @IsString()
  name!: string;

  /** Diario em BRL (converte pra micros internamente). */
  @IsNumber()
  @Min(1)
  daily_budget_brl!: number;

  /** Bidding: MAXIMIZE_CONVERSIONS ou MAXIMIZE_CONVERSION_VALUE. */
  @IsString()
  @IsIn(['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE'])
  @IsOptional()
  bidding_strategy?: 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CONVERSION_VALUE';

  /** Target CPA em BRL (se MAXIMIZE_CONVERSIONS) — opcional. */
  @IsNumber()
  @Min(0.5)
  @IsOptional()
  target_cpa_brl?: number;

  /** Target ROAS multiplier (se MAXIMIZE_CONVERSION_VALUE) — opcional. */
  @IsNumber()
  @Min(0.1)
  @IsOptional()
  target_roas?: number;

  /** Final URL principal (landing page). */
  @IsString()
  final_url!: string;

  /** IDs numericos geo_target (Default: ["1001775"]=Brasil). */
  @IsArray()
  @IsString({ each: true })
  geo_target_ids!: string[];

  /** IDs numericos language (Default: ["1014"]=portuguese). */
  @IsArray()
  @IsString({ each: true })
  language_ids!: string[];

  @IsString()
  @IsIn(['ENABLED', 'PAUSED'])
  @IsOptional()
  initial_status?: 'ENABLED' | 'PAUSED';

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Lista chamadas (call_view) registradas pelo Google Ads call tracking.
 * Filtra por janela retroativa (max 90d) e opcionalmente por campanha.
 */
export class GetCallHistoryDto {
  /** Janela em dias retroativos. Default 30, max 90 (limite Google). */
  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  days_back?: number;

  /** Filtra por google_campaign_id. */
  @IsString()
  @IsOptional()
  campaign_id?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 3 do backlog (2026-05-17) — Targeting + Bulk ops
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Atualiza geo targets de uma campanha. `add` cria novos CampaignCriterion
 * com location, `remove` remove existentes via resource_name.
 *
 * geo_target_ids: IDs numericos do Google (ex: "1031620" = Maceio/AL,
 * "1001775" = Brasil). Lista completa em
 * https://developers.google.com/google-ads/api/data/geotargets.
 *
 * negative=true: adiciona como EXCLUSAO de geo (campanha NAO veicula la).
 */
export class UpdateGeoTargetsDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  add?: string[];

  /** resource_names dos criteria a remover (de traffic_list_campaign_criteria). */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  remove?: string[];

  @IsBoolean()
  @IsOptional()
  negative?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Atualiza language targets. language_ids sao IDs numericos de
 * language_constants (ex: "1014" = portuguese, "1000" = english).
 */
export class UpdateLanguageTargetsDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  add?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  remove?: string[];

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Atualiza device targeting (bid modifiers por device).
 *
 * Valores:
 *   1.0 = sem ajuste (default)
 *   0.5 = -50% (reduz lance pela metade)
 *   1.5 = +50% (aumenta lance 50%)
 *   0.1 = -90% (quase nao aparece)
 *
 * null = remove modifier (volta pra default 1.0).
 */
export class UpdateDeviceTargetingDto {
  @IsNumber()
  @Min(0.1)
  @Max(10)
  @IsOptional()
  mobile_modifier?: number | null;

  @IsNumber()
  @Min(0.1)
  @Max(10)
  @IsOptional()
  desktop_modifier?: number | null;

  @IsNumber()
  @Min(0.1)
  @Max(10)
  @IsOptional()
  tablet_modifier?: number | null;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Bulk add negatives — mesma lista de keywords em N campanhas/ad_groups.
 * Mais eficiente que N chamadas separadas (1 mutate batch no Google).
 */
export class BulkAddNegativesDto {
  @IsArray()
  targets!: Array<{
    /** campaign_id OR ad_group_id (exatamente um). */
    campaign_id?: string;
    ad_group_id?: string;
  }>;

  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsString()
  @IsIn(['EXACT', 'PHRASE', 'BROAD'])
  match_type!: 'EXACT' | 'PHRASE' | 'BROAD';

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Bulk pause/resume — N campanhas ou ad_groups numa unica chamada.
 */
export class BulkUpdateStatusDto {
  @IsArray()
  targets!: Array<{
    /** "campaign" | "ad_group" */
    type: 'campaign' | 'ad_group';
    id: string; // UUID interno OR google_id
  }>;

  @IsString()
  @IsIn(['ENABLED', 'PAUSED'])
  status!: 'ENABLED' | 'PAUSED';

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 2 do backlog (2026-05-17) — Extensions/Assets + Quality Score
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cria Asset novo no Google Ads. Tool unificada — `type` define qual
 * sub-message do Asset eh populado.
 *
 * Tipos suportados nesta entrega:
 *   - SITELINK         → sitelink_asset (link_text + final_url)
 *   - CALLOUT          → callout_asset (text)
 *   - STRUCTURED_SNIPPET → structured_snippet_asset (header + values)
 *   - CALL             → call_asset (phone_number + country_code) — ja existe traffic_attach_call_asset
 *   - LOCATION         → location_asset (place_id) — limitado
 *   - PRICE            → price_asset (type + items)
 *   - PROMOTION        → promotion_asset (occasion + percent_off ou money_amount)
 *   - LEAD_FORM        → lead_form_asset (business_name + call_to_action_type + form_fields)
 *
 * Cada tipo tem fields obrigatorios diferentes. `data` eh um JSON livre
 * com o payload especifico do tipo. Validacao detalhada no service.
 */
export class CreateExtensionDto {
  @IsString()
  @IsIn([
    'SITELINK',
    'CALLOUT',
    'STRUCTURED_SNIPPET',
    'CALL',
    'LOCATION',
    'PRICE',
    'PROMOTION',
    'LEAD_FORM',
  ])
  type!: string;

  /** Payload especifico do tipo (sitelink: {text, final_url, description1, description2}, etc). */
  data!: Record<string, any>;

  /**
   * Se passado, ja anexa em conta/campanha/ad_group apos criar. Atomico
   * (cria + attach na mesma chamada pra evitar asset orfao).
   */
  @IsString()
  @IsIn(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP'])
  @IsOptional()
  attach_level?: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';

  @IsString()
  @IsOptional()
  campaign_id?: string;

  @IsString()
  @IsOptional()
  ad_group_id?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Anexa Asset existente a conta/campanha/ad_group. Asset precisa ja
 * existir (foi criado via traffic_create_extension).
 */
export class AttachExtensionDto {
  /** resource_name do asset OU UUID interno se cacheado localmente. */
  @IsString()
  asset_id!: string;

  @IsString()
  @IsIn(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP'])
  level!: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';

  @IsString()
  @IsOptional()
  campaign_id?: string;

  @IsString()
  @IsOptional()
  ad_group_id?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Desanexa um Asset de conta/campanha/ad_group. NAO remove o asset em si
 * — so o vinculo (CustomerAsset/CampaignAsset/AdGroupAsset eh removido).
 * Pra remover o asset, use traffic_remove_extension.
 */
export class DetachExtensionDto {
  @IsString()
  asset_id!: string;

  @IsString()
  @IsIn(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP'])
  level!: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';

  @IsString()
  @IsOptional()
  campaign_id?: string;

  @IsString()
  @IsOptional()
  ad_group_id?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Remove (soft-delete) um Asset propriamente. Detaches em cascata sao
 * automaticos no Google.
 */
export class RemoveExtensionDto {
  @IsString()
  asset_id!: string;

  @IsBoolean()
  confirm!: boolean;

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Trigger manual do cron Enhanced Conversions for Leads upload.
 * Roda fora do schedule diario (04h Maceio) — util pra processar leads
 * recentes apos toggle inicial ou apos manutencao.
 */
export class TriggerEnhancedConvUploadDto {
  /** Janela de dias retroativos pra processar. Default 14, max 90. */
  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  days_back?: number;
}

/**
 * Habilita Enhanced Conversions for Leads na conta.
 *
 * Modo GOOGLE_TAG: flag binaria no customer.conversion_tracking_setting.
 * Google passa a usar dados de userIdentifiers vindos do gtag/GTM no browser.
 *
 * Modo API: alem da flag, liga cron BullMQ daily que sobe userIdentifiers
 * (email/phone hashed SHA-256) de leads recentes via UploadClickConversions
 * mesmo sem gclid. Cobre cookieless world.
 */
export class EnableEnhancedConversionsDto {
  @IsString()
  @IsIn(['GOOGLE_TAG', 'API', 'BOTH'])
  mode!: 'GOOGLE_TAG' | 'API' | 'BOTH';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  user_data_fields?: Array<'email' | 'phone' | 'address'>;

  @IsBoolean()
  confirm!: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Cria AdGroup novo dentro de uma campanha existente.
 *
 * `cpc_bid_brl` aplica-se quando campanha usa MANUAL_CPC. Em Smart Bidding,
 * usado como bid ceiling/floor opcional.
 *
 * `target_cpa_brl` / `target_roas` aplicam override no nivel ad_group quando
 * campanha esta em TARGET_CPA / TARGET_ROAS (raro mas Google permite).
 */
export class CreateAdGroupDto {
  @IsString()
  name!: string;

  @IsString()
  @IsIn(['SEARCH_STANDARD', 'SEARCH_DYNAMIC_ADS', 'DISPLAY_STANDARD'])
  @IsOptional()
  type?: 'SEARCH_STANDARD' | 'SEARCH_DYNAMIC_ADS' | 'DISPLAY_STANDARD';

  @IsString()
  @IsIn(['ENABLED', 'PAUSED'])
  @IsOptional()
  status?: 'ENABLED' | 'PAUSED';

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  cpc_bid_brl?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  target_cpa_brl?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  target_roas?: number;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Atualiza AdGroup existente. Apenas campos enviados sao alterados.
 *
 * `rotation`: OPTIMIZE = Google decide qual ad mostrar mais (default e
 * recomendado). ROTATE_FOREVER = rotacao igual entre ads (perde optimizacao,
 * usar so em A/B test).
 */
export class UpdateAdGroupDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsIn(['ENABLED', 'PAUSED'])
  @IsOptional()
  status?: 'ENABLED' | 'PAUSED';

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  cpc_bid_brl?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  target_cpa_brl?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  target_roas?: number;

  @IsString()
  @IsIn(['OPTIMIZE', 'ROTATE_FOREVER'])
  @IsOptional()
  rotation?: 'OPTIMIZE' | 'ROTATE_FOREVER';

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Atualiza um RSA existente. Google Ads NAO suporta UPDATE em ads — eh
 * imutavel. Implementacao usa pattern "substituir": cria novo RSA com mesmo
 * ad_group + remove o antigo (status=REMOVED). Operacao atomica do ponto de
 * vista do CRM (mutate_log unico cobre os 2 passos).
 *
 * Mesmas validacoes OAB de create_rsa rodam automaticas.
 * `confirm=true` exigido se ad tem >=100 impressoes nos ultimos 7d (mudanca
 * reseta aprendizado do anuncio).
 */
export class UpdateRsaDto {
  /** Final URL — landing page do novo ad. Required (mesmo q copie). */
  @IsString()
  final_url!: string;

  @IsArray()
  @IsString({ each: true })
  headlines!: string[];

  @IsArray()
  @IsString({ each: true })
  descriptions!: string[];

  @IsString()
  @IsOptional()
  path1?: string;

  @IsString()
  @IsOptional()
  path2?: string;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Remove (soft-delete) um ad individual.
 */
export class RemoveAdDto {
  @IsBoolean()
  confirm!: boolean;

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Cria Call Asset (substituto do CallAd que foi removido em v23) e anexa
 * a uma campanha ou ad_group ou a toda a conta.
 *
 * Phone vem do TrafficSettings.business_phone_e164 se nao explicito.
 * Business name vem do TrafficSettings.business_name se nao explicito.
 *
 * `call_tracked=true`: Google injeta call tracking number visivel em vez
 * do numero real, e reporta calls como conversoes (se mapeado).
 */
export class AttachCallAssetDto {
  @IsString()
  @IsIn(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP'])
  level!: 'ACCOUNT' | 'CAMPAIGN' | 'AD_GROUP';

  @IsString()
  @IsOptional()
  campaign_id?: string;

  @IsString()
  @IsOptional()
  ad_group_id?: string;

  /** E.164: +5582999999999. Default: TrafficSettings.business_phone_e164. */
  @IsString()
  @IsOptional()
  phone_number?: string;

  /** ISO 3166 alpha-2. Default: "BR". */
  @IsString()
  @IsOptional()
  country_code?: string;

  @IsBoolean()
  @IsOptional()
  call_tracked?: boolean;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Remove (soft-delete) uma campanha. Soft-delete via status=REMOVED.
 *
 * Spec: confirm obrigatorio sempre, reason obrigatorio com min 3 chars.
 * Salvaguardas adicionais:
 *   - force_if_enabled: required quando status=ENABLED no momento
 *   - confirm_with_history: required quando campanha tem >=10 conv lifetime,
 *     >=R$500 gasto historico, OU esteve ENABLED nos ultimos 7 dias
 *
 * Validate_only=true retorna preview do cascade (ad_groups, ads, keywords
 * que vao junto) sem aplicar.
 */
export class RemoveCampaignDto {
  @IsBoolean()
  confirm!: boolean;

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsBoolean()
  @IsOptional()
  force_if_enabled?: boolean;

  @IsBoolean()
  @IsOptional()
  confirm_with_history?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Remove (soft-delete) um ad_group. Mesmo padrao de RemoveCampaignDto.
 * Adicional: backend bloqueia se for o UNICO ad_group ativo da campanha
 * (sem isso a campanha fica orfã sem onde servir).
 */
export class RemoveAdGroupDto {
  @IsBoolean()
  confirm!: boolean;

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsBoolean()
  @IsOptional()
  force_if_enabled?: boolean;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Adiciona keywords positivas a um ad_group.
 */
export class AddKeywordsDto {
  @IsArray()
  keywords!: Array<{
    text: string;
    match_type: 'EXACT' | 'PHRASE' | 'BROAD';
    cpc_bid_brl?: number;
  }>;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * Adiciona keywords negativas. Scope=CAMPAIGN ou AD_GROUP.
 */
export class AddNegativesDto {
  @IsString()
  @IsIn(['CAMPAIGN', 'AD_GROUP'])
  scope!: 'CAMPAIGN' | 'AD_GROUP';

  @IsArray()
  negatives!: Array<{
    text: string;
    match_type: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

// ─── Conversion Actions ────────────────────────────────────────────────────

/**
 * Mapeia uma ConversionAction do Google a um evento do CRM. Quando o evento
 * dispara (lead.created, client.signed, payment.received), o sistema sobe
 * automaticamente um OCI nessa conversao.
 */
export class MapConversionActionDto {
  /** Evento do CRM. null = desfazer mapeamento. */
  @IsString()
  @IsOptional()
  crm_event_kind?: string | null;

  /** Valor padrao em BRL atribuido a essa conversao. null = sem valor. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  default_value_brl?: number | null;
}

// ─── Filtros do dashboard ───────────────────────────────────────────────────

export class DashboardQueryDto {
  /**
   * Atalho de período para os KPIs principais. Sobrescreve date_from/date_to
   * quando presente. Default: '7d'.
   *   - today      → apenas hoje
   *   - 7d         → últimos 7 dias (default histórico do dashboard)
   *   - 30d        → últimos 30 dias
   *   - month      → 1º dia do mês corrente até hoje
   *   - prev_month → mês anterior completo
   */
  @IsString()
  @IsOptional()
  @IsIn(['today', '7d', '30d', 'month', 'prev_month'])
  period?: 'today' | '7d' | '30d' | 'month' | 'prev_month';

  /** ISO date (YYYY-MM-DD). Default: 30d atras. */
  @IsString()
  @IsOptional()
  date_from?: string;

  /** ISO date (YYYY-MM-DD). Default: hoje. */
  @IsString()
  @IsOptional()
  date_to?: string;

  /** Filtra por tipo de campanha (ex: SEARCH, PERFORMANCE_MAX). */
  @IsString()
  @IsOptional()
  channel_type?: string;

  /** ISO date (YYYY-MM-DD) — para comparativo de periodo. */
  @IsString()
  @IsOptional()
  compare_from?: string;

  @IsString()
  @IsOptional()
  compare_to?: string;
}

// ─── IA Otimizadora (Sprint C) ─────────────────────────────────────────────

export class ListAiDecisionsDto {
  @IsString()
  @IsOptional()
  @IsIn(['EXECUTE', 'SUGGEST', 'BLOCK', 'NOTIFY_ONLY', 'FAILED'])
  action?: 'EXECUTE' | 'SUGGEST' | 'BLOCK' | 'NOTIFY_ONLY' | 'FAILED';

  @IsString()
  @IsOptional()
  kind?: string;

  @IsString()
  @IsOptional()
  @IsIn(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'TRIGGERED'])
  loop_kind?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'TRIGGERED';

  @IsString()
  @IsOptional()
  @IsIn(['APPROVED', 'REVERTED', 'IGNORED', 'PENDING'])
  feedback?: 'APPROVED' | 'REVERTED' | 'IGNORED' | 'PENDING';

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AiDecisionFeedbackDto {
  @IsString()
  @IsIn(['APPROVED', 'REVERTED', 'IGNORED'])
  feedback!: 'APPROVED' | 'REVERTED' | 'IGNORED';

  @IsString()
  @IsOptional()
  note?: string;

  /**
   * Sprint G.5 — Quando true e feedback=IGNORED, cria TrafficIAMemory com
   * TTL 365d pra suprimir esta combinação (decision_kind, resource_id) por
   * 1 ano (efetivamente "ignorar permanentemente"). O filtro de memória
   * adaptativa respeita esse veto.
   */
  @IsBoolean()
  @IsOptional()
  permanent?: boolean;
}

export class AiTriggerLoopDto {
  @IsString()
  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'TRIGGERED'])
  loop_kind?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'TRIGGERED';
}

export class UpdateAiPolicyDto {
  @IsBoolean()
  @IsOptional()
  agent_enabled?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['ADVISOR', 'AUTONOMOUS'])
  mode?: 'ADVISOR' | 'AUTONOMOUS';

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(500)
  max_auto_actions_per_day?: number;

  @IsNumber()
  @IsOptional()
  @Min(0.5)
  @Max(1)
  min_confidence_for_auto?: number;

  @IsBoolean()
  @IsOptional()
  auto_apply_negative_keywords?: boolean;

  @IsBoolean()
  @IsOptional()
  auto_apply_pause_disapproved?: boolean;

  @IsBoolean()
  @IsOptional()
  auto_apply_rsa_asset_recommendations?: boolean;

  @IsBoolean()
  @IsOptional()
  auto_apply_budget_changes?: boolean;

  @IsBoolean()
  @IsOptional()
  auto_apply_bidding_strategy_changes?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0.01)
  @Max(0.5)
  max_budget_change_percent?: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(7)
  max_budget_change_per_week?: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(500)
  max_negatives_per_week?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(168)
  rollback_window_hours?: number;

  @IsBoolean()
  @IsOptional()
  notify_admin_email?: boolean;

  @IsBoolean()
  @IsOptional()
  notify_admin_whatsapp?: boolean;

  @IsBoolean()
  @IsOptional()
  notify_admin_inapp?: boolean;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(168)
  escalation_hours?: number;

  @IsBoolean()
  @IsOptional()
  hourly_enabled?: boolean;

  @IsBoolean()
  @IsOptional()
  shadow_mode?: boolean;

  // ─── Sprint G: LLM + cooldowns ─────────────────────────────────────────
  @IsString()
  @IsOptional()
  @IsIn(['anthropic', 'openai'])
  llm_provider?: 'anthropic' | 'openai';

  @IsString()
  @IsOptional()
  llm_summary_model?: string;

  @IsString()
  @IsOptional()
  llm_classify_model?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(365)
  ignored_cooldown_days?: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(365)
  reverted_penalty_days?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(20)
  max_resuggestion_strikes?: number;
}

// ─── Lead Form Asset (Sprint D) ─────────────────────────────────────────────

export class ListLeadFormSubmissionsDto {
  @IsString()
  @IsOptional()
  @IsIn(['PENDING', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'ERROR'])
  status?: 'PENDING' | 'PROCESSED' | 'DUPLICATE' | 'REJECTED' | 'ERROR';

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;
}

// ─── Sprint I (Fase 4) — Criar campanha + Bidding + RSA ────────────────────

export class CreateSearchCampaignDto {
  @IsString()
  name!: string;

  /** Orçamento diário em BRL (convertido pra micros internamente). */
  @IsNumber()
  @Min(1)
  daily_budget_brl!: number;

  @IsString()
  @IsIn([
    'MAXIMIZE_CONVERSIONS',
    'MAXIMIZE_CLICKS',
    'MANUAL_CPC',
    'TARGET_CPA',
  ])
  bidding_strategy!:
    | 'MAXIMIZE_CONVERSIONS'
    | 'MAXIMIZE_CLICKS'
    | 'MANUAL_CPC'
    | 'TARGET_CPA';

  /** Obrigatório se bidding_strategy=TARGET_CPA. Em BRL. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  target_cpa_brl?: number;

  /**
   * IDs numéricos de geo_target_constants do Google. Default: ["1001775"]
   * (Brasil). Para cidades específicas use o código do AdWords (ex:
   * "1031620" = Maceió/AL).
   */
  @IsArray()
  @IsString({ each: true })
  geo_target_ids!: string[];

  /** IDs numéricos de language_constants. Default: ["1014"] (Portuguese). */
  @IsArray()
  @IsString({ each: true })
  language_ids!: string[];

  @IsString()
  @IsOptional()
  final_url?: string;

  /** Status inicial — default 'PAUSED' por segurança. */
  @IsString()
  @IsIn(['ENABLED', 'PAUSED'])
  @IsOptional()
  initial_status?: 'ENABLED' | 'PAUSED';

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

/**
 * DTO de atualizacao de bidding strategy.
 *
 * Expandido em 2026-05-17 a pedido do agente externo:
 *   - Adicionado TARGET_IMPRESSION_SHARE e TARGET_SPEND no enum
 *   - Novos campos: target_impression_share_pct, target_impression_share_location,
 *     max_cpc_bid_ceiling_brl, confirm
 *   - Mantida compat: ordem dos campos antigos preservada, defaults idem.
 *
 * Validacoes condicionais (TARGET_CPA exige target_cpa_brl etc) ficam no
 * controller, antes do enqueue — pra poder retornar warnings ao usuario.
 * Bloqueios (TARGET_SPEND deprecated, MANUAL_CPC sem confirm) tambem no
 * controller. Ver trafego.controller.ts#updateBiddingStrategy.
 */
export class UpdateBiddingStrategyDto {
  @IsString()
  @IsIn([
    'MAXIMIZE_CONVERSIONS',
    'MAXIMIZE_CONVERSION_VALUE',
    'TARGET_CPA',
    'TARGET_ROAS',
    'MAXIMIZE_CLICKS',
    'TARGET_IMPRESSION_SHARE',
    'MANUAL_CPC',
    'TARGET_SPEND',
  ])
  bidding_strategy!:
    | 'MAXIMIZE_CONVERSIONS'
    | 'MAXIMIZE_CONVERSION_VALUE'
    | 'TARGET_CPA'
    | 'TARGET_ROAS'
    | 'MAXIMIZE_CLICKS'
    | 'TARGET_IMPRESSION_SHARE'
    | 'MANUAL_CPC'
    | 'TARGET_SPEND';

  /** Em BRL — obrigatório se TARGET_CPA. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  target_cpa_brl?: number;

  /** Multiplicador — obrigatório se TARGET_ROAS. Ex: 3.5 = 350%. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  target_roas?: number;

  /** 0.01..1.0 — obrigatório se TARGET_IMPRESSION_SHARE. */
  @IsNumber()
  @Min(0.01)
  @Max(1.0)
  @IsOptional()
  target_impression_share_pct?: number;

  /** Default ANYWHERE_ON_PAGE quando TARGET_IMPRESSION_SHARE. */
  @IsString()
  @IsIn(['ANYWHERE_ON_PAGE', 'TOP_OF_PAGE', 'ABSOLUTE_TOP_OF_PAGE'])
  @IsOptional()
  target_impression_share_location?:
    | 'ANYWHERE_ON_PAGE'
    | 'TOP_OF_PAGE'
    | 'ABSOLUTE_TOP_OF_PAGE';

  /** Teto de CPC opcional pra TARGET_CPA/TARGET_ROAS/TARGET_IMPRESSION_SHARE. */
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  max_cpc_bid_ceiling_brl?: number;

  /**
   * Required em mudancas de alto risco:
   *   - Sair de Smart Bidding com >=30 conv/30d (perde aprendizado)
   *   - MANUAL_CPC (raro hoje em dia, geralmente erro de digitacao)
   *   - target_cpa_brl < 0.5 BRL (suspeitamente baixo)
   *   - target_roas > 50 (5000%, suspeito)
   */
  @IsBoolean()
  @IsOptional()
  confirm?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

export class CreateRsaDto {
  /** Final URL — landing page do anúncio. */
  @IsString()
  final_url!: string;

  /**
   * Headlines (3..15). Google exige mínimo 3, máximo 15.
   * Limit: 30 chars cada.
   */
  @IsArray()
  @IsString({ each: true })
  headlines!: string[];

  /**
   * Descriptions (2..4). Google exige mínimo 2, máximo 4.
   * Limit: 90 chars cada.
   */
  @IsArray()
  @IsString({ each: true })
  descriptions!: string[];

  /** Path1/Path2 — display URL (opcional, max 15 chars cada). */
  @IsString()
  @IsOptional()
  path1?: string;

  @IsString()
  @IsOptional()
  path2?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  /** Modo dry-run — Google valida mas não cria. */
  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

// ─── Ad Schedule (P3) ──────────────────────────────────────────────────────

/** Um slot de horário de veiculação. */
class AdScheduleSlotDto {
  @IsString()
  @IsIn([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ])
  day_of_week!:
    | 'MONDAY'
    | 'TUESDAY'
    | 'WEDNESDAY'
    | 'THURSDAY'
    | 'FRIDAY'
    | 'SATURDAY'
    | 'SUNDAY';

  @IsInt()
  @Min(0)
  @Max(23)
  start_hour!: number;

  @IsInt()
  @IsIn([0, 15, 30, 45])
  start_minute!: number;

  @IsInt()
  @Min(0)
  @Max(24)
  end_hour!: number;

  @IsInt()
  @IsIn([0, 15, 30, 45])
  end_minute!: number;

  /** Bid modifier 0.1..10.0. null/omitido = sem ajuste. */
  @IsNumber()
  @Min(0.1)
  @Max(10)
  @IsOptional()
  bid_modifier?: number | null;
}

export class UpdateAdScheduleDto {
  /** Lista de slots (substituição completa). Vazio = roda 24/7. */
  @IsArray()
  slots!: AdScheduleSlotDto[];

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  validate_only?: boolean;
}

// ─── Landing Pages (Fase 4f) ───────────────────────────────────────────────

export class CreateLandingPageDto {
  @IsString()
  url!: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  campaign_id?: string | null;
}

export class UpdateLandingPageDto {
  @IsString()
  @IsOptional()
  title?: string | null;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsString()
  @IsOptional()
  campaign_id?: string | null;
}

export class GenerateRsaDto {
  /** Área do Direito (ex: "trabalhista", "criminal", "previdenciário"). */
  @IsString()
  practice_area!: string;

  /** Cidade alvo (ex: "Maceió"). */
  @IsString()
  city!: string;

  /** Diferenciais opcionais (ex: "20 anos", "primeira consulta gratuita"). */
  @IsString()
  @IsOptional()
  differentials?: string;

  /** URL final da landing page — vai pro contexto do prompt. */
  @IsString()
  @IsOptional()
  final_url?: string;
}

export class UpdateLeadFormSettingsDto {
  @IsString()
  @IsOptional()
  lead_form_webhook_secret?: string;

  @IsBoolean()
  @IsOptional()
  lead_form_auto_create_lead?: boolean;

  @IsString()
  @IsOptional()
  lead_form_default_stage?: string;
}

// ─── Customer Match (Sprint D) ──────────────────────────────────────────────

export class CreateUserListDto {
  @IsString()
  @IsIn(['CLIENTES_ATIVOS', 'LEADS_QUALIFICADOS', 'LOOKALIKE_BASE', 'CUSTOM'])
  kind!: 'CLIENTES_ATIVOS' | 'LEADS_QUALIFICADOS' | 'LOOKALIKE_BASE' | 'CUSTOM';

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(540)
  membership_lifespan_days?: number;
}

export class TriggerCustomerMatchSyncDto {
  @IsString()
  @IsOptional()
  user_list_id?: string;
}

// ─── Recommendations API (Sprint E) ─────────────────────────────────────────

export class ListRecommendationsDto {
  @IsString()
  @IsOptional()
  @IsIn([
    'PENDING',
    'READY',
    'OAB_BLOCKED',
    'APPLIED',
    'DISMISSED',
    'EXPIRED',
    'ERROR',
  ])
  status?:
    | 'PENDING'
    | 'READY'
    | 'OAB_BLOCKED'
    | 'APPLIED'
    | 'DISMISSED'
    | 'EXPIRED'
    | 'ERROR';

  @IsString()
  @IsOptional()
  type?: string;

  // @Type(() => Number) eh obrigatorio em query params numericos.
  // Sem isso, "100" chega como string e @IsInt/@Min/@Max falham TODOS,
  // produzindo mensagem confusa "limit must not be greater than 300;
  // limit must not be less than 1; limit must be an integer number"
  // (bug reportado pelo agente externo em 2026-05-17). NestJS sem
  // global transform:true precisa de @Type pra coercao.
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(300)
  limit?: number;
}

export class ApplyRecommendationDto {
  /** Bypass do filtro OAB (admin override). Default false. */
  @IsBoolean()
  @IsOptional()
  force?: boolean;
}

// ─── Reach Planner (Sprint F) ───────────────────────────────────────────────

// ─── Backfill (Sprint H.1) ──────────────────────────────────────────────────

export class StartBackfillDto {
  /** YYYY-MM-DD. Default 24 meses atrás. Max 5 anos. */
  @IsString()
  @IsOptional()
  target_from?: string;
}

// ─── Chat (Sprint H.5) ──────────────────────────────────────────────────────

export class CreateChatSessionDto {
  @IsString()
  @IsOptional()
  title?: string;
}

export class SendChatMessageDto {
  @IsString()
  text!: string;
}

export class RejectChatActionDto {
  @IsString()
  @IsOptional()
  note?: string;
}

export class GenerateReachForecastDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(180)
  duration_days?: number;

  @IsArray()
  @IsString({ each: true })
  location_ids!: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  age_ranges?: string[];

  @IsArray()
  @IsOptional()
  genders?: any[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  devices?: Array<'DESKTOP' | 'MOBILE' | 'TABLET' | 'CONNECTED_TV'>;

  @IsString()
  @IsOptional()
  @IsIn(['YOUTUBE', 'GOOGLE_VIDEO_PARTNERS', 'YOUTUBE_AND_PARTNERS'])
  network?: 'YOUTUBE' | 'GOOGLE_VIDEO_PARTNERS' | 'YOUTUBE_AND_PARTNERS';

  @IsArray()
  products!: Array<{ code: string; budget_brl: number }>;
}
