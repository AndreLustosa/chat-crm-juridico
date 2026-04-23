-- ─────────────────────────────────────────────────────────────────────────────
-- Normaliza CaseDeadline: adiciona campo `status` enum-like
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Ate hoje, CaseDeadline so tinha `completed: boolean`. Impossivel
--   diferenciar prazo CUMPRIDO de CANCELADO (ambos completed=true) ou
--   ADIADO (nao existia — so pending ou done).
--
--   CalendarEvent e Task ja usam enum string 4-5 valores. Esta migration
--   alinha CaseDeadline:
--     PENDENTE  (default, aguardando)
--     CONCLUIDO (cumprido normalmente)
--     CANCELADO (nao precisa mais)
--     ADIADO    (remarcado pra outra data)
--
--   `completed` fica mantido como shortcut boolean pra queries legadas.
--   Regra de sync:
--     completed = true  <=> status IN ('CONCLUIDO', 'CANCELADO')
--     completed = false <=> status IN ('PENDENTE', 'ADIADO')
--
-- O que faz:
--   1. Adiciona coluna status TEXT default 'PENDENTE'
--   2. Backfill baseado em completed + completion_note:
--      - completed=true + completion_note prefix '[CANCELADO]' -> CANCELADO
--      - completed=true + outros casos                          -> CONCLUIDO
--      - completed=false                                         -> PENDENTE
--
-- Rollback: DROP COLUMN status. Campo `completed` continua operacional.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Adiciona coluna
ALTER TABLE "CaseDeadline"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDENTE';

-- Backfill: popula status baseado em completed + completion_note
UPDATE "CaseDeadline"
SET "status" = CASE
  WHEN "completed" = true AND "completion_note" LIKE '[CANCELADO]%' THEN 'CANCELADO'
  WHEN "completed" = true THEN 'CONCLUIDO'
  ELSE 'PENDENTE'
END;

-- Index no status pra queries de filtro
CREATE INDEX IF NOT EXISTS "CaseDeadline_status_idx" ON "CaseDeadline"("status");

-- Sanity check
DO $$
DECLARE
  v_pendente INTEGER;
  v_concluido INTEGER;
  v_cancelado INTEGER;
  v_adiado INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pendente FROM "CaseDeadline" WHERE status = 'PENDENTE';
  SELECT COUNT(*) INTO v_concluido FROM "CaseDeadline" WHERE status = 'CONCLUIDO';
  SELECT COUNT(*) INTO v_cancelado FROM "CaseDeadline" WHERE status = 'CANCELADO';
  SELECT COUNT(*) INTO v_adiado FROM "CaseDeadline" WHERE status = 'ADIADO';

  RAISE NOTICE '--- Distribuicao pos-migration ---';
  RAISE NOTICE '  PENDENTE : %', v_pendente;
  RAISE NOTICE '  CONCLUIDO: %', v_concluido;
  RAISE NOTICE '  CANCELADO: %', v_cancelado;
  RAISE NOTICE '  ADIADO   : %', v_adiado;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i 78395b49af22 psql -U crm_user -d lustosa \
--     < 2026-04-22-deadline-status-enum.sql
-- ─────────────────────────────────────────────────────────────────────────────
