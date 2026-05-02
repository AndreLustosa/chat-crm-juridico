import { z } from 'zod';

export const datePresetSchema = z
  .enum(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'])
  .optional();

export const optionalDateRange = {
  date_from: z.string().optional().describe('Data inicial no formato YYYY-MM-DD'),
  date_to: z.string().optional().describe('Data final no formato YYYY-MM-DD'),
  date_preset: datePresetSchema.describe('Preset de periodo'),
};

export const campaignIdSchema = z.string().describe('ID numerico da campanha no Google Ads');

export const matchTypeSchema = z
  .enum(['BROAD', 'PHRASE', 'EXACT'])
  .describe('Tipo de correspondencia da palavra-chave');

export const paginationSchema = {
  limit: z.number().int().positive().max(200).optional().describe('Maximo de itens retornados'),
  page: z.number().int().positive().optional().describe('Pagina, com base 1'),
};
