-- Migration: adiciona CalendarEvent.hearing_notified_at pra fallback cron
-- de notificacao imediata de audiencias agendadas.
--
-- Contexto (PR2 #10 da auditoria Tarefas+Calendario):
-- Hoje quando uma AUDIENCIA/PERICIA eh criada, enfileiramos
-- notify-hearing-scheduled na BullMQ (delay imediato ou ate proximo
-- horario comercial). Se o Redis cair entre o add() e o disparo
-- (deploy, restart, OOM, ban WhatsApp), a mensagem nunca chega ao
-- cliente — sem alarme nem fallback. Em outage de algumas horas, audiencias
-- do dia seguinte ficam sem aviso.
--
-- Solucao: coluna `hearing_notified_at` rastreia se o cliente ja foi
-- notificado. Cron diario (06h BRT) varre AUDIENCIA/PERICIA cujo:
--   - hearing_notified_at IS NULL
--   - start_at > NOW (ainda vai acontecer)
--   - status NOT IN (CANCELADO, CONCLUIDO, ADIADO)
-- E enfileira notify-hearing-scheduled novamente com fallback.
-- Worker preenche hearing_notified_at apos envio bem-sucedido.
--
-- Idempotencia: cron pega so events sem hearing_notified_at; worker
-- preenche apos enviar. Restart do API/worker nao re-dispara mensagem.

BEGIN;

-- Coluna nullable (legacy events ficam NULL ate cron varrer)
ALTER TABLE "CalendarEvent"
  ADD COLUMN IF NOT EXISTS "hearing_notified_at" TIMESTAMP(3);

-- Index parcial pro cron varrer rapido (so events nao notificados)
CREATE INDEX IF NOT EXISTS "CalendarEvent_hearing_pending_idx"
  ON "CalendarEvent" ("type", "start_at", "status")
  WHERE "hearing_notified_at" IS NULL
    AND "type" IN ('AUDIENCIA', 'PERICIA');

-- Backfill: events JA passados (start_at < NOW) marcamos como
-- notified_at = created_at pra nao re-disparar pra audiencia ocorrida
-- ontem. Events FUTUROS ficam NULL pro cron pegar.
UPDATE "CalendarEvent"
SET "hearing_notified_at" = "created_at"
WHERE "type" IN ('AUDIENCIA', 'PERICIA')
  AND "start_at" < NOW()
  AND "hearing_notified_at" IS NULL;

COMMIT;
