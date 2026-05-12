-- Skills PR2 #A9: cap em tentativas de transcricao
--
-- Antes: AudioRetranscribeCron re-enfileirava audio corrompido a cada 15min
-- indefinidamente, queimando cota Whisper/Groq em audios que nunca vao
-- transcrever (corrompidos, vazios, formato nao suportado).
--
-- Agora: 3 tentativas max. Apos isso transcribe_failed=true e cron pula.
-- transcribe_last_err armazena ultima razao da falha pra debug.

ALTER TABLE "Media"
  ADD COLUMN IF NOT EXISTS "transcribe_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "transcribe_failed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "transcribe_last_err" TEXT;
