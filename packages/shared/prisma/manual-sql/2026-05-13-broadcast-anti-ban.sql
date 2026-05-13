-- Anti-ban WhatsApp em broadcast (feature 2026-05-13):
--
-- Contexto: em 2026-04-28 a conta do escritorio foi banida 24h pelo
-- antispam da Meta apos disparo de 78 alvos a cada 10s sem variacao de
-- template, sem healthcheck e sem circuit breaker. Esta migration adiciona
-- campos pra que o worker possa AUTO-PAUSAR o broadcast quando detecta
-- problemas, em vez de continuar martelando o Evolution e queimar a conta.
--
-- Status novo no campo BroadcastJob.status: 'PAUSADO_AUTO'
--   - Setado pelo worker quando consecutive_failures >= 5 OU connectionState
--     do Evolution != 'open'
--   - Admin precisa clicar "Retomar" no UI pra mudar pra ENVIANDO de novo
--   - pause_reason mostra o motivo (mensagem legivel pra UI)

ALTER TABLE "BroadcastJob"
  ADD COLUMN IF NOT EXISTS "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paused_until"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pause_reason"         TEXT,
  ADD COLUMN IF NOT EXISTS "last_health_check_at" TIMESTAMP(3);

-- interval_ms default sobe pra 20s (era 10s — chave do incidente). Nao mexe
-- em broadcasts existentes (default so afeta INSERTs novos), so atualiza
-- o DEFAULT da coluna.
ALTER TABLE "BroadcastJob" ALTER COLUMN "interval_ms" SET DEFAULT 20000;
