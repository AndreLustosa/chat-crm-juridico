-- Tracking de avisos enviados por cobranca pra evitar spam.
--
-- last_reminder_sent_at: timestamp do ultimo aviso (qualquer tipo) pra
--   evitar disparar 2 lembretes na mesma janela do cron.
-- reminder_count: contador total de avisos enviados — usado pra ordenar
--   escalation (1=cordial, 2=firme, 3=urgente, 4+=alerta interno)
-- last_reminder_kind: tipo do ultimo aviso enviado, evita reenviar mesmo
--   tipo (ex: nao mandar 'pre-due-3d' duas vezes pra mesma charge).
--
-- Idempotente — campos opcionais.

ALTER TABLE "PaymentGatewayCharge"
  ADD COLUMN IF NOT EXISTS "last_reminder_sent_at" TIMESTAMP(3) NULL,
  ADD COLUMN IF NOT EXISTS "reminder_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_reminder_kind" TEXT NULL;

CREATE INDEX IF NOT EXISTS "PaymentGatewayCharge_due_status_idx"
  ON "PaymentGatewayCharge"("due_date", "status");

-- Lead.payment_reminders_disabled: opt-out por cliente.
-- Cliente pode desligar lembretes de cobranca sem desligar outros tipos
-- de notificacao (movimentacoes, agendamento, etc).
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "payment_reminders_disabled" BOOLEAN NOT NULL DEFAULT false;
