-- Reseed das skills default no banco apos auditoria 2026-05-08.
--
-- Contexto: usuario nao customizou skills via UI. Os textos no banco
-- estao com versoes antigas (girias "direitinho/certinho", SDR sem o
-- caso "lead se apresentou junto"). O codigo (apps/api/src/settings/
-- settings.service.ts) ja foi atualizado, mas o seed eh
-- create-if-missing — nao sobrescreve skills existentes (memoria
-- project_skills_seed_policy.md).
--
-- Estrategia: DELETE das 11 skills default. CASCADE remove SkillAsset
-- + SkillTool automaticamente (onDelete: Cascade no schema). Mensagens
-- vinculadas a essas skills tem onDelete: SetNull, entao nao quebram.
--
-- Apos o DELETE, na proxima chamada de getSkills() (qualquer msg que
-- chegar), o seed automatico recria as 11 skills com os textos NOVOS
-- (sem girias, com caso "lead se apresentou junto" no SDR).
--
-- Idempotente: se DELETE nao acha as skills (ja foram apagadas e
-- recriadas), nao faz nada. Pode rodar 2x sem efeito.
--
-- ATENCAO: se voce CUSTOMIZOU alguma skill via UI (mudou system_prompt
-- ou adicionou tools/assets manuais), ELES SERAO PERDIDOS. O usuario
-- confirmou em 2026-05-08 que NAO customizou nenhuma skill — entao eh
-- seguro.

BEGIN;

-- ─── 1) Snapshot BEFORE ──────────────────────────────────────────────
SELECT
  'BEFORE — total de skills no banco' AS metric,
  COUNT(*)::int AS value
FROM "PromptSkill";

SELECT
  name AS skill_name,
  CASE WHEN system_prompt ~* 'direitinho' THEN 'SIM' ELSE 'nao' END AS tem_direitinho,
  CASE WHEN system_prompt ~* 'certinho' THEN 'SIM' ELSE 'nao' END AS tem_certinho,
  CASE WHEN system_prompt LIKE '%JA SE APRESENTOU%' THEN 'SIM' ELSE 'nao' END AS tem_caso_novo
FROM "PromptSkill"
ORDER BY "order", name;

-- ─── 2) DELETE das 11 skills default ─────────────────────────────────
-- CASCADE remove SkillAsset + SkillTool automaticamente.
DELETE FROM "PromptSkill"
WHERE name IN (
  'SDR Jurídico — Sophia',
  'Especialista Trabalhista',
  'Especialista Consumidor',
  'Especialista Família',
  'Especialista Previdenciário',
  'Especialista Penal',
  'Especialista Civil',
  'Especialista Empresarial',
  'Especialista Imobiliário',
  'Especialista Geral',
  'Acompanhamento de Cliente'
);

-- ─── 3) Snapshot AFTER ───────────────────────────────────────────────
SELECT
  'AFTER — total de skills no banco (deve ser 0 ou apenas customizadas)' AS metric,
  COUNT(*)::int AS value
FROM "PromptSkill";

COMMIT;

-- ─── 4) Reseed automatico ────────────────────────────────────────────
-- Apos COMMIT, faca uma chamada qualquer pra IA (mande 1 msg de teste
-- pelo WhatsApp ou bate na rota GET /api/settings/skills no container
-- API). O metodo getSkills() detecta que nao ha skill default cadastrada
-- e recria as 11 com os textos novos.
--
-- Verificar reseed:
--   SELECT name, LEFT(system_prompt, 100) FROM "PromptSkill" ORDER BY "order";
--   (deve listar as 11 com textos atualizados sem direitinho/certinho)
--
-- Verificar caso "lead se apresentou":
--   SELECT name FROM "PromptSkill"
--   WHERE name = 'SDR Jurídico — Sophia'
--     AND system_prompt LIKE '%JA SE APRESENTOU%';
--   (deve retornar 1 linha)
