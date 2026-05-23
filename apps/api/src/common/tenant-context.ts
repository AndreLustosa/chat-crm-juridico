import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  tenantId: string | null;
}

const storage = new AsyncLocalStorage<TenantStore>();

/** tenant_id da request atual (null = sem contexto → a RLS fecha tudo). */
export function getTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

/** Roda `fn` (e tudo o que for async dentro dela) com o tenant no contexto. */
export function runWithTenant<T>(tenantId: string | null, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/**
 * Liga a RLS (app conecta como role `crm_app` + `SET LOCAL app.tenant_id`
 * por request). Default OFF → comportamento atual 100% intacto. Só ligamos
 * (TENANT_RLS_ENABLED=true) em staging e, depois de validado, em produção.
 * Ver Fase 0.5b-2.
 */
export const TENANT_RLS_ENABLED = process.env.TENANT_RLS_ENABLED === 'true';
