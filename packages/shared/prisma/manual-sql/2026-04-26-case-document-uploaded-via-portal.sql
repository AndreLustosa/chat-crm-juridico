-- Marca documentos que vieram via portal do cliente (upload self-service).
-- Serve pra: (1) UI do CRM diferenciar "por [advogado]" de "enviado pelo
-- cliente"; (2) listar facilmente uploads do cliente por processo; (3)
-- relatorios do tipo "quantos documentos o cliente subiu este mes".
--
-- Default false → backfill seguro pra registros existentes (nenhum doc
-- antigo veio do portal).
--
-- Idempotente.

ALTER TABLE "CaseDocument"
  ADD COLUMN IF NOT EXISTS "uploaded_via_portal" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "CaseDocument_legal_case_id_uploaded_via_portal_idx"
  ON "CaseDocument"("legal_case_id", "uploaded_via_portal");
