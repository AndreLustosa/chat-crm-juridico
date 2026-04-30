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
  limit?: number;
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
