-- Recebimento parcial em honorarios (feature 2026-05-15):
--
-- Andre reportou que precisa registrar quando cliente paga PARTE de
-- uma parcela (ex: parcela R$ 7.000,00 e cliente paga R$ 3.000,00 PIX
-- agora, prometendo o resto depois). Antes so dava pra marcar PAGO
-- (tudo) ou deixar PENDENTE — perdia historico do recebimento parcial.
--
-- Modelo simples: novo campo paid_amount NULLABLE em HonorarioPayment.
-- - NULL ou 0: nada recebido (status PENDENTE/ATRASADO)
-- - 0 < paid_amount < amount: recebimento parcial (status novo PARCIAL)
-- - paid_amount >= amount: tudo pago (status PAGO + paid_at preenchido)
--
-- Status enum agora aceita 'PARCIAL' alem de PENDENTE/PAGO/ATRASADO.
-- Sem migration de dados — registros existentes ficam com paid_amount
-- NULL e continuam funcionando (status atual preservado).

ALTER TABLE "HonorarioPayment"
  ADD COLUMN IF NOT EXISTS "paid_amount" DECIMAL;
