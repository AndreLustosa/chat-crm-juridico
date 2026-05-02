import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { googleAdsService } from '../services/google-ads.js';
import { campaignIdSchema, optionalDateRange, paginationSchema } from '../schemas/index.js';
import { fail, formatError, fromMicros, markdownTable, money, num, ok, paginate, percent, resolveDateRange, rangeWhere } from '../utils/format.js';

export function registerAdTools(server: McpServer) {
  server.registerTool(
    'traffic_list_ads',
    {
      description: 'Lista anuncios RSA de uma campanha com headlines, descricoes e forca.',
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
        const rows = await googleAdsService.query<any>(`
          SELECT
            campaign.id,
            campaign.name,
            ad_group.id,
            ad_group.name,
            ad_group_ad.ad.id,
            ad_group_ad.status,
            ad_group_ad.ad_strength,
            ad_group_ad.ad.final_urls,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions,
            metrics.ctr,
            metrics.average_cpc
          FROM ad_group_ad
          WHERE campaign.id = ${input.campaign_id}
            AND ${rangeWhere(range)}
            AND ad_group_ad.status != 'REMOVED'
          ORDER BY metrics.impressions DESC
        `);
        const data = paginate(rows.map(adFromRow), input.page, input.limit);
        return ok(
          data,
          markdownTable(
            ['Ad ID', 'Grupo', 'Forca', 'Headlines', 'Descricoes', 'Cliques', 'Conv.', 'CTR'],
            data.map((ad) => [ad.ad_id, ad.ad_group, ad.ad_strength, ad.headlines.length, ad.descriptions.length, ad.metrics.clicks, ad.metrics.conversions.toFixed(2), percent(ad.metrics.ctr)]),
          ),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_get_ad_strength',
    {
      description: 'Retorna a forca de todos os anuncios de todas as campanhas.',
      inputSchema: { ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const rows = await googleAdsService.query<any>(`
          SELECT
            campaign.id,
            campaign.name,
            ad_group_ad.ad.id,
            ad_group_ad.ad_strength,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions
          FROM ad_group_ad
          WHERE ad_group_ad.status != 'REMOVED'
        `);
        const data = paginate(rows.map((row) => ({
          campaign_id: String(row.campaign?.id ?? ''),
          campaign: row.campaign?.name ?? '',
          ad_id: String(row.ad_group_ad?.ad?.id ?? ''),
          ad_strength: String(row.ad_group_ad?.ad_strength ?? 'UNKNOWN'),
          headline_count: row.ad_group_ad?.ad?.responsive_search_ad?.headlines?.length ?? 0,
          description_count: row.ad_group_ad?.ad?.responsive_search_ad?.descriptions?.length ?? 0,
        })), input.page, input.limit);
        return ok(
          data,
          markdownTable(['Campanha', 'Ad ID', 'Forca', 'Headlines', 'Descricoes'], data.map((a) => [a.campaign, a.ad_id, a.ad_strength, a.headline_count, a.description_count])),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}

function adFromRow(row: any) {
  const spend = fromMicros(row.metrics?.cost_micros);
  const clicks = num(row.metrics?.clicks);
  const impressions = num(row.metrics?.impressions);
  const conversions = num(row.metrics?.conversions);
  const rsa = row.ad_group_ad?.ad?.responsive_search_ad;
  return {
    campaign_id: String(row.campaign?.id ?? ''),
    campaign: row.campaign?.name ?? '',
    ad_group_id: String(row.ad_group?.id ?? ''),
    ad_group: row.ad_group?.name ?? '',
    ad_id: String(row.ad_group_ad?.ad?.id ?? ''),
    status: String(row.ad_group_ad?.status ?? 'UNKNOWN'),
    ad_strength: String(row.ad_group_ad?.ad_strength ?? 'UNKNOWN'),
    headlines: (rsa?.headlines ?? []).map((h: any) => h.text ?? ''),
    descriptions: (rsa?.descriptions ?? []).map((d: any) => d.text ?? ''),
    final_urls: row.ad_group_ad?.ad?.final_urls ?? [],
    metrics: {
      spend,
      clicks,
      impressions,
      conversions,
      ctr: num(row.metrics?.ctr, impressions > 0 ? clicks / impressions : 0),
      cpc: clicks > 0 ? spend / clicks : null,
      cpl: conversions > 0 ? spend / conversions : null,
      cpc_formatted: clicks > 0 ? money(spend / clicks) : '-',
    },
  };
}
