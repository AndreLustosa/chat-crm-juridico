-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill de EventReminders pra CalendarEvents futuros sem lembrete
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Ate hoje, varias vias de criacao de CalendarEvent nao configuravam
--   reminders (book_appointment da IA, child events de recorrencia, algumas
--   criacoes manuais antigas). Resultado: eventos sem nenhum EventReminder,
--   logo sem notificacao visual nem WhatsApp.
--
--   A partir deste deploy, o calendar.service.create() aplica defaults por
--   tipo automaticamente. Mas eventos JA CRIADOS sem reminders continuam
--   silenciosos ate esta migration rodar.
--
-- O que faz:
--   Pra cada CalendarEvent futuro (start_at > NOW()) que nao tem NENHUM
--   EventReminder, cria reminders defaults baseado no tipo:
--
--     AUDIENCIA / PERICIA:
--       1440min (1d) WHATSAPP + PUSH
--       60min  (1h) WHATSAPP + PUSH
--     PRAZO:
--       2880min (2d) PUSH
--       1440min (1d) WHATSAPP + PUSH
--       60min   (1h) PUSH
--     CONSULTA:
--       60min  (1h) PUSH
--       30min  (30m) WHATSAPP
--     TAREFA:
--       60min  (1h) PUSH
--     OUTRO:
--       30min  (30m) PUSH
--
-- Nao modifica eventos que ja tem reminders (mesmo que seja so 1).
-- Nao modifica eventos passados (start_at <= NOW()) nem CANCELADOS/CONCLUIDOS.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Snapshot pre-backfill
DO $$
DECLARE v_without INTEGER; v_with INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_without
  FROM "CalendarEvent" ce
  WHERE ce.start_at > NOW()
    AND ce.status IN ('AGENDADO', 'CONFIRMADO')
    AND NOT EXISTS (SELECT 1 FROM "EventReminder" er WHERE er.event_id = ce.id);

  SELECT COUNT(*) INTO v_with
  FROM "CalendarEvent" ce
  WHERE ce.start_at > NOW()
    AND ce.status IN ('AGENDADO', 'CONFIRMADO')
    AND EXISTS (SELECT 1 FROM "EventReminder" er WHERE er.event_id = ce.id);

  RAISE NOTICE 'Eventos futuros SEM reminders: %', v_without;
  RAISE NOTICE 'Eventos futuros COM reminders: %', v_with;
END $$;

-- Cria reminders defaults usando VALUES + CROSS JOIN
-- Cada linha gerada = 1 EventReminder novo
INSERT INTO "EventReminder" (id, event_id, minutes_before, channel, sent_at)
SELECT
  gen_random_uuid(),
  ce.id,
  d.minutes_before,
  d.channel,
  NULL
FROM "CalendarEvent" ce
CROSS JOIN LATERAL (
  VALUES
    -- AUDIENCIA / PERICIA
    (ce.type IN ('AUDIENCIA', 'PERICIA'), 1440, 'WHATSAPP'),
    (ce.type IN ('AUDIENCIA', 'PERICIA'), 1440, 'PUSH'),
    (ce.type IN ('AUDIENCIA', 'PERICIA'),   60, 'WHATSAPP'),
    (ce.type IN ('AUDIENCIA', 'PERICIA'),   60, 'PUSH'),
    -- PRAZO
    (ce.type = 'PRAZO', 2880, 'PUSH'),
    (ce.type = 'PRAZO', 1440, 'WHATSAPP'),
    (ce.type = 'PRAZO', 1440, 'PUSH'),
    (ce.type = 'PRAZO',   60, 'PUSH'),
    -- CONSULTA
    (ce.type = 'CONSULTA', 60, 'PUSH'),
    (ce.type = 'CONSULTA', 30, 'WHATSAPP'),
    -- TAREFA
    (ce.type = 'TAREFA', 60, 'PUSH'),
    -- OUTRO
    (ce.type = 'OUTRO', 30, 'PUSH')
) AS d(applies, minutes_before, channel)
WHERE d.applies = true
  AND ce.start_at > NOW()
  AND ce.status IN ('AGENDADO', 'CONFIRMADO')
  AND NOT EXISTS (SELECT 1 FROM "EventReminder" er WHERE er.event_id = ce.id)
  -- Garantia extra: trigger time ainda e futuro (nao cria reminder pra ja passou)
  AND ce.start_at - (d.minutes_before || ' minutes')::interval > NOW();

-- Sanity check pos-backfill
DO $$
DECLARE v_created INTEGER; v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_created
  FROM "EventReminder"
  WHERE sent_at IS NULL AND id IN (
    SELECT er.id FROM "EventReminder" er
    JOIN "CalendarEvent" ce ON ce.id = er.event_id
    WHERE ce.start_at > NOW() AND ce.status IN ('AGENDADO', 'CONFIRMADO')
  );

  SELECT COUNT(*) INTO v_remaining
  FROM "CalendarEvent" ce
  WHERE ce.start_at > NOW()
    AND ce.status IN ('AGENDADO', 'CONFIRMADO')
    AND NOT EXISTS (SELECT 1 FROM "EventReminder" er WHERE er.event_id = ce.id);

  RAISE NOTICE '--- Pos-backfill ---';
  RAISE NOTICE 'EventReminders pendentes (sent_at IS NULL) pra eventos futuros: %', v_created;
  RAISE NOTICE 'Eventos futuros AINDA sem reminder (esperado 0 ou poucos): %', v_remaining;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i <container> psql -U <user> -d <db> \
--     < 2026-04-22-backfill-event-reminders.sql
--
-- Queries uteis apos rodar:
--
--   -- Proximos 10 reminders PUSH a disparar
--   SELECT er.id, er.minutes_before, er.channel, ce.title, ce.type,
--          ce.start_at - (er.minutes_before * interval '1 minute') AS trigger_time
--   FROM "EventReminder" er
--   JOIN "CalendarEvent" ce ON ce.id = er.event_id
--   WHERE er.sent_at IS NULL AND er.channel = 'PUSH'
--     AND ce.status IN ('AGENDADO', 'CONFIRMADO')
--   ORDER BY trigger_time ASC LIMIT 10;
--
--   -- Proximos 10 reminders WHATSAPP a disparar
--   SELECT er.id, er.minutes_before, er.channel, ce.title, ce.type,
--          ce.start_at - (er.minutes_before * interval '1 minute') AS trigger_time
--   FROM "EventReminder" er
--   JOIN "CalendarEvent" ce ON ce.id = er.event_id
--   WHERE er.sent_at IS NULL AND er.channel = 'WHATSAPP'
--     AND ce.status IN ('AGENDADO', 'CONFIRMADO')
--   ORDER BY trigger_time ASC LIMIT 10;
--
--   -- Total de reminders por status
--   SELECT channel, COUNT(*) FILTER (WHERE sent_at IS NULL) AS pendentes,
--                    COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS enviados
--   FROM "EventReminder"
--   GROUP BY channel;
-- ─────────────────────────────────────────────────────────────────────────────
