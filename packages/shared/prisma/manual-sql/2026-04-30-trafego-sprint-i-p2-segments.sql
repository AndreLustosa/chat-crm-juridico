-- Sprint I (P2) — Imp Share + Ad Strength + Hourly/Device Metrics
-- Habilita: barra de saúde da campanha, heatmap hora×dia, donut dispositivos.

-- ─── 1. TrafficMetricDaily — colunas de impression share ──────────────────
ALTER TABLE "TrafficMetricDaily"
  ADD COLUMN IF NOT EXISTS "search_impression_share"         DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "search_lost_is_budget"           DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "search_lost_is_rank"             DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "search_top_impression_share"     DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "search_abs_top_impression_share" DECIMAL(65, 30);

-- ─── 2. TrafficAd — ad_strength ──────────────────────────────────────────
ALTER TABLE "TrafficAd"
  ADD COLUMN IF NOT EXISTS "ad_strength" TEXT;

-- ─── 3. TrafficMetricHourly ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficMetricHourly" (
  "id"                String       NOT NULL,
  "tenant_id"         String       NOT NULL,
  "account_id"        String       NOT NULL,
  "campaign_id"       String       NOT NULL,
  "date"              DATE         NOT NULL,
  "hour"              INTEGER      NOT NULL,
  "impressions"       INTEGER      NOT NULL DEFAULT 0,
  "clicks"            INTEGER      NOT NULL DEFAULT 0,
  "cost_micros"       BIGINT       NOT NULL DEFAULT 0,
  "conversions"       DECIMAL(65, 30) NOT NULL DEFAULT 0,
  "conversions_value" DECIMAL(65, 30) NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrafficMetricHourly_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficMetricHourly_tenant_id_fkey'
  ) THEN
    ALTER TABLE "TrafficMetricHourly"
      ADD CONSTRAINT "TrafficMetricHourly_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficMetricHourly_account_id_fkey'
  ) THEN
    ALTER TABLE "TrafficMetricHourly"
      ADD CONSTRAINT "TrafficMetricHourly_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficMetricHourly_campaign_id_fkey'
  ) THEN
    ALTER TABLE "TrafficMetricHourly"
      ADD CONSTRAINT "TrafficMetricHourly_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficMetricHourly_campaign_id_date_hour_key"
  ON "TrafficMetricHourly" ("campaign_id", "date", "hour");

CREATE INDEX IF NOT EXISTS "TrafficMetricHourly_tenant_id_date_idx"
  ON "TrafficMetricHourly" ("tenant_id", "date");

CREATE INDEX IF NOT EXISTS "TrafficMetricHourly_campaign_id_date_idx"
  ON "TrafficMetricHourly" ("campaign_id", "date");

-- ─── 4. TrafficMetricDevice ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficMetricDevice" (
  "id"                String       NOT NULL,
  "tenant_id"         String       NOT NULL,
  "account_id"        String       NOT NULL,
  "campaign_id"       String       NOT NULL,
  "date"              DATE         NOT NULL,
  "device"            String       NOT NULL,
  "impressions"       INTEGER      NOT NULL DEFAULT 0,
  "clicks"            INTEGER      NOT NULL DEFAULT 0,
  "cost_micros"       BIGINT       NOT NULL DEFAULT 0,
  "conversions"       DECIMAL(65, 30) NOT NULL DEFAULT 0,
  "conversions_value" DECIMAL(65, 30) NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrafficMetricDevice_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficMetricDevice_tenant_id_fkey'
  ) THEN
    ALTER TABLE "TrafficMetricDevice"
      ADD CONSTRAINT "TrafficMetricDevice_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficMetricDevice_account_id_fkey'
  ) THEN
    ALTER TABLE "TrafficMetricDevice"
      ADD CONSTRAINT "TrafficMetricDevice_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficMetricDevice_campaign_id_fkey'
  ) THEN
    ALTER TABLE "TrafficMetricDevice"
      ADD CONSTRAINT "TrafficMetricDevice_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficMetricDevice_campaign_id_date_device_key"
  ON "TrafficMetricDevice" ("campaign_id", "date", "device");

CREATE INDEX IF NOT EXISTS "TrafficMetricDevice_tenant_id_date_idx"
  ON "TrafficMetricDevice" ("tenant_id", "date");

CREATE INDEX IF NOT EXISTS "TrafficMetricDevice_campaign_id_date_idx"
  ON "TrafficMetricDevice" ("campaign_id", "date");
