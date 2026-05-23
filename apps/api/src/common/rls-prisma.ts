import { getTenantId } from './tenant-context';

/**
 * Aplica a extensão de RLS no PrismaClient: cada operação roda dentro de uma
 * transação que faz `SET LOCAL app.tenant_id` (via set_config(..., true)), pra
 * a policy RLS filtrar pelo tenant da request. Padrão validado no staging
 * (Fase 0.5b-2): tenant A → só A, B → só B, sem contexto → 0 linhas (fail-closed).
 *
 * `base` é o client SEM a extensão — usado para o set_config + $transaction,
 * evitando recursão no $allOperations.
 *
 * Sem tenant no contexto (getTenantId() === null) NÃO setamos a GUC: a query
 * cai no fail-closed da RLS (não vê nada). Processos de sistema (worker/crons)
 * usam o role com bypass (crm_user), não este client.
 *
 * ATENÇÃO (cobertura): operações dentro de `$transaction` (array/interativa)
 * dos services NÃO passam por este wrapper — cada uma precisa setar a GUC no
 * início da transação. Há 22 ocorrências de $transaction no apps/api a cobrir
 * (encontradas e ajustadas via teste funcional no staging antes do cutover).
 */
export function applyRlsExtension(base: any): any {
  return base.$extends({
    query: {
      async $allOperations({ args, query }: any) {
        const tenantId = getTenantId();
        if (tenantId == null) return query(args);
        const [, result] = await base.$transaction([
          base.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId),
          query(args),
        ]);
        return result;
      },
    },
  });
}
