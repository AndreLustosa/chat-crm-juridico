-- Estende MonthlyGoal com 3 dimensoes:
--   - lawyer_id (escopo: NULL = escritorio, valor = advogado especifico)
--   - kind ('REALIZED' | 'CONTRACTED') — meta de receita realizada vs contratada
--   - created_by_id (auditoria) + deleted_at (soft delete)
--
-- Backward compat com dados existentes:
--   - Linhas antigas ficam com lawyer_id=NULL e kind='REALIZED'
--     (era a unica configuracao que a UI antiga permitia).
--   - Unique constraint antigo (tenant_id, year, month) e dropado e
--     substituido por (tenant_id, lawyer_id, year, month, kind) — o que
--     mantem unicidade pra rows antigas e permite as 3 dimensoes novas.
--
-- Idempotente.

ALTER TABLE "MonthlyGoal"
  ADD COLUMN IF NOT EXISTS "lawyer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'REALIZED',
  ADD COLUMN IF NOT EXISTS "created_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- FK do lawyer_id pra User (cascade pra preservar integridade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'MonthlyGoal_lawyer_id_fkey'
  ) THEN
    ALTER TABLE "MonthlyGoal"
      ADD CONSTRAINT "MonthlyGoal_lawyer_id_fkey"
      FOREIGN KEY ("lawyer_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- FK do created_by_id pra User (set null se usuario for removido — preserva historico)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'MonthlyGoal_created_by_id_fkey'
  ) THEN
    ALTER TABLE "MonthlyGoal"
      ADD CONSTRAINT "MonthlyGoal_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Drop unique antigo (so tenant+year+month) — agora as 3 dimensoes definem unicidade
DROP INDEX IF EXISTS "MonthlyGoal_tenant_year_month_key";

-- Unique completo + soft delete: COALESCE pra tratar NULL como valor estavel
-- (postgres trata NULL como sempre diferente em unique, o que permitiria
-- rows duplicadas com lawyer_id=NULL). COALESCE forca '__OFFICE__' como
-- placeholder pra escopo escritorio.
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyGoal_unique_scope"
  ON "MonthlyGoal"(
    "tenant_id",
    COALESCE("lawyer_id", '__OFFICE__'),
    "year",
    "month",
    "kind"
  )
  WHERE "deleted_at" IS NULL;

-- Indice para busca rapida por advogado + ano (tela de gestao)
CREATE INDEX IF NOT EXISTS "MonthlyGoal_lawyer_year_idx"
  ON "MonthlyGoal"("lawyer_id", "year")
  WHERE "deleted_at" IS NULL;

-- Indice para filtro de "ativos" (nao soft-deletados)
CREATE INDEX IF NOT EXISTS "MonthlyGoal_active_idx"
  ON "MonthlyGoal"("tenant_id", "year", "month")
  WHERE "deleted_at" IS NULL;
