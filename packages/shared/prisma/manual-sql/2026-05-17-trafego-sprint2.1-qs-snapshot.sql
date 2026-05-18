-- Sprint 2.1 (2026-05-17): snapshot diario de Quality Score por keyword.
-- Sem isso, traffic_get_quality_score_history so retorna o snapshot atual
-- (do TrafficKeyword.quality_info cacheado). Pra serie temporal precisa
-- de tabela proprio + cron diario que faz INSERT a cada execucao.
--
-- Cron `QualityScoreSnapshotCron` roda 03h Maceio e faz upsert por
-- (keyword_id, captured_at_date) — se cron rodar 2x no mesmo dia, sobrescreve.

CREATE TABLE IF NOT EXISTS "TrafficKeywordQualitySnapshot" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "keyword_id" TEXT NOT NULL,
  "quality_score" INTEGER NOT NULL,
  "expected_ctr" TEXT,
  "ad_relevance" TEXT,
  "landing_page_experience" TEXT,
  "captured_at" TIMESTAMP NOT NULL,
  "captured_at_date" DATE NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrafficKeywordQualitySnapshot_pkey" PRIMARY KEY ("id")
);

-- Unique pra dedupe diario (1 snapshot por keyword por dia)
CREATE UNIQUE INDEX IF NOT EXISTS "TrafficKeywordQualitySnapshot_keyword_date_uq"
  ON "TrafficKeywordQualitySnapshot"("keyword_id", "captured_at_date");

-- Indexes pra query de history
CREATE INDEX IF NOT EXISTS "TrafficKeywordQualitySnapshot_keyword_captured"
  ON "TrafficKeywordQualitySnapshot"("keyword_id", "captured_at" DESC);

CREATE INDEX IF NOT EXISTS "TrafficKeywordQualitySnapshot_tenant_captured"
  ON "TrafficKeywordQualitySnapshot"("tenant_id", "captured_at" DESC);

-- FKs (cascade delete pra limpar quando keyword/tenant some)
ALTER TABLE "TrafficKeywordQualitySnapshot"
  ADD CONSTRAINT "TrafficKeywordQualitySnapshot_keyword_fk"
  FOREIGN KEY ("keyword_id") REFERENCES "TrafficKeyword"("id") ON DELETE CASCADE;

ALTER TABLE "TrafficKeywordQualitySnapshot"
  ADD CONSTRAINT "TrafficKeywordQualitySnapshot_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE;

ALTER TABLE "TrafficKeywordQualitySnapshot"
  ADD CONSTRAINT "TrafficKeywordQualitySnapshot_account_fk"
  FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id") ON DELETE CASCADE;
