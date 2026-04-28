-- Backfill paid_at em transações status='PAGO' que estão com paid_at null.
--
-- Contexto: o sistema migrou para regime de caixa em todos os agregadores
-- (KPI receita realizada, despesas pagas, meta REALIZED, summary, cash-flow).
-- Eles passam a filtrar por:
--   (paid_at >= start AND paid_at <= end)
--   OR (paid_at IS NULL AND date >= start AND date <= end)
--
-- O fallback `paid_at IS NULL` foi pensado pra dados legados — em prod
-- preferimos que toda transação paga tenha paid_at preenchido pra evitar
-- ambiguidade. Esse SQL preenche paid_at = date pras linhas afetadas.
--
-- Idempotente: roda quantas vezes precisar; só altera linhas com
-- status='PAGO' AND paid_at IS NULL.
--
-- Recomenda-se rodar UMA vez antes de aplicar o deploy do código novo.

UPDATE "FinancialTransaction"
SET paid_at = date
WHERE status = 'PAGO'
  AND paid_at IS NULL;

-- Sanity check (read-only, pode ignorar — útil pra confirmar)
-- SELECT COUNT(*) AS pagos_sem_paid_at_apos_backfill
-- FROM "FinancialTransaction"
-- WHERE status = 'PAGO' AND paid_at IS NULL;
-- Esperado: 0
