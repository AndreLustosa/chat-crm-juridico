-- Hardening: Instance.tenant_id NOT NULL.
--
-- Motivacao: Evolution server compartilhado entre escritorios (incidente
-- 2026-04-29 — vide commit f3ad69b). Antes desse fix, o webhook gravava
-- mensagens de instancia orfa (sem tenant_id). Hoje o webhook descarta
-- payload de instancia nao registrada, mas a coluna Instance.tenant_id
-- ainda eh nullable — entao crons (esaj-sync, djen, calendar-reminder,
-- payment-*) que filtram instancias REGISTRADAS aceitam Instance com
-- tenant_id=null e podem cruzar tenants em multi-tenant.
--
-- Esta migration:
--   1) Backfill: instances sem tenant_id viram do tenant padrao
--      (so 1 tenant existe hoje, query #D do investigate2.js confirmou)
--   2) ALTER COLUMN: tenant_id passa a NOT NULL
--   3) Index composto pra acelerar filtros (type, tenant_id)
--
-- Ordem de aplicacao em produção:
--   - Roda este SQL (exigir tenant_id no banco)
--   - Sobe codigo novo (filtro tenant_id em knownInstances dos 8 spots)
--   - O codigo anterior NAO quebra com NOT NULL pq todas as Instance ja
--     tem tenant_id (so ha 1 row em prod, com tenant default).

BEGIN;

-- 1) Snapshot antes
SELECT 'Instances total' AS item, COUNT(*)::int AS qtd FROM "Instance"
UNION ALL
SELECT 'Instances tenant_id NULL', COUNT(*)::int FROM "Instance" WHERE tenant_id IS NULL;

-- 2) Backfill: instances orfas viram do primeiro tenant.
-- Hoje so ha 1 tenant ('Escritório Padrão' id 00000000-0000-0000-0000-000000000000),
-- entao usamos LIMIT 1 ordenado por created_at NULLS LAST. Em ambientes com
-- multi-tenant futuro, esse backfill pode precisar de inspecao manual.
UPDATE "Instance"
SET tenant_id = (SELECT id FROM "Tenant" ORDER BY id LIMIT 1)
WHERE tenant_id IS NULL;

-- 3) Tornar NOT NULL
ALTER TABLE "Instance" ALTER COLUMN tenant_id SET NOT NULL;

-- 4) Index composto pra acelerar filtros do tipo
--    WHERE type = 'whatsapp' AND tenant_id = $1
CREATE INDEX IF NOT EXISTS "Instance_type_tenant_id_idx"
  ON "Instance" (type, tenant_id);

-- 5) Snapshot depois
SELECT 'AFTER: Instances tenant_id NULL' AS item, COUNT(*)::int AS qtd
  FROM "Instance" WHERE tenant_id IS NULL;

COMMIT;
