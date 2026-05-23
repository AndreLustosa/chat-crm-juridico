/**
 * SaaS Fase 1 — avaliação de assinatura/trial por tenant.
 *
 * Função PURA usada em dois lugares (fonte única de verdade):
 *   1) SubscriptionGuard — decide se a request é bloqueada (HTTP 402).
 *   2) GET /me/subscription — informa o frontend (banner de trial / tela de bloqueio).
 *
 * Regras de acesso:
 *   - is_internal=true  → SEMPRE ativo (escritórios do dono; nunca expiram).
 *   - ACTIVE            → ativo (assinatura paga em dia).
 *   - TRIALING          → ativo SE trial_ends_at no futuro; senão expira (TRIAL_EXPIRED).
 *   - PAST_DUE          → bloqueado (pagamento falhou; Fase 2 pode dar carência).
 *   - CANCELED/EXPIRED  → bloqueado.
 */

/** Flags de ambiente (lidas uma vez no boot, como TENANT_RLS_ENABLED). */
export const SAAS_SIGNUP_ENABLED = process.env.SAAS_SIGNUP_ENABLED === 'true';
export const SAAS_GATING_ENABLED = process.env.SAAS_GATING_ENABLED === 'true';

/** Dias de trial gratuito (default 15). Parametrizável por env. */
export const TRIAL_DAYS = (() => {
  const n = parseInt(process.env.SAAS_TRIAL_DAYS || '15', 10);
  return Number.isFinite(n) && n > 0 ? n : 15;
})();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SubscriptionReason =
  | 'INTERNAL'
  | 'ACTIVE'
  | 'TRIAL'
  | 'TRIAL_EXPIRED'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED'
  | 'UNKNOWN';

/** Subconjunto dos campos de assinatura do Tenant que a avaliação precisa. */
export interface TenantSubscriptionFields {
  is_internal: boolean;
  subscription_status: string | null;
  trial_ends_at: Date | null;
  current_period_end?: Date | null;
  plan?: string | null;
}

export interface SubscriptionEvaluation {
  /** Pode usar o sistema? (true = liberado) */
  active: boolean;
  /** Escritório interno do dono (nunca expira). */
  is_internal: boolean;
  /** Está em período de teste? */
  is_trial: boolean;
  /** Motivo da decisão (telemetria / UI). */
  reason: SubscriptionReason;
  /** Status salvo no banco (cru). */
  status: string;
  /** Fim do trial (ISO) ou null. */
  trial_ends_at: string | null;
  /** Fim do período pago atual (ISO) ou null. */
  current_period_end: string | null;
  /** Dias restantes do trial (>=0) ou null se não for trial. */
  days_remaining: number | null;
  /** Plano (TRIAL, etc.) ou null. */
  plan: string | null;
}

/**
 * Avalia o estado de assinatura de um tenant. Pura e determinística (recebe
 * `now` injetável para testes).
 */
export function evaluateSubscription(
  t: TenantSubscriptionFields,
  now: Date = new Date(),
): SubscriptionEvaluation {
  const status = (t.subscription_status || '').toUpperCase();
  const trialEndsAtIso = t.trial_ends_at ? t.trial_ends_at.toISOString() : null;
  const periodEndIso = t.current_period_end ? t.current_period_end.toISOString() : null;
  const plan = t.plan ?? null;

  const base = {
    is_internal: !!t.is_internal,
    status: t.subscription_status || 'UNKNOWN',
    trial_ends_at: trialEndsAtIso,
    current_period_end: periodEndIso,
    plan,
  };

  // 1) Escritório interno do dono — sempre liberado.
  if (t.is_internal) {
    return { active: true, is_trial: false, reason: 'INTERNAL', days_remaining: null, ...base };
  }

  // 2) Assinatura paga em dia.
  if (status === 'ACTIVE') {
    return { active: true, is_trial: false, reason: 'ACTIVE', days_remaining: null, ...base };
  }

  // 3) Trial — ativo enquanto trial_ends_at estiver no futuro.
  if (status === 'TRIALING') {
    const ends = t.trial_ends_at ? t.trial_ends_at.getTime() : 0;
    const stillValid = !!t.trial_ends_at && ends > now.getTime();
    const daysRemaining = t.trial_ends_at
      ? Math.max(0, Math.ceil((ends - now.getTime()) / MS_PER_DAY))
      : 0;
    if (stillValid) {
      return { active: true, is_trial: true, reason: 'TRIAL', days_remaining: daysRemaining, ...base };
    }
    return { active: false, is_trial: true, reason: 'TRIAL_EXPIRED', days_remaining: 0, ...base };
  }

  // 4) Demais estados (PAST_DUE / CANCELED / EXPIRED / desconhecido) → bloqueado.
  let reason: SubscriptionReason = 'UNKNOWN';
  if (status === 'PAST_DUE') reason = 'PAST_DUE';
  else if (status === 'CANCELED') reason = 'CANCELED';
  else if (status === 'EXPIRED') reason = 'EXPIRED';
  return { active: false, is_trial: false, reason, days_remaining: null, ...base };
}
