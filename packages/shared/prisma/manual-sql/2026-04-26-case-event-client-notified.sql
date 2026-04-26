-- Adiciona campo client_notified_at em CaseEvent + indice
-- Permite notificar o cliente sobre movimentacoes ESAJ (antes so o advogado
-- recebia). Mantem `notified_at` separado pra distinguir os dois canais.
--
-- Politica unificada 2026-04-26 (André):
--   "cliente recebe TODAS as notificacoes de movimentacao com explicacao do
--    que se trata e disclaimer de mensagem automatica do sistema"
--
-- Idempotente: usa IF NOT EXISTS pra rodar varias vezes sem erro.

ALTER TABLE "CaseEvent"
  ADD COLUMN IF NOT EXISTS "client_notified_at" TIMESTAMP(3) NULL;

CREATE INDEX IF NOT EXISTS "CaseEvent_source_client_notified_at_idx"
  ON "CaseEvent"("source", "client_notified_at");
