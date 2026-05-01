-- Sprint I (Fase 4) — Search Terms Report
-- Cria tabela TrafficSearchTerm para cachear termos de pesquisa reais
-- digitados pelos usuarios. Sync popula via search_term_view (GAQL).
--
-- Idempotente: se a tabela ja existe (re-aplicacao), CREATE TABLE IF NOT
-- EXISTS evita erro. Indices via CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "TrafficSearchTerm" (
  "id"                String       NOT NULL,
  "tenant_id"         String       NOT NULL,
  "account_id"        String       NOT NULL,
  "campaign_id"       String,
  "ad_group_id"       String,
  "search_term"       String       NOT NULL,
  "match_type"        String,
  "status"            String,
  "impressions"       INTEGER      NOT NULL DEFAULT 0,
  "clicks"            INTEGER      NOT NULL DEFAULT 0,
  "cost_micros"       BIGINT       NOT NULL DEFAULT 0,
  "conversions"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "conversions_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "last_seen_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrafficSearchTerm_pkey" PRIMARY KEY ("id")
);

-- FKs com onDelete: Cascade alinhado com schema.prisma
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficSearchTerm_tenant_id_fkey'
  ) THEN
    ALTER TABLE "TrafficSearchTerm"
      ADD CONSTRAINT "TrafficSearchTerm_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficSearchTerm_account_id_fkey'
  ) THEN
    ALTER TABLE "TrafficSearchTerm"
      ADD CONSTRAINT "TrafficSearchTerm_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficSearchTerm_campaign_id_fkey'
  ) THEN
    ALTER TABLE "TrafficSearchTerm"
      ADD CONSTRAINT "TrafficSearchTerm_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficSearchTerm_ad_group_id_fkey'
  ) THEN
    ALTER TABLE "TrafficSearchTerm"
      ADD CONSTRAINT "TrafficSearchTerm_ad_group_id_fkey"
      FOREIGN KEY ("ad_group_id") REFERENCES "TrafficAdGroup"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Unique pra dedupe natural por (campanha, ad_group, termo)
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficSearchTerm_campaign_id_ad_group_id_search_term_key"
  ON "TrafficSearchTerm" ("campaign_id", "ad_group_id", "search_term");

-- Indices pra queries comuns: por tenant ordenado por last_seen_at,
-- por campaign ordenado por conv/cost (worst-offenders).
CREATE INDEX IF NOT EXISTS "TrafficSearchTerm_tenant_id_last_seen_at_idx"
  ON "TrafficSearchTerm" ("tenant_id", "last_seen_at");

CREATE INDEX IF NOT EXISTS "TrafficSearchTerm_campaign_id_conversions_cost_micros_idx"
  ON "TrafficSearchTerm" ("campaign_id", "conversions", "cost_micros");

CREATE INDEX IF NOT EXISTS "TrafficSearchTerm_tenant_id_conversions_cost_micros_idx"
  ON "TrafficSearchTerm" ("tenant_id", "conversions", "cost_micros");
