-- ─────────────────────────────────────────────────────────────────────────────
-- Sincronizacao: leads com LegalCase ativo devem ser is_client=true
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Ate o commit de hoje, a importacao via ESAJ (busca por OAB) criava
--   LegalCase sem atualizar Lead.is_client. Resultado: dezenas de "leads"
--   que na verdade sao clientes com processo ativo.
--
--   As outras vias (create direto, createDirect, DJEN, unarchive) ja
--   faziam isso corretamente — so o court-scraper tinha o bug.
--
-- O que faz:
--   Promove a cliente (is_client=true, stage=FINALIZADO) todo Lead que:
--     - Tem pelo menos 1 LegalCase nao-arquivado associado
--     - Atualmente esta com is_client=false
--
--   NAO toca em leads sem LegalCase (continuam como leads).
--   NAO toca em leads ja marcados is_client=true.
--   NAO toca em leads cujos unicos processos estao archived=true.
--
-- Campos atualizados (pra bater com o padrao dos services):
--   - is_client          = true
--   - became_client_at   = NOW() (se ja tinha, mantem o valor antigo via COALESCE)
--   - stage              = 'FINALIZADO'
--   - stage_entered_at   = NOW()
--   - loss_reason        = NULL (limpa motivo de perda antigo, se houver)
--
-- Preserva: updated_at, created_at, name, phone, tags, etc.
--
-- Rollback: nao ha. Os valores originais sao perdidos. Se precisar,
-- restaure backup antes de rodar.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Snapshot pre-migration (log informativo)
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM "Lead" l
  WHERE l.is_client = false
    AND EXISTS (
      SELECT 1 FROM "LegalCase" lc
      WHERE lc.lead_id = l.id
        AND lc.archived = false
    );
  RAISE NOTICE 'Leads com processo ativo que serao promovidos a cliente: %', v_count;
END $$;

-- Update principal
UPDATE "Lead" l
SET
  is_client = true,
  became_client_at = COALESCE(l.became_client_at, NOW()),
  stage = 'FINALIZADO',
  stage_entered_at = NOW(),
  loss_reason = NULL
WHERE l.is_client = false
  AND EXISTS (
    SELECT 1 FROM "LegalCase" lc
    WHERE lc.lead_id = l.id
      AND lc.archived = false
  );

-- Sanity check pos-migracao
DO $$
DECLARE
  v_clients INTEGER;
  v_leads INTEGER;
  v_orphan_clients INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_clients FROM "Lead" WHERE is_client = true;
  SELECT COUNT(*) INTO v_leads FROM "Lead" WHERE is_client = false;
  SELECT COUNT(*) INTO v_orphan_clients
  FROM "Lead" l
  WHERE l.is_client = true
    AND NOT EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.lead_id = l.id AND lc.archived = false);

  RAISE NOTICE '--- Pos-migracao ---';
  RAISE NOTICE '  Clientes totais:              %', v_clients;
  RAISE NOTICE '  Leads (is_client=false):      %', v_leads;
  RAISE NOTICE '  Clientes SEM processo ativo:  % (ok — marcados manualmente, contratos sem processo, etc)', v_orphan_clients;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Query util pra conferir os promovidos (rodar apos o COMMIT):
--
--   SELECT l.id, l.name, l.phone, l.stage, l.is_client, l.became_client_at,
--          COUNT(lc.id) as processos_ativos
--   FROM "Lead" l
--   JOIN "LegalCase" lc ON lc.lead_id = l.id AND lc.archived = false
--   WHERE l.is_client = true
--     AND l.became_client_at::date = CURRENT_DATE
--   GROUP BY l.id, l.name, l.phone, l.stage, l.is_client, l.became_client_at
--   ORDER BY l.became_client_at DESC;
-- ─────────────────────────────────────────────────────────────────────────────
