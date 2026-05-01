-- Sprint I (Fase 4f) — Landing Pages
-- Cria tabela LandingPage com campos pra PageSpeed Insights + análise IA.

CREATE TABLE IF NOT EXISTS "LandingPage" (
  "id"                String       NOT NULL,
  "tenant_id"         String       NOT NULL,
  "account_id"        String,
  "campaign_id"       String,
  "url"               String       NOT NULL,
  "title"             String,
  "description"       TEXT,
  "pagespeed_mobile"  INTEGER      NOT NULL DEFAULT 0,
  "pagespeed_desktop" INTEGER      NOT NULL DEFAULT 0,
  "lcp_ms"            INTEGER,
  "cls_x100"          INTEGER,
  "inp_ms"            INTEGER,
  "last_pagespeed_at" TIMESTAMP(3),
  "pagespeed_data"    JSONB,
  "last_analyzed_at"  TIMESTAMP(3),
  "analysis"          JSONB,
  "clicks_30d"        INTEGER      NOT NULL DEFAULT 0,
  "conversions_30d"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'LandingPage_tenant_id_fkey'
  ) THEN
    ALTER TABLE "LandingPage"
      ADD CONSTRAINT "LandingPage_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'LandingPage_account_id_fkey'
  ) THEN
    ALTER TABLE "LandingPage"
      ADD CONSTRAINT "LandingPage_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'LandingPage_campaign_id_fkey'
  ) THEN
    ALTER TABLE "LandingPage"
      ADD CONSTRAINT "LandingPage_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "LandingPage_tenant_id_url_key"
  ON "LandingPage" ("tenant_id", "url");

CREATE INDEX IF NOT EXISTS "LandingPage_tenant_id_last_pagespeed_at_idx"
  ON "LandingPage" ("tenant_id", "last_pagespeed_at");

CREATE INDEX IF NOT EXISTS "LandingPage_campaign_id_idx"
  ON "LandingPage" ("campaign_id");
