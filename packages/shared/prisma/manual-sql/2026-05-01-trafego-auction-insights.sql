-- Auction Insights do Google Ads por dia x campanha x dominio concorrente.
-- Observacao: os campos auction_insight_search_* existem no GAQL, mas podem
-- retornar erro de permissao quando o developer token nao tem acesso.

CREATE TABLE IF NOT EXISTS "TrafficAuctionInsightDaily" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "domain" TEXT NOT NULL,
  "impression_share" DECIMAL(65,30),
  "overlap_rate" DECIMAL(65,30),
  "position_above_rate" DECIMAL(65,30),
  "top_impression_rate" DECIMAL(65,30),
  "abs_top_impression_rate" DECIMAL(65,30),
  "outranking_share" DECIMAL(65,30),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrafficAuctionInsightDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficAuctionInsightDaily_campaign_id_date_domain_key"
  ON "TrafficAuctionInsightDaily"("campaign_id", "date", "domain");

CREATE INDEX IF NOT EXISTS "TrafficAuctionInsightDaily_tenant_id_date_idx"
  ON "TrafficAuctionInsightDaily"("tenant_id", "date");

CREATE INDEX IF NOT EXISTS "TrafficAuctionInsightDaily_account_id_date_idx"
  ON "TrafficAuctionInsightDaily"("account_id", "date");

CREATE INDEX IF NOT EXISTS "TrafficAuctionInsightDaily_campaign_id_date_idx"
  ON "TrafficAuctionInsightDaily"("campaign_id", "date");

CREATE INDEX IF NOT EXISTS "TrafficAuctionInsightDaily_domain_idx"
  ON "TrafficAuctionInsightDaily"("domain");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TrafficAuctionInsightDaily_tenant_id_fkey'
  ) THEN
    ALTER TABLE "TrafficAuctionInsightDaily"
      ADD CONSTRAINT "TrafficAuctionInsightDaily_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TrafficAuctionInsightDaily_account_id_fkey'
  ) THEN
    ALTER TABLE "TrafficAuctionInsightDaily"
      ADD CONSTRAINT "TrafficAuctionInsightDaily_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TrafficAuctionInsightDaily_campaign_id_fkey'
  ) THEN
    ALTER TABLE "TrafficAuctionInsightDaily"
      ADD CONSTRAINT "TrafficAuctionInsightDaily_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
