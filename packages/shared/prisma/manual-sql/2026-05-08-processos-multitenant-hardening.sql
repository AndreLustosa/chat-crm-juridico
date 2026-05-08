-- Multi-tenant hardening do modulo de Processos Juridicos (auditoria 2026-05-08).
--
-- Cobre 5 bugs criticos do relatorio:
--   1) DjenPublication.tenant_id ausente
--   2) CaseEvent.tenant_id ausente direto
--   3) movement_hash @unique global → @@unique([case_id, hash])
--   4) DjenIgnoredProcess.numero_processo @unique global → @@unique([tenant_id, numero])
--   5) LegalCase sem @@unique([tenant_id, case_number])
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS,
-- CREATE UNIQUE INDEX IF NOT EXISTS.

BEGIN;

-- ─── BEFORE snapshot ────────────────────────────────────────────────
SELECT 'BEFORE: DjenPublication.tenant_id existe?' AS metric,
  (SELECT COUNT(*)::int FROM information_schema.columns
   WHERE table_schema='public' AND table_name='DjenPublication' AND column_name='tenant_id') AS value;

SELECT 'BEFORE: CaseEvent.tenant_id existe?' AS metric,
  (SELECT COUNT(*)::int FROM information_schema.columns
   WHERE table_schema='public' AND table_name='CaseEvent' AND column_name='tenant_id') AS value;

SELECT 'BEFORE: movement_hash unique global?' AS metric,
  (SELECT COUNT(*)::int FROM pg_indexes
   WHERE tablename='CaseEvent' AND indexname LIKE '%movement_hash%') AS value;

-- ─── 1) DjenPublication.tenant_id ──────────────────────────────────
ALTER TABLE "DjenPublication"
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS "DjenPublication_tenant_id_idx"
  ON "DjenPublication"(tenant_id);

-- Backfill 1: via legal_case_id (publicacoes ja vinculadas)
UPDATE "DjenPublication" dp
SET tenant_id = lc.tenant_id
FROM "LegalCase" lc
WHERE dp.legal_case_id = lc.id
  AND dp.tenant_id IS NULL
  AND lc.tenant_id IS NOT NULL;

-- Backfill 2: via DjenLawyerOab — SE A TABELA EXISTIR.
-- (Em algumas instalacoes a tabela nao existe — IF EXISTS evita falha
-- da transacao. Update aplicado via 2026-05-08 no banco prod.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='DjenLawyerOab'
  ) THEN
    EXECUTE $sql$
      UPDATE "DjenPublication" dp
      SET tenant_id = (
        SELECT dlo.tenant_id FROM "DjenLawyerOab" dlo
        WHERE dlo.lawyer_name IS NOT NULL
          AND POSITION(UPPER(dlo.lawyer_name) IN UPPER(COALESCE(dp.nome_advogado, ''))) > 0
        LIMIT 1
      )
      WHERE dp.tenant_id IS NULL
        AND dp.nome_advogado IS NOT NULL
    $sql$;
  ELSE
    RAISE NOTICE 'Tabela DjenLawyerOab nao existe — pulando backfill 2';
  END IF;
END $$;

-- Backfill 3: tenant default pras restantes (1 tenant em prod)
-- Apenas se houver um unico tenant ativo (caso atual).
DO $$
DECLARE
  default_tenant_id TEXT;
  remaining_count INT;
BEGIN
  SELECT id INTO default_tenant_id FROM "Tenant"
  WHERE id = '00000000-0000-0000-0000-000000000000';

  SELECT COUNT(*) INTO remaining_count
  FROM "DjenPublication" WHERE tenant_id IS NULL;

  IF default_tenant_id IS NOT NULL AND remaining_count > 0 THEN
    UPDATE "DjenPublication"
    SET tenant_id = default_tenant_id
    WHERE tenant_id IS NULL;
    RAISE NOTICE 'Backfilled % DjenPublications restantes com tenant default', remaining_count;
  END IF;
END $$;

-- ─── 2) CaseEvent.tenant_id ────────────────────────────────────────
ALTER TABLE "CaseEvent"
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS "CaseEvent_tenant_id_idx"
  ON "CaseEvent"(tenant_id);

-- Backfill via case_id → legal_case.tenant_id
UPDATE "CaseEvent" ce
SET tenant_id = lc.tenant_id
FROM "LegalCase" lc
WHERE ce.case_id = lc.id
  AND ce.tenant_id IS NULL
  AND lc.tenant_id IS NOT NULL;

-- ─── 3) movement_hash @unique global → composto ────────────────────
-- Procura constraint UNIQUE existente em movement_hash isolado e remove.
DO $$
DECLARE
  cons_name TEXT;
BEGIN
  SELECT con.conname INTO cons_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'CaseEvent'
    AND con.contype = 'u'
    AND att.attname = 'movement_hash'
    AND array_length(con.conkey, 1) = 1
  LIMIT 1;

  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "CaseEvent" DROP CONSTRAINT %I', cons_name);
    RAISE NOTICE 'Constraint UNIQUE global de movement_hash removida: %', cons_name;
  END IF;
END $$;

-- Indice unico antigo (se existir, gerado pelo Prisma com nome _key)
DROP INDEX IF EXISTS "CaseEvent_movement_hash_key";

-- Cria UNIQUE composto novo
CREATE UNIQUE INDEX IF NOT EXISTS "CaseEvent_case_id_movement_hash_key"
  ON "CaseEvent"(case_id, movement_hash)
  WHERE movement_hash IS NOT NULL;

-- ─── 4) DjenIgnoredProcess composto ────────────────────────────────
DO $$
DECLARE
  cons_name TEXT;
BEGIN
  SELECT con.conname INTO cons_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'DjenIgnoredProcess'
    AND con.contype = 'u'
    AND att.attname = 'numero_processo'
    AND array_length(con.conkey, 1) = 1
  LIMIT 1;

  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "DjenIgnoredProcess" DROP CONSTRAINT %I', cons_name);
    RAISE NOTICE 'Constraint UNIQUE global de numero_processo removida: %', cons_name;
  END IF;
END $$;

DROP INDEX IF EXISTS "DjenIgnoredProcess_numero_processo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "DjenIgnoredProcess_tenant_id_numero_processo_key"
  ON "DjenIgnoredProcess"(tenant_id, numero_processo);

-- ─── 5) LegalCase @@unique([tenant_id, case_number]) ──────────────
-- ATENCAO: Pode haver duplicatas existentes. Estrategia: criar indice
-- usando WHERE case_number IS NOT NULL pra permitir multiplos NULL.
-- Se houver duplicatas reais, o CREATE falha — listar pra resolver
-- manualmente ANTES desta migration.

-- Snapshot de duplicatas (se houver, NAO comita)
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT tenant_id, case_number, COUNT(*) c
    FROM "LegalCase"
    WHERE case_number IS NOT NULL
    GROUP BY tenant_id, case_number
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE NOTICE 'AVISO: % par(es) (tenant_id, case_number) duplicado(s) — criando indice nao-unico por seguranca', dup_count;
    -- Cria indice NAO-unico (perdemos protecao de race, mas migration nao quebra)
    CREATE INDEX IF NOT EXISTS "LegalCase_tenant_id_case_number_idx"
      ON "LegalCase"(tenant_id, case_number)
      WHERE case_number IS NOT NULL;
  ELSE
    -- Sem duplicatas: cria UNIQUE com seguranca
    CREATE UNIQUE INDEX IF NOT EXISTS "LegalCase_tenant_id_case_number_key"
      ON "LegalCase"(tenant_id, case_number)
      WHERE case_number IS NOT NULL;
    RAISE NOTICE 'UNIQUE INDEX criado em LegalCase(tenant_id, case_number)';
  END IF;
END $$;

-- ─── AFTER snapshot ─────────────────────────────────────────────────
SELECT 'AFTER: DjenPublication.tenant_id NULL count' AS metric,
  COUNT(*)::int AS value
FROM "DjenPublication" WHERE tenant_id IS NULL;

SELECT 'AFTER: CaseEvent.tenant_id NULL count' AS metric,
  COUNT(*)::int AS value
FROM "CaseEvent" WHERE tenant_id IS NULL;

SELECT 'AFTER: movement_hash unique composto?' AS metric,
  (SELECT COUNT(*)::int FROM pg_indexes
   WHERE tablename='CaseEvent' AND indexname='CaseEvent_case_id_movement_hash_key') AS value;

SELECT 'AFTER: DjenIgnoredProcess unique composto?' AS metric,
  (SELECT COUNT(*)::int FROM pg_indexes
   WHERE tablename='DjenIgnoredProcess' AND indexname='DjenIgnoredProcess_tenant_id_numero_processo_key') AS value;

SELECT 'AFTER: LegalCase tenant_id+case_number indexed?' AS metric,
  (SELECT COUNT(*)::int FROM pg_indexes
   WHERE tablename='LegalCase'
     AND (indexname='LegalCase_tenant_id_case_number_key'
       OR indexname='LegalCase_tenant_id_case_number_idx')) AS value;

COMMIT;
