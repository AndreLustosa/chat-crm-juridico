-- Adiciona campo client_explanation em CaseEvent — cache da explicação leiga
-- gerada sob demanda pela Sophia quando o cliente clica no botão "Pedir
-- explicação" no portal. Evita re-chamar IA pra mesma movimentação.

ALTER TABLE "CaseEvent"
  ADD COLUMN IF NOT EXISTS "client_explanation" TEXT NULL;
