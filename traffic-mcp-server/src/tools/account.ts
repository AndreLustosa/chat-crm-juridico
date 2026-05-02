import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { googleAdsService } from '../services/google-ads.js';
import { fail, formatError, fromMicros, markdownTable, money, num, ok, percent, resolveDateRange, totals } from '../utils/format.js';

export function registerAccountTools(server: McpServer) {
  server.registerTool(
    'traffic_account_status',
    {
      description: 'Retorna status geral da conta Google Ads.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const rows = await googleAdsService.query<any>(`
          SELECT
            campaign.id,
            campaign.status,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks,
            metrics.impressions
          FROM campaign
          WHERE segments.date DURING LAST_30_DAYS
            AND campaign.status != 'REMOVED'
        `);
        const campaigns = await googleAdsService.query<any>(`
          SELECT campaign.id, campaign.status
          FROM campaign
          WHERE campaign.status != 'REMOVED'
        `);
        const metricTotals = totals(rows.map((row) => ({
          spend: fromMicros(row.metrics?.cost_micros),
          clicks: num(row.metrics?.clicks),
          impressions: num(row.metrics?.impressions),
          conversions: num(row.metrics?.conversions),
        })));
        const data = {
          account_id: googleAdsService.customerId,
          total_campaigns: campaigns.length,
          active_campaigns: campaigns.filter((r) => String(r.campaign?.status) === 'ENABLED' || Number(r.campaign?.status) === 2).length,
          paused_campaigns: campaigns.filter((r) => String(r.campaign?.status) === 'PAUSED' || Number(r.campaign?.status) === 3).length,
          account_budget_status: 'UNKNOWN',
          total_spend_30d: metricTotals.spend,
          total_conversions_30d: metricTotals.conversions,
          rate_limit: googleAdsService.rateStatus(),
        };
        return ok(
          data,
          [
            `Conta Google Ads: ${data.account_id}`,
            markdownTable(
              ['Campanhas', 'Ativas', 'Pausadas', 'Gasto 30d', 'Conversoes 30d', 'Quota local restante'],
              [[data.total_campaigns, data.active_campaigns, data.paused_campaigns, money(data.total_spend_30d), data.total_conversions_30d.toFixed(2), data.rate_limit.remaining]],
            ),
          ].join('\n\n'),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_health_check',
    {
      description: 'Verifica a saude geral das campanhas e retorna alertas.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const today = resolveDateRange({ date_preset: 'TODAY' });
        const last7 = resolveDateRange({ date_preset: 'LAST_7_DAYS' });
        const todayRows = await campaignHealthRows(today.from, today.to);
        const last7Rows = await campaignHealthRows(last7.from, last7.to);
        const baseline = new Map(last7Rows.map((r) => [r.id, r]));
        const alerts: Array<Record<string, unknown>> = [];
        for (const current of todayRows) {
          const base = baseline.get(current.id);
          if (current.status === 'ENABLED' && current.impressions === 0) {
            alerts.push({ severity: 'critical', campaign: current.name, message: 'Campanha ativa com 0 impressoes hoje.', metric: 'impressions', current_value: 0, threshold: '> 0' });
          }
          if (base?.cpc && current.cpc && current.cpc > base.cpc * 1.3) {
            alerts.push({ severity: 'warning', campaign: current.name, message: 'CPC acima de 130% da media dos ultimos 7 dias.', metric: 'cpc', current_value: current.cpc, threshold: base.cpc * 1.3 });
          }
          if (base?.ctr && current.ctr < base.ctr * 0.6) {
            alerts.push({ severity: 'warning', campaign: current.name, message: 'CTR abaixo de 60% da media dos ultimos 7 dias.', metric: 'ctr', current_value: current.ctr, threshold: base.ctr * 0.6 });
          }
          if (current.impression_share !== null && current.impression_share < 0.25) {
            alerts.push({ severity: 'info', campaign: current.name, message: 'Parcela de impressoes abaixo de 25%.', metric: 'impression_share', current_value: current.impression_share, threshold: 0.25 });
          }
        }
        const weakAds = await googleAdsService.query<any>(`
          SELECT campaign.name, ad_group_ad.ad.id, ad_group_ad.ad_strength
          FROM ad_group_ad
          WHERE ad_group_ad.status != 'REMOVED'
        `);
        for (const row of weakAds) {
          if (String(row.ad_group_ad?.ad_strength) === 'POOR' || Number(row.ad_group_ad?.ad_strength) === 2) {
            alerts.push({ severity: 'warning', campaign: row.campaign?.name ?? '', message: 'Anuncio com ad strength POOR.', metric: 'ad_strength', current_value: 'POOR', threshold: 'GOOD' });
          }
        }
        return ok(
          alerts,
          alerts.length === 0
            ? 'Nenhum alerta relevante encontrado.'
            : markdownTable(['Severidade', 'Campanha', 'Mensagem', 'Metrica', 'Valor'], alerts.map((a: any) => [a.severity, a.campaign, a.message, a.metric, typeof a.current_value === 'number' && a.current_value < 1 ? percent(a.current_value) : a.current_value])),
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}

async function campaignHealthRows(from: string, to: string) {
  const rows = await googleAdsService.safeQuery<any>(
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.ctr,
        metrics.search_impression_share
      FROM campaign
      WHERE segments.date BETWEEN '${from}' AND '${to}'
        AND campaign.status != 'REMOVED'
    `,
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${from}' AND '${to}'
        AND campaign.status != 'REMOVED'
    `,
  );
  return rows.map((row) => {
    const spend = fromMicros(row.metrics?.cost_micros);
    const clicks = num(row.metrics?.clicks);
    const impressions = num(row.metrics?.impressions);
    return {
      id: String(row.campaign?.id ?? ''),
      name: row.campaign?.name ?? '',
      status: String(row.campaign?.status ?? ''),
      spend,
      clicks,
      impressions,
      ctr: num(row.metrics?.ctr, impressions > 0 ? clicks / impressions : 0),
      cpc: clicks > 0 ? spend / clicks : null,
      impression_share: row.metrics?.search_impression_share === undefined ? null : num(row.metrics?.search_impression_share),
    };
  });
}
