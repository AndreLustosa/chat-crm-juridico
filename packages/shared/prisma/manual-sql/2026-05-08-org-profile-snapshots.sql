-- Histórico de versões do OrganizationProfile (Fase 3 da auditoria 2026-05-08).
--
-- Cria a tabela OrganizationProfileSnapshot pra guardar versões anteriores
-- do summary do escritório. Permite reverter, auditar mudanças e comparar
-- versões.
--
-- Idempotente: IF NOT EXISTS em todos os DDLs.

BEGIN;

-- ─── 1) Snapshot BEFORE ─────────────────────────────────────────────
SELECT 'BEFORE: Tabela OrganizationProfileSnapshot existe' AS metric,
       (SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'OrganizationProfileSnapshot') AS value;

-- ─── 2) Cria tabela ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OrganizationProfileSnapshot" (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id             TEXT NOT NULL,
  version               INTEGER NOT NULL,
  summary               TEXT NOT NULL,
  facts                 JSONB NOT NULL DEFAULT '{}',
  source                TEXT NOT NULL,
  created_by_user_id    TEXT,
  source_memory_count   INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganizationProfileSnapshot_tenant_id_fkey"
    FOREIGN KEY (tenant_id)
    REFERENCES "OrganizationProfile"(tenant_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- ─── 3) Indices ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "OrganizationProfileSnapshot_tenant_id_created_at_idx"
  ON "OrganizationProfileSnapshot" (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS "OrganizationProfileSnapshot_tenant_id_version_idx"
  ON "OrganizationProfileSnapshot" (tenant_id, version);

-- ─── 4) Snapshot AFTER ──────────────────────────────────────────────
SELECT 'AFTER: Tabela OrganizationProfileSnapshot existe' AS metric,
       (SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'OrganizationProfileSnapshot') AS value;

SELECT 'AFTER: Indices criados' AS metric,
       COUNT(*)::int AS value
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'OrganizationProfileSnapshot';

COMMIT;
