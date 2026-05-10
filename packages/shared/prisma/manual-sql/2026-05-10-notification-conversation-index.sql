-- Migration: index parcial pra acelerar markByConversation
--
-- Contexto (PR3 #13 da auditoria NotificationsService):
-- markByConversation roda toda vez que operador abre uma conversa
-- (zerar badge do sino em sincronia com sidebar). Prisma gera a
-- query como: WHERE data->>'conversationId' = 'X'.
--
-- Sem index dedicado, o PG faz Seq Scan na tabela Notification toda
-- pra cada chamada — cresce O(N) com o total de notificacoes do
-- escritorio (mesmo apos cleanup 90d, milhares de rows).
--
-- Solucao: btree index parcial em ((data->>'conversationId')) — o
-- operador `->>'X'` retorna text, btree casa perfeitamente. Index
-- limitado a notifs nao lidas de tipo incoming_message (caso de uso
-- exclusivo do markByConversation). Storage minimo + escrita rapida.
--
-- NAO usar GIN aqui — GIN serviria pra queries com `data @> '{...}'`
-- (jsonb contains) mas Prisma nao gera essa sintaxe pra path: equals.
--
-- Idempotente: IF NOT EXISTS.

BEGIN;

CREATE INDEX IF NOT EXISTS "Notification_data_conversationId_idx"
  ON "Notification" ((("data"->>'conversationId')))
  WHERE "notification_type" = 'incoming_message' AND "read_at" IS NULL;

COMMIT;

-- Validacao pos-migration:
-- EXPLAIN ANALYZE UPDATE "Notification"
-- SET read_at = NOW()
-- WHERE user_id = '<user-id>'
--   AND read_at IS NULL
--   AND notification_type = 'incoming_message'
--   AND data->>'conversationId' = '<conversation-id>';
-- Deve usar Index Scan em Notification_data_conversationId_idx.
