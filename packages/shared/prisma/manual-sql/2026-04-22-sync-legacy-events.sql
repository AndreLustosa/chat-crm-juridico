-- ─────────────────────────────────────────────────────────────────────────────
-- Sincronizacao retroativa de eventos ja concluidos/cancelados
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Ate 2026-04-22 o sync entre CalendarEvent <-> Task <-> CaseDeadline era
--   apenas unidirecional (Task -> Calendar). Isso significava que qualquer
--   evento que foi marcado como CONCLUIDO/CANCELADO diretamente no Calendar
--   NAO propagou pra Task ou CaseDeadline vinculados.
--
--   Agora que o sync bidirecional ta funcionando pra novos cumprimentos,
--   precisamos limpar o atraso historico pra:
--     - Tarefas (Task) nao aparecerem como A_FAZER quando o CalendarEvent
--       vinculado esta CONCLUIDO ha semanas.
--     - Prazos (CaseDeadline) nao aparecerem como pendentes.
--
-- O que faz:
--   1. Task: se calendar_event.status = CONCLUIDO e task.status = A_FAZER,
--      marca task.status = CONCLUIDA + completed_at (copia do calendar).
--   2. Task: se calendar_event.status = CANCELADO e task.status != CANCELADA,
--      marca task.status = CANCELADA.
--   3. CaseDeadline: se calendar_event.status = CONCLUIDO e deadline nao
--      esta completed, marca completed=true + completed_at.
--
-- Preserva: completion_note (se ja existe), qualquer outro status que nao
-- seja A_FAZER/pendente.
--
-- Rollback: nao ha (o status anterior foi perdido). Se precisar, restaure
-- backup antes de rodar.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Snapshot pre-migration
DO $$
DECLARE
  v_tasks_to_complete  INTEGER;
  v_tasks_to_cancel    INTEGER;
  v_deadlines_to_complete INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_tasks_to_complete
  FROM "Task" t
  JOIN "CalendarEvent" ce ON ce.id = t.calendar_event_id
  WHERE ce.status = 'CONCLUIDO' AND t.status = 'A_FAZER';

  SELECT COUNT(*) INTO v_tasks_to_cancel
  FROM "Task" t
  JOIN "CalendarEvent" ce ON ce.id = t.calendar_event_id
  WHERE ce.status = 'CANCELADO' AND t.status NOT IN ('CANCELADA', 'CONCLUIDA');

  SELECT COUNT(*) INTO v_deadlines_to_complete
  FROM "CaseDeadline" d
  JOIN "CalendarEvent" ce ON ce.id = d.calendar_event_id
  WHERE ce.status = 'CONCLUIDO' AND d.completed = false;

  RAISE NOTICE '--- Sync retroativo ---';
  RAISE NOTICE 'Tasks a marcar como CONCLUIDA: %', v_tasks_to_complete;
  RAISE NOTICE 'Tasks a marcar como CANCELADA: %', v_tasks_to_cancel;
  RAISE NOTICE 'CaseDeadlines a marcar completed: %', v_deadlines_to_complete;
END $$;

-- 1. Task CONCLUIDA (calendar concluido, task ainda a fazer)
UPDATE "Task" t
SET
  "status" = 'CONCLUIDA',
  "completed_at" = COALESCE(t."completed_at", ce."completed_at", ce."updated_at"),
  "completed_by_id" = COALESCE(t."completed_by_id", ce."completed_by_id"),
  "completion_note" = COALESCE(t."completion_note", ce."completion_note")
FROM "CalendarEvent" ce
WHERE t."calendar_event_id" = ce."id"
  AND ce."status" = 'CONCLUIDO'
  AND t."status" = 'A_FAZER';

-- 2. Task CANCELADA (calendar cancelado, task nao cancelada nem concluida)
UPDATE "Task" t
SET
  "status" = 'CANCELADA',
  "completed_at" = COALESCE(t."completed_at", ce."completed_at", ce."updated_at"),
  "completed_by_id" = COALESCE(t."completed_by_id", ce."completed_by_id"),
  "completion_note" = COALESCE(t."completion_note", ce."completion_note")
FROM "CalendarEvent" ce
WHERE t."calendar_event_id" = ce."id"
  AND ce."status" = 'CANCELADO'
  AND t."status" NOT IN ('CANCELADA', 'CONCLUIDA');

-- 3. CaseDeadline completed (calendar concluido, deadline pendente)
UPDATE "CaseDeadline" d
SET
  "completed" = true,
  "completed_at" = COALESCE(d."completed_at", ce."completed_at", ce."updated_at"),
  "completed_by_id" = COALESCE(d."completed_by_id", ce."completed_by_id"),
  "completion_note" = COALESCE(d."completion_note", ce."completion_note")
FROM "CalendarEvent" ce
WHERE d."calendar_event_id" = ce."id"
  AND ce."status" = 'CONCLUIDO'
  AND d."completed" = false;

-- Sanity check pos-migration
DO $$
DECLARE
  v_tasks_remaining INTEGER;
  v_deadlines_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_tasks_remaining
  FROM "Task" t
  JOIN "CalendarEvent" ce ON ce.id = t.calendar_event_id
  WHERE ce.status IN ('CONCLUIDO', 'CANCELADO')
    AND t.status NOT IN ('CONCLUIDA', 'CANCELADA');

  SELECT COUNT(*) INTO v_deadlines_remaining
  FROM "CaseDeadline" d
  JOIN "CalendarEvent" ce ON ce.id = d.calendar_event_id
  WHERE ce.status = 'CONCLUIDO' AND d.completed = false;

  RAISE NOTICE '--- Pos-sync ---';
  RAISE NOTICE 'Tasks ainda inconsistentes (esperado 0): %', v_tasks_remaining;
  RAISE NOTICE 'Deadlines ainda inconsistentes (esperado 0): %', v_deadlines_remaining;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Como rodar:
--   docker exec -i 78395b49af22 psql -U crm_user -d lustosa \
--     < 2026-04-22-sync-legacy-events.sql
-- ─────────────────────────────────────────────────────────────────────────────
