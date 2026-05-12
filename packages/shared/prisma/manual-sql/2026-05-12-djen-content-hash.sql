-- DJEN duplicado fix:
--
-- DJEN gera comunicacao_id SEPARADOS quando ha multiplos destinatarios na
-- mesma intimacao (ex: AUTOR + REU recebem 2 publicacoes do mesmo despacho).
-- Antes: a deduplicacao so checava comunicacao_id (unique no DJEN).
-- Agora: content_hash = SHA256 do conteudo NORMALIZADO permite detectar
-- duplicatas via (tenant_id, numero_processo, data_disponibilizacao, content_hash).
--
-- Publicacoes duplicadas detectadas ficam com archived=true + duplicate_of_id
-- apontando pra original, pra rastreabilidade.

ALTER TABLE "DjenPublication"
  ADD COLUMN IF NOT EXISTS "content_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicate_of_id" TEXT;

-- Indice composto pra busca rapida de duplicata no sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "DjenPublication_tenant_proc_data_hash_idx"
  ON "DjenPublication" (tenant_id, numero_processo, data_disponibilizacao, content_hash);
