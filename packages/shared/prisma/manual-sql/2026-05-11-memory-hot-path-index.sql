-- Memoria PR3 #B3: indice composto pra hot path do sistema de memoria.
--
-- Queries afetadas:
--   - searchMemories (memory-retrieval.service.ts)
--   - listLead / listOrganization (memories.service.ts)
--   - dedupOrganizationMemories / dedupLeadMemories
--   - getOrganizationMemories / getRecentEpisodicMemories
--
-- Todas filtram por (tenant_id, scope, scope_id, status='active').
-- O indice existente (tenant_id, scope, scope_id) ja eh bom, mas obriga
-- Postgres a abrir as paginas do heap pra filtrar status no segundo passo.
-- Com status incluso, vira index-only scan = ~3-5x mais rapido em tabelas
-- grandes (10K+ memorias).
--
-- CONCURRENTLY: cria sem lock de gravacao (cron noturno continua rodando).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Memory_tenant_scope_scopeid_status_idx"
  ON "Memory" (tenant_id, scope, scope_id, status);
