-- Sprint E — Recommendations API com filtro OAB
--
-- Cria TrafficRecommendation: cache local de recommendations vindas da
-- Google Ads API. Cada uma passa por OAB validator (validateAd /
-- validateKeyword) antes de ser elegível pra apply automático ou manual.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS "TrafficRecommendation" (
  "id"                   TEXT NOT NULL PRIMARY KEY,
  "tenant_id"            TEXT NOT NULL,
  "account_id"           TEXT NOT NULL,
  "google_resource_name" TEXT NOT NULL,
  "recommendation_type"  TEXT NOT NULL,
  "campaign_id"          TEXT,
  "ad_group_id"          TEXT,
  "payload"              JSONB NOT NULL,
  "impact_base"          JSONB,
  "impact_potential"     JSONB,
  "status"               TEXT NOT NULL DEFAULT 'PENDING',
  "oab_violations"       JSONB,
  "oab_summary"          TEXT,
  "resolved_at"          TIMESTAMP(3),
  "mutate_log_id"        TEXT,
  "error_message"        TEXT,
  "resolved_by"          TEXT,
  "first_seen_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficRecommendation"
    ADD CONSTRAINT "TrafficRecommendation_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficRecommendation"
    ADD CONSTRAINT "TrafficRecommendation_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficRecommendation_account_resource_uniq"
  ON "TrafficRecommendation"("account_id", "google_resource_name");
CREATE INDEX IF NOT EXISTS "TrafficRecommendation_tenant_status_type_idx"
  ON "TrafficRecommendation"("tenant_id", "status", "recommendation_type");
CREATE INDEX IF NOT EXISTS "TrafficRecommendation_account_status_idx"
  ON "TrafficRecommendation"("account_id", "status");
CREATE INDEX IF NOT EXISTS "TrafficRecommendation_campaign_idx"
  ON "TrafficRecommendation"("campaign_id");
