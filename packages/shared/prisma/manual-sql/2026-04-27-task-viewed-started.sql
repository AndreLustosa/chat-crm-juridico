-- Tracking de progresso da Task pra advogado acompanhar sem precisar
-- abrir cada uma e perguntar pro estagiario:
--
--   viewed_at  : primeira vez que o responsavel renderizou o card no
--                dashboard (estagiario abriu o app e a Task carregou)
--   started_at : quando o responsavel clicou "Iniciar" (status virou
--                EM_PROGRESSO)
--
-- Junto com completed_at (ja existente), advogado tem timeline completa:
--    criada -> vista -> iniciada -> concluida
--
-- Idempotente.

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "viewed_at" TIMESTAMP(3) NULL,
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3) NULL;

-- Index pra querie do advogado "minhas diligencias delegadas que ainda
-- nao foram vistas" — reforca cobranca proativa
CREATE INDEX IF NOT EXISTS "Task_created_by_id_viewed_at_idx"
  ON "Task"("created_by_id", "viewed_at");
