-- Feature 2026-05-12 (pedido Andre): vincula CalendarEvent a DjenPublication
--
-- Antes: quando o operador cria um prazo a partir da analise IA do DJEN,
-- o CalendarEvent so guarda title + description (texto plain). A analise
-- rica (orientacoes estrategicas, prazo legal, justificativa, riscos)
-- fica orfa em DjenPublication.lawyer_analysis e a tela "Advogado —
-- Preparacao" nao consegue mostrar pro advogado na hora de cumprir.
--
-- Agora: CalendarEvent.djen_publication_id (nullable FK). Frontend da tela
-- de preparacao pode carregar a analise original via novo endpoint
-- GET /calendar/events/:id?includeDjenAnalysis=1 (a implementar).

ALTER TABLE "CalendarEvent"
  ADD COLUMN IF NOT EXISTS "djen_publication_id" TEXT;

-- FK explicita (ON DELETE SET NULL — se publicacao for arquivada, evento mantem)
ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_djen_publication_id_fkey"
  FOREIGN KEY ("djen_publication_id")
  REFERENCES "DjenPublication"(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Index pra carregar todos eventos de uma publicacao + filtrar eventos
-- com analise DJEN na tela de preparacao
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CalendarEvent_djen_publication_id_idx"
  ON "CalendarEvent" (djen_publication_id)
  WHERE djen_publication_id IS NOT NULL;
