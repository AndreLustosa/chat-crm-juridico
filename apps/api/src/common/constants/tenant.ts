/**
 * Tenant default usado como fallback quando tenant_id ausente em codigo legado.
 *
 * Contexto: apos a migration `2026-05-07-tenant-id-not-null-batch.sql`, todos
 * os 32 models legados passaram a ter `tenant_id NOT NULL`. Antes, varios sites
 * faziam `data: { tenant_id: tenantId || null }` — agora isso quebra com
 * NOT NULL violation. Pra manter compat sem refatorar 13+ callers, esses
 * sites passam a usar `DEFAULT_TENANT_ID` como fallback.
 *
 * Em producao single-tenant atual, esse UUID identifica o "Escritorio Padrao"
 * (vide diagnostico pre-migration: tenants_total = 1, default_tenant_id =
 * '00000000-0000-0000-0000-000000000000'). Em deploys multi-tenant futuros,
 * cada caller deve ser refatorado pra exigir `tenantId: string` (obrigatorio)
 * em vez de cair no fallback.
 *
 * NUNCA use isso pra "ignorar" tenant_id — sempre prefira passar o tenantId
 * real do contexto (req.user.tenant_id, JWT payload, etc).
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Retorna o tenantId fornecido ou o DEFAULT_TENANT_ID.
 *
 * Use em sites onde o caller pode passar undefined/null por razoes legadas
 * (ex: tasks criadas pelo sistema sem operador autenticado). Pra contextos
 * autenticados (req.user.tenant_id), prefira passar o tenantId direto e
 * deixar Prisma falhar se for null (sinal de bug a corrigir).
 */
export function tenantOrDefault(tenantId: string | null | undefined): string {
  return tenantId || DEFAULT_TENANT_ID;
}
