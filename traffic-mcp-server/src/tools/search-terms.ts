import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { googleAdsService } from '../services/google-ads.js';
import { optionalDateRange, paginationSchema } from '../schemas/index.js';
import { fail, formatError, fromMicros, markdownTable, money, num, ok, paginate, percent, resolveDateRange } from '../utils/format.js';

export function registerSearchTermTools(server: McpServer) {
  server.registerTool(
    'traffic_list_search_terms',
    {
      description: 'Lista os termos reais que as pessoas digitaram no Google e acionaram os anuncios.',
      inputSchema: {
        campaign_id: z.string().optional(),
        ...optionalDateRange,
        has_conversions: z.boolean().optional(),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const range = resolveDateRange(input);
        const data = (await googleAdsService.query<any>(searchTermsQuery(range.from, range.to, input.campaign_id)))
          .map(searchTermFromRow)
          .filter((t) => input.has_conversions === undefined || (input.has_conversions ? t.conversions > 0 : t.conversions === 0));
        const page = paginate(data, input.page, input.limit);
        return ok(
          page,
          markdownTable(
            ['Termo', 'Campanha', 'Gasto', 'Cliques', 'Imp.', 'Conv.', 'CTR'],
            page.map((t) => [t.search_term, t.campaign, money(t.spend), t.clicks, t.impressions, t.conversions.toFixed(2), percent(t.ctr)]),
          ),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_find_wasted_terms',
    {
      description: 'Identifica termos de busca que gastaram dinheiro sem gerar conversao.',
      inputSchema: {
        min_spend: z.number().nonnegative().optional().default(10),
        ...optionalDateRange,
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const range = resolveDateRange(input);
        const data = (await googleAdsService.query<any>(searchTermsQuery(range.from, range.to)))
          .map(searchTermFromRow)
          .filter((t) => t.conversions === 0 && t.spend >= (input.min_spend ?? 10))
          .sort((a, b) => b.spend - a.spend);
        const page = paginate(data, input.page, input.limit);
        return ok(
          page,
          markdownTable(
            ['Termo', 'Campanha', 'Gasto', 'Cliques'],
            page.map((t) => [t.search_term, t.campaign, money(t.spend), t.clicks]),
          ),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}

function searchTermsQuery(from: string, to: string, campaignId?: string): string {
  return `
    SELECT
      search_term_view.search_term,
      campaign.id,
      campaign.name,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr
    FROM search_term_view
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      ${campaignId ? `AND campaign.id = ${campaignId}` : ''}
    ORDER BY metrics.cost_micros DESC
  `;
}

function searchTermFromRow(row: any) {
  const spend = fromMicros(row.metrics?.cost_micros);
  const clicks = num(row.metrics?.clicks);
  const impressions = num(row.metrics?.impressions);
  return {
    search_term: row.search_term_view?.search_term ?? '',
    campaign_id: String(row.campaign?.id ?? ''),
    campaign: row.campaign?.name ?? '',
    clicks,
    impressions,
    conversions: num(row.metrics?.conversions),
    spend,
    ctr: num(row.metrics?.ctr, impressions > 0 ? clicks / impressions : 0),
  };
}
