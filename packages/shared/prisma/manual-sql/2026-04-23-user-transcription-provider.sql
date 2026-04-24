-- ─────────────────────────────────────────────────────────────────────────────
-- User.transcription_provider — escolha de provider de transcrição por usuário
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Admin define qual motor de transcrição cada usuário usa:
--     - 'whisper-local' → container crm-whisper na VPS (lento, separa falantes)
--     - 'groq'          → Groq Cloud (~30s/h áudio, sem diarização)
--     - NULL            → usa default da env TRANSCRIPTION_PROVIDER
--
--   A escolha é feita em Configurações → Transcrição (UI admin).
--   Não aparece pro usuário comum — quando ele faz upload, o backend lê
--   user.transcription_provider e passa pro worker.
--
-- Rollback: ALTER TABLE "User" DROP COLUMN "transcription_provider";
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "transcription_provider" TEXT;

COMMIT;

-- Sanity:
--   docker exec lustosaadvogados_postgres psql -U crm_user -d lustosa \
--     -c '\d "User"' | grep transcription_provider
