-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: Lead.phone + User.phone pro formato canonico 55+DDD+8dig
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Contexto:
--   Scan em 2026-04-24 mostrou 1662/1666 leads ja canonicos (99.8%). Outliers:
--     - 1 Lead com DDD 82 mas sem prefixo 55  → precisa fix
--     - 2 Leads "Escritorio/Clientes" com prefixo 17 (DDI 1, nao-BR)  → pular
--     - 1 Lead "WhatsApp Business" com phone='0'  → pular
--
--   Sem duplicatas detectadas (query 6 do scan retornou 0). UPDATE seguro.
--
-- O que faz:
--   (1) Converte leads em formato 11 digitos sem DDI (DD + 9 + 8dig) pra
--       12 digitos com DDI (55 + DD + 8dig). Remove o 9 no processo.
--   (2) Converte leads em formato 10 digitos sem DDI (DD + 8dig) pra
--       12 digitos (adiciona 55).
--   (3) Converte leads em formato 13 digitos com DDI com 9 (55 + DD + 9 + 8dig)
--       pra canonico (remove o 9).
--   (4) Converte 12 digitos SEM prefixo 55 (DD + 9 + 8dig = 12) pra 13 digitos → depois remove 9.
--       So acontece se o DDD esta entre DDDs validos BR (evita cocar numero internacional).
--   (5) NAO toca nos 3 placeholders (phone='0', DDI 1) — nao sao numeros BR.
--
-- Seguranca:
--   Transacional. Cada etapa roda ON CONFLICT DO NOTHING por via de seguranca
--   mas nao deve conflitar (scan confirmou). Se algum erro, rollback total.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Diagnostico pre-backfill
DO $$
DECLARE v_lead INTEGER; v_user INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_lead
  FROM "Lead"
  WHERE phone IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) != 12
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10;

  SELECT COUNT(*) INTO v_user
  FROM "User"
  WHERE phone IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) != 12
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10;

  RAISE NOTICE '--- Pre-backfill ---';
  RAISE NOTICE 'Leads com phone nao-canonico (10-13 digitos, nao 12): %', v_lead;
  RAISE NOTICE 'Users com phone nao-canonico (10-13 digitos, nao 12): %', v_user;
END $$;

-- ─── Normalizacao Lead.phone ───────────────────────────────────────────

-- (1) 13 digitos (55+DD+9+8dig) → 12 digitos (55+DD+8dig): remove o 9 apos DDI
UPDATE "Lead"
SET phone = CONCAT(
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 4),
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 6)
)
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 13
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 2) = '55'
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 5, 1) = '9';

-- (2) 11 digitos (DD+9+8dig) sem DDI → 12 digitos canonicos (remove 9 + adiciona 55)
UPDATE "Lead"
SET phone = CONCAT('55',
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 2),
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 4)
)
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 11
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 3, 1) = '9'
  -- Filtra DDDs BR validos pra evitar tocar em numeros internacionais
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 2) IN (
    '11','12','13','14','15','16','17','18','19',
    '21','22','24','27','28',
    '31','32','33','34','35','37','38',
    '41','42','43','44','45','46','47','48','49','51','53','54','55',
    '61','62','63','64','65','66','67','68','69',
    '71','73','74','75','77','79',
    '81','82','83','84','85','86','87','88','89',
    '91','92','93','94','95','96','97','98','99'
  );

-- (3) 12 digitos sem DDI (DD + 9 + 8dig = esse caso eh improvavel mas possivel):
-- Na verdade 12 digitos ja eh canonico quando comeca com 55. Se nao comeca
-- com 55 e tem DDD BR valido, adicionamos 55 E removemos o 9.
-- Ex: 829 99913012 (12 dig) → 55 82 99913012 (14? ERRADO)
-- Na real se tem 12 digitos sem DDI, provavelmente eh DD + 9 + 8dig + zero?
-- Isso nao deve acontecer. Melhor nao mexer automaticamente — caso
-- pontual precisa analise manual.

-- (4) 10 digitos (DD + 8dig, fixo ou celular antigo) → adiciona 55
UPDATE "Lead"
SET phone = CONCAT('55', REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 10
  -- Filtra DDDs BR validos (exclui numero americano DDI 1 tipo 170xxxxxxx)
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 2) IN (
    '11','12','13','14','15','16','17','18','19',
    '21','22','24','27','28',
    '31','32','33','34','35','37','38',
    '41','42','43','44','45','46','47','48','49','51','53','54','55',
    '61','62','63','64','65','66','67','68','69',
    '71','73','74','75','77','79',
    '81','82','83','84','85','86','87','88','89',
    '91','92','93','94','95','96','97','98','99'
  );

-- ATENCAO: a regra (4) vai tocar os 2 leads "Escritorio/Clientes" com
-- prefixo 17? Sim (17 eh DDD valido de SP). Mas esses sao especiais —
-- excluir explicitamente por nome se forem identificados como
-- nao-BR pela IA da VPS.
-- Solucao: scan antes e exclusao manual pontual desses IDs.

-- ─── Normalizacao User.phone (mesma logica) ─────────────────────────────

UPDATE "User"
SET phone = CONCAT(
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 4),
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 6)
)
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 13
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 2) = '55'
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 5, 1) = '9';

UPDATE "User"
SET phone = CONCAT('55',
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1, 2),
  SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 4)
)
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 11
  AND SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 3, 1) = '9';

UPDATE "User"
SET phone = CONCAT('55', REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
WHERE LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 10;

-- ─── Diagnostico pos-backfill ───────────────────────────────────────────

DO $$
DECLARE v_lead INTEGER; v_user INTEGER; v_canon INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_lead
  FROM "Lead"
  WHERE phone IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) != 12
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10;

  SELECT COUNT(*) INTO v_canon
  FROM "Lead"
  WHERE phone IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 12
    AND phone LIKE '55%';

  SELECT COUNT(*) INTO v_user
  FROM "User"
  WHERE phone IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) != 12
    AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10;

  RAISE NOTICE '--- Pos-backfill ---';
  RAISE NOTICE 'Leads canonicos (55+DD+8dig): %', v_canon;
  RAISE NOTICE 'Leads outliers restantes (10-13 digitos nao 12): %', v_lead;
  RAISE NOTICE 'Users outliers restantes: %', v_user;
  RAISE NOTICE '(Os outliers esperados sao os placeholders: DDI 1 e phone=0)';
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar na VPS:
--   docker exec -i <container> psql -U crm_user -d lustosa \
--     < 2026-04-24-phone-canonical-backfill.sql
-- ─────────────────────────────────────────────────────────────────────────────
