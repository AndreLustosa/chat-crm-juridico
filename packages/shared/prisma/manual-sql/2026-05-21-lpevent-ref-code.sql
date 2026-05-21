-- Enhanced Conversions for Leads — matching gclid → lead (2026-05-21):
--
-- O visitante chega na LP vindo de anuncio Google (?gclid=X). O LPTracker
-- ja grava o gclid no LpEvent. Mas o CTA "Falar com Advogado" abre o
-- WhatsApp direto (sem form), entao o gclid morria no navegador — nunca
-- chegava no Lead criado pelo webhook do WhatsApp.
--
-- Solucao: ref_code curto (AL-XXXXXX) deterministico do visitor_id,
-- embutido no texto do wa.me. A 1a mensagem do lead traz esse codigo;
-- o webhook busca o LpEvent por ref_code e copia o gclid pro Lead.
-- Com o gclid no Lead, onClientSigned dispara o upload offline pro
-- Google Ads (UploadClickConversions) — fechando o loop de atribuicao.

ALTER TABLE "LpEvent"
  ADD COLUMN IF NOT EXISTS "ref_code" TEXT;

-- Index pro lookup do webhook (ref_code + mais recente primeiro)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "LpEvent_ref_code_created_at_idx"
  ON "LpEvent" (ref_code, created_at);
