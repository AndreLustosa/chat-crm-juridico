-- Modulo Trafego Organico / Google Search Console.
-- Cria tabelas para configuracao, cadastro de landing pages por cidade/area,
-- metricas Search Analytics, snapshots de URL Inspection e logs de sync.

CREATE TABLE IF NOT EXISTS "OrganicSearchConfig" (
  "id"                    TEXT         NOT NULL,
  "tenant_id"             TEXT         NOT NULL,
  "site_url"              TEXT         NOT NULL,
  "property_type"         TEXT         NOT NULL DEFAULT 'DOMAIN',
  "service_account_b64"   TEXT,
  "service_account_email" TEXT,
  "is_active"             BOOLEAN      NOT NULL DEFAULT TRUE,
  "last_sync_at"          TIMESTAMP(3),
  "last_inspection_at"    TIMESTAMP(3),
  "last_error"            TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganicSearchConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganicLandingPage" (
  "id"                  TEXT         NOT NULL,
  "tenant_id"           TEXT         NOT NULL,
  "url"                 TEXT         NOT NULL,
  "path"                TEXT         NOT NULL,
  "title"               TEXT         NOT NULL,
  "city"                TEXT,
  "state"               TEXT,
  "practice_area"       TEXT,
  "target_keywords"     TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"               TEXT,
  "sitemap_url"         TEXT,
  "is_active"           BOOLEAN      NOT NULL DEFAULT TRUE,
  "clicks_30d"          INTEGER      NOT NULL DEFAULT 0,
  "impressions_30d"     INTEGER      NOT NULL DEFAULT 0,
  "ctr_30d"             DOUBLE PRECISION NOT NULL DEFAULT 0,
  "position_30d"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lp_views_30d"        INTEGER      NOT NULL DEFAULT 0,
  "whatsapp_clicks_30d" INTEGER      NOT NULL DEFAULT 0,
  "index_verdict"       TEXT,
  "coverage_state"      TEXT,
  "indexing_state"      TEXT,
  "page_fetch_state"    TEXT,
  "robots_txt_state"    TEXT,
  "google_canonical"    TEXT,
  "user_canonical"      TEXT,
  "last_crawl_time"     TIMESTAMP(3),
  "last_search_sync_at" TIMESTAMP(3),
  "last_inspected_at"   TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganicLandingPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganicSearchMetric" (
  "id"          TEXT         NOT NULL,
  "tenant_id"   TEXT         NOT NULL,
  "page_id"     TEXT         NOT NULL,
  "date"        DATE         NOT NULL,
  "query"       TEXT         NOT NULL DEFAULT '',
  "country"     TEXT         NOT NULL DEFAULT '',
  "device"      TEXT         NOT NULL DEFAULT '',
  "clicks"      INTEGER      NOT NULL DEFAULT 0,
  "impressions" INTEGER      NOT NULL DEFAULT 0,
  "ctr"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "position"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganicSearchMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganicInspectionSnapshot" (
  "id"               TEXT         NOT NULL,
  "tenant_id"        TEXT         NOT NULL,
  "page_id"          TEXT         NOT NULL,
  "inspection_url"   TEXT         NOT NULL,
  "site_url"         TEXT         NOT NULL,
  "verdict"          TEXT,
  "coverage_state"   TEXT,
  "indexing_state"   TEXT,
  "page_fetch_state" TEXT,
  "robots_txt_state" TEXT,
  "google_canonical" TEXT,
  "user_canonical"   TEXT,
  "last_crawl_time"  TIMESTAMP(3),
  "raw"              JSONB,
  "inspected_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganicInspectionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganicSyncLog" (
  "id"            TEXT         NOT NULL,
  "tenant_id"     TEXT         NOT NULL,
  "trigger"       TEXT         NOT NULL,
  "status"        TEXT         NOT NULL,
  "date_from"     DATE,
  "date_to"       DATE,
  "pages_seen"    INTEGER      NOT NULL DEFAULT 0,
  "rows_upserted" INTEGER      NOT NULL DEFAULT 0,
  "inspected"     INTEGER      NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "duration_ms"   INTEGER,
  "started_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"   TIMESTAMP(3),

  CONSTRAINT "OrganicSyncLog_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'OrganicSearchConfig_tenant_id_fkey') THEN
    ALTER TABLE "OrganicSearchConfig"
      ADD CONSTRAINT "OrganicSearchConfig_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'OrganicLandingPage_tenant_id_fkey') THEN
    ALTER TABLE "OrganicLandingPage"
      ADD CONSTRAINT "OrganicLandingPage_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'OrganicSearchMetric_tenant_id_fkey') THEN
    ALTER TABLE "OrganicSearchMetric"
      ADD CONSTRAINT "OrganicSearchMetric_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'OrganicSearchMetric_page_id_fkey') THEN
    ALTER TABLE "OrganicSearchMetric"
      ADD CONSTRAINT "OrganicSearchMetric_page_id_fkey"
      FOREIGN KEY ("page_id") REFERENCES "OrganicLandingPage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'OrganicInspectionSnapshot_tenant_id_fkey') THEN
    ALTER TABLE "OrganicInspectionSnapshot"
      ADD CONSTRAINT "OrganicInspectionSnapshot_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'OrganicInspectionSnapshot_page_id_fkey') THEN
    ALTER TABLE "OrganicInspectionSnapshot"
      ADD CONSTRAINT "OrganicInspectionSnapshot_page_id_fkey"
      FOREIGN KEY ("page_id") REFERENCES "OrganicLandingPage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'OrganicSyncLog_tenant_id_fkey') THEN
    ALTER TABLE "OrganicSyncLog"
      ADD CONSTRAINT "OrganicSyncLog_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "OrganicSearchConfig_tenant_id_key"
  ON "OrganicSearchConfig" ("tenant_id");
CREATE INDEX IF NOT EXISTS "OrganicSearchConfig_site_url_idx"
  ON "OrganicSearchConfig" ("site_url");

CREATE UNIQUE INDEX IF NOT EXISTS "OrganicLandingPage_tenant_id_url_key"
  ON "OrganicLandingPage" ("tenant_id", "url");
CREATE INDEX IF NOT EXISTS "OrganicLandingPage_tenant_id_is_active_idx"
  ON "OrganicLandingPage" ("tenant_id", "is_active");
CREATE INDEX IF NOT EXISTS "OrganicLandingPage_tenant_id_city_practice_area_idx"
  ON "OrganicLandingPage" ("tenant_id", "city", "practice_area");
CREATE INDEX IF NOT EXISTS "OrganicLandingPage_path_idx"
  ON "OrganicLandingPage" ("path");

CREATE UNIQUE INDEX IF NOT EXISTS "OrganicSearchMetric_page_id_date_query_country_device_key"
  ON "OrganicSearchMetric" ("page_id", "date", "query", "country", "device");
CREATE INDEX IF NOT EXISTS "OrganicSearchMetric_tenant_id_date_idx"
  ON "OrganicSearchMetric" ("tenant_id", "date");
CREATE INDEX IF NOT EXISTS "OrganicSearchMetric_page_id_date_idx"
  ON "OrganicSearchMetric" ("page_id", "date");
CREATE INDEX IF NOT EXISTS "OrganicSearchMetric_query_idx"
  ON "OrganicSearchMetric" ("query");

CREATE INDEX IF NOT EXISTS "OrganicInspectionSnapshot_tenant_id_inspected_at_idx"
  ON "OrganicInspectionSnapshot" ("tenant_id", "inspected_at" DESC);
CREATE INDEX IF NOT EXISTS "OrganicInspectionSnapshot_page_id_inspected_at_idx"
  ON "OrganicInspectionSnapshot" ("page_id", "inspected_at" DESC);

CREATE INDEX IF NOT EXISTS "OrganicSyncLog_tenant_id_started_at_idx"
  ON "OrganicSyncLog" ("tenant_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "OrganicSyncLog_status_started_at_idx"
  ON "OrganicSyncLog" ("status", "started_at");
