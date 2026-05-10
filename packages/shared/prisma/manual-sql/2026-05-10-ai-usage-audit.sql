-- Migration: adiciona AiUsage.user_id + tenant_id + meta_json + indices
--
-- Contexto (Peticoes PR1 #6 + #10):
-- Antes AiUsage so gravava (model, tokens, cost) com conversation_id e
-- skill_id. Sem user_id, tenant_id ou metadata estruturada — incidente
-- "peticao saiu com nome errado" sem responsavel rastreavel.
--
-- Tambem necessario pra cost cap funcionar: ai-cost-cap.util.ts agrega
-- cost_usd das ultimas 24h por (user_id, tenant_id) — sem indices, query
-- fica O(N) em tabela que cresce muito.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

BEGIN;

ALTER TABLE "AiUsage"
  ADD COLUMN IF NOT EXISTS "user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "meta_json" JSONB;

-- Indices pra cost cap performar (query agregada por user/tenant + janela)
CREATE INDEX IF NOT EXISTS "AiUsage_user_id_created_at_idx"
  ON "AiUsage" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "AiUsage_tenant_id_created_at_idx"
  ON "AiUsage" ("tenant_id", "created_at");

COMMIT;

-- Validacao pos-migration:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'AiUsage'
--   AND column_name IN ('user_id', 'tenant_id', 'meta_json');
-- Esperado: 3 linhas (TEXT, TEXT, JSONB) com is_nullable = YES.
