-- ─────────────────────────────────────────────────────────────────────────────
-- Unificacao de stages redundantes -> QUALIFICANDO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Antes desta migration, o sistema tinha 3 nomes para o mesmo conceito de
--   "lead em triagem/qualificacao":
--     - NOVO       (default do schema + webhook WhatsApp)
--     - INICIAL    (UI/kanban + IA prompts)
--     - QUALIFICANDO (IA na pratica, auto-enroll de followup)
--
--   Tambem existem valores antigos importados: QUALIFICADO, EM_ATENDIMENTO,
--   CONTATADO que semanticamente sao o mesmo.
--
-- O que faz:
--   - Migra todos os leads com stage legado para 'QUALIFICANDO'.
--   - Preserva updated_at para nao bagunca a Fila de followup (que usa esse
--     campo para decidir cutoff de inatividade).
--   - Nao toca em FINALIZADO, PERDIDO, AGUARDANDO_*, REUNIAO_AGENDADA.
--
-- Como rodar (VPS, diretamente no Postgres):
--   docker exec -i postgres-lustosa psql -U lustosa -d lustosaadvogados < 2026-04-21-unify-stages.sql
-- ou no psql interativo, \i neste arquivo.
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
  FROM "Lead"
  WHERE stage IN ('NOVO', 'INICIAL', 'CONTATADO', 'QUALIFICADO', 'EM_ATENDIMENTO');
  RAISE NOTICE 'Leads a migrar para QUALIFICANDO: %', v_count;
END $$;

-- Update principal
-- Nao passar SET updated_at explicitamente: o Prisma tem @updatedAt no
-- campo, mas em SQL direto o Postgres NAO atualiza automaticamente.
-- Queremos preservar o updated_at original de qualquer forma.
UPDATE "Lead"
SET stage = 'QUALIFICANDO'
WHERE stage IN (
  'NOVO',
  'INICIAL',
  'CONTATADO',
  'QUALIFICADO',
  'EM_ATENDIMENTO'
);

-- Sanity check: listar stages distintos apos migracao
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '--- Distribuicao de stages apos migracao ---';
  FOR r IN
    SELECT stage, COUNT(*) as total
    FROM "Lead"
    GROUP BY stage
    ORDER BY total DESC
  LOOP
    RAISE NOTICE '  % : %', rpad(r.stage, 25), r.total;
  END LOOP;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Nota sobre o stage 'processo_ativo' (minusculo, 1 lead):
-- Este valor e fora do padrao e NAO esta sendo migrado aqui.
-- Provavelmente e um lead ja com processo em andamento = deveria ser
-- FINALIZADO ou is_client=true. Avalie manualmente:
--
--   SELECT id, name, phone, stage, is_client, created_at
--   FROM "Lead"
--   WHERE stage = 'processo_ativo';
--
-- Depois de decidir, rode manualmente:
--   UPDATE "Lead" SET stage = 'FINALIZADO', is_client = true
--   WHERE stage = 'processo_ativo';
-- ─────────────────────────────────────────────────────────────────────────────
