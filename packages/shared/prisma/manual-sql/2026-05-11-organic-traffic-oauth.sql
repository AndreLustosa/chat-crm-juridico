-- Adiciona OAuth2 ao modulo Trafego Organico / Google Search Console.
-- Mantem Service Account como fallback, mas permite conectar com uma conta
-- Google proprietaria da propriedade no Search Console.

ALTER TABLE "OrganicSearchConfig"
  ADD COLUMN IF NOT EXISTS "auth_method" TEXT NOT NULL DEFAULT 'SERVICE_ACCOUNT',
  ADD COLUMN IF NOT EXISTS "oauth_client_id" TEXT,
  ADD COLUMN IF NOT EXISTS "oauth_client_secret" TEXT,
  ADD COLUMN IF NOT EXISTS "oauth_redirect_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "oauth_refresh_token" TEXT,
  ADD COLUMN IF NOT EXISTS "oauth_user_email" TEXT,
  ADD COLUMN IF NOT EXISTS "oauth_connected_at" TIMESTAMP(3);

UPDATE "OrganicSearchConfig"
SET "auth_method" = CASE
  WHEN "oauth_refresh_token" IS NOT NULL THEN 'OAUTH'
  WHEN "service_account_b64" IS NOT NULL THEN 'SERVICE_ACCOUNT'
  ELSE "auth_method"
END;

CREATE INDEX IF NOT EXISTS "OrganicSearchConfig_auth_method_idx"
  ON "OrganicSearchConfig" ("auth_method");

CREATE INDEX IF NOT EXISTS "OrganicSearchConfig_oauth_user_email_idx"
  ON "OrganicSearchConfig" ("oauth_user_email");
