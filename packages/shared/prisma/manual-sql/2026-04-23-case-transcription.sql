-- ─────────────────────────────────────────────────────────────────────────────
-- CaseTranscription: tabela para transcrição de audiências (ASF/MP4 → texto)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Fluxo de transcrição de audiências: usuário faz upload de vídeo (ASF,
--   MP4, MKV, etc.) vinculado a um LegalCase; worker converte pra MP4 (player
--   web), extrai áudio, manda pro crm-whisper que roda WhisperX (large-v3 +
--   diarização pyannote). Salvamos texto corrido, segmentos com timestamps
--   e speaker labels.
--
-- Arquitetura pluggable: provider define qual backend (whisper-local, groq...)
-- fez a transcrição. Permite trocar sem perder histórico.
--
-- Rollback: DROP TABLE "CaseTranscription". Arquivos no S3 permanecem.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS "CaseTranscription" (
  "id"              TEXT PRIMARY KEY,
  "tenant_id"       TEXT,
  "legal_case_id"   TEXT NOT NULL,
  "uploaded_by_id"  TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "progress"        INTEGER NOT NULL DEFAULT 0,
  "error_message"   TEXT,
  "provider"        TEXT NOT NULL DEFAULT 'whisper-local',
  "model"           TEXT,
  "diarize"         BOOLEAN NOT NULL DEFAULT TRUE,
  -- Storage
  "source_s3_key"   TEXT NOT NULL,
  "source_mime"     TEXT NOT NULL,
  "source_size"     INTEGER NOT NULL,
  "video_s3_key"    TEXT,
  "audio_s3_key"    TEXT,
  -- Resultado
  "language"        TEXT,
  "duration_sec"    DOUBLE PRECISION,
  "text"            TEXT,
  "segments_json"   JSONB,
  "words_json"      JSONB,
  "speakers_json"   JSONB,
  -- Job tracking
  "external_job_id" TEXT,
  "started_at"      TIMESTAMP(3),
  "finished_at"     TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FKs
ALTER TABLE "CaseTranscription"
  DROP CONSTRAINT IF EXISTS "CaseTranscription_legal_case_id_fkey";
ALTER TABLE "CaseTranscription"
  ADD CONSTRAINT "CaseTranscription_legal_case_id_fkey"
  FOREIGN KEY ("legal_case_id") REFERENCES "LegalCase"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseTranscription"
  DROP CONSTRAINT IF EXISTS "CaseTranscription_uploaded_by_id_fkey";
ALTER TABLE "CaseTranscription"
  ADD CONSTRAINT "CaseTranscription_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "CaseTranscription"
  DROP CONSTRAINT IF EXISTS "CaseTranscription_tenant_id_fkey";
ALTER TABLE "CaseTranscription"
  ADD CONSTRAINT "CaseTranscription_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "CaseTranscription_legal_case_id_created_at_idx"
  ON "CaseTranscription"("legal_case_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "CaseTranscription_status_idx"
  ON "CaseTranscription"("status");
CREATE INDEX IF NOT EXISTS "CaseTranscription_tenant_id_idx"
  ON "CaseTranscription"("tenant_id");

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Quando rodar na VPS:
--   docker exec -i <postgres_container> psql -U crm_user -d lustosa < 2026-04-23-case-transcription.sql
--
-- Sanity check pos-migration:
--   \d "CaseTranscription"   # deve listar todas as colunas
--   SELECT COUNT(*) FROM "CaseTranscription";   # 0 (tabela nova)
-- ─────────────────────────────────────────────────────────────────────────────
