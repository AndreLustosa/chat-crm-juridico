-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: publicacoes DJEN existentes viram CaseEvent tipo MOVIMENTACAO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Ate o commit 3cd040f (2026-04-23), o sync DJEN (djen.service.ts) salvava
--   as publicacoes em "DjenPublication" mas NUNCA criava CaseEvent tipo
--   MOVIMENTACAO — entao publicacoes nao apareciam na timeline do processo.
--   So o scraper ESAJ criava MOVIMENTACOES.
--
--   Bug reportado: Alecio Diogo teve intimacao publicada no DJEN hoje e nao
--   aparece como movimentacao do processo.
--
--   O fix em codigo (commit 3cd040f) cria CaseEvent automaticamente pra
--   novas publicacoes. Esta migration faz o BACKFILL pras publicacoes
--   antigas ja salvas no banco.
--
-- O que faz:
--   1. Para cada DjenPublication com legal_case_id preenchido,
--      inserir CaseEvent tipo MOVIMENTACAO se ainda nao existe.
--   2. Dedup via movement_hash = sha256('djen:' + comunicacao_id) —
--      mesma formula usada no codigo, garante que re-runs sao idempotentes.
--   3. Pula publicacoes sem legal_case_id (nao associadas a processo).
--
-- Preservacao:
--   Usa ON CONFLICT (movement_hash) DO NOTHING — nao sobrescreve CaseEvents
--   existentes (caso algum ja tenha sido criado manualmente ou pelo codigo
--   novo apos deploy).
--
-- Requisito: extensao pgcrypto pra funcao digest().
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Garante pgcrypto disponivel (no-op se ja instalado)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Diagnostico pre-backfill
DO $$
DECLARE
  v_candidates INTEGER;
  v_cases INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT legal_case_id)
    INTO v_candidates, v_cases
  FROM "DjenPublication"
  WHERE legal_case_id IS NOT NULL;

  RAISE NOTICE '--- Pre-backfill ---';
  RAISE NOTICE 'Publicacoes DJEN vinculadas a LegalCase: %', v_candidates;
  RAISE NOTICE 'LegalCases distintos com publicacoes: %', v_cases;
END $$;

-- Backfill: INSERT com ON CONFLICT (idempotente)
INSERT INTO "CaseEvent" (
  id,
  case_id,
  type,
  title,
  description,
  source,
  event_date,
  movement_hash,
  source_raw,
  created_at
)
SELECT
  gen_random_uuid(),
  dp.legal_case_id,
  'MOVIMENTACAO',
  LEFT(
    COALESCE(
      NULLIF(TRIM(CONCAT_WS(' — ', dp.tipo_comunicacao, dp.assunto)), ''),
      'Publicação DJEN'
    ),
    200
  ) AS title,
  COALESCE(NULLIF(dp.conteudo, ''), NULLIF(dp.assunto, ''), NULLIF(dp.tipo_comunicacao, ''), 'Publicação DJEN') AS description,
  'DJEN',
  dp.data_disponibilizacao,
  encode(digest('djen:' || dp.comunicacao_id::text, 'sha256'), 'hex'),
  jsonb_build_object(
    'djen_publication_id', dp.id,
    'comunicacao_id', dp.comunicacao_id,
    'tipo', dp.tipo_comunicacao,
    'assunto', dp.assunto,
    'backfilled_at', now()::text
  ),
  dp.created_at
FROM "DjenPublication" dp
WHERE dp.legal_case_id IS NOT NULL
ON CONFLICT (movement_hash) DO NOTHING;

-- Diagnostico pos-backfill
DO $$
DECLARE
  v_created INTEGER;
  v_djen_total INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO v_created
  FROM "CaseEvent"
  WHERE source = 'DJEN' AND type = 'MOVIMENTACAO';

  SELECT COUNT(*)
    INTO v_djen_total
  FROM "DjenPublication"
  WHERE legal_case_id IS NOT NULL;

  RAISE NOTICE '--- Pos-backfill ---';
  RAISE NOTICE 'CaseEvents tipo MOVIMENTACAO com source=DJEN (total apos backfill): %', v_created;
  RAISE NOTICE 'DjenPublications vinculadas (esperado match quase 1:1): %', v_djen_total;

  IF v_created < v_djen_total THEN
    RAISE NOTICE 'Diferenca: % — pode ser por conteudo vazio ou conflito de hash com ESAJ.', v_djen_total - v_created;
  END IF;
END $$;

-- Verifica o Alecio especificamente
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '--- Eventos do Alecio (pos-backfill) ---';
  FOR r IN
    SELECT ce.event_date, ce.type, ce.source, LEFT(ce.title, 80) AS title
    FROM "CaseEvent" ce
    JOIN "LegalCase" lc ON lc.id = ce.case_id
    JOIN "Lead" l ON l.id = lc.lead_id
    WHERE l.name ILIKE '%alecio%'
    ORDER BY ce.event_date DESC
    LIMIT 10
  LOOP
    RAISE NOTICE '  % | % | % | %', r.event_date, r.source, r.type, r.title;
  END LOOP;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i <container_postgres_lustosa> psql -U crm_user -d lustosa \
--     < 2026-04-23-djen-to-case-events.sql
-- ─────────────────────────────────────────────────────────────────────────────
