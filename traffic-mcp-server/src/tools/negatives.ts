import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { googleAdsService } from '../services/google-ads.js';
import { campaignIdSchema, matchTypeSchema, paginationSchema } from '../schemas/index.js';
import { fail, formatError, markdownTable, ok, paginate } from '../utils/format.js';

export function registerNegativeTools(server: McpServer) {
  server.registerTool(
    'traffic_list_negatives',
    {
      description: 'Lista todas as palavras-chave negativas de uma campanha.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const rows = await googleAdsService.query<any>(`
          SELECT
            campaign_criterion.criterion_id,
            campaign_criterion.keyword.text,
            campaign_criterion.keyword.match_type
          FROM campaign_criterion
          WHERE campaign.id = ${input.campaign_id}
            AND campaign_criterion.negative = true
            AND campaign_criterion.type = 'KEYWORD'
        `);
        const data = rows.map((row) => ({
          keyword: row.campaign_criterion?.keyword?.text ?? '',
          match_type: String(row.campaign_criterion?.keyword?.match_type ?? ''),
          criterion_id: String(row.campaign_criterion?.criterion_id ?? ''),
        }));
        const page = paginate(data, input.page, input.limit);
        return ok(page, markdownTable(['Keyword', 'Tipo', 'Criterion ID'], page.map((n) => [n.keyword, n.match_type, n.criterion_id])));
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_add_negative',
    {
      description: 'Adiciona uma ou mais palavras-chave negativas a uma campanha.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        keywords: z.array(z.string().min(1)).min(1).max(100),
        match_type: matchTypeSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => addNegativesToCampaign(input.campaign_id, input.keywords, input.match_type),
  );

  server.registerTool(
    'traffic_remove_negative',
    {
      description: 'Remove uma palavra-chave negativa de uma campanha.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        criterion_id: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      try {
        const resource = googleAdsService.campaignCriterionResource(input.campaign_id, input.criterion_id);
        const result = await googleAdsService.mutate(
          'campaign_criterion',
          'remove',
          [resource],
          { tool: 'traffic_remove_negative', campaign_id: input.campaign_id, criterion_id: input.criterion_id },
        );
        const data = { removed_keyword: input.criterion_id, resource_names: result.resource_names };
        return ok(data, `Negativa ${input.criterion_id} removida da campanha ${input.campaign_id}.`);
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    'traffic_add_negative_all_campaigns',
    {
      description: 'Adiciona palavras-chave negativas em todas as campanhas ativas.',
      inputSchema: {
        keywords: z.array(z.string().min(1)).min(1).max(100),
        match_type: matchTypeSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      try {
        const campaigns = await googleAdsService.query<any>(`
          SELECT campaign.id, campaign.name
          FROM campaign
          WHERE campaign.status = 'ENABLED'
            AND campaign.status != 'REMOVED'
        `, { cache: false });
        let totalAdded = 0;
        for (const row of campaigns) {
          const id = String(row.campaign?.id);
          if (!id) continue;
          await addNegativesToCampaign(id, input.keywords, input.match_type);
          totalAdded += input.keywords.length;
        }
        const data = { campaigns_affected: campaigns.length, total_added: totalAdded };
        return ok(data, `${totalAdded} negativas adicionadas em ${campaigns.length} campanhas ativas.`);
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}

async function addNegativesToCampaign(campaignId: string, keywords: string[], matchType: 'BROAD' | 'PHRASE' | 'EXACT') {
  try {
    const operations = keywords.map((keyword) => ({
      campaign: googleAdsService.campaignResource(campaignId),
      negative: true,
      keyword: {
        text: keyword,
        match_type: googleAdsService.enumMatchType(matchType),
      },
    }));
    const result = await googleAdsService.mutate(
      'campaign_criterion',
      'create',
      operations,
      { tool: 'traffic_add_negative', campaign_id: campaignId, keywords, match_type: matchType },
    );
    const data = { added_count: keywords.length, keywords_added: keywords, resource_names: result.resource_names };
    return ok(data, `${keywords.length} negativas adicionadas a campanha ${campaignId}: ${keywords.join(', ')}`);
  } catch (error) {
    return fail(formatError(error));
  }
}
