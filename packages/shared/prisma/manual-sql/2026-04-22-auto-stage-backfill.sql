-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill tracking_stage baseado em CalendarEvents futuros
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   A partir deste deploy, quando um CalendarEvent AUDIENCIA ou PERICIA
--   e criado pra um LegalCase futuro, o tracking_stage avanca
--   automaticamente pra INSTRUCAO ou PERICIA_AGENDADA respectivamente.
--
--   Mas processos JA cadastrados com eventos futuros ficam com
--   tracking_stage antigo (ex: CITACAO) mesmo tendo audiencia marcada
--   pra daqui uma semana. Esta migration corrige retroativamente.
--
-- O que faz:
--   1. Encontra LegalCases com CalendarEvent futuro tipo PERICIA e
--      tracking_stage antes de PERICIA_AGENDADA. Promove.
--   2. Encontra LegalCases com CalendarEvent futuro tipo AUDIENCIA e
--      tracking_stage antes de INSTRUCAO. Promove pra INSTRUCAO.
--   3. Nao mexe em casos arquivados, encerrados, ou em etapa posterior.
--   4. Nao regressa — so avanca.
--
-- Ordem canonica (de menor a maior prioridade):
--   DISTRIBUIDO, CITACAO, CONTESTACAO, REPLICA, PERICIA_AGENDADA,
--   INSTRUCAO, ALEGACOES_FINAIS, AGUARDANDO_SENTENCA, JULGAMENTO,
--   RECURSO, TRANSITADO, EXECUCAO, ENCERRADO
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- CTE com a ordem dos stages
WITH stage_order(stage, idx) AS (
  VALUES
    ('DISTRIBUIDO', 0),
    ('CITACAO', 1),
    ('CONTESTACAO', 2),
    ('REPLICA', 3),
    ('PERICIA_AGENDADA', 4),
    ('INSTRUCAO', 5),
    ('ALEGACOES_FINAIS', 6),
    ('AGUARDANDO_SENTENCA', 7),
    ('JULGAMENTO', 8),
    ('RECURSO', 9),
    ('TRANSITADO', 10),
    ('EXECUCAO', 11),
    ('ENCERRADO', 12)
),
-- Casos com audiencia futura que precisam avancar pra INSTRUCAO (idx 5)
audiencia_candidates AS (
  SELECT DISTINCT lc.id
  FROM "LegalCase" lc
  JOIN "CalendarEvent" ce ON ce.legal_case_id = lc.id
  LEFT JOIN stage_order so ON so.stage = lc.tracking_stage
  WHERE ce.type = 'AUDIENCIA'
    AND ce.start_at > NOW()
    AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
    AND lc.archived = false
    AND COALESCE(so.idx, 0) < 5
),
-- Casos com pericia futura que precisam avancar pra PERICIA_AGENDADA (idx 4)
pericia_candidates AS (
  SELECT DISTINCT lc.id
  FROM "LegalCase" lc
  JOIN "CalendarEvent" ce ON ce.legal_case_id = lc.id
  LEFT JOIN stage_order so ON so.stage = lc.tracking_stage
  WHERE ce.type = 'PERICIA'
    AND ce.start_at > NOW()
    AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
    AND lc.archived = false
    AND COALESCE(so.idx, 0) < 4
)
SELECT NULL; -- no-op antes dos UPDATEs

-- Diagnostico pre-migration
DO $$
DECLARE v_aud INTEGER; v_per INTEGER;
BEGIN
  SELECT COUNT(DISTINCT lc.id) INTO v_aud
  FROM "LegalCase" lc
  JOIN "CalendarEvent" ce ON ce.legal_case_id = lc.id
  WHERE ce.type = 'AUDIENCIA'
    AND ce.start_at > NOW()
    AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
    AND lc.archived = false
    AND lc.tracking_stage IN ('DISTRIBUIDO','CITACAO','CONTESTACAO','REPLICA','PERICIA_AGENDADA');

  SELECT COUNT(DISTINCT lc.id) INTO v_per
  FROM "LegalCase" lc
  JOIN "CalendarEvent" ce ON ce.legal_case_id = lc.id
  WHERE ce.type = 'PERICIA'
    AND ce.start_at > NOW()
    AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
    AND lc.archived = false
    AND lc.tracking_stage IN ('DISTRIBUIDO','CITACAO','CONTESTACAO','REPLICA');

  RAISE NOTICE '--- Pre-backfill ---';
  RAISE NOTICE 'Processos com audiencia futura a promover pra INSTRUCAO: %', v_aud;
  RAISE NOTICE 'Processos com pericia futura a promover pra PERICIA_AGENDADA: %', v_per;
END $$;

-- PERICIA primeiro (indice menor — se tem audiencia + pericia, audiencia prevalece depois)
UPDATE "LegalCase" lc
SET tracking_stage = 'PERICIA_AGENDADA',
    stage_changed_at = NOW()
FROM "CalendarEvent" ce
WHERE ce.legal_case_id = lc.id
  AND ce.type = 'PERICIA'
  AND ce.start_at > NOW()
  AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
  AND lc.archived = false
  AND lc.tracking_stage IN ('DISTRIBUIDO','CITACAO','CONTESTACAO','REPLICA');

-- AUDIENCIA depois (sobrepoe se houver ambos — audiencia esta apos pericia no kanban)
UPDATE "LegalCase" lc
SET tracking_stage = 'INSTRUCAO',
    stage_changed_at = NOW()
FROM "CalendarEvent" ce
WHERE ce.legal_case_id = lc.id
  AND ce.type = 'AUDIENCIA'
  AND ce.start_at > NOW()
  AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO', 'ADIADO')
  AND lc.archived = false
  AND lc.tracking_stage IN ('DISTRIBUIDO','CITACAO','CONTESTACAO','REPLICA','PERICIA_AGENDADA');

-- Diagnostico pos-migration
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '--- Pos-backfill (distribuicao) ---';
  FOR r IN
    SELECT tracking_stage, COUNT(*) AS total
    FROM "LegalCase"
    WHERE archived = false
    GROUP BY tracking_stage
    ORDER BY total DESC
  LOOP
    RAISE NOTICE '  % : %', rpad(r.tracking_stage, 22), r.total;
  END LOOP;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i <container> psql -U <user> -d <db> \
--     < 2026-04-22-auto-stage-backfill.sql
-- ─────────────────────────────────────────────────────────────────────────────
