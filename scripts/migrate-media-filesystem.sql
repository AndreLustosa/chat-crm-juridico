-- ─────────────────────────────────────────────────────────────────────────
-- Migration manual: Media → filesystem + tabelas de notificações (Fases 2-4)
-- ─────────────────────────────────────────────────────────────────────────
-- Aplica as mudanças de schema das últimas releases:
--   1. Media.s3_key vira NULLABLE + novo campo file_path
--   2. Tabela NotificationSetting (Fase 2)
--   3. Tabela ConversationMute (Fase 3)
--   4. Tabela Notification (Fase 3)
--   5. Tabela PushSubscription (Fase 4)
--
-- Use se "prisma db push" não rodou automaticamente no deploy.
-- Todas as operações são IDEMPOTENTES (IF NOT EXISTS / DROP NOT NULL).
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Media: novo campo file_path + s3_key opcional
-- ═══════════════════════════════════════════════════════════

ALTER TABLE "Media"
  ALTER COLUMN "s3_key" DROP NOT NULL;

ALTER TABLE "Media"
  ADD COLUMN IF NOT EXISTS "file_path" TEXT;

-- ═══════════════════════════════════════════════════════════
-- 2. NotificationSetting (Fase 2 — preferências de notificação)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "NotificationSetting" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL UNIQUE,
  "sound_id" TEXT NOT NULL DEFAULT 'ding',
  "muted_until" TIMESTAMP(3),
  "preferences" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationSetting_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ═══════════════════════════════════════════════════════════
-- 3. ConversationMute (Fase 3 — mute por conversa)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "ConversationMute" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "muted_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMute_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationMute_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationMute_user_conv_unique"
    UNIQUE ("user_id", "conversation_id")
);

CREATE INDEX IF NOT EXISTS "ConversationMute_user_id_idx"
  ON "ConversationMute"("user_id");

-- ═══════════════════════════════════════════════════════════
-- 4. Notification (Fase 3 — histórico persistente)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "notification_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "data" JSONB,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Notification_user_id_read_at_idx"
  ON "Notification"("user_id", "read_at");
CREATE INDEX IF NOT EXISTS "Notification_user_id_created_at_idx"
  ON "Notification"("user_id", "created_at");

-- ═══════════════════════════════════════════════════════════
-- 5. PushSubscription (Fase 4 — Web Push)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL UNIQUE,
  "keys_p256dh" TEXT NOT NULL,
  "keys_auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PushSubscription_user_id_idx"
  ON "PushSubscription"("user_id");

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Verificação pós-migration (rode para confirmar)
-- ─────────────────────────────────────────────────────────────────────────

-- Media: deve ter file_path
-- SELECT column_name, is_nullable, data_type FROM information_schema.columns
-- WHERE table_name = 'Media' AND column_name IN ('s3_key', 'file_path');

-- Tabelas novas devem existir
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('NotificationSetting', 'ConversationMute', 'Notification', 'PushSubscription');
