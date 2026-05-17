-- Sprint 1 do backlog do gestor de trafego (2026-05-17):
-- Adiciona campos default a TrafficSettings pra:
--   1. business_phone_e164 / business_name  → defaults pra Call Asset (criado
--      via tool MCP traffic_attach_call_asset; gestor pode override por chamada)
--   2. enhanced_conv_for_leads_upload_enabled → liga cron BullMQ que sobe
--      userIdentifiers (email/phone hashed SHA-256) de leads recentes via
--      UploadClickConversions pra Enhanced Conversions for Leads matching
--
-- Tudo nullable/default false — nao quebra TrafficSettings existentes.

ALTER TABLE "TrafficSettings"
  ADD COLUMN IF NOT EXISTS "business_phone_e164" TEXT,
  ADD COLUMN IF NOT EXISTS "business_name" TEXT,
  ADD COLUMN IF NOT EXISTS "enhanced_conv_for_leads_upload_enabled" BOOLEAN NOT NULL DEFAULT false;
