-- Fix BUG-D root cause (reportado pelo gestor de trafego em 2026-05-18):
-- Sync salvava enum INT do Google (MinuteOfHour.ZERO=2, FIFTEEN=3, THIRTY=4,
-- FORTY_FIVE=5) literal na coluna start_minute/end_minute do TrafficAdSchedule,
-- em vez de converter pra minuto literal (0/15/30/45).
--
-- Consequencia: traffic_get_schedule mostrava "07:02-17:02" porque lia o `2`
-- (enum value de ZERO) como minuto literal. Os schedules NO GOOGLE estavam
-- corretos (Google interpreta o enum corretamente), mas a leitura via CRM
-- estava errada.
--
-- Fix do codigo: trafego-sync-extended.service.ts agora converte enum value
-- → minuto literal antes de salvar. Esta migration corrige os schedules
-- ja salvos com valores errados.
--
-- Operacao eh IDEMPOTENTE: roda CASE WHEN — valores ja literais (0/15/30/45)
-- ficam intocados. So converte os enum values (2/3/4/5).

UPDATE "TrafficAdSchedule"
SET
  start_minute = CASE start_minute
    WHEN 2 THEN 0
    WHEN 3 THEN 15
    WHEN 4 THEN 30
    WHEN 5 THEN 45
    ELSE start_minute
  END,
  end_minute = CASE end_minute
    WHEN 2 THEN 0
    WHEN 3 THEN 15
    WHEN 4 THEN 30
    WHEN 5 THEN 45
    ELSE end_minute
  END,
  updated_at = NOW()
WHERE
  start_minute IN (2, 3, 4, 5)
  OR end_minute IN (2, 3, 4, 5);

-- Sanity check pos-migration: deve retornar 0 (nenhum schedule com enum int)
SELECT
  COUNT(*) AS schedules_with_wrong_enum_int
FROM "TrafficAdSchedule"
WHERE start_minute IN (2, 3, 4, 5) OR end_minute IN (2, 3, 4, 5);
