-- ============================================================================
-- Migration manual — 2026-04-18 — Sistema de memoria inteligente (Memory + LeadProfile)
-- ============================================================================
-- Ordem de aplicacao:
--  1) pnpm --filter @crm/shared db:push   (cria tabelas Memory e LeadProfile)
--  2) psql "$DATABASE_URL" -f 2026-04-18-memory-system.sql   (pgvector + indices)
-- ----------------------------------------------------------------------------
-- IMPORTANTE: todas as colunas sao OPCIONAIS (nullable ou com @default) —
-- migration e segura e idempotente.
-- ============================================================================

-- 1) Habilitar extensao pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Adicionar coluna embedding na tabela Memory (1536 dim = text-embedding-3-small)
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3) Indice HNSW para busca vetorial (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_memory_embedding
  ON "Memory" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- 4) Indice parcial para memorias organizacionais ativas (scope='organization')
CREATE INDEX IF NOT EXISTS idx_memory_org_active
  ON "Memory" (tenant_id, subcategory)
  WHERE scope = 'organization' AND status = 'active';

-- 5) Indice parcial para memorias de lead ativas
CREATE INDEX IF NOT EXISTS idx_memory_lead_active
  ON "Memory" (tenant_id, scope_id, created_at DESC)
  WHERE scope = 'lead' AND status = 'active';

-- 6) Tabela de log de acesso (auditoria LGPD / debug)
-- NOTA: Memory.id, User.id etc. sao TEXT no schema Prisma (uuid como string),
-- nao UUID nativo — por isso a FK usa TEXT.
CREATE TABLE IF NOT EXISTS memory_access_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id     TEXT        REFERENCES "Memory"(id) ON DELETE CASCADE,
  accessed_by   TEXT,
  access_type   VARCHAR(20) NOT NULL,  -- 'read' | 'inject' | 'update' | 'delete'
  context       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory
  ON memory_access_log (memory_id, created_at DESC);

-- 7) GlobalSettings padrao do sistema de memoria
INSERT INTO "GlobalSetting" ("key", "value", "updated_at") VALUES
  ('MEMORY_BATCH_ENABLED',    'true',                NOW()),
  ('MEMORY_BATCH_HOUR',       '00:00',               NOW()),
  ('MEMORY_EMBEDDING_MODEL',  'text-embedding-3-small', NOW()),
  ('MEMORY_EXTRACTION_MODEL', 'gpt-4.1',             NOW())
ON CONFLICT ("key") DO NOTHING;
