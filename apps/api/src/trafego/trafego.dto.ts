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

export class UpdateBiddingStrategyDto {
  @IsString()
  @IsIn([
    'MAXIMIZE_CONVERSIONS',
    'MAXIMIZE_CLICKS',
    'MANUAL_CPC',
    'TARGET_CPA',
    'TARGET_ROAS',
    'MAXIMIZE_CONVERSION_VALUE',
  ])
  bidding_strategy!:
    | 'MAXIMIZE_CONVERSIONS'
    | 'MAXIMIZE_CLICKS'
    | 'MANUAL_CPC'
    | 'TARGET_CPA'
    | 'TARGET_ROAS'
    | 'MAXIMIZE_CONVERSION_VALUE';

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
