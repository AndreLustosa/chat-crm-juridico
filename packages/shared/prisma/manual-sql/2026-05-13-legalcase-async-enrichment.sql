-- Enriquecimento assincrono pos-protocolo (LegalCase):
--
-- Quando o advogado arrasta um card para a etapa PROTOCOLO na Triagem,
-- o sistema agora pede so o numero do processo + polo (autor/reu).
-- Os demais dados (vara, juiz, classe, valor, partes, movimentos) sao
-- buscados automaticamente no tribunal via court-scraper apos 24h
-- (delay porque o protocolo recem-feito demora ate o tribunal indexar).
--
-- Estados de enrichment_status:
--   - NULL: nao aplicavel (caso criado fora desse fluxo, ex: via DJEN)
--   - 'PENDING': aguardando a janela de 24h e/ou retry
--   - 'DONE':    enriquecido com sucesso e movido pro menu Processos
--   - 'FAILED':  esgotou retries (3x) ou tribunal nao suportado;
--                fica visivel na Triagem com badge para operador editar manual.

ALTER TABLE "LegalCase"
  ADD COLUMN IF NOT EXISTS "enrichment_status"        TEXT,
  ADD COLUMN IF NOT EXISTS "enrichment_scheduled_for" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "enriched_at"              TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "enrichment_attempts"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "enrichment_error"         TEXT;

-- Indice composto para o cron de enriquecimento — filtra rapido por
-- (status='PENDING' AND scheduled_for <= now()). CONCURRENTLY pra nao
-- bloquear writes durante o build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "LegalCase_enrichment_status_scheduled_idx"
  ON "LegalCase" (enrichment_status, enrichment_scheduled_for)
  WHERE enrichment_status IS NOT NULL;
