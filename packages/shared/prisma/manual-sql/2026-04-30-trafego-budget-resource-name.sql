-- Codex P1 fix — Resolver budget_resource_name automaticamente em update-budget.
--
-- Adiciona cache do campaign_budget resource_name em TrafficCampaign pra que o
-- mutate de budget consiga referenciar o budget existente sem round-trip extra
-- na Google Ads API. Sync popula via campaign.campaign_budget na GAQL.
--
-- Idempotente — IF NOT EXISTS protege re-execucao.

ALTER TABLE "TrafficCampaign"
  ADD COLUMN IF NOT EXISTS "budget_resource_name" TEXT;
