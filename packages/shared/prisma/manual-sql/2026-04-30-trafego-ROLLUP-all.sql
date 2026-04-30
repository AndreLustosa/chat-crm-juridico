-- ============================================================================
-- TRAFEGO — ROLLOUT COMPLETO (Sprint A+B/C/D/E/F/G + Codex fix)
-- ============================================================================
-- Agregador idempotente das 7 migrations pendentes do modulo de trafego.
-- Toda DDL usa IF NOT EXISTS / DO BEGIN..EXCEPTION duplicate_object — pode
-- ser executado multiplas vezes sem efeito colateral.
--
-- Ordem:
--   1. trafego-sprint-ab-mutate-oci          (9 tabelas + cols em Lead/TrafficCampaign)
--   2. trafego-budget-resource-name          (col TrafficCampaign.budget_resource_name)
--   3. trafego-sprint-c-ai-agent             (3 tabelas: IADecision/IAMemory/IAPolicy)
--   4. trafego-sprint-d-leadform-customer-match (cols TrafficSettings + 2 tabelas)
--   5. trafego-sprint-e-recommendations      (1 tabela)
--   6. trafego-sprint-f-pmax-reach           (3 tabelas: AssetGroup/Asset/Forecast)
--   7. trafego-sprint-g-memory-llm           (6 cols TrafficIAPolicy)
-- ============================================================================


-- ============================================================================
-- BLOCO: 2026-04-30-trafego-sprint-ab-mutate-oci.sql
-- ============================================================================
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

-- ============================================================================
-- BLOCO: 2026-04-30-trafego-budget-resource-name.sql
-- ============================================================================
-- Codex P1 fix — Resolver budget_resource_name automaticamente em update-budget.
--
-- Adiciona cache do campaign_budget resource_name em TrafficCampaign pra que o
-- mutate de budget consiga referenciar o budget existente sem round-trip extra
-- na Google Ads API. Sync popula via campaign.campaign_budget na GAQL.
--
-- Idempotente — IF NOT EXISTS protege re-execucao.

ALTER TABLE "TrafficCampaign"
  ADD COLUMN IF NOT EXISTS "budget_resource_name" TEXT;

-- ============================================================================
-- BLOCO: 2026-04-30-trafego-sprint-c-ai-agent.sql
-- ============================================================================
-- Sprint C — IA Otimizadora (Traffic AI Agent)
--
-- Adiciona 3 tabelas para a IA gestora de tráfego:
--   - TrafficIADecision: auditoria perpétua de toda decisão (executada,
--     sugerida, bloqueada por OAB, falhada). Nunca apagar.
--   - TrafficIAMemory:   estado/memória persistente entre loops (ex: contagens
--                        de re-avaliação pra escalation, debouncing).
--   - TrafficIAPolicy:   1 row por tenant — toggles ADVISOR/AUTONOMOUS,
--                        thresholds, schedules, canais de notificação.
--
-- Idempotente — IF NOT EXISTS protege re-execução.

-- ── 1. TrafficIADecision ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficIADecision" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "account_id"      TEXT NOT NULL,
  "loop_kind"       TEXT NOT NULL,
  "decision_kind"   TEXT NOT NULL,
  "resource_type"   TEXT,
  "resource_id"     TEXT,
  "resource_name"   TEXT,
  "inputs"          JSONB NOT NULL,
  "confidence"      DECIMAL(4,3) NOT NULL,
  "reasons"         JSONB NOT NULL,
  "action"          TEXT NOT NULL,
  "executed"        BOOLEAN NOT NULL DEFAULT FALSE,
  "mutate_log_id"   TEXT,
  "human_feedback"  TEXT,
  "feedback_at"     TIMESTAMP(3),
  "feedback_note"   TEXT,
  "summary"         TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "TrafficIADecision"
    ADD CONSTRAINT "TrafficIADecision_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficIADecision"
    ADD CONSTRAINT "TrafficIADecision_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "TrafficIADecision_tenant_kind_created_idx"
  ON "TrafficIADecision"("tenant_id", "decision_kind", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficIADecision_account_action_created_idx"
  ON "TrafficIADecision"("account_id", "action", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "TrafficIADecision_action_feedback_idx"
  ON "TrafficIADecision"("action", "human_feedback");
CREATE INDEX IF NOT EXISTS "TrafficIADecision_executed_created_idx"
  ON "TrafficIADecision"("executed", "created_at" DESC);

-- ── 2. TrafficIAMemory ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficIAMemory" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "value"       JSONB NOT NULL,
  "expires_at"  TIMESTAMP(3),
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "TrafficIAMemory"
    ADD CONSTRAINT "TrafficIAMemory_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficIAMemory_tenant_key_uniq"
  ON "TrafficIAMemory"("tenant_id", "key");
CREATE INDEX IF NOT EXISTS "TrafficIAMemory_expires_idx"
  ON "TrafficIAMemory"("expires_at");

-- ── 3. TrafficIAPolicy ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficIAPolicy" (
  "id"                                    TEXT NOT NULL PRIMARY KEY,
  "tenant_id"                             TEXT NOT NULL,
  "agent_enabled"                         BOOLEAN NOT NULL DEFAULT FALSE,
  "mode"                                  TEXT NOT NULL DEFAULT 'ADVISOR',
  "max_auto_actions_per_day"              INTEGER NOT NULL DEFAULT 10,
  "min_confidence_for_auto"               DECIMAL(4,3) NOT NULL DEFAULT 0.95,
  "auto_apply_negative_keywords"          BOOLEAN NOT NULL DEFAULT FALSE,
  "auto_apply_pause_disapproved"          BOOLEAN NOT NULL DEFAULT TRUE,
  "auto_apply_rsa_asset_recommendations"  BOOLEAN NOT NULL DEFAULT FALSE,
  "auto_apply_budget_changes"             BOOLEAN NOT NULL DEFAULT FALSE,
  "auto_apply_bidding_strategy_changes"   BOOLEAN NOT NULL DEFAULT FALSE,
  "max_budget_change_percent"             DECIMAL(4,3) NOT NULL DEFAULT 0.20,
  "max_budget_change_per_week"            INTEGER NOT NULL DEFAULT 1,
  "max_negatives_per_week"                INTEGER NOT NULL DEFAULT 20,
  "rollback_window_hours"                 INTEGER NOT NULL DEFAULT 24,
  "notify_admin_email"                    BOOLEAN NOT NULL DEFAULT TRUE,
  "notify_admin_whatsapp"                 BOOLEAN NOT NULL DEFAULT TRUE,
  "notify_admin_inapp"                    BOOLEAN NOT NULL DEFAULT TRUE,
  "escalation_hours"                      INTEGER NOT NULL DEFAULT 48,
  "daily_cron"                            TEXT NOT NULL DEFAULT '30 6 * * *',
  "weekly_cron"                           TEXT NOT NULL DEFAULT '0 9 * * 1',
  "monthly_cron"                          TEXT NOT NULL DEFAULT '0 9 1 * *',
  "hourly_enabled"                        BOOLEAN NOT NULL DEFAULT FALSE,
  "shadow_mode"                           BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"                            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                            TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficIAPolicy"
    ADD CONSTRAINT "TrafficIAPolicy_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficIAPolicy_tenant_id_uniq"
  ON "TrafficIAPolicy"("tenant_id");

-- ============================================================================
-- BLOCO: 2026-04-30-trafego-sprint-d-leadform-customer-match.sql
-- ============================================================================
-- Sprint D — Lead Form Asset webhook + Customer Match (audiences)
--
-- Adiciona:
--   1. 3 colunas em TrafficSettings (webhook_secret + auto_create + default_stage)
--   2. TrafficUserList (audiences sincronizadas com Google Ads)
--   3. TrafficUserListMember (members hashed PII pra Customer Match)
--
-- Idempotente.

-- ── 1. TrafficSettings: campos do Lead Form Asset ────────────────────────
ALTER TABLE "TrafficSettings"
  ADD COLUMN IF NOT EXISTS "lead_form_webhook_secret"    TEXT;
ALTER TABLE "TrafficSettings"
  ADD COLUMN IF NOT EXISTS "lead_form_auto_create_lead"  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "TrafficSettings"
  ADD COLUMN IF NOT EXISTS "lead_form_default_stage"     TEXT NOT NULL DEFAULT 'INTERESSADO';

-- ── 2. TrafficUserList ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficUserList" (
  "id"                       TEXT NOT NULL PRIMARY KEY,
  "tenant_id"                TEXT NOT NULL,
  "account_id"               TEXT NOT NULL,
  "google_user_list_id"      TEXT,
  "google_resource_name"     TEXT,
  "name"                     TEXT NOT NULL,
  "description"              TEXT,
  "kind"                     TEXT NOT NULL,
  "membership_lifespan_days" INTEGER NOT NULL DEFAULT 540,
  "status"                   TEXT NOT NULL DEFAULT 'DRAFT',
  "error_message"            TEXT,
  "google_size_reported"     INTEGER,
  "local_size"               INTEGER NOT NULL DEFAULT 0,
  "last_synced_at"           TIMESTAMP(3),
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficUserList"
    ADD CONSTRAINT "TrafficUserList_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficUserList"
    ADD CONSTRAINT "TrafficUserList_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficUserList_account_kind_uniq"
  ON "TrafficUserList"("account_id", "kind");
CREATE INDEX IF NOT EXISTS "TrafficUserList_tenant_status_idx"
  ON "TrafficUserList"("tenant_id", "status");

-- ── 3. TrafficUserListMember ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TrafficUserListMember" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "account_id"         TEXT NOT NULL,
  "user_list_id"       TEXT NOT NULL,
  "lead_id"            TEXT,
  "email_sha256"       TEXT,
  "phone_sha256"       TEXT,
  "first_name_sha256"  TEXT,
  "last_name_sha256"   TEXT,
  "op_pending"         TEXT,
  "synced_at"          TIMESTAMP(3),
  "error_message"      TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "TrafficUserListMember"
    ADD CONSTRAINT "TrafficUserListMember_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficUserListMember"
    ADD CONSTRAINT "TrafficUserListMember_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrafficUserListMember"
    ADD CONSTRAINT "TrafficUserListMember_user_list_id_fkey"
      FOREIGN KEY ("user_list_id") REFERENCES "TrafficUserList"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficUserListMember_list_email_phone_uniq"
  ON "TrafficUserListMember"("user_list_id", "email_sha256", "phone_sha256");
CREATE INDEX IF NOT EXISTS "TrafficUserListMember_account_op_idx"
  ON "TrafficUserListMember"("account_id", "op_pending");
CREATE INDEX IF NOT EXISTS "TrafficUserListMember_lead_idx"
  ON "TrafficUserListMember"("lead_id");

-- ============================================================================
-- BLOCO: 2026-04-30-trafego-sprint-e-recommendations.sql
-- ============================================================================
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

-- ============================================================================
-- BLOCO: 2026-04-30-trafego-sprint-f-pmax-reach.sql
-- ============================================================================
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

-- ============================================================================
-- BLOCO: 2026-04-30-trafego-sprint-g-memory-llm.sql
-- ============================================================================
-- Sprint G — Memória adaptativa + LLM model selector
--
-- Estende TrafficIAPolicy com:
--   - llm_provider / llm_summary_model / llm_classify_model
--   - ignored_cooldown_days / reverted_penalty_days / max_resuggestion_strikes
--
-- Idempotente.

ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "llm_provider"             TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "llm_summary_model"        TEXT NOT NULL DEFAULT 'claude-haiku-4-5';
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "llm_classify_model"       TEXT NOT NULL DEFAULT 'claude-haiku-4-5';
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "ignored_cooldown_days"    INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "reverted_penalty_days"    INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "TrafficIAPolicy"
  ADD COLUMN IF NOT EXISTS "max_resuggestion_strikes" INTEGER NOT NULL DEFAULT 3;
