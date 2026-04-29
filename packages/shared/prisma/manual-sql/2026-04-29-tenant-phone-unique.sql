-- ─────────────────────────────────────────────────────────────────────────────
-- Bug 2026-04-29 — Lead.phone deixa de ser unique global e passa a ser
-- unique por (tenant_id, phone). Isso permite que dois escritorios distintos
-- tenham o mesmo telefone como lead sem se sobrescreverem.
--
-- Sintoma do bug: Cliente cadastrado primeiro no tenant LEXCON recebia
-- comunicado disparado no tenant LUSTOSAADVOGADOS via numero do LEXCON
-- (notificacao saiu pelo escritorio errado).
--
-- Esta migracao roda ANTES de `prisma db push` da nova schema.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O que faz:
--   (1) DIAGNOSTICO: lista linhas com (tenant_id, phone) duplicado.
--       Se aparecer alguma, o admin precisa decidir manualmente qual manter
--       antes de prosseguir (geralmente o is_client=true vence). NAO
--       merge automatico — risco alto de perder dados.
--   (2) DROP do index UNIQUE atual em (phone) — `Lead_phone_key`.
--   (3) DROP do index NAO-unique em (tenant_id, phone) — `Lead_tenant_id_phone_idx`.
--   (4) CREATE do UNIQUE (tenant_id, phone) — `Lead_tenant_id_phone_key`.
--   (5) CREATE de index NAO-unique em (phone) — `Lead_phone_idx`,
--       pra buscas cross-tenant continuarem rapidas (ex: portal-auth, dedup).
--
-- Seguranca:
--   - Transacional. Se houver duplicata bloqueando o (4), rollback total.
--   - Nao deleta dados. Apenas recria indices.
--   - Idempotente parcial: usa IF EXISTS / IF NOT EXISTS onde possivel.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── (1) Diagnostico de duplicatas ────────────────────────────────────────
DO $$
DECLARE
  v_dup_count INTEGER;
  v_orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count FROM (
    SELECT tenant_id, phone, COUNT(*) AS c
    FROM "Lead"
    WHERE tenant_id IS NOT NULL
    GROUP BY tenant_id, phone
    HAVING COUNT(*) > 1
  ) AS t;

  SELECT COUNT(*) INTO v_orphan_count
  FROM "Lead"
  WHERE tenant_id IS NULL;

  RAISE NOTICE '--- Diagnostico pre-migracao ---';
  RAISE NOTICE 'Duplicatas (tenant_id, phone) em leads com tenant: %', v_dup_count;
  RAISE NOTICE 'Leads orfaos (tenant_id IS NULL): %', v_orphan_count;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Ha % duplicatas de (tenant_id, phone). Resolver manualmente antes de aplicar a migracao. Query: SELECT tenant_id, phone, COUNT(*) FROM "Lead" GROUP BY tenant_id, phone HAVING COUNT(*) > 1;', v_dup_count;
  END IF;
END $$;

-- ─── (2) Drop unique antigo em (phone) ────────────────────────────────────
-- Nome do index gerado pelo Prisma a partir de `phone String @unique`.
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_phone_key";
DROP INDEX IF EXISTS "Lead_phone_key";

-- ─── (3) Drop index nao-unique em (tenant_id, phone) ──────────────────────
-- Nome do index gerado a partir de `@@index([tenant_id, phone])`.
DROP INDEX IF EXISTS "Lead_tenant_id_phone_idx";

-- ─── (4) Cria unique composto (tenant_id, phone) ──────────────────────────
-- Nome canonico que o Prisma gera pra `@@unique([tenant_id, phone])`.
-- PostgreSQL trata NULL como distinto em UNIQUE por padrao, entao
-- multiplos leads com tenant_id=NULL e mesmo phone permanecem permitidos
-- (matching com schema Prisma + comportamento existente em produçao).
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_tenant_id_phone_key" UNIQUE (tenant_id, phone);

-- ─── (5) Cria index nao-unique em (phone) ─────────────────────────────────
-- Cobre buscas cross-tenant (portal-auth.service.ts, leads-cleanup, etc).
CREATE INDEX IF NOT EXISTS "Lead_phone_idx" ON "Lead" (phone);

-- ─── Diagnostico pos-migracao ─────────────────────────────────────────────
DO $$
DECLARE
  v_unique_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_unique_count
  FROM pg_indexes
  WHERE tablename = 'Lead'
    AND indexname IN ('Lead_tenant_id_phone_key', 'Lead_phone_idx');

  RAISE NOTICE '--- Pos-migracao ---';
  RAISE NOTICE 'Indices novos presentes: % de 2 esperados', v_unique_count;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i <container> psql -U crm_user -d lustosa \
--     < 2026-04-29-tenant-phone-unique.sql
--
-- Em seguida, no host onde roda o app:
--   pnpm --filter @crm/shared db:push
--
-- (db:push apenas confirma que o schema bate. Se o SQL acima ja rodou,
-- o push deve ser noop pra essa parte.)
-- ─────────────────────────────────────────────────────────────────────────────
