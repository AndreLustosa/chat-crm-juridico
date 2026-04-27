-- Anexos de Task (diligencias). Estagiario sobe arquivo na hora de
-- concluir uma diligencia (ex: comprovante de residencia que o cliente
-- mandou via WhatsApp).
--
-- Quando a Task tem legal_case_id, esses anexos aparecem TAMBEM na aba
-- Documentos do workspace via UNION na query — sem duplicar registros.
-- Quando Task nao tem legal_case_id, anexo fica visivel so na propria
-- diligencia (cobertura pra "comprar selo no cartorio" e similares).
--
-- folder eh sugerido automaticamente baseado no titulo da Task ("RG/CPF"
-- vira CLIENTE, "contrato" vira CONTRATOS, etc) com fallback OUTROS.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS "TaskAttachment" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "task_id" TEXT NOT NULL,
  "uploaded_by_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "s3_key" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "folder" TEXT NOT NULL DEFAULT 'OUTROS',
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- FK pra Task (cascade — apaga anexos ao deletar task)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TaskAttachment_task_id_fkey'
  ) THEN
    ALTER TABLE "TaskAttachment"
      ADD CONSTRAINT "TaskAttachment_task_id_fkey"
      FOREIGN KEY ("task_id") REFERENCES "Task"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- FK pra Tenant (cascade — apaga anexos ao deletar tenant)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TaskAttachment_tenant_id_fkey'
  ) THEN
    ALTER TABLE "TaskAttachment"
      ADD CONSTRAINT "TaskAttachment_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- FK pra User (sem cascade — preserva anexos se user for removido)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TaskAttachment_uploaded_by_id_fkey'
  ) THEN
    ALTER TABLE "TaskAttachment"
      ADD CONSTRAINT "TaskAttachment_uploaded_by_id_fkey"
      FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id")
      ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TaskAttachment_task_id_idx"
  ON "TaskAttachment"("task_id");

CREATE INDEX IF NOT EXISTS "TaskAttachment_tenant_id_idx"
  ON "TaskAttachment"("tenant_id");
