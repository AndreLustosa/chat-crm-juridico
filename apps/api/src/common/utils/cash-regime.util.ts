/**
 * Helpers para regime de caixa em queries de FinancialTransaction.
 *
 * Definição: "realizado em [from..to]" significa o que efetivamente
 * entrou ou saiu de caixa nesse intervalo. Pra transações com
 * status='PAGO':
 *   - se paid_at está preenchido, usa ele (caso comum, fluxo Asaas
 *     populando ao receber webhook RECEIVED)
 *   - se paid_at é null (dado legado/dirty), usa date como fallback
 *
 * O fallback existe pra não perder transações antigas no relatório.
 * Em prod, espera-se que paid_at sempre esteja preenchido (ver
 * manual-sql/2026-04-28-backfill-paid-at.sql).
 */

/**
 * Retorna o where clause Prisma que filtra transações por regime de caixa.
 *
 * Combine com outros filtros (type, status, tenant_id, lawyer_id) usando
 * spread:
 *   const where = {
 *     type: 'RECEITA',
 *     status: 'PAGO',
 *     ...cashRegimeWhere(monthStart, monthEnd),
 *   };
 */
export function cashRegimeWhere(from: Date, to: Date) {
  return {
    OR: [
      // Caso 1: paid_at preenchido — usa data do pagamento real.
      { paid_at: { gte: from, lte: to } },
      // Caso 2: paid_at null (legado) — fallback pra date.
      // Combinacao explicita de { paid_at: null } com filtro de date evita
      // pegar transactions com paid_at fora do intervalo cuja date casa.
      {
        AND: [
          { paid_at: null },
          { date: { gte: from, lte: to } },
        ],
      },
    ],
  };
}

/**
 * Retorna a data efetiva de uma transação pra agrupamento (cash flow,
 * sparkline, etc). Quando status=PAGO e paid_at preenchido, usa ele.
 * Caso contrario usa date.
 */
export function effectiveTransactionDate(tx: {
  status: string;
  date: Date | string;
  paid_at: Date | string | null;
}): Date {
  if (tx.status === 'PAGO' && tx.paid_at) {
    return new Date(tx.paid_at);
  }
  return new Date(tx.date);
}
