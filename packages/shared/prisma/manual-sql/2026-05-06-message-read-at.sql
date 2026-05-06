-- Adiciona Message.read_at — fonte unica de verdade pra unread counts.
-- Antes era inferido de status NOT IN ('recebido','entregue'), fragil porque
-- varios paths nao atualizavam status corretamente (mark-read das msgs sem
-- external_message_id ficavam pra sempre como 'recebido' e contavam no badge).

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

-- Backfill: msgs ja com status 'lido' marca como lidas retroativamente
-- (now() pq nao temos timestamp historico — bom suficiente, so afeta o
-- proximo refetch dos contadores).
UPDATE "Message"
SET "read_at" = NOW()
WHERE "status" = 'lido'
  AND "read_at" IS NULL
  AND "direction" = 'in';

-- Mensagens outbound nao entram em unread counts mas marcamos read_at
-- pro indice (conversation_id, read_at) ficar denso e responder mais rapido.
UPDATE "Message"
SET "read_at" = "created_at"
WHERE "direction" = 'out'
  AND "read_at" IS NULL;

CREATE INDEX IF NOT EXISTS "Message_conversation_id_read_at_idx"
  ON "Message" ("conversation_id", "read_at");
