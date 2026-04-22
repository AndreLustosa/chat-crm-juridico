-- ─────────────────────────────────────────────────────────────────────────────
-- Fix dos stages residuais: processo_ativo (minusculo) + ENCERRADO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Apos a unificacao de stages em 2026-04-21, sobraram 2 leads com valores
--   fora do enum atual do CRM:
--     - 1 lead com stage='processo_ativo' (minusculo, fora do padrao)
--     - 1 lead com stage='ENCERRADO' (alias antigo de FINALIZADO)
--
--   Ambos semanticamente representam "cliente com processo em andamento ou
--   encerrado" — destino correto e FINALIZADO (is_client ja deve estar true
--   se tem LegalCase ativo, mas garantimos no UPDATE).
--
-- O que faz:
--   1. Diagnostica os 2 leads afetados
--   2. Migra ambos para stage='FINALIZADO'
--   3. Preserva updated_at original
--   4. Se o lead tem LegalCase nao-arquivado, garante is_client=true
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Diagnostico antes
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '--- Leads residuais pre-correcao ---';
  FOR r IN
    SELECT id, name, phone, stage, is_client, became_client_at,
           (SELECT COUNT(*) FROM "LegalCase" lc WHERE lc.lead_id = l.id AND lc.archived = false) AS casos_ativos
    FROM "Lead" l
    WHERE stage IN ('processo_ativo', 'ENCERRADO')
  LOOP
    RAISE NOTICE 'Lead % (% | %) — stage=%, is_client=%, casos_ativos=%',
      r.id, r.name, r.phone, r.stage, r.is_client, r.casos_ativos;
  END LOOP;
END $$;

-- Migrar pra FINALIZADO
UPDATE "Lead"
SET stage = 'FINALIZADO'
WHERE stage IN ('processo_ativo', 'ENCERRADO');

-- Se alguma dessas migrations envolveu lead com caso ativo, garantir
-- is_client=true e became_client_at (caso migracao anterior nao tenha pego).
UPDATE "Lead" l
SET
  is_client = true,
  became_client_at = COALESCE(l.became_client_at, NOW())
WHERE l.is_client = false
  AND EXISTS (
    SELECT 1 FROM "LegalCase" lc
    WHERE lc.lead_id = l.id AND lc.archived = false
  );

-- Sanity check pos-correcao
DO $$
DECLARE
  v_residuais INTEGER;
  v_finalizado_total INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_residuais
  FROM "Lead"
  WHERE stage IN ('processo_ativo', 'ENCERRADO');

  SELECT COUNT(*) INTO v_finalizado_total
  FROM "Lead" WHERE stage = 'FINALIZADO';

  RAISE NOTICE '--- Pos-correcao ---';
  RAISE NOTICE 'Leads ainda com stage residual (esperado 0): %', v_residuais;
  RAISE NOTICE 'Total FINALIZADO: %', v_finalizado_total;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i 78395b49af22 psql -U crm_user -d lustosa \
--     < 2026-04-22-fix-residual-stages.sql
--
-- Sanity check final (distribuicao completa de stages):
--   SELECT stage, COUNT(*) FROM "Lead" GROUP BY stage ORDER BY 2 DESC;
-- ─────────────────────────────────────────────────────────────────────────────
