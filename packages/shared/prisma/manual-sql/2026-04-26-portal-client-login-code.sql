-- Tabela ClientLoginCode — OTP passwordless do portal do cliente
-- Cliente digita telefone no /portal/login, recebe codigo de 4 digitos
-- via WhatsApp, valida e ganha JWT (audience=client). Idempotente.

CREATE TABLE IF NOT EXISTS "ClientLoginCode" (
  "id"          TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "lead_id"     TEXT          NOT NULL,
  "code_hash"   TEXT          NOT NULL,
  "expires_at"  TIMESTAMP(3)  NOT NULL,
  "attempts"    INTEGER       NOT NULL DEFAULT 0,
  "used_at"     TIMESTAMP(3),
  "ip_address"  TEXT,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientLoginCode_pkey" PRIMARY KEY ("id")
);

-- FK pra Lead (cascade delete: se lead some, codigos somem juntos)
DO $$ BEGIN
  ALTER TABLE "ClientLoginCode"
    ADD CONSTRAINT "ClientLoginCode_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "Lead"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ClientLoginCode_lead_id_expires_at_idx"
  ON "ClientLoginCode"("lead_id", "expires_at");
CREATE INDEX IF NOT EXISTS "ClientLoginCode_lead_id_used_at_idx"
  ON "ClientLoginCode"("lead_id", "used_at");
