-- Adiciona campo whatsapp_sent_at em Notification — usado pra dedup
-- agressivo de WhatsApp ao advogado (1 WA por conversa por hora,
-- independente de read_at).
--
-- Bug original (Gianny, 2026-04-26): cada mensagem nova do cliente
-- gerava 1 WhatsApp ao advogado se a Notification anterior ja tivesse
-- read_at preenchido (advogado abriu o app uma vez). Spam de notificacoes.
--
-- Idempotente.

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "whatsapp_sent_at" TIMESTAMP(3) NULL;

CREATE INDEX IF NOT EXISTS "Notification_user_id_whatsapp_sent_at_idx"
  ON "Notification"("user_id", "whatsapp_sent_at");
