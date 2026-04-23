-- ─────────────────────────────────────────────────────────────────────────────
-- Limpeza de Messages duplicadas com prefixo sintetico (sys_*)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Ate 2026-04-23, o dedup no webhook da Evolution (EvolutionService.
--   handleMessageUpsert) so procurava mensagens pendentes com prefixo
--   'out_*'. Quando um reminder (sys_reminder_*), followup (sys_followup_ia_*)
--   ou broadcast (sys_broadcast_*) era enviado e o webhook chegava com o
--   ID real do WhatsApp, o codigo nao achava a mensagem pendente e criava
--   um segundo registro no banco — aparecendo duplicada no chat.
--
--   Bug reportado pela Dra. Gianny: reminder de audiencia do Guilherme
--   Porto (23/04 11:20) apareceu duplicado no chat da conversa — dois
--   Message com texto identico, criados no mesmo segundo:
--     - sys_reminder_1776930606601     (ID sintetico interno)
--     - 3EB01DAFEDF16EA99D4970         (ID real do WhatsApp via webhook)
--
--   Fix em codigo: commit a97416b (covers 'sys_*' no filtro de dedup).
--   Esta migration faz a limpeza RETROATIVA das duplicatas ja existentes.
--
-- O que faz:
--   1. Encontra pares (A, B) de Messages na mesma conversa, direction=out,
--      mesmo texto, criadas em janela <2min.
--   2. Quando A tem external_message_id 'sys_*' e B tem ID real do
--      WhatsApp (nao 'sys_*' nem 'out_*'), a duplicata A eh removida.
--   3. Nao mexe em pares onde ambos sao sinteticos ou ambos reais — so
--      o padrao especifico do bug.
--
-- Seguranca:
--   - Dry-run primeiro via RAISE NOTICE (contagem por conversa).
--   - Transacional: rollback automatico se DELETE afetar > 100 linhas
--     (threshold pra pegar runaway sem bloquear limpeza legitima).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Diagnostico pre-cleanup
DO $$
DECLARE
  v_total INTEGER;
  v_convs INTEGER;
BEGIN
  WITH duplicated AS (
    SELECT m.id
    FROM "Message" m
    WHERE m.external_message_id LIKE 'sys\_%' ESCAPE '\'
      AND m.direction = 'out'
      AND EXISTS (
        SELECT 1 FROM "Message" m2
        WHERE m2.conversation_id = m.conversation_id
          AND m2.direction = 'out'
          AND m2.text = m.text
          AND m2.id <> m.id
          AND m2.external_message_id NOT LIKE 'sys\_%' ESCAPE '\'
          AND m2.external_message_id NOT LIKE 'out\_%' ESCAPE '\'
          AND ABS(EXTRACT(EPOCH FROM (m2.created_at - m.created_at))) < 120
      )
  )
  SELECT COUNT(*), COUNT(DISTINCT (SELECT conversation_id FROM "Message" WHERE id = d.id))
  INTO v_total, v_convs
  FROM duplicated d;

  RAISE NOTICE '--- Pre-cleanup ---';
  RAISE NOTICE 'Duplicatas sys_* com par real a remover: %', v_total;
  RAISE NOTICE 'Conversas afetadas: %', v_convs;

  IF v_total > 100 THEN
    RAISE EXCEPTION 'ABORTADO: % linhas excede threshold de seguranca (100). Revisar manualmente.', v_total;
  END IF;
END $$;

-- Remove as duplicatas sys_* quando existe um par real (ID do WhatsApp)
DELETE FROM "Message" m
WHERE m.external_message_id LIKE 'sys\_%' ESCAPE '\'
  AND m.direction = 'out'
  AND EXISTS (
    SELECT 1 FROM "Message" m2
    WHERE m2.conversation_id = m.conversation_id
      AND m2.direction = 'out'
      AND m2.text = m.text
      AND m2.id <> m.id
      AND m2.external_message_id NOT LIKE 'sys\_%' ESCAPE '\'
      AND m2.external_message_id NOT LIKE 'out\_%' ESCAPE '\'
      AND ABS(EXTRACT(EPOCH FROM (m2.created_at - m.created_at))) < 120
  );

-- Diagnostico pos-cleanup
DO $$
DECLARE v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM "Message" m
  WHERE m.external_message_id LIKE 'sys\_%' ESCAPE '\'
    AND m.direction = 'out'
    AND EXISTS (
      SELECT 1 FROM "Message" m2
      WHERE m2.conversation_id = m.conversation_id
        AND m2.direction = 'out'
        AND m2.text = m.text
        AND m2.id <> m.id
        AND m2.external_message_id NOT LIKE 'sys\_%' ESCAPE '\'
        AND m2.external_message_id NOT LIKE 'out\_%' ESCAPE '\'
        AND ABS(EXTRACT(EPOCH FROM (m2.created_at - m.created_at))) < 120
    );

  RAISE NOTICE '--- Pos-cleanup ---';
  RAISE NOTICE 'Duplicatas sys_* restantes: %', v_remaining;

  IF v_remaining > 0 THEN
    RAISE WARNING 'Ainda ha % duplicatas — pode ter caso edge nao coberto.', v_remaining;
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i <container> psql -U <user> -d <db> \
--     < 2026-04-23-dedupe-sys-messages.sql
-- ─────────────────────────────────────────────────────────────────────────────
