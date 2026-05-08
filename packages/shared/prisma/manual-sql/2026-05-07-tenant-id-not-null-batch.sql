-- Hardening multi-tenant: tenant_id NOT NULL em 32 models legados.
-- Continua o trabalho de 2026-05-06-instance-tenant-id-not-null.sql, que
-- ja deixou Instance.tenant_id NOT NULL apos incidente 2026-04-29 (vide
-- commit f3ad69b). Esta migration generaliza pra todos os models legados.
--
-- Diagnostico pre-migration (2026-05-07, output da IA da VPS):
--   - 1 tenant em prod (id 00000000-0000-0000-0000-000000000000, "Escritorio Padrao")
--   - 31 das 32 tabelas: 0% de NULL
--   - 1 unica excecao: CalendarEvent com 9 NULL em 104 rows (8.7%)
--   - 0 orfaos (rows apontando pra tenant inexistente)
--
-- Por isso este script eh seguro: backfill cobre o unico caso real
-- (CalendarEvent) e o ALTER NOT NULL nas demais 31 tabelas eh idempotente
-- (todas ja tem tenant_id preenchido).
--
-- Contexto da auditoria:
--   AUDITORIA-2026-05-07.md > Prioridade 3 — `tenant_id` NOT NULL nos 49 models
--   (numero real: 32, vs 49 que o agente reportou — Trafego inteiro ja era NOT NULL).
--
-- Ordem de aplicacao em produção:
--   1) Roda este SQL (idempotente — IF NOT EXISTS e ALTER COLUMN repetido eh no-op)
--   2) prisma generate (regenera tipos com tenant_id obrigatorio)
--   3) Sobe codigo novo (apps/api, apps/worker, apps/web)
--   4) Codigo antigo NAO quebra: durante o intervalo entre 1 e 3, qualquer
--      INSERT/UPDATE que omitir tenant_id vai falhar com NOT NULL violation —
--      mas o codigo atual ja preenche tenant_id em todos os caminhos
--      (verificado por grep antes do commit).

BEGIN;

-- ─── 1) Snapshot antes ────────────────────────────────────────────────
SELECT 'BEFORE: CalendarEvent rows com tenant_id NULL' AS metric,
       COUNT(*)::int AS value
FROM "CalendarEvent" WHERE tenant_id IS NULL;

-- ─── 2) Backfill: unico caso real eh CalendarEvent (9 rows) ──────────
-- Single tenant em prod, entao usar o tenant default.
UPDATE "CalendarEvent"
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

-- ─── 3) ALTER COLUMN ... SET NOT NULL nas 32 tabelas ─────────────────
-- Idempotente: ALTER COLUMN ... SET NOT NULL eh no-op se ja for NOT NULL.

ALTER TABLE "User" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Lead" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Conversation" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "TaskAttachment" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Inbox" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "LegalCase" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "DjenIgnoredProcess" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "FollowupSequence" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "BroadcastJob" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "CalendarEvent" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "AppointmentType" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Holiday" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "CaseDocument" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "CaseTranscription" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "CaseDeadline" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "CasePetition" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "LegalTemplate" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "CaseHonorario" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "LeadHonorario" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "AiChat" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "AutomationRule" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "FinancialTransaction" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Report" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "FinancialTransactionAttachment" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "FinancialCategory" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "MonthlyGoal" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "PaymentGatewayCustomer" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "PaymentGatewayCharge" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "NotaFiscal" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "TaxRecord" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN tenant_id SET NOT NULL;

-- ─── 4) Snapshot depois ───────────────────────────────────────────────
SELECT 'AFTER: CalendarEvent rows com tenant_id NULL' AS metric,
       COUNT(*)::int AS value
FROM "CalendarEvent" WHERE tenant_id IS NULL;

SELECT 'AFTER: total de tabelas com tenant_id NOT NULL no information_schema' AS metric,
       COUNT(*)::int AS value
FROM information_schema.columns
WHERE column_name = 'tenant_id'
  AND is_nullable = 'NO'
  AND table_schema = 'public';

COMMIT;
