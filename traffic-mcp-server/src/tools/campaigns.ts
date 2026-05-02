import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { googleAdsService } from '../services/google-ads.js';
import { campaignIdSchema, optionalDateRange, paginationSchema } from '../schemas/index.js';
import { fail, formatError, markdownTable, money, num, ok, paginate, percent, resolveDateRange, rangeWhere, totals, fromMicros, dateBr } from '../utils/format.js';

export function registerCampaignTools(server: McpServer) {
  server.registerTool(
    'traffic_list_campaigns',
    {
      description: 'Lista todas as campanhas do Google Ads com metricas de performance.',
      inputSchema: {
        ...optionalDateRange,
        status_filter: z.enum(['ENABLED', 'PAUSED', 'ALL']).optional().default('ALL'),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const range = resolveDateRange(input);
        const statusWhere = input.status_filter && input.status_filter !== 'ALL'
          ? `AND campaign.status = '${input.status_filter}'`
          : '';
        const fullQuery = `
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            campaign.campaign_budget,
            campaign_budget.amount_micros,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.ctr,
            metrics.average_cpc,
            metrics.cost_per_conversion,
            metrics.search_impression_share,
            metrics.search_budget_lost_impression_share,
            metrics.search_rank_lost_impression_share,
            metrics.search_top_impression_share,
            metrics.search_absolute_top_impression_share,
            metrics.search_click_share
          FROM campaign
          WHERE ${rangeWhere(range)}
            AND campaign.status != 'REMOVED'
            ${statusWhere}
          ORDER BY metrics.cost_micros DESC
        `;
        const fallbackQuery = `
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            campaign.campaign_budget,
            campaign_budget.amount_micros,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.ctr,
            metrics.average_cpc,
            metrics.cost_per_conversion
          FROM campaign
          WHERE ${rangeWhere(range)}
            AND campaign.status != 'REMOVED'
            ${statusWhere}
          ORDER BY metrics.cost_micros DESC
        `;
        const rows = await googleAdsService.safeQuery<any>(fullQuery, fallbackQuery);
        const data = rows.map(campaignFromRow);
        const page = paginate(data, input.page, input.limit);
        return ok(
          page,
          [
            `Campanhas Google Ads (${dateBr(range.from)} a ${dateBr(range.to)})`,
            markdownTable(
              ['ID', 'Campanha', 'Status', 'Orcamento/dia', 'Gasto', 'Cliques', 'Conv.', 'CTR', 'CPC', 'CPL'],
              page.map((c) => [
                c.id,
                c.name,
                c.status,
                money(c.budget_per_day),
                money(c.spend),
                c.clicks,
                c.conversions.toFixed(2),
                percent(c.ctr),
                c.cpc ? money(c.cpc) : '-',
                c.cpl ? money(c.cpl) : '-',
              ]),
            ),
          ].join('\n\n'),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_get_campaign',
    {
      description: 'Retorna detalhes completos de uma campanha especifica, incluindo serie diaria.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const range = resolveDateRange(input);
        const rows = await googleAdsService.query<any>(`
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            campaign.campaign_budget,
            campaign_budget.amount_micros,
            segments.date,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.ctr,
            metrics.average_cpc,
            metrics.cost_per_conversion
          FROM campaign
          WHERE campaign.id = ${input.campaign_id}
            AND ${rangeWhere(range)}
          ORDER BY segments.date ASC
        `);
        if (rows.length === 0) return fail(`Campanha ${input.campaign_id} nao encontrada no periodo informado.`);
        const first = campaignFromRow(rows[0]);
        const daily = rows.map((row) => metricRow(row, row.segments?.date));
        const total = totals(daily);
        const data = { ...first, ...total, daily };
        return ok(
          data,
          [
            `Campanha: ${first.name} (${first.id})`,
            `Periodo: ${dateBr(range.from)} a ${dateBr(range.to)}`,
            `Gasto: ${money(total.spend)} | Cliques: ${total.clicks} | Conversoes: ${total.conversions.toFixed(2)} | CPL: ${total.cpl ? money(total.cpl) : '-'}`,
            markdownTable(
              ['Data', 'Gasto', 'Cliques', 'Impressoes', 'Conv.', 'CTR', 'CPL'],
              daily.map((d) => [dateBr(d.date), money(d.spend), d.clicks, d.impressions, d.conversions.toFixed(2), percent(d.ctr), d.cpl ? money(d.cpl) : '-']),
            ),
          ].join('\n\n'),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_compare_periods',
    {
      description: 'Compara metricas de campanhas entre dois periodos.',
      inputSchema: {
        period1_from: z.string(),
        period1_to: z.string(),
        period2_from: z.string(),
        period2_to: z.string(),
        campaign_id: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const p1 = await campaignTotals(input.period1_from, input.period1_to, input.campaign_id);
        const p2 = await campaignTotals(input.period2_from, input.period2_to, input.campaign_id);
        const data = {
          period1: p1,
          period2: p2,
          deltas: {
            spend_pct: delta(p1.spend, p2.spend),
            clicks_pct: delta(p1.clicks, p2.clicks),
            impressions_pct: delta(p1.impressions, p2.impressions),
            conversions_pct: delta(p1.conversions, p2.conversions),
            cpl_pct: delta(p1.cpl ?? 0, p2.cpl ?? 0),
          },
        };
        return ok(
          data,
          markdownTable(
            ['Metrica', 'Periodo 1', 'Periodo 2', 'Delta'],
            [
              ['Gasto', money(p1.spend), money(p2.spend), percent(data.deltas.spend_pct)],
              ['Cliques', p1.clicks, p2.clicks, percent(data.deltas.clicks_pct)],
              ['Impressoes', p1.impressions, p2.impressions, percent(data.deltas.impressions_pct)],
              ['Conversoes', p1.conversions.toFixed(2), p2.conversions.toFixed(2), percent(data.deltas.conversions_pct)],
              ['CPL', p1.cpl ? money(p1.cpl) : '-', p2.cpl ? money(p2.cpl) : '-', percent(data.deltas.cpl_pct)],
            ],
          ),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_pause_campaign',
    {
      description: 'Pausa uma campanha ativa. A campanha deixa de veicular imediatamente.',
      inputSchema: { campaign_id: campaignIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id }) => updateCampaignStatus(campaign_id, 'PAUSED'),
  );

  server.registerTool(
    'traffic_enable_campaign',
    {
      description: 'Ativa uma campanha pausada. A campanha volta a veicular imediatamente.',
      inputSchema: { campaign_id: campaignIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id }) => updateCampaignStatus(campaign_id, 'ENABLED'),
  );

  server.registerTool(
    'traffic_update_budget',
    {
      description: 'Altera o orcamento diario de uma campanha.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        new_daily_budget: z.number().positive().describe('Novo orcamento diario em reais'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id, new_daily_budget }) => {
      try {
        const budget = await googleAdsService.getCampaignBudget(campaign_id);
        const result = await googleAdsService.mutate(
          'campaign_budget',
          'update',
          [{
            resource_name: budget.budget_resource_name,
            amount_micros: Math.round(new_daily_budget * 1_000_000),
          }],
          { tool: 'traffic_update_budget', campaign_id, old_budget: budget.old_budget, new_daily_budget },
        );
        const data = {
          campaign_name: budget.campaign_name,
          old_budget: budget.old_budget,
          new_budget: new_daily_budget,
          resource_names: result.resource_names,
        };
        return ok(data, `Orcamento atualizado em ${budget.campaign_name}: ${money(budget.old_budget)} -> ${money(new_daily_budget)}.`);
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}

function campaignFromRow(row: any) {
  const spend = fromMicros(row.metrics?.cost_micros);
  const clicks = num(row.metrics?.clicks);
  const impressions = num(row.metrics?.impressions);
  const conversions = num(row.metrics?.conversions);
  return {
    id: String(row.campaign?.id ?? ''),
    name: row.campaign?.name ?? '(sem nome)',
    status: enumName(row.campaign?.status),
    budget_per_day: fromMicros(row.campaign_budget?.amount_micros),
    bidding_strategy: enumName(row.campaign?.bidding_strategy_type),
    channel_type: enumName(row.campaign?.advertising_channel_type),
    spend,
    clicks,
    impressions,
    conversions,
    ctr: num(row.metrics?.ctr, impressions > 0 ? clicks / impressions : 0),
    cpc: clicks > 0 ? spend / clicks : null,
    cpl: conversions > 0 ? spend / conversions : null,
    conversion_rate: clicks > 0 ? conversions / clicks : 0,
    impression_share: nullableNumber(row.metrics?.search_impression_share),
    lost_impression_share_budget: nullableNumber(row.metrics?.search_budget_lost_impression_share),
    lost_impression_share_rank: nullableNumber(row.metrics?.search_rank_lost_impression_share),
    top_impression_pct: nullableNumber(row.metrics?.search_top_impression_share),
    abs_top_impression_pct: nullableNumber(row.metrics?.search_absolute_top_impression_share),
    click_share: nullableNumber(row.metrics?.search_click_share),
    ad_strength: null,
  };
}

function metricRow(row: any, date: string) {
  const spend = fromMicros(row.metrics?.cost_micros);
  const clicks = num(row.metrics?.clicks);
  const impressions = num(row.metrics?.impressions);
  const conversions = num(row.metrics?.conversions);
  return {
    date,
    spend,
    clicks,
    impressions,
    conversions,
    ctr: num(row.metrics?.ctr, impressions > 0 ? clicks / impressions : 0),
    cpc: clicks > 0 ? spend / clicks : null,
    cpl: conversions > 0 ? spend / conversions : null,
  };
}

async function campaignTotals(from: string, to: string, campaignId?: string) {
  const rows = await googleAdsService.query<any>(`
    SELECT
      campaign.id,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      ${campaignId ? `AND campaign.id = ${campaignId}` : ''}
  `);
  return totals(rows.map((row) => metricRow(row, from)));
}

async function updateCampaignStatus(campaignId: string, status: 'ENABLED' | 'PAUSED') {
  try {
    const result = await googleAdsService.mutate(
      'campaign',
      'update',
      [{
        resource_name: googleAdsService.campaignResource(campaignId),
        status: googleAdsService.enumCampaignStatus(status),
      }],
      { tool: status === 'PAUSED' ? 'traffic_pause_campaign' : 'traffic_enable_campaign', campaign_id: campaignId },
    );
    const data = { campaign_id: campaignId, status, resource_names: result.resource_names };
    return ok(data, `Campanha ${campaignId} alterada para ${status}.`);
  } catch (error) {
    return fail(formatError(error));
  }
}

function delta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 1 : 0;
  return (current - previous) / previous;
}

function enumName(value: unknown): string {
  return String(value ?? 'UNKNOWN');
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return num(value);
}
