-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: CalendarEvent.assigned_user_id com lawyer_id do LegalCase vinculado
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Ate o commit atual, ao criar um prazo manualmente (CaseDeadline) ou alguns
--   fluxos automaticos, o CalendarEvent.assigned_user_id ficava NULL mesmo
--   quando o processo (LegalCase) tinha advogado atribuido. Resultado: prazos
--   apareciam na Triagem como "Sem responsavel".
--
--   Bug reportado 2026-04-24. Fix em codigo centraliza a heranca no
--   calendar.service.ts::create (fallback generico) + case-deadlines.service.ts
--   (setting explicito). Esse SQL limpa o legado.
--
-- O que faz:
--   UPDATE em CalendarEvent onde:
--     - assigned_user_id IS NULL
--     - legal_case_id IS NOT NULL (evita mexer em eventos sem processo)
--     - status nao eh CANCELADO/CONCLUIDO (evita alterar historico)
--
--   Seta assigned_user_id = LegalCase.lawyer_id.
--
-- Seguro: idempotente (WHERE IS NULL), transacional, reporta contagem.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Diagnostico pre-backfill
DO $$
DECLARE
  v_total INTEGER;
  v_prazos INTEGER;
  v_por_tipo RECORD;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM "CalendarEvent"
  WHERE assigned_user_id IS NULL
    AND legal_case_id IS NOT NULL
    AND status NOT IN ('CANCELADO', 'CONCLUIDO');

  SELECT COUNT(*) INTO v_prazos
  FROM "CalendarEvent"
  WHERE assigned_user_id IS NULL
    AND legal_case_id IS NOT NULL
    AND status NOT IN ('CANCELADO', 'CONCLUIDO')
    AND type = 'PRAZO';

  RAISE NOTICE '--- Pre-backfill ---';
  RAISE NOTICE 'CalendarEvents sem assigned_user_id (ativos + vinculados a processo): %', v_total;
  RAISE NOTICE '  Destes, tipo PRAZO: %', v_prazos;

  RAISE NOTICE 'Distribuicao por tipo:';
  FOR v_por_tipo IN
    SELECT type, COUNT(*) AS qtd
    FROM "CalendarEvent"
    WHERE assigned_user_id IS NULL
      AND legal_case_id IS NOT NULL
      AND status NOT IN ('CANCELADO', 'CONCLUIDO')
    GROUP BY type
    ORDER BY qtd DESC
  LOOP
    RAISE NOTICE '  %: %', RPAD(v_por_tipo.type, 20), v_por_tipo.qtd;
  END LOOP;
END $$;

-- Backfill: herda lawyer_id do LegalCase
UPDATE "CalendarEvent" ce
SET assigned_user_id = lc.lawyer_id
FROM "LegalCase" lc
WHERE ce.legal_case_id = lc.id
  AND ce.assigned_user_id IS NULL
  AND ce.status NOT IN ('CANCELADO', 'CONCLUIDO')
  AND lc.lawyer_id IS NOT NULL;

-- Diagnostico pos-backfill
DO $$
DECLARE
  v_atualizados INTEGER;
  v_restantes INTEGER;
BEGIN
  -- Conta os que agora tem assigned_user_id preenchido via backfill (todos
  -- CalendarEvents com legal_case_id que antes eram null)
  SELECT COUNT(*) INTO v_restantes
  FROM "CalendarEvent"
  WHERE assigned_user_id IS NULL
    AND legal_case_id IS NOT NULL
    AND status NOT IN ('CANCELADO', 'CONCLUIDO');

  RAISE NOTICE '--- Pos-backfill ---';
  RAISE NOTICE 'CalendarEvents ainda sem assigned_user_id (ativos + com processo): %', v_restantes;
  RAISE NOTICE '(Esperado: 0 — todos os processos tem lawyer_id NOT NULL)';

  IF v_restantes > 0 THEN
    RAISE WARNING 'Ha % eventos ainda sem assigned_user_id — revisar manualmente', v_restantes;
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i <container> psql -U crm_user -d lustosa \
--     < 2026-04-24-backfill-calendar-event-assigned-user.sql
-- ─────────────────────────────────────────────────────────────────────────────
