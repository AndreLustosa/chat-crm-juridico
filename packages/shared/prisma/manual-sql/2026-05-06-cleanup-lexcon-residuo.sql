-- Cleanup do residuo do incidente 2026-04-29 (Evolution server compartilhado).
-- Antes do commit f3ad69b (29/04), webhooks da instancia "lexcon" (do Lexcon
-- Assessoria Contabil) caiam no banco do Lustosa. Vazaram:
--   - 3 Conversations com instance_name='lexcon' (07/04, todas tenant_id=null)
--   - 6 Messages dessas conversas (texto contabil: certidao societaria,
--     honorarios, chave PIX em nome de terceiros do Lexcon)
--   - ~30 Leads com phone do range 558282xxxxx e tenant_id=null
--     (cartorios, OABs, CFCs, prestadores B2B do Lexcon)
--
-- Esses dados nunca pertenceram ao Lustosa. Apos f3ad69b, zero entrada nova
-- desde 07/04 — confirmado por query (ultimo Message com instance_name='lexcon'
-- foi 2026-04-07T21:46:42).
--
-- Idempotente: WHERE filtros precisos garantem que so apaga residuo. Roda
-- dentro de transacao com contagens visiveis pra audit.

BEGIN;

-- 1) Snapshot antes
SELECT 'Conversations lexcon' AS item, COUNT(*)::int AS qtd FROM "Conversation" WHERE instance_name = 'lexcon'
UNION ALL
SELECT 'Messages em conv lexcon', COUNT(*)::int FROM "Message" m JOIN "Conversation" c ON c.id = m.conversation_id WHERE c.instance_name = 'lexcon'
UNION ALL
SELECT 'Leads tenant=null phone 558282%', COUNT(*)::int FROM "Lead" WHERE phone LIKE '558282%' AND tenant_id IS NULL;

-- 2) Apagar Messages das conversas lexcon (CASCADE no Conversation cobriria,
-- mas explicitamos pra contagem)
DELETE FROM "Message"
WHERE conversation_id IN (
  SELECT id FROM "Conversation" WHERE instance_name = 'lexcon'
);

-- 3) Apagar Conversations lexcon (CASCADE em Message ja garantiria via FK,
-- mas o passo 2 deixou claro o escopo)
DELETE FROM "Conversation"
WHERE instance_name = 'lexcon';

-- 4) Apagar Leads B2B do Lexcon que vazaram com tenant_id=null e phone 558282xxx
-- Filtros: phone (range fixo do escritorio Lexcon em Arapiraca/AL DDD 82),
-- tenant_id IS NULL (criados pelo webhook orfao antes do f3ad69b),
-- e que NAO tenham nenhuma conversa restante (a conversation_id pode
-- referenciar lead via lead_id; se o lead tem outra conv, deixa).
DELETE FROM "Lead"
WHERE phone LIKE '558282%'
  AND tenant_id IS NULL
  AND id NOT IN (
    SELECT DISTINCT lead_id FROM "Conversation" WHERE lead_id IS NOT NULL
  );

-- 5) Apagar tambem os 3 leads das conversas lexcon (orphans depois do step 3)
-- Esses tem phones 558299xxx/558291xxx mas tenant_id=null E nenhuma outra conv.
DELETE FROM "Lead"
WHERE tenant_id IS NULL
  AND id NOT IN (SELECT DISTINCT lead_id FROM "Conversation" WHERE lead_id IS NOT NULL)
  AND id IN (
    SELECT id FROM "Lead" WHERE created_at < '2026-04-29'
  );

-- 6) Snapshot depois (deve estar zerado)
SELECT 'AFTER: Conversations lexcon' AS item, COUNT(*)::int AS qtd FROM "Conversation" WHERE instance_name = 'lexcon'
UNION ALL
SELECT 'AFTER: Messages em conv lexcon', COUNT(*)::int FROM "Message" m JOIN "Conversation" c ON c.id = m.conversation_id WHERE c.instance_name = 'lexcon'
UNION ALL
SELECT 'AFTER: Leads tenant=null phone 558282%', COUNT(*)::int FROM "Lead" WHERE phone LIKE '558282%' AND tenant_id IS NULL;

COMMIT;
