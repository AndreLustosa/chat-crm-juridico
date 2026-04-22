-- ─────────────────────────────────────────────────────────────────────────────
-- Audit fields em CalendarEvent, Task e CaseDeadline
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Antes desta migration, so Task tinha `completion_note` e CaseDeadline
--   tinha `completed_at`. CalendarEvent nao tinha nenhum campo de audit.
--   Impossivel saber QUEM cumpriu, QUANDO e QUAL A NOTA do cumprimento.
--
-- O que faz:
--   CalendarEvent:
--     + completed_at      DateTime? (quando foi marcado como concluido/cancelado)
--     + completed_by_id   String?   (FK user — quem marcou)
--     + completion_note   String?   (nota opcional)
--
--   Task:
--     + completed_at      DateTime?
--     + completed_by_id   String?   (FK user)
--     (completion_note ja existe)
--
--   CaseDeadline:
--     + completed_by_id   String?   (FK user)
--     + completion_note   String?
--     (completed_at ja existe)
--
-- Rollback: DROP COLUMN em todos os 3. Dados perdem o audit mas nao quebra
-- o sistema — campos sao todos opcionais.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- CalendarEvent
ALTER TABLE "CalendarEvent"
  ADD COLUMN IF NOT EXISTS "completed_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "completion_note" TEXT;

-- FK opcional pra User (ON DELETE SET NULL)
ALTER TABLE "CalendarEvent"
  DROP CONSTRAINT IF EXISTS "CalendarEvent_completed_by_id_fkey";
ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Task
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "completed_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_by_id" TEXT;

ALTER TABLE "Task"
  DROP CONSTRAINT IF EXISTS "Task_completed_by_id_fkey";
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CaseDeadline
ALTER TABLE "CaseDeadline"
  ADD COLUMN IF NOT EXISTS "completed_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "completion_note" TEXT;

ALTER TABLE "CaseDeadline"
  DROP CONSTRAINT IF EXISTS "CaseDeadline_completed_by_id_fkey";
ALTER TABLE "CaseDeadline"
  ADD CONSTRAINT "CaseDeadline_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: se ja ha eventos marcados como CONCLUIDO/CANCELADO, seta
-- completed_at = updated_at como aproximacao (melhor que null pra stats).
UPDATE "CalendarEvent"
SET "completed_at" = "updated_at"
WHERE "status" IN ('CONCLUIDO', 'CANCELADO')
  AND "completed_at" IS NULL;

UPDATE "Task"
SET "completed_at" = NOW()
WHERE "status" IN ('CONCLUIDA', 'CANCELADA')
  AND "completed_at" IS NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Quando rodar na VPS:
--   docker exec -i 78395b49af22 psql -U crm_user -d lustosa < 2026-04-22-event-audit-fields.sql
--
-- Sanity check pos-migration:
--   \d "CalendarEvent"    # deve listar as 3 colunas novas
--   SELECT COUNT(*) FROM "CalendarEvent" WHERE completed_at IS NOT NULL;
-- ─────────────────────────────────────────────────────────────────────────────
