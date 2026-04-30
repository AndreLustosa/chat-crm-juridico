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
