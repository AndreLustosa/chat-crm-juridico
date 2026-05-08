-- Workflow de aprovacao opcional pra OrganizationProfile (Fase 3 PR2).
--
-- Adiciona 5 campos pra suportar "proposta pendente":
--   - pending_summary           : texto novo proposto (nao publicado ainda)
--   - pending_facts             : facts JSON novo
--   - pending_changes_applied   : array de mudancas aplicadas pelo LLM (descricao)
--   - pending_at                : timestamp da geracao da proposta
--   - pending_triggered_by      : userId que disparou (null se foi cron)
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.

BEGIN;

-- ─── BEFORE ─────────────────────────────────────────────────────────
SELECT 'BEFORE: campos pending_ existentes' AS metric,
       COUNT(*)::int AS value
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'OrganizationProfile'
  AND column_name LIKE 'pending_%';

-- ─── ALTER TABLE ────────────────────────────────────────────────────
ALTER TABLE "OrganizationProfile"
  ADD COLUMN IF NOT EXISTS pending_summary          TEXT,
  ADD COLUMN IF NOT EXISTS pending_facts            JSONB,
  ADD COLUMN IF NOT EXISTS pending_changes_applied  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS pending_at               TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS pending_triggered_by     TEXT;

-- ─── AFTER ──────────────────────────────────────────────────────────
SELECT 'AFTER: campos pending_ existentes (deve ser 5)' AS metric,
       COUNT(*)::int AS value
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'OrganizationProfile'
  AND column_name LIKE 'pending_%';

COMMIT;
