-- Migration: DROP TABLE "AiMemory"
-- Data: 2026-04-20
-- Autor: Remocao total Nivel 3 - fase 2d-3
--
-- Contexto: AiMemory era o sistema antigo de memoria (case_state JSON verboso).
-- Substituido pelo sistema novo:
--   - LeadProfile (perfil consolidado em prosa pela IA)
--   - Memory (entries individuais tipadas com embeddings)
--
-- Dados migrados antes do DROP:
--   - 132 registros AiMemory consolidados em 132 LeadProfiles
--   - Ver MEMORY_SYSTEM.md secao 9.6
--
-- Executar MANUALMENTE na producao apos deploy do codigo novo:
--   psql "$DATABASE_URL" -f 2026-04-20-drop-aimemory.sql
--
-- IRREVERSIVEL — dados historicos do sistema antigo se perdem.
-- Backup: ver dump automatico da VPS antes de executar.

BEGIN;

-- Verifica quantos registros existem antes do drop (log para auditoria)
DO $$
DECLARE
  row_count INT;
BEGIN
  SELECT COUNT(*) INTO row_count FROM "AiMemory";
  RAISE NOTICE '[DROP AiMemory] Registros existentes antes do drop: %', row_count;
END $$;

-- Drop da tabela com cascade (nao ha foreign keys apontando pra ela alem da relacao Lead.memory,
-- que ja foi removida do schema.prisma). CASCADE protege caso algo esteja esquecido.
DROP TABLE IF EXISTS "AiMemory" CASCADE;

-- Confirma drop (deve retornar 0 linhas)
SELECT tablename FROM pg_tables WHERE tablename = 'AiMemory';

COMMIT;

-- Apos executar, validar:
--   \d "AiMemory"   -- deve retornar "Did not find any relation named..."
--   SELECT COUNT(*) FROM "LeadProfile";  -- deve continuar retornando 132+
