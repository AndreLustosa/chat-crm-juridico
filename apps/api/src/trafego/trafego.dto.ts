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
