import { z } from 'zod';

export const datePresetSchema = z
  .enum(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'])
  .optional();

export const optionalDateRange = {
  date_from: z.string().optional().describe('Data inicial no formato YYYY-MM-DD'),
  date_to: z.string().optional().describe('Data final no formato YYYY-MM-DD'),
  date_preset: datePresetSchema.describe('Preset de periodo'),
};

/**
 * Identificador de campanha. Aceita AMBOS:
 *   - UUID interno do CRM (campo `id` retornado por traffic_list_campaigns)
 *   - google_campaign_id numerico (campo `google_campaign_id` retornado por traffic_list_campaigns)
 *
 * Backend (requireCampaign em apps/api/src/trafego/trafego.service.ts) faz
 * lookup por OR { id, google_campaign_id }. Atualizado em 2026-05-17 apos
 * BUG #2 (agente externo passava google_id e recebia 404 sem dica).
 */
export const campaignIdSchema = z
  .string()
  .describe(
    'UUID interno do CRM (campo `id` de traffic_list_campaigns) OU google_campaign_id numerico (campo `google_campaign_id`). Ambos sao aceitos.',
  );

export const matchTypeSchema = z
  .enum(['BROAD', 'PHRASE', 'EXACT'])
  .describe('Tipo de correspondencia da palavra-chave');

export const paginationSchema = {
  limit: z.number().int().positive().max(200).optional().describe('Maximo de itens retornados'),
  page: z.number().int().positive().optional().describe('Pagina, com base 1'),
};
