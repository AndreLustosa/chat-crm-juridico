-- Meta de receita mensal — usada pelo card "Meta do Mês" do dashboard
-- financeiro novo. UI permite cadastrar single ou propagar pra 12 meses.
--
-- Multi-tenant: pode haver tenant_id null (single-tenant) ou especifico.
-- Unique por (tenant_id, year, month) — upsert ja existente.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS "MonthlyGoal" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL CHECK ("month" >= 1 AND "month" <= 12),
  "value" DECIMAL(14, 2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonthlyGoal_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'MonthlyGoal_tenant_id_fkey'
  ) THEN
    ALTER TABLE "MonthlyGoal"
      ADD CONSTRAINT "MonthlyGoal_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Unique constraint pra upsert por mes/ano/tenant
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyGoal_tenant_year_month_key"
  ON "MonthlyGoal"("tenant_id", "year", "month");

CREATE INDEX IF NOT EXISTS "MonthlyGoal_year_month_idx"
  ON "MonthlyGoal"("year", "month");
