-- Sprint F — PMax/Demand Gen Asset Groups + Reach Planner
--
-- Adiciona:
--   1. TrafficAssetGroup (cache de asset_group da API)
--   2. TrafficAssetGroupAsset (link N:N AssetGroup × Asset com performance_label)
--   3. TrafficReachForecast (forecasts gerados via Reach Planner Service)
--
-- Idempotente.

-- ── 1. TrafficAssetGroup ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficAssetGroup" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "tenant_id"             TEXT NOT NULL,
  "account_id"            TEXT NOT NULL,
  "campaign_id"           TEXT NOT NULL,
  "google_asset_group_id" TEXT NOT NULL,
  "google_resource_name"  TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "status"                TEXT NOT NULL,
  "ad_strength"           TEXT,
  "primary_status"        TEXT,
  "last_seen_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficAssetGroup"
    ADD CONSTRAINT "TrafficAssetGroup_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficAssetGroup"
    ADD CONSTRAINT "TrafficAssetGroup_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficAssetGroup"
    ADD CONSTRAINT "TrafficAssetGroup_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficAssetGroup_account_google_uniq"
  ON "TrafficAssetGroup"("account_id", "google_asset_group_id");
CREATE INDEX IF NOT EXISTS "TrafficAssetGroup_tenant_status_idx"
  ON "TrafficAssetGroup"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "TrafficAssetGroup_campaign_idx"
  ON "TrafficAssetGroup"("campaign_id");

-- ── 2. TrafficAssetGroupAsset ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficAssetGroupAsset" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "account_id"          TEXT NOT NULL,
  "asset_group_id"      TEXT NOT NULL,
  "asset_resource_name" TEXT NOT NULL,
  "google_asset_id"     TEXT NOT NULL,
  "asset_type"          TEXT,
  "asset_text"          TEXT,
  "asset_url"           TEXT,
  "field_type"          TEXT NOT NULL,
  "performance_label"   TEXT,
  "status"              TEXT,
  "last_seen_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficAssetGroupAsset"
    ADD CONSTRAINT "TrafficAssetGroupAsset_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficAssetGroupAsset"
    ADD CONSTRAINT "TrafficAssetGroupAsset_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficAssetGroupAsset"
    ADD CONSTRAINT "TrafficAssetGroupAsset_asset_group_id_fkey"
      FOREIGN KEY ("asset_group_id") REFERENCES "TrafficAssetGroup"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficAssetGroupAsset_group_asset_field_uniq"
  ON "TrafficAssetGroupAsset"("asset_group_id", "google_asset_id", "field_type");
CREATE INDEX IF NOT EXISTS "TrafficAssetGroupAsset_account_perf_idx"
  ON "TrafficAssetGroupAsset"("account_id", "performance_label");
CREATE INDEX IF NOT EXISTS "TrafficAssetGroupAsset_type_idx"
  ON "TrafficAssetGroupAsset"("asset_type");

-- ── 3. TrafficReachForecast ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficReachForecast" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "account_id"       TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "request_params"   JSONB NOT NULL,
  "response_payload" JSONB NOT NULL,
  "summary"          JSONB NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'PENDING',
  "error_message"    TEXT,
  "created_by"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficReachForecast"
    ADD CONSTRAINT "TrafficReachForecast_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficReachForecast"
    ADD CONSTRAINT "TrafficReachForecast_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "TrafficReachForecast_tenant_created_idx"
  ON "TrafficReachForecast"("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficReachForecast_account_status_idx"
  ON "TrafficReachForecast"("account_id", "status");
