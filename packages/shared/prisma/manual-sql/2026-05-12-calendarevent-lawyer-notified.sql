-- Skills PR2 #A12: idempotency da notificacao do advogado em book_appointment
--
-- Antes: notifyLawyer rodava sempre. Se job de book_appointment falhava no
-- final (timeout BullMQ, restart) e re-executava, advogado recebia 2x ou 3x
-- a mesma notificacao no WhatsApp. Vaza telefone do cliente N vezes + queima
-- cota WhatsApp (risco ban).
--
-- Agora: marca lawyer_notified_at antes de enviar. updateMany retorna count=0
-- em re-execucoes — notify aborta cedo.

ALTER TABLE "CalendarEvent"
  ADD COLUMN IF NOT EXISTS "lawyer_notified_at" TIMESTAMP(3);

-- Sem index — coluna usada em UPDATE com WHERE id=? AND lawyer_notified_at IS NULL.
-- PK em id ja serve.
