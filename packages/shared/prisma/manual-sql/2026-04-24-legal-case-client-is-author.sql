-- ─────────────────────────────────────────────────────────────────────────────
-- Adiciona coluna client_is_author ao LegalCase
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Antes: modal de Cadastro Direto tinha toggle "Escritorio representa:
--   Autor | Reu" mas o backend so salvava `opposing_party` (nome). Sem
--   persistir qual polo o cliente ocupa, a IA do chat recebia apenas nome
--   da parte contraria e podia gerar mensagens invertendo os polos
--   (ex: "seu processo contra X" quando era "X contra voce").
--
--   Bug reportado 2026-04-24.
--
-- Esta migration adiciona coluna client_is_author Boolean DEFAULT true.
-- Default true cobre o cenario mais comum (cliente autorando a acao).
-- Processos onde cliente era reu ficam com flag errada — o advogado deve
-- corrigir pontualmente via UI (workspace/edit) ou via SQL se tiver lista.
--
-- Geralmente o Prisma migrate do container crm-api faz isso no startup
-- (RUN_MIGRATIONS=true no compose). Este script eh defensivo pra rodar
-- manual se precisar.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Idempotente: so adiciona se nao existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'LegalCase' AND column_name = 'client_is_author'
  ) THEN
    ALTER TABLE "LegalCase"
      ADD COLUMN client_is_author BOOLEAN NOT NULL DEFAULT true;
    RAISE NOTICE 'Coluna client_is_author adicionada';
  ELSE
    RAISE NOTICE 'Coluna client_is_author ja existe — pulando';
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Como rodar (VPS):
--   docker exec -i <container_postgres_lustosa> psql -U crm_user -d lustosa \
--     < 2026-04-24-legal-case-client-is-author.sql
--
-- Ou esperar o proximo deploy da API (Prisma migrate roda automatico).
-- ─────────────────────────────────────────────────────────────────────────────
