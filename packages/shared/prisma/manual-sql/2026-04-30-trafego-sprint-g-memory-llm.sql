-- Sprint G — Memória adaptativa + LLM model selector
--
-- Estende TrafficIAPolicy com:
--   - llm_provider / llm_summary_model / llm_classify_model
--   - ignored_cooldown_days / reverted_penalty_days / max_resuggestion_strikes
--
-- Idempotente.

ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "llm_provider"             TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "llm_summary_model"        TEXT NOT NULL DEFAULT 'claude-haiku-4-5';
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "llm_classify_model"       TEXT NOT NULL DEFAULT 'claude-haiku-4-5';
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "ignored_cooldown_days"    INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "reverted_penalty_days"    INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "max_resuggestion_strikes" INTEGER NOT NULL DEFAULT 3;
