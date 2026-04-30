-- Sprint C — IA Otimizadora (Traffic AI Agent)
--
-- Adiciona 3 tabelas para a IA gestora de tráfego:
--   - TrafficIADecision: auditoria perpétua de toda decisão (executada,
--     sugerida, bloqueada por OAB, falhada). Nunca apagar.
--   - TrafficIAMemory:   estado/memória persistente entre loops (ex: contagens
--                        de re-avaliação pra escalation, debouncing).
--   - TrafficIAPolicy:   1 row por tenant — toggles ADVISOR/AUTONOMOUS,
--                        thresholds, schedules, canais de notificação.
--
-- Idempotente — IF NOT EXISTS protege re-execução.

-- ── 1. TrafficIADecision ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficIADecision" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "account_id"      TEXT NOT NULL,
  "loop_kind"       TEXT NOT NULL,
  "decision_kind"   TEXT NOT NULL,
  "resource_type"   TEXT,
  "resource_id"     TEXT,
  "resource_name"   TEXT,
  "inputs"          JSONB NOT NULL,
  "confidence"      DECIMAL(4,3) NOT NULL,
  "reasons"         JSONB NOT NULL,
  "action"          TEXT NOT NULL,
  "executed"        BOOLEAN NOT NULL DEFAULT FALSE,
  "mutate_log_id"   TEXT,
  "human_feedback"  TEXT,
  "feedback_at"     TIMESTAMP(3),
  "feedback_note"   TEXT,
  "summary"         TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "TrafficIADecision"
    ADD CONSTRAINT "TrafficIADecision_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficIADecision"
    ADD CONSTRAINT "TrafficIADecision_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "TrafficIADecision_tenant_kind_created_idx"
  ON "TrafficIADecision"("tenant_id", "decision_kind", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficIADecision_account_action_created_idx"
  ON "TrafficIADecision"("account_id", "action", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficIADecision_action_feedback_idx"
  ON "TrafficIADecision"("action", "human_feedback");
CREATE INDEX IF NOT EXISTS "TrafficIADecision_executed_created_idx"
  ON "TrafficIADecision"("executed", "created_at" DESC);

-- ── 2. TrafficIAMemory ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficIAMemory" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "value"       JSONB NOT NULL,
  "expires_at"  TIMESTAMP(3),
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "TrafficIAMemory"
    ADD CONSTRAINT "TrafficIAMemory_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficIAMemory_tenant_key_uniq"
  ON "TrafficIAMemory"("tenant_id", "key");
CREATE INDEX IF NOT EXISTS "TrafficIAMemory_expires_idx"
  ON "TrafficIAMemory"("expires_at");

-- ── 3. TrafficIAPolicy ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficIAPolicy" (
  "id"                                    TEXT NOT NULL PRIMARY KEY,
  "tenant_id"                             TEXT NOT NULL,
  "agent_enabled"                         BOOLEAN NOT NULL DEFAULT FALSE,
  "mode"                                  TEXT NOT NULL DEFAULT 'ADVISOR',
  "max_auto_actions_per_day"              INTEGER NOT NULL DEFAULT 10,
  "min_confidence_for_auto"               DECIMAL(4,3) NOT NULL DEFAULT 0.95,
  "auto_apply_negative_keywords"          BOOLEAN NOT NULL DEFAULT FALSE,
  "auto_apply_pause_disapproved"          BOOLEAN NOT NULL DEFAULT TRUE,
  "auto_apply_rsa_asset_recommendations"  BOOLEAN NOT NULL DEFAULT FALSE,
  "auto_apply_budget_changes"             BOOLEAN NOT NULL DEFAULT FALSE,
  "auto_apply_bidding_strategy_changes"   BOOLEAN NOT NULL DEFAULT FALSE,
  "max_budget_change_percent"             DECIMAL(4,3) NOT NULL DEFAULT 0.20,
  "max_budget_change_per_week"            INTEGER NOT NULL DEFAULT 1,
  "max_negatives_per_week"                INTEGER NOT NULL DEFAULT 20,
  "rollback_window_hours"                 INTEGER NOT NULL DEFAULT 24,
  "notify_admin_email"                    BOOLEAN NOT NULL DEFAULT TRUE,
  "notify_admin_whatsapp"                 BOOLEAN NOT NULL DEFAULT TRUE,
  "notify_admin_inapp"                    BOOLEAN NOT NULL DEFAULT TRUE,
  "escalation_hours"                      INTEGER NOT NULL DEFAULT 48,
  "daily_cron"                            TEXT NOT NULL DEFAULT '30 6 * * *',
  "weekly_cron"                           TEXT NOT NULL DEFAULT '0 9 * * 1',
  "monthly_cron"                          TEXT NOT NULL DEFAULT '0 9 1 * *',
  "hourly_enabled"                        BOOLEAN NOT NULL DEFAULT FALSE,
  "shadow_mode"                           BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"                            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                            TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficIAPolicy"
    ADD CONSTRAINT "TrafficIAPolicy_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficIAPolicy_tenant_id_uniq"
  ON "TrafficIAPolicy"("tenant_id");
