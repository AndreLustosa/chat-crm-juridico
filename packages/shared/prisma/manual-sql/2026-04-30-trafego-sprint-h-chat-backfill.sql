-- Sprint H — Chat conversacional + Backfill histórico
--
-- Adiciona:
--   1. 7 colunas em TrafficAccount pra controlar backfill (status, cursor,
--      progresso, completed_at, error)
--   2. TrafficChatSession (sessões de conversa do user com a IA)
--   3. TrafficChatMessage (mensagens com tool_calls + proposed_action)
--
-- Idempotente.

-- ── 1. TrafficAccount: campos de backfill ────────────────────────────────
ALTER TABLE "TrafficAccount"
  ADD COLUMN IF NOT EXISTS "backfill_status"        TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "TrafficAccount"
  ADD COLUMN IF NOT EXISTS "backfill_target_from"   TIMESTAMP(3);
ALTER TABLE "TrafficAccount"
  ADD COLUMN IF NOT EXISTS "backfill_cursor"        TIMESTAMP(3);
ALTER TABLE "TrafficAccount"
  ADD COLUMN IF NOT EXISTS "backfill_total_months"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TrafficAccount"
  ADD COLUMN IF NOT EXISTS "backfill_done_months"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TrafficAccount"
  ADD COLUMN IF NOT EXISTS "backfill_completed_at"  TIMESTAMP(3);
ALTER TABLE "TrafficAccount"
  ADD COLUMN IF NOT EXISTS "backfill_error"         TEXT;

CREATE INDEX IF NOT EXISTS "TrafficAccount_backfill_status_idx"
  ON "TrafficAccount"("backfill_status");

-- ── 2. TrafficChatSession ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficChatSession" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "account_id"          TEXT NOT NULL,
  "user_id"             TEXT NOT NULL,
  "title"               TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'OPEN',
  "started_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  "llm_provider"        TEXT,
  "llm_model"           TEXT,
  "total_tokens_input"  INTEGER NOT NULL DEFAULT 0,
  "total_tokens_output" INTEGER NOT NULL DEFAULT 0,
  "total_cost_brl"      DECIMAL(10,4) NOT NULL DEFAULT 0
);

DO $$ BEGIN
  ALTER TABLE "TrafficChatSession"
    ADD CONSTRAINT "TrafficChatSession_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficChatSession"
    ADD CONSTRAINT "TrafficChatSession_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "TrafficChatSession_tenant_status_activity_idx"
  ON "TrafficChatSession"("tenant_id", "status", "last_activity_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficChatSession_user_activity_idx"
  ON "TrafficChatSession"("user_id", "last_activity_at" DESC);

-- ── 3. TrafficChatMessage ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficChatMessage" (
  "id"                            TEXT NOT NULL PRIMARY KEY,
  "tenant_id"                     TEXT NOT NULL,
  "account_id"                    TEXT NOT NULL,
  "session_id"                    TEXT NOT NULL,
  "role"                          TEXT NOT NULL,
  "content"                       TEXT NOT NULL,
  "tool_calls"                    JSONB,
  "tool_result_for"               TEXT,
  "tool_result"                   JSONB,
  "proposed_action"               JSONB,
  "proposed_action_status"        TEXT,
  "proposed_action_mutate_log_id" TEXT,
  "proposed_action_resolved_at"   TIMESTAMP(3),
  "proposed_action_resolved_by"   TEXT,
  "tokens_input"                  INTEGER NOT NULL DEFAULT 0,
  "tokens_output"                 INTEGER NOT NULL DEFAULT 0,
  "cost_brl"                      DECIMAL(10,4) NOT NULL DEFAULT 0,
  "model_used"                    TEXT,
  "error_message"                 TEXT,
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "TrafficChatMessage"
    ADD CONSTRAINT "TrafficChatMessage_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficChatMessage"
    ADD CONSTRAINT "TrafficChatMessage_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficChatMessage"
    ADD CONSTRAINT "TrafficChatMessage_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "TrafficChatSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "TrafficChatMessage_session_created_idx"
  ON "TrafficChatMessage"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "TrafficChatMessage_tenant_role_created_idx"
  ON "TrafficChatMessage"("tenant_id", "role", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficChatMessage_proposed_status_idx"
  ON "TrafficChatMessage"("proposed_action_status");
