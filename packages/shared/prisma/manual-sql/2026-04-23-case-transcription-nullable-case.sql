-- ─────────────────────────────────────────────────────────────────────────────
-- CaseTranscription.legal_case_id: NOT NULL -> NULL
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Transcrições avulsas criadas pelo menu Ferramentas não precisam estar
--   vinculadas a um processo. Torna legal_case_id nullable e troca CASCADE
--   por SET NULL para não apagar transcrições quando o processo é deletado
--   (virar "órfã" é melhor que sumir — o texto pode ser referência futura).
--
-- Também adiciona índice (uploaded_by_id, created_at) pra listagem por
-- usuário ficar rápida na página de Ferramentas (lista todas, incluindo
-- avulsas do próprio advogado).
--
-- Rollback: ALTER TABLE ... ALTER COLUMN ... SET NOT NULL (mas exige que
-- todas linhas tenham legal_case_id não-nulo — pode falhar se já houver
-- transcrição avulsa registrada).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Relaxa a constraint NOT NULL
ALTER TABLE "CaseTranscription"
  ALTER COLUMN "legal_case_id" DROP NOT NULL;

-- Troca CASCADE por SET NULL (preserva transcrição mesmo se o processo for deletado)
ALTER TABLE "CaseTranscription"
  DROP CONSTRAINT IF EXISTS "CaseTranscription_legal_case_id_fkey";
ALTER TABLE "CaseTranscription"
  ADD CONSTRAINT "CaseTranscription_legal_case_id_fkey"
  FOREIGN KEY ("legal_case_id") REFERENCES "LegalCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Novo índice pra listagem "minhas transcrições" na página de Ferramentas
CREATE INDEX IF NOT EXISTS "CaseTranscription_uploaded_by_id_created_at_idx"
  ON "CaseTranscription"("uploaded_by_id", "created_at" DESC);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker cp 2026-04-23-case-transcription-nullable-case.sql lustosaadvogados_postgres:/tmp/
--   docker exec -i lustosaadvogados_postgres psql -U crm_user -d lustosa \
--     -f /tmp/2026-04-23-case-transcription-nullable-case.sql
--
-- Sanity check:
--   \d "CaseTranscription"   # coluna legal_case_id deve aparecer sem NOT NULL
-- ─────────────────────────────────────────────────────────────────────────────
