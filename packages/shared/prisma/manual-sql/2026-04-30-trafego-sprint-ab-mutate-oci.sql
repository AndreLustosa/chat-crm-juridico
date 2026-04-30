-- Sprint A+B (Mutate + OCI) — adiciona 9 tabelas novas + extensoes em Lead/TrafficCampaign.
--
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS pra rodar
-- multiplas vezes sem quebrar.
--
-- Roda em producao via:
--   docker exec -it lustosaadvogados_postgres psql -U postgres -d lustosaadvogados \
--     -f /tmp/2026-04-30-trafego-sprint-ab-mutate-oci.sql
--
-- ── 1. Extensoes em Lead (gclid + utm) ────────────────────────────────────
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "google_gclid"    TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "google_gbraid"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "google_wbraid"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "google_click_at" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utm_source"      TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utm_medium"      TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utm_campaign"    TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utm_content"     TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utm_term"        TEXT;

CREATE INDEX IF NOT EXISTS "Lead_google_gclid_idx"  ON "Lead"("google_gclid");
CREATE INDEX IF NOT EXISTS "Lead_google_gbraid_idx" ON "Lead"("google_gbraid");
CREATE INDEX IF NOT EXISTS "Lead_google_wbraid_idx" ON "Lead"("google_wbraid");

-- ── 2. Extensoes em TrafficCampaign (objective + service_category) ───────
ALTER TABLE "TrafficCampaign" ADD COLUMN IF NOT EXISTS "objective"        TEXT NOT NULL DEFAULT 'PERFORMANCE';
ALTER TABLE "TrafficCampaign" ADD COLUMN IF NOT EXISTS "service_category" TEXT;

CREATE INDEX IF NOT EXISTS "TrafficCampaign_service_category_idx" ON "TrafficCampaign"("service_category");
CREATE INDEX IF NOT EXISTS "TrafficCampaign_objective_idx"        ON "TrafficCampaign"("objective");

-- ── 3. TrafficMutateLog (audit de toda escrita na Google Ads API) ────────
CREATE TABLE IF NOT EXISTS "TrafficMutateLog" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "initiator" TEXT NOT NULL,
    "confidence" DECIMAL(65,30),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "validate_only" BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER,
    "reverted_by" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrafficMutateLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficMutateLog_request_id_key"          ON "TrafficMutateLog"("request_id");
CREATE INDEX        IF NOT EXISTS "TrafficMutateLog_tenant_id_created_at_idx" ON "TrafficMutateLog"("tenant_id", "created_at" DESC);
CREATE INDEX        IF NOT EXISTS "TrafficMutateLog_account_id_resource_type_created_at_idx" ON "TrafficMutateLog"("account_id", "resource_type", "created_at" DESC);
CREATE INDEX        IF NOT EXISTS "TrafficMutateLog_initiator_created_at_idx" ON "TrafficMutateLog"("initiator", "created_at" DESC);
CREATE INDEX        IF NOT EXISTS "TrafficMutateLog_status_idx"               ON "TrafficMutateLog"("status");

-- ── 4. TrafficAdGroup ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficAdGroup" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "google_ad_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT,
    "cpc_bid_micros" BIGINT,
    "cpm_bid_micros" BIGINT,
    "target_cpa_micros" BIGINT,
    "target_roas" DECIMAL(65,30),
    "is_archived_internal" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrafficAdGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        IF NOT EXISTS "TrafficAdGroup_tenant_id_status_idx"          ON "TrafficAdGroup"("tenant_id", "status");
CREATE INDEX        IF NOT EXISTS "TrafficAdGroup_account_id_last_seen_at_idx"   ON "TrafficAdGroup"("account_id", "last_seen_at");
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficAdGroup_campaign_id_google_ad_group_id_key" ON "TrafficAdGroup"("campaign_id", "google_ad_group_id");

-- ── 5. TrafficKeyword ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficKeyword" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "ad_group_id" TEXT NOT NULL,
    "google_criterion_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "negative" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "cpc_bid_micros" BIGINT,
    "quality_score" INTEGER,
    "quality_info" JSONB,
    "added_by_ai" BOOLEAN NOT NULL DEFAULT false,
    "ai_confidence" DECIMAL(65,30),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrafficKeyword_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        IF NOT EXISTS "TrafficKeyword_tenant_id_negative_idx"             ON "TrafficKeyword"("tenant_id", "negative");
CREATE INDEX        IF NOT EXISTS "TrafficKeyword_account_id_status_idx"              ON "TrafficKeyword"("account_id", "status");
CREATE INDEX        IF NOT EXISTS "TrafficKeyword_text_idx"                           ON "TrafficKeyword"("text");
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficKeyword_ad_group_id_google_criterion_id_key" ON "TrafficKeyword"("ad_group_id", "google_criterion_id");

-- ── 6. TrafficAd ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficAd" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "ad_group_id" TEXT NOT NULL,
    "google_ad_id" TEXT NOT NULL,
    "ad_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approval_status" TEXT,
    "policy_topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "final_urls" JSONB NOT NULL DEFAULT '[]',
    "headlines" JSONB NOT NULL DEFAULT '[]',
    "descriptions" JSONB NOT NULL DEFAULT '[]',
    "path1" TEXT,
    "path2" TEXT,
    "ad_payload" JSONB,
    "added_by_ai" BOOLEAN NOT NULL DEFAULT false,
    "ai_confidence" DECIMAL(65,30),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrafficAd_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        IF NOT EXISTS "TrafficAd_tenant_id_approval_status_idx"  ON "TrafficAd"("tenant_id", "approval_status");
CREATE INDEX        IF NOT EXISTS "TrafficAd_account_id_status_idx"          ON "TrafficAd"("account_id", "status");
CREATE INDEX        IF NOT EXISTS "TrafficAd_ad_type_idx"                    ON "TrafficAd"("ad_type");
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficAd_ad_group_id_google_ad_id_key"   ON "TrafficAd"("ad_group_id", "google_ad_id");

-- ── 7. TrafficCampaignBudget ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficCampaignBudget" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "google_budget_id" TEXT NOT NULL,
    "name" TEXT,
    "amount_micros" BIGINT NOT NULL,
    "delivery_method" TEXT,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "reference_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ENABLED',
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrafficCampaignBudget_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        IF NOT EXISTS "TrafficCampaignBudget_tenant_id_is_shared_idx"      ON "TrafficCampaignBudget"("tenant_id", "is_shared");
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficCampaignBudget_account_id_google_budget_id_key" ON "TrafficCampaignBudget"("account_id", "google_budget_id");

-- ── 8. TrafficBulkJob ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficBulkJob" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "resource_name" TEXT NOT NULL,
    "job_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_ops" INTEGER NOT NULL DEFAULT 0,
    "succeeded_ops" INTEGER NOT NULL DEFAULT 0,
    "failed_ops" INTEGER NOT NULL DEFAULT 0,
    "initiator" TEXT NOT NULL,
    "operations" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrafficBulkJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficBulkJob_resource_name_key"                       ON "TrafficBulkJob"("resource_name");
CREATE INDEX        IF NOT EXISTS "TrafficBulkJob_tenant_id_status_idx"                    ON "TrafficBulkJob"("tenant_id", "status");
CREATE INDEX        IF NOT EXISTS "TrafficBulkJob_account_id_job_kind_created_at_idx"      ON "TrafficBulkJob"("account_id", "job_kind", "created_at" DESC);

-- ── 9. TrafficConversionAction ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficConversionAction" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "google_conversion_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT,
    "counting_type" TEXT,
    "click_through_lookback" INTEGER,
    "include_in_conversions" BOOLEAN NOT NULL DEFAULT true,
    "crm_event_kind" TEXT,
    "default_value_micros" BIGINT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrafficConversionAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        IF NOT EXISTS "TrafficConversionAction_tenant_id_status_idx"            ON "TrafficConversionAction"("tenant_id", "status");
CREATE INDEX        IF NOT EXISTS "TrafficConversionAction_crm_event_kind_idx"              ON "TrafficConversionAction"("crm_event_kind");
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficConversionAction_account_id_google_conversion_id_key" ON "TrafficConversionAction"("account_id", "google_conversion_id");

-- ── 10. TrafficOCIUpload ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficOCIUpload" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversion_action_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "email_sha256" TEXT,
    "phone_sha256" TEXT,
    "order_id" TEXT,
    "conversion_at" TIMESTAMP(3) NOT NULL,
    "value_micros" BIGINT,
    "currency_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "api_response" JSONB,
    "uploaded_at" TIMESTAMP(3),
    "trigger_event" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrafficOCIUpload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        IF NOT EXISTS "TrafficOCIUpload_tenant_id_status_created_at_idx" ON "TrafficOCIUpload"("tenant_id", "status", "created_at" DESC);
CREATE INDEX        IF NOT EXISTS "TrafficOCIUpload_account_id_status_idx"           ON "TrafficOCIUpload"("account_id", "status");
CREATE INDEX        IF NOT EXISTS "TrafficOCIUpload_lead_id_idx"                     ON "TrafficOCIUpload"("lead_id");
CREATE INDEX        IF NOT EXISTS "TrafficOCIUpload_gclid_idx"                       ON "TrafficOCIUpload"("gclid");
CREATE INDEX        IF NOT EXISTS "TrafficOCIUpload_email_sha256_idx"                ON "TrafficOCIUpload"("email_sha256");
CREATE INDEX        IF NOT EXISTS "TrafficOCIUpload_order_id_idx"                    ON "TrafficOCIUpload"("order_id");
CREATE INDEX        IF NOT EXISTS "TrafficOCIUpload_conversion_at_idx"               ON "TrafficOCIUpload"("conversion_at");
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficOCIUpload_conversion_action_id_gclid_conversion_at_key" ON "TrafficOCIUpload"("conversion_action_id", "gclid", "conversion_at");

-- ── 11. TrafficLeadFormSubmission ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficLeadFormSubmission" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "google_asset_id" TEXT,
    "campaign_id" TEXT,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "full_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "lead_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "raw_payload" JSONB NOT NULL DEFAULT '{}',
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "TrafficLeadFormSubmission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TrafficLeadFormSubmission_tenant_id_status_created_at_idx" ON "TrafficLeadFormSubmission"("tenant_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficLeadFormSubmission_account_id_status_idx"           ON "TrafficLeadFormSubmission"("account_id", "status");
CREATE INDEX IF NOT EXISTS "TrafficLeadFormSubmission_gclid_idx"                       ON "TrafficLeadFormSubmission"("gclid");
CREATE INDEX IF NOT EXISTS "TrafficLeadFormSubmission_email_idx"                       ON "TrafficLeadFormSubmission"("email");
CREATE INDEX IF NOT EXISTS "TrafficLeadFormSubmission_phone_idx"                       ON "TrafficLeadFormSubmission"("phone");
CREATE INDEX IF NOT EXISTS "TrafficLeadFormSubmission_lead_id_idx"                     ON "TrafficLeadFormSubmission"("lead_id");

-- ── Foreign Keys ────────────────────────────────────────────────────────
-- Idempotente: drop antes pra evitar erro em re-execucao
DO $$ BEGIN
  ALTER TABLE "TrafficMutateLog"
    ADD CONSTRAINT "TrafficMutateLog_tenant_id_fkey"  FOREIGN KEY ("tenant_id")  REFERENCES "Tenant"("id")          ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficMutateLog"
    ADD CONSTRAINT "TrafficMutateLog_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficAdGroup"
    ADD CONSTRAINT "TrafficAdGroup_tenant_id_fkey"   FOREIGN KEY ("tenant_id")   REFERENCES "Tenant"("id")           ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficAdGroup"
    ADD CONSTRAINT "TrafficAdGroup_account_id_fkey"  FOREIGN KEY ("account_id")  REFERENCES "TrafficAccount"("id")   ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficAdGroup"
    ADD CONSTRAINT "TrafficAdGroup_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficKeyword"
    ADD CONSTRAINT "TrafficKeyword_tenant_id_fkey"   FOREIGN KEY ("tenant_id")   REFERENCES "Tenant"("id")           ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficKeyword"
    ADD CONSTRAINT "TrafficKeyword_account_id_fkey"  FOREIGN KEY ("account_id")  REFERENCES "TrafficAccount"("id")   ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficKeyword"
    ADD CONSTRAINT "TrafficKeyword_ad_group_id_fkey" FOREIGN KEY ("ad_group_id") REFERENCES "TrafficAdGroup"("id")   ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficAd"
    ADD CONSTRAINT "TrafficAd_tenant_id_fkey"   FOREIGN KEY ("tenant_id")   REFERENCES "Tenant"("id")          ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficAd"
    ADD CONSTRAINT "TrafficAd_account_id_fkey"  FOREIGN KEY ("account_id")  REFERENCES "TrafficAccount"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficAd"
    ADD CONSTRAINT "TrafficAd_ad_group_id_fkey" FOREIGN KEY ("ad_group_id") REFERENCES "TrafficAdGroup"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficCampaignBudget"
    ADD CONSTRAINT "TrafficCampaignBudget_tenant_id_fkey"  FOREIGN KEY ("tenant_id")  REFERENCES "Tenant"("id")         ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficCampaignBudget"
    ADD CONSTRAINT "TrafficCampaignBudget_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficBulkJob"
    ADD CONSTRAINT "TrafficBulkJob_tenant_id_fkey"  FOREIGN KEY ("tenant_id")  REFERENCES "Tenant"("id")         ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficBulkJob"
    ADD CONSTRAINT "TrafficBulkJob_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficConversionAction"
    ADD CONSTRAINT "TrafficConversionAction_tenant_id_fkey"  FOREIGN KEY ("tenant_id")  REFERENCES "Tenant"("id")         ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficConversionAction"
    ADD CONSTRAINT "TrafficConversionAction_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficOCIUpload"
    ADD CONSTRAINT "TrafficOCIUpload_tenant_id_fkey"            FOREIGN KEY ("tenant_id")            REFERENCES "Tenant"("id")               ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficOCIUpload"
    ADD CONSTRAINT "TrafficOCIUpload_account_id_fkey"           FOREIGN KEY ("account_id")           REFERENCES "TrafficAccount"("id")       ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficOCIUpload"
    ADD CONSTRAINT "TrafficOCIUpload_conversion_action_id_fkey" FOREIGN KEY ("conversion_action_id") REFERENCES "TrafficConversionAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficOCIUpload"
    ADD CONSTRAINT "TrafficOCIUpload_lead_id_fkey"              FOREIGN KEY ("lead_id")              REFERENCES "Lead"("id")                 ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficLeadFormSubmission"
    ADD CONSTRAINT "TrafficLeadFormSubmission_tenant_id_fkey"  FOREIGN KEY ("tenant_id")  REFERENCES "Tenant"("id")         ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficLeadFormSubmission"
    ADD CONSTRAINT "TrafficLeadFormSubmission_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TrafficLeadFormSubmission"
    ADD CONSTRAINT "TrafficLeadFormSubmission_lead_id_fkey"    FOREIGN KEY ("lead_id")    REFERENCES "Lead"("id")           ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
