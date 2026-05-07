-- Tabela CronConfig: controle global de crons (ativar/desativar via admin
-- + historico de execucao). Cada cron auto-registra na primeira execucao
-- via CronRunnerService.ensureExists.
--
-- Substitui o setup atual onde nada controlava overlap (besides 4 lugares
-- com LockService) e nao havia visibilidade de last_run.
--
-- Ordem de aplicacao em produção:
--   1) Roda este SQL (cria tabela)
--   2) prisma generate
--   3) Sobe codigo novo (todos os crons envolvidos em cronRunner.run)
--   4) Crons auto-populam CronConfig na primeira execucao apos deploy
--
-- Idempotente: IF NOT EXISTS em tabela e indice. Pode rodar varias vezes.

BEGIN;

CREATE TABLE IF NOT EXISTS "CronConfig" (
  "id"               TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "schedule"         TEXT,
  "enabled"          BOOLEAN NOT NULL DEFAULT true,
  "last_run_at"      TIMESTAMP(3),
  "last_status"      TEXT,
  "last_error"       TEXT,
  "last_duration_ms" INTEGER,
  "run_count"        INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CronConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CronConfig_name_key"
  ON "CronConfig" ("name");

CREATE INDEX IF NOT EXISTS "CronConfig_enabled_idx"
  ON "CronConfig" ("enabled");

COMMIT;
