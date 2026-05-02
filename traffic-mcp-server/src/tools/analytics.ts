import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { googleAdsService } from '../services/google-ads.js';
import { optionalDateRange } from '../schemas/index.js';
import { fail, formatError, fromMicros, markdownTable, money, num, ok, percent, resolveDateRange, rangeWhere } from '../utils/format.js';

export function registerAnalyticsTools(server: McpServer) {
  server.registerTool(
    'traffic_hourly_performance',
    {
      description: 'Retorna performance por hora do dia.',
      inputSchema: { campaign_id: z.string().optional(), ...optionalDateRange },
      annotations: { readOnlyHint: true },
    },
    async (input) => groupedPerformance('segments.hour', 'hour', input),
  );

  server.registerTool(
    'traffic_daily_performance',
    {
      description: 'Retorna performance por dia da semana.',
      inputSchema: { campaign_id: z.string().optional(), ...optionalDateRange },
      annotations: { readOnlyHint: true },
    },
    async (input) => groupedPerformance('segments.day_of_week', 'day_of_week', input),
  );

  server.registerTool(
    'traffic_device_performance',
    {
      description: 'Retorna breakdown de performance por dispositivo.',
      inputSchema: { campaign_id: z.string().optional(), ...optionalDateRange },
      annotations: { readOnlyHint: true },
    },
    async (input) => groupedPerformance('segments.device', 'device', input, true),
  );

  server.registerTool(
    'traffic_daily_timeseries',
    {
      description: 'Retorna serie temporal diaria de metricas para graficos de evolucao.',
      inputSchema: {
        campaign_id: z.string().optional(),
        date_from: z.string(),
        date_to: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => groupedPerformance('segments.date', 'date', input),
  );
}

async function groupedPerformance(
  segmentField: string,
  label: string,
  input: { campaign_id?: string; date_from?: string; date_to?: string; date_preset?: any },
  includePct = false,
) {
  try {
    const range = resolveDateRange(input);
    const rows = await googleAdsService.query<any>(`
      SELECT
        ${segmentField},
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_per_conversion
      FROM campaign
      WHERE ${rangeWhere(range)}
        ${input.campaign_id ? `AND campaign.id = ${input.campaign_id}` : ''}
      ORDER BY ${segmentField} ASC
    `);
    const totalSpend = rows.reduce((sum, row) => sum + fromMicros(row.metrics?.cost_micros), 0);
    const data = rows.map((row) => {
      const spend = fromMicros(row.metrics?.cost_micros);
      const clicks = num(row.metrics?.clicks);
      const impressions = num(row.metrics?.impressions);
      const conversions = num(row.metrics?.conversions);
      return {
        [label]: getSegmentValue(row, label),
        spend,
        clicks,
        impressions,
        conversions,
        ctr: num(row.metrics?.ctr, impressions > 0 ? clicks / impressions : 0),
        cpc: clicks > 0 ? spend / clicks : null,
        cpl: conversions > 0 ? spend / conversions : null,
        ...(includePct ? { pct_total: totalSpend > 0 ? spend / totalSpend : 0 } : {}),
      };
    });
    return ok(
      data,
      markdownTable(
        [label, 'Gasto', 'Cliques', 'Imp.', 'Conv.', 'CTR', 'CPC', 'CPL', ...(includePct ? ['% total'] : [])],
        data.map((d: any) => [d[label], money(d.spend), d.clicks, d.impressions, d.conversions.toFixed(2), percent(d.ctr), d.cpc ? money(d.cpc) : '-', d.cpl ? money(d.cpl) : '-', ...(includePct ? [percent(d.pct_total)] : [])]),
      ),
    );
  } catch (error) {
    return fail(formatError(error));
  }
}

function getSegmentValue(row: any, label: string): string | number {
  if (label === 'hour') return row.segments?.hour ?? 0;
  if (label === 'day_of_week') return String(row.segments?.day_of_week ?? '');
  if (label === 'device') return String(row.segments?.device ?? '');
  return row.segments?.date ?? '';
}
