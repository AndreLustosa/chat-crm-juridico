-- ============================================================
-- Merge conversas duplicadas por lead_id + channel
-- Mantém a conversa mais antiga (que tem o histórico completo)
-- e move todas as mensagens das duplicatas para ela.
-- ============================================================
-- EXECUTAR EM TRANSAÇÃO — rodar com BEGIN; ... COMMIT;

BEGIN;

-- 1. Identificar leads com múltiplas conversas ABERTO no mesmo canal
-- (diagnóstico — rodar antes para ver a escala do problema)
SELECT
  l.phone,
  l.name,
  COUNT(*) AS total_convs,
  ARRAY_AGG(c.id ORDER BY c.last_message_at ASC) AS conv_ids
FROM "Conversation" c
JOIN "Lead" l ON l.id = c.lead_id
WHERE c.channel = 'whatsapp'
  AND c.status IN ('ABERTO', 'ADIADO')
GROUP BY c.lead_id, c.channel, l.phone, l.name
HAVING COUNT(*) > 1
ORDER BY total_convs DESC;

-- 2. Para cada grupo de duplicatas, mover mensagens para a conversa mais antiga
-- A CTE keeper pega a conversa mais antiga (primeiro elemento do array, que tem mais historico)
WITH duplicates AS (
  SELECT
    lead_id,
    channel,
    MIN(last_message_at) AS oldest_msg,
    (ARRAY_AGG(id ORDER BY last_message_at ASC))[1] AS keeper_id,
    ARRAY_REMOVE(ARRAY_AGG(id ORDER BY last_message_at ASC),
                 (ARRAY_AGG(id ORDER BY last_message_at ASC))[1]) AS victim_ids
  FROM "Conversation"
  WHERE channel = 'whatsapp'
    AND status IN ('ABERTO', 'ADIADO')
  GROUP BY lead_id, channel
  HAVING COUNT(*) > 1
)
-- 2a. Mover mensagens das vítimas para o keeper
UPDATE "Message" m
SET conversation_id = d.keeper_id
FROM duplicates d
WHERE m.conversation_id = ANY(d.victim_ids);

-- 3. Mover tasks das vítimas para o keeper
WITH duplicates AS (
  SELECT
    lead_id,
    channel,
    (ARRAY_AGG(id ORDER BY last_message_at ASC))[1] AS keeper_id,
    ARRAY_REMOVE(ARRAY_AGG(id ORDER BY last_message_at ASC),
                 (ARRAY_AGG(id ORDER BY last_message_at ASC))[1]) AS victim_ids
  FROM "Conversation"
  WHERE channel = 'whatsapp'
    AND status IN ('ABERTO', 'ADIADO')
  GROUP BY lead_id, channel
  HAVING COUNT(*) > 1
)
UPDATE "Task" t
SET conversation_id = d.keeper_id
FROM duplicates d
WHERE t.conversation_id = ANY(d.victim_ids);

-- 4. Mover notes das vítimas para o keeper
WITH duplicates AS (
  SELECT
    lead_id,
    channel,
    (ARRAY_AGG(id ORDER BY last_message_at ASC))[1] AS keeper_id,
    ARRAY_REMOVE(ARRAY_AGG(id ORDER BY last_message_at ASC),
                 (ARRAY_AGG(id ORDER BY last_message_at ASC))[1]) AS victim_ids
  FROM "Conversation"
  WHERE channel = 'whatsapp'
    AND status IN ('ABERTO', 'ADIADO')
  GROUP BY lead_id, channel
  HAVING COUNT(*) > 1
)
UPDATE "ConversationNote" n
SET conversation_id = d.keeper_id
FROM duplicates d
WHERE n.conversation_id = ANY(d.victim_ids);

-- 5. Copiar ai_notes da vítima mais recente para o keeper (se keeper não tem)
WITH duplicates AS (
  SELECT
    lead_id,
    channel,
    (ARRAY_AGG(id ORDER BY last_message_at ASC))[1] AS keeper_id,
    (ARRAY_AGG(id ORDER BY last_message_at DESC))[1] AS newest_id
  FROM "Conversation"
  WHERE channel = 'whatsapp'
    AND status IN ('ABERTO', 'ADIADO')
  GROUP BY lead_id, channel
  HAVING COUNT(*) > 1
)
UPDATE "Conversation" c
SET ai_notes = COALESCE(c.ai_notes, newest.ai_notes),
    next_step = COALESCE(c.next_step, newest.next_step),
    legal_area = COALESCE(c.legal_area, newest.legal_area),
    assigned_lawyer_id = COALESCE(c.assigned_lawyer_id, newest.assigned_lawyer_id),
    assigned_user_id = COALESCE(c.assigned_user_id, newest.assigned_user_id),
    instance_name = COALESCE(newest.instance_name, c.instance_name),
    inbox_id = COALESCE(c.inbox_id, newest.inbox_id),
    last_message_at = GREATEST(c.last_message_at, newest.last_message_at)
FROM duplicates d
JOIN "Conversation" newest ON newest.id = d.newest_id
WHERE c.id = d.keeper_id AND d.keeper_id != d.newest_id;

-- 6. Fechar (soft-delete) as conversas vítimas
WITH duplicates AS (
  SELECT
    lead_id,
    channel,
    (ARRAY_AGG(id ORDER BY last_message_at ASC))[1] AS keeper_id,
    ARRAY_REMOVE(ARRAY_AGG(id ORDER BY last_message_at ASC),
                 (ARRAY_AGG(id ORDER BY last_message_at ASC))[1]) AS victim_ids
  FROM "Conversation"
  WHERE channel = 'whatsapp'
    AND status IN ('ABERTO', 'ADIADO')
  GROUP BY lead_id, channel
  HAVING COUNT(*) > 1
)
UPDATE "Conversation" c
SET status = 'FECHADO'
FROM duplicates d
WHERE c.id = ANY(d.victim_ids);

-- 7. Verificação final: não deve retornar nenhuma linha
SELECT lead_id, channel, COUNT(*) AS cnt
FROM "Conversation"
WHERE channel = 'whatsapp'
  AND status IN ('ABERTO', 'ADIADO')
GROUP BY lead_id, channel
HAVING COUNT(*) > 1;

COMMIT;
