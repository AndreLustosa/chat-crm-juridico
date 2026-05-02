import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { googleAdsService } from '../services/google-ads.js';
import { campaignIdSchema, optionalDateRange, paginationSchema } from '../schemas/index.js';
import { fail, formatError, fromMicros, markdownTable, money, num, ok, paginate, percent, resolveDateRange, rangeWhere } from '../utils/format.js';

export function registerKeywordTools(server: McpServer) {
  server.registerTool(
    'traffic_list_keywords',
    {
      description: 'Lista palavras-chave de uma campanha com quality score e metricas.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        ...optionalDateRange,
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const range = resolveDateRange(input);
        const rows = await googleAdsService.query<any>(keywordQuery(range.from, range.to, `AND campaign.id = ${input.campaign_id}`));
        const data = paginate(rows.map(keywordFromRow), input.page, input.limit);
        return ok(
          data,
          markdownTable(
            ['Keyword', 'Tipo', 'QS', 'Gasto', 'Cliques', 'Imp.', 'Conv.', 'CTR', 'CPC', 'CPL'],
            data.map((k) => [k.keyword, k.match_type, k.quality_score ?? '-', money(k.spend), k.clicks, k.impressions, k.conversions.toFixed(2), percent(k.ctr), k.cpc ? money(k.cpc) : '-', k.cpl ? money(k.cpl) : '-']),
          ),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_get_keyword_performance',
    {
      description: 'Retorna performance detalhada de todas as keywords cross-campaign.',
      inputSchema: {
        ...optionalDateRange,
        min_spend: z.number().nonnegative().optional(),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const range = resolveDateRange(input);
        const rows = await googleAdsService.query<any>(keywordQuery(range.from, range.to, ''));
        const data = rows
          .map(keywordFromRow)
          .filter((k) => k.spend >= (input.min_spend ?? 0))
          .sort((a, b) => b.spend - a.spend);
        const page = paginate(data, input.page, input.limit);
        return ok(
          page,
          markdownTable(
            ['Campanha', 'Keyword', 'Tipo', 'Gasto', 'Cliques', 'Conv.', 'CPL'],
            page.map((k) => [k.campaign, k.keyword, k.match_type, money(k.spend), k.clicks, k.conversions.toFixed(2), k.cpl ? money(k.cpl) : '-']),
          ),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}

function keywordQuery(from: string, to: string, extraWhere: string): string {
  return `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.quality_info.quality_score,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_per_conversion
    FROM keyword_view
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      AND ad_group_criterion.negative = false
      AND campaign.status != 'REMOVED'
      ${extraWhere}
    ORDER BY metrics.cost_micros DESC
  `;
}

function keywordFromRow(row: any) {
  const spend = fromMicros(row.metrics?.cost_micros);
  const clicks = num(row.metrics?.clicks);
  const impressions = num(row.metrics?.impressions);
  const conversions = num(row.metrics?.conversions);
  return {
    campaign_id: String(row.campaign?.id ?? ''),
    campaign: row.campaign?.name ?? '',
    ad_group_id: String(row.ad_group?.id ?? ''),
    ad_group: row.ad_group?.name ?? '',
    criterion_id: String(row.ad_group_criterion?.criterion_id ?? ''),
    keyword: row.ad_group_criterion?.keyword?.text ?? '',
    match_type: String(row.ad_group_criterion?.keyword?.match_type ?? ''),
    quality_score: row.ad_group_criterion?.quality_info?.quality_score ?? null,
    spend,
    clicks,
    impressions,
    conversions,
    ctr: num(row.metrics?.ctr, impressions > 0 ? clicks / impressions : 0),
    cpc: clicks > 0 ? spend / clicks : null,
    cpl: conversions > 0 ? spend / conversions : null,
  };
}
