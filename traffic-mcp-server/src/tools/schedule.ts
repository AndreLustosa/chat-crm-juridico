import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { enums } from 'google-ads-api';
import { googleAdsService } from '../services/google-ads.js';
import { campaignIdSchema } from '../schemas/index.js';
import { fail, formatError, markdownTable, ok } from '../utils/format.js';

export function registerScheduleTools(server: McpServer) {
  server.registerTool(
    'traffic_get_schedule',
    {
      description: 'Retorna a configuracao de horario de veiculacao de uma campanha.',
      inputSchema: { campaign_id: campaignIdSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ campaign_id }) => {
      try {
        const data = await getSchedule(campaign_id);
        return ok(
          data,
          markdownTable(
            ['Criterion ID', 'Dia', 'Inicio', 'Fim', 'Modificador'],
            data.map((s) => [s.criterion_id, s.day_of_week, `${s.start_hour}:00`, `${s.end_hour}:00`, s.bid_modifier ?? '']),
          ),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_update_schedule',
    {
      description: 'Atualiza a programacao de horarios de uma campanha substituindo a agenda atual.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        schedule: z.array(z.object({
          day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
          start_hour: z.number().int().min(0).max(23),
          end_hour: z.number().int().min(1).max(24),
          bid_modifier: z.number().positive().optional(),
        })).min(1).max(42),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id, schedule }) => {
      try {
        const existing = await getSchedule(campaign_id);
        if (existing.length > 0) {
          await googleAdsService.mutate(
            'campaign_criterion',
            'remove',
            existing.map((s) => googleAdsService.campaignCriterionResource(campaign_id, s.criterion_id)),
            { tool: 'traffic_update_schedule_remove_existing', campaign_id },
          );
        }
        const operations = schedule.map((s) => ({
          campaign: googleAdsService.campaignResource(campaign_id),
          ad_schedule: {
            day_of_week: dayEnum(s.day),
            start_hour: s.start_hour,
            start_minute: enums.MinuteOfHour.ZERO,
            end_hour: s.end_hour,
            end_minute: enums.MinuteOfHour.ZERO,
          },
          bid_modifier: s.bid_modifier,
        }));
        const result = await googleAdsService.mutate(
          'campaign_criterion',
          'create',
          operations,
          { tool: 'traffic_update_schedule', campaign_id, schedule },
        );
        const data = { updated_entries: schedule.length, resource_names: result.resource_names };
        return ok(data, `Agenda da campanha ${campaign_id} atualizada com ${schedule.length} entradas.`);
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}

function dayEnum(day: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY') {
  return enums.DayOfWeek[day];
}

async function getSchedule(campaignId: string) {
  const rows = await googleAdsService.query<any>(`
    SELECT
      campaign_criterion.criterion_id,
      campaign_criterion.ad_schedule.day_of_week,
      campaign_criterion.ad_schedule.start_hour,
      campaign_criterion.ad_schedule.end_hour,
      campaign_criterion.bid_modifier
    FROM campaign_criterion
    WHERE campaign.id = ${campaignId}
      AND campaign_criterion.type = 'AD_SCHEDULE'
      AND campaign_criterion.negative = false
  `);
  return rows.map((row) => ({
    criterion_id: String(row.campaign_criterion?.criterion_id ?? ''),
    day_of_week: String(row.campaign_criterion?.ad_schedule?.day_of_week ?? ''),
    start_hour: Number(row.campaign_criterion?.ad_schedule?.start_hour ?? 0),
    end_hour: Number(row.campaign_criterion?.ad_schedule?.end_hour ?? 0),
    bid_modifier: row.campaign_criterion?.bid_modifier ?? null,
  }));
}
