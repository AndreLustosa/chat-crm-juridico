-- ============================================================================
-- Migration manual — 2026-04-18 — IA fora do expediente + agendamento pela IA
-- ============================================================================
-- Aplique na VPS com:  psql "$DATABASE_URL" -f 2026-04-18-after-hours-ai.sql
-- Ou use `pnpm --filter @crm/shared db:push` (prisma db push) para sincronizar
-- o schema inteiro com base em schema.prisma.
-- ----------------------------------------------------------------------------
-- IMPORTANTE: todas as colunas são OPCIONAIS (nullable ou com @default) —
-- a migration é segura em tabelas populadas e idempotente.
-- ============================================================================

-- 1) Conversation.ai_mode_source — origem da última alteração em ai_mode
--    Valores: 'MANUAL' (operador toggled), 'CRON_AFTER_HOURS' (cron noturno),
--    NULL (estado inicial / IA ligada por default).
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "ai_mode_source" TEXT;

-- 2) CalendarEvent.created_by_ai — true quando o evento nasceu de book_appointment
ALTER TABLE "CalendarEvent"
  ADD COLUMN IF NOT EXISTS "created_by_ai" BOOLEAN NOT NULL DEFAULT false;

-- 3) Settings padrão — popula keys caso ainda não existam
INSERT INTO "GlobalSetting" ("key", "value", "updated_at") VALUES
  ('AFTER_HOURS_AI_ENABLED', 'true',           NOW()),
  ('AFTER_HOURS_START',      '17:00',          NOW()),
  ('AFTER_HOURS_END',        '08:00',          NOW()),
  ('BUSINESS_DAYS',          '1,2,3,4,5',      NOW()),
  ('TIMEZONE',               'America/Maceio', NOW())
ON CONFLICT ("key") DO NOTHING;
