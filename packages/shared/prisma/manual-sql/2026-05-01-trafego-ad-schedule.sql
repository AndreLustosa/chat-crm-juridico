-- P3 (Sprint I) — Ad Schedule editor
-- Cache local de campaign_criterion type=AD_SCHEDULE pra editor de horários.
-- Idempotente via @@unique([campaign_id, google_criterion_id]).

CREATE TABLE IF NOT EXISTS "TrafficAdSchedule" (
  "id"                  String       NOT NULL,
  "tenant_id"           String       NOT NULL,
  "account_id"          String       NOT NULL,
  "campaign_id"         String       NOT NULL,
  "google_criterion_id" String       NOT NULL,
  "day_of_week"         String       NOT NULL,
  "start_hour"          INTEGER      NOT NULL,
  "start_minute"        INTEGER      NOT NULL,
  "end_hour"            INTEGER      NOT NULL,
  "end_minute"          INTEGER      NOT NULL,
  "bid_modifier"        DECIMAL(65, 30),
  "last_seen_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrafficAdSchedule_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficAdSchedule_tenant_id_fkey'
  ) THEN
    ALTER TABLE "TrafficAdSchedule"
      ADD CONSTRAINT "TrafficAdSchedule_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficAdSchedule_account_id_fkey'
  ) THEN
    ALTER TABLE "TrafficAdSchedule"
      ADD CONSTRAINT "TrafficAdSchedule_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "TrafficAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TrafficAdSchedule_campaign_id_fkey'
  ) THEN
    ALTER TABLE "TrafficAdSchedule"
      ADD CONSTRAINT "TrafficAdSchedule_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "TrafficCampaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TrafficAdSchedule_campaign_id_google_criterion_id_key"
  ON "TrafficAdSchedule" ("campaign_id", "google_criterion_id");

CREATE INDEX IF NOT EXISTS "TrafficAdSchedule_tenant_id_day_of_week_idx"
  ON "TrafficAdSchedule" ("tenant_id", "day_of_week");

CREATE INDEX IF NOT EXISTS "TrafficAdSchedule_campaign_id_idx"
  ON "TrafficAdSchedule" ("campaign_id");
