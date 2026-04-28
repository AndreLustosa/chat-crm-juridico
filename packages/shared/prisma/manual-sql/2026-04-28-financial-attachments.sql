-- Cria tabela FinancialTransactionAttachment — anexos de receitas/despesas.
-- Pre-requisito do "Pacote de comprovantes" (relatorio pra contadora).
--
-- Idempotente. O entrypoint do API roda `prisma db push` que ja cria a tabela
-- automaticamente; este SQL serve como referencia/backup pra producao.

CREATE TABLE IF NOT EXISTS "FinancialTransactionAttachment" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "transaction_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "uploaded_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialTransactionAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'FinancialTransactionAttachment_tenant_id_fkey') THEN
    ALTER TABLE "FinancialTransactionAttachment"
      ADD CONSTRAINT "FinancialTransactionAttachment_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'FinancialTransactionAttachment_transaction_id_fkey') THEN
    ALTER TABLE "FinancialTransactionAttachment"
      ADD CONSTRAINT "FinancialTransactionAttachment_transaction_id_fkey"
      FOREIGN KEY ("transaction_id") REFERENCES "FinancialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'FinancialTransactionAttachment_uploaded_by_id_fkey') THEN
    ALTER TABLE "FinancialTransactionAttachment"
      ADD CONSTRAINT "FinancialTransactionAttachment_uploaded_by_id_fkey"
      FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FinancialTransactionAttachment_transaction_id_idx" ON "FinancialTransactionAttachment"("transaction_id");
CREATE INDEX IF NOT EXISTS "FinancialTransactionAttachment_tenant_id_created_at_idx" ON "FinancialTransactionAttachment"("tenant_id", "created_at");
