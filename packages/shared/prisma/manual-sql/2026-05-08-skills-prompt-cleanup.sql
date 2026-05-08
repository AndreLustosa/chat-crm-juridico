-- Limpeza de tom dos prompts das skills no banco.
--
-- Contexto: auditoria 2026-05-08 (Jhennify + Andreia) revelou bugs de tom.
-- O codigo (apps/api/src/settings/settings.service.ts) ja foi atualizado,
-- mas as skills ja populadas no banco continuam com texto antigo porque
-- o seed eh create-if-missing (memoria project_skills_seed_policy.md).
--
-- Mudancas:
--   1. Substituicao de girias diminutivas em frases EXATAS dos exemplos
--      (direitinho, certinho) — apenas onde a frase inteira casa, pra
--      nao sobrescrever customizacoes que o usuario tenha feito.
--   2. Atualizacao do bloco "Primeira Mensagem" do SDR pra adicionar
--      situacao 2 (lead se apresentou em mensagem mas Lead.name vazio).
--
-- Idempotente: REPLACE so substitui se a string velha existir. Roda 2x
-- e o segundo run nao muda nada (frases velhas ja nao existem).

BEGIN;

-- ─── 1) Snapshot BEFORE ──────────────────────────────────────────────
SELECT
  'BEFORE — skills com girias diminutivas' AS metric,
  COUNT(*)::int AS value
FROM "PromptSkill"
WHERE system_prompt ~* '(direitinho|certinho|tudinho|tranquilinho|rapidinho)';

-- Lista quais skills tem cada giria pra log
SELECT
  name AS skill_name,
  CASE WHEN system_prompt ~* 'direitinho' THEN 1 ELSE 0 END AS has_direitinho,
  CASE WHEN system_prompt ~* 'certinho' THEN 1 ELSE 0 END AS has_certinho,
  CASE WHEN system_prompt ~* 'tudinho' THEN 1 ELSE 0 END AS has_tudinho
FROM "PromptSkill"
WHERE system_prompt ~* '(direitinho|certinho|tudinho|tranquilinho|rapidinho)'
ORDER BY name;

-- ─── 2) Substituicoes cirurgicas das frases dos exemplos ─────────────
-- Cada UPDATE substitui apenas a frase EXATA que estava no codigo.

-- 2.1) SDR Juridico: "Fica tranquilo que a gente vai analisar tudo direitinho."
UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  'Fica tranquilo que a gente vai analisar tudo direitinho.',
  'Entendo a preocupação. Vamos analisar com calma.'
)
WHERE system_prompt LIKE '%Fica tranquilo que a gente vai analisar tudo direitinho.%';

-- 2.2) Funil Trabalhista / Consumidor: "Vamos ver direitinho." (em "Inseguro →")
UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  'Inseguro → "Vamos ver direitinho."',
  'Inseguro → "Vamos ver com calma o que dá pra fazer."'
)
WHERE system_prompt LIKE '%Inseguro → "Vamos ver direitinho."%';

-- 2.3) Imobiliario: "Vamos olhar direitinho sua situação pra defender seus direitos."
UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  'Vamos olhar direitinho sua situação pra defender seus direitos.',
  'Vamos analisar sua situação pra entender as opções de defesa.'
)
WHERE system_prompt LIKE '%Vamos olhar direitinho sua situação pra defender seus direitos.%';

-- 2.4) Trabalhista exemplo BOM: "recebeu tudo certinho? Rescisão"
UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  'BOM: "E quando você saiu, recebeu tudo certinho? Rescisão, FGTS, essas coisas?"',
  'BOM: "E quando você saiu, recebeu tudo? Rescisão, FGTS, essas coisas?"'
)
WHERE system_prompt LIKE '%recebeu tudo certinho? Rescisão%';

-- 2.5) Trabalhista exemplo BOM: "A carteira tava assinada direitinho?"
UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  'BOM: "A carteira tava assinada direitinho?"',
  'BOM: "A carteira estava assinada?"'
)
WHERE system_prompt LIKE '%A carteira tava assinada direitinho?%';

-- 2.6) Trabalhista exemplo CORRETO: "E você recebe esse 1.600 todo mês certinho?"
UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  'CORRETO: "E você recebe esse 1.600 todo mês certinho?"',
  'CORRETO: "E esse 1.600 cai todo mês na conta?"'
)
WHERE system_prompt LIKE '%E você recebe esse 1.600 todo mês certinho?%';

-- ─── 3) Atualizacao do bloco "Primeira Mensagem" do SDR ───────────────
-- Adiciona a situacao 2 (lead se apresentou junto) entre a 1 e a antiga 2.
--
-- Estrategia: faz REPLACE da frase ancora antiga (paragrafo "NUNCA chamar
-- o lead por apelido vindo do WhatsApp...") prefixando com a nova situacao
-- 2 + a antiga situacao 2 renumerada como 3.
--
-- A condicao WHERE garante que so atualiza se o bloco antigo ainda casa
-- (idempotente — segunda passada nao muda).

UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  E'2) Lead.name esta PREENCHIDO no banco (veio do site/SDR/cadastro):\n   → Cumprimento cordial + use o nome direto, sem perguntar nem confirmar.',
  E'2) Lead.name esta VAZIO/null no banco MAS o lead JA SE APRESENTOU em uma mensagem (ex: "Me chamo Jhennify", "Sou a Maria", "Aqui é o João da Silva"):\n   → CAPTURE o nome no campo updates.name da resposta E cumprimente usando esse nome.\n   NAO peca o nome de novo (causa frustracao — bug 2026-05-08 Jhennify).\n   Exemplo (Lead.name=null, historico tem "me chamo Jhennify"):\n     "Olá, Jhennify! Sou a Sophia do escritório André Lustosa Advogados, me conta o que tá acontecendo."\n   IMPORTANTE: Capitalize o nome corretamente (primeira letra maiuscula). Se vier "joao" → use "João".\n\n3) Lead.name esta PREENCHIDO no banco (veio do site/SDR/cadastro):\n   → Cumprimento cordial + use o nome direto, sem perguntar nem confirmar.'
)
WHERE name = 'SDR Juridico'
  AND system_prompt LIKE '%2) Lead.name esta PREENCHIDO no banco (veio do site/SDR/cadastro):%'
  AND system_prompt NOT LIKE '%2) Lead.name esta VAZIO/null no banco MAS o lead JA SE APRESENTOU%';

-- 3.1) Tambem adiciona instrucao de ler historico antes de pedir nome
UPDATE "PromptSkill"
SET system_prompt = REPLACE(
  system_prompt,
  E'NUNCA chamar o lead por apelido vindo do WhatsApp ("Toninho", "Mae", emoji, etc).',
  E'ANTES de pedir o nome, LEIA O HISTORICO COMPLETO (turns user/assistant acima). Se o lead disse o nome em qualquer mensagem (mesmo em rajada de 3 mensagens rapidas), use ele. Pedir nome ja dito eh quebra de confianca.\n\nNUNCA chamar o lead por apelido vindo do WhatsApp ("Toninho", "Mae", emoji, etc).'
)
WHERE name = 'SDR Juridico'
  AND system_prompt LIKE '%NUNCA chamar o lead por apelido vindo do WhatsApp%'
  AND system_prompt NOT LIKE '%ANTES de pedir o nome, LEIA O HISTORICO COMPLETO%';

-- ─── 4) Snapshot AFTER ───────────────────────────────────────────────
SELECT
  'AFTER — skills com girias diminutivas (deve ser MENOR que BEFORE)' AS metric,
  COUNT(*)::int AS value
FROM "PromptSkill"
WHERE system_prompt ~* '(direitinho|certinho|tudinho|tranquilinho|rapidinho)';

SELECT
  'AFTER — SDR ja tem situacao 2 atualizada (deve ser 1)' AS metric,
  COUNT(*)::int AS value
FROM "PromptSkill"
WHERE name = 'SDR Juridico'
  AND system_prompt LIKE '%2) Lead.name esta VAZIO/null no banco MAS o lead JA SE APRESENTOU%';

COMMIT;
