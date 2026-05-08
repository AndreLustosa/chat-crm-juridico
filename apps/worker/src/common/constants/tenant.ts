/**
 * Espelho da constante de apps/api/src/common/constants/tenant.ts
 * (mesma justificativa: fallback pra codigo legado apos tenant_id NOT NULL).
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export function tenantOrDefault(tenantId: string | null | undefined): string {
  return tenantId || DEFAULT_TENANT_ID;
}
