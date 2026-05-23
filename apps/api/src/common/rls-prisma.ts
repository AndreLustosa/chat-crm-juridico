import { getTenantId, isInTenantTx, runInTenantTx } from './tenant-context';

const SET_TENANT = `SELECT set_config('app.tenant_id', $1, true)`;

/**
 * Aplica a extensão de RLS no PrismaClient. Objetivo: toda query da request
 * rodar com `SET LOCAL app.tenant_id` na MESMA conexão/transação, pra a policy
 * RLS filtrar pelo tenant. Validado no staging (mecanismo {A:2,B:1,none:0} +
 * caminho de leitura ponta a ponta).
 *
 * `base` = client SEM extensão (usado pra set_config/$transaction → evita recursão).
 *
 * Duas frentes cobertas:
 *  1) Operações soltas (findMany, create, etc.): `$allOperations` embrulha cada
 *     uma numa transação que seta a GUC. Pula quando não há tenant (fail-closed
 *     no banco) ou quando já estamos dentro de uma transação (inTx).
 *  2) `$transaction` (array e interativa) dos services: override central injeta
 *     o SET LOCAL no início da transação e marca `inTx`, pra as operações
 *     internas NÃO re-embrulharem (evita transação aninhada). Cobre os 22 sites
 *     sem editar cada um.
 *
 * Processos de sistema (crons/webhook) entram via runWithTenant no seu próprio
 * contexto (ou usam o role com bypass) — tratados à parte.
 */
export function applyRlsExtension(base: any): any {
  return base.$extends({
    query: {
      async $allOperations({ args, query }: any) {
        const tid = getTenantId();
        if (tid == null || isInTenantTx()) return query(args);
        const [, result] = await base.$transaction([
          base.$executeRawUnsafe(SET_TENANT, tid),
          query(args),
        ]);
        return result;
      },
    },
    client: {
      $transaction(this: any, ...txArgs: any[]) {
        const tid = getTenantId();
        const first = txArgs[0];

        // Forma interativa: $transaction(async (tx) => {...}, options?)
        if (typeof first === 'function') {
          return base.$transaction(
            (tx: any) =>
              runInTenantTx(async () => {
                if (tid != null) await tx.$executeRawUnsafe(SET_TENANT, tid);
                return first(tx);
              }),
            txArgs[1],
          );
        }

        // Forma array: $transaction([op1, op2, ...], options?)
        const ops = first as any[];
        if (tid == null) return base.$transaction(ops, txArgs[1]);
        return runInTenantTx(async () => {
          const res = await base.$transaction(
            [base.$executeRawUnsafe(SET_TENANT, tid), ...ops],
            txArgs[1],
          );
          return (res as any[]).slice(1);
        });
      },
    },
  });
}
