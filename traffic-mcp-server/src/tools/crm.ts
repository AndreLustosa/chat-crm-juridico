import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { crmTrafficService } from '../services/crm.js';
import { campaignIdSchema, matchTypeSchema, optionalDateRange, paginationSchema } from '../schemas/index.js';
import { dateBr, fail, markdownTable, money, ok, paginate, percent, resolveDateRange } from '../utils/format.js';

type AnyRecord = Record<string, any>;

export function registerCrmTrafficTools(server: McpServer) {
  registerCampaignTools(server);
  registerKeywordTools(server);
  registerSearchTermTools(server);
  registerNegativeTools(server);
  registerAdTools(server);
  registerScheduleTools(server);
  registerAnalyticsTools(server);
  registerAccountTools(server);
}

function registerCampaignTools(server: McpServer) {
  server.registerTool(
    'traffic_list_campaigns',
    {
      description: 'Lista campanhas do Gestor de Trafego usando a API interna do CRM.',
      inputSchema: {
        ...optionalDateRange,
        status_filter: z.enum(['ENABLED', 'PAUSED', 'ALL']).optional().default('ALL'),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const campaigns = await crmTrafficService.get<AnyRecord[]>('/trafego/campaigns');
      const filtered = campaigns
        .filter((c) => input.status_filter === 'ALL' || c.status === input.status_filter)
        .map(normalizeCampaign);
      const page = paginate(filtered, input.page, input.limit);
      return ok(page, markdownTable(
        ['ID local', 'Google ID', 'Campanha', 'Status', 'Orcamento/dia', 'Canal'],
        page.map((c) => [c.id, c.google_campaign_id ?? '-', c.name, c.status, money(c.budget_per_day), c.channel_type ?? '-']),
      ));
    }),
  );

  server.registerTool(
    'traffic_get_campaign',
    {
      description: 'Retorna detalhes de uma campanha a partir dos dados sincronizados no CRM.',
      inputSchema: { campaign_id: campaignIdSchema, date_from: z.string().optional(), date_to: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const [campaigns, dashboard] = await Promise.all([
        crmTrafficService.get<AnyRecord[]>('/trafego/campaigns'),
        crmTrafficService.get<AnyRecord>('/trafego/dashboard', dateQuery(input)),
      ]);
      const campaign = campaigns.map(normalizeCampaign).find((c) => matchesId(c, input.campaign_id));
      if (!campaign) return fail(`Campanha ${input.campaign_id} nao encontrada no CRM.`);
      const data = { ...campaign, dashboard_snapshot: dashboard };
      return ok(data, [
        `Campanha: ${campaign.name}`,
        `Status: ${campaign.status}`,
        `Orcamento diario: ${money(campaign.budget_per_day)}`,
        'Dados detalhados de metricas vem do snapshot sincronizado do CRM.',
      ].join('\n'));
    }),
  );

  server.registerTool(
    'traffic_compare_periods',
    {
      description: 'Compara snapshots do dashboard do CRM entre dois periodos.',
      inputSchema: {
        period1_from: z.string(),
        period1_to: z.string(),
        period2_from: z.string(),
        period2_to: z.string(),
        campaign_id: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const [period1, period2] = await Promise.all([
        crmTrafficService.get<AnyRecord>('/trafego/dashboard', { date_from: input.period1_from, date_to: input.period1_to }),
        crmTrafficService.get<AnyRecord>('/trafego/dashboard', { date_from: input.period2_from, date_to: input.period2_to }),
      ]);
      const data = { period1, period2, note: 'Comparativo baseado no endpoint /trafego/dashboard do CRM.' };
      return ok(data, markdownTable(
        ['Metrica', 'Periodo 1', 'Periodo 2'],
        [
          ['Gasto hoje', money(period1.kpis?.spend_today_brl), money(period2.kpis?.spend_today_brl)],
          ['Gasto mes', money(period1.kpis?.spend_month_brl), money(period2.kpis?.spend_month_brl)],
          ['CPL 7d', money(period1.kpis?.cpl_brl), money(period2.kpis?.cpl_brl)],
          ['CTR 7d', percent(period1.kpis?.ctr), percent(period2.kpis?.ctr)],
          ['CPC medio 7d', money(period1.kpis?.avg_cpc_brl), money(period2.kpis?.avg_cpc_brl)],
        ],
      ));
    }),
  );

  server.registerTool(
    'traffic_pause_campaign',
    {
      description: 'Pausa uma campanha via fila de mutate do CRM.',
      inputSchema: { campaign_id: campaignIdSchema, reason: z.string().optional(), validate_only: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id, reason, validate_only }) => mutateCampaign(campaign_id, 'pause', reason, validate_only),
  );

  server.registerTool(
    'traffic_enable_campaign',
    {
      description: 'Reativa uma campanha via fila de mutate do CRM.',
      inputSchema: { campaign_id: campaignIdSchema, reason: z.string().optional(), validate_only: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id, reason, validate_only }) => mutateCampaign(campaign_id, 'resume', reason, validate_only),
  );

  server.registerTool(
    'traffic_update_budget',
    {
      description: 'Altera o orcamento diario de uma campanha via CRM.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        new_daily_budget: z.number().positive(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id, new_daily_budget, reason, validate_only }) => safe(async () => {
      const result = await crmTrafficService.patch(`/trafego/campaigns/${campaign_id}/budget`, {
        new_amount_brl: new_daily_budget,
        reason,
        validate_only,
      });
      return ok(result, `Atualizacao de orcamento enfileirada no CRM: campanha ${campaign_id} -> ${money(new_daily_budget)}.`);
    }),
  );
}

function registerKeywordTools(server: McpServer) {
  server.registerTool(
    'traffic_list_keywords',
    {
      description: 'Lista palavras-chave por campanha usando ad groups sincronizados no CRM.',
      inputSchema: { campaign_id: campaignIdSchema, date_from: z.string().optional(), date_to: z.string().optional(), ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const adGroups = await crmTrafficService.get<AnyRecord[]>('/trafego/ad-groups', { campaign_id: input.campaign_id });
      const keywordSets = await Promise.all(adGroups.map((ag) => crmTrafficService.get<AnyRecord[]>(`/trafego/ad-groups/${ag.id}/keywords`, { negative: false })));
      const keywords: AnyRecord[] = keywordSets.flat().map((k) => ({ ...k, keyword: k.text ?? k.keyword_text ?? k.name }));
      const page = paginate(keywords, input.page, input.limit);
      return ok(page, markdownTable(
        ['Keyword', 'Match', 'Status', 'Negativa', 'CPC bid'],
        page.map((k) => [k.keyword ?? '-', k.match_type ?? '-', k.status ?? '-', k.negative ? 'sim' : 'nao', k.cpc_bid_brl ? money(k.cpc_bid_brl) : '-']),
      ));
    }),
  );

  server.registerTool(
    'traffic_get_keyword_performance',
    {
      description: 'Lista keywords sincronizadas no CRM, agrupadas por ad group.',
      inputSchema: { date_from: z.string().optional(), date_to: z.string().optional(), min_spend: z.number().optional(), ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const adGroups = await crmTrafficService.get<AnyRecord[]>('/trafego/ad-groups');
      const keywordSets = await Promise.all(adGroups.map((ag) => crmTrafficService.get<AnyRecord[]>(`/trafego/ad-groups/${ag.id}/keywords`, { negative: false })));
      const keywords: AnyRecord[] = keywordSets.flat().map((k) => ({ ...k, keyword: k.text ?? k.keyword_text ?? k.name }));
      const page = paginate(keywords, input.page, input.limit);
      return ok(page, markdownTable(['Keyword', 'Match', 'Status', 'Ad group'], page.map((k) => [k.keyword ?? '-', k.match_type ?? '-', k.status ?? '-', k.ad_group_id ?? '-'])));
    }),
  );
}

function registerSearchTermTools(server: McpServer) {
  const unavailable = 'O CRM atual ainda nao expoe endpoint HTTP de termos de busca. O MCP esta em modo CRM para nao duplicar credenciais do Google Ads.';
  server.registerTool(
    'traffic_list_search_terms',
    {
      description: 'Lista termos de busca. Requer endpoint de search terms no CRM.',
      inputSchema: { campaign_id: z.string().optional(), date_from: z.string().optional(), date_to: z.string().optional(), has_conversions: z.boolean().optional(), ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async () => fail(unavailable),
  );
  server.registerTool(
    'traffic_find_wasted_terms',
    {
      description: 'Identifica termos desperdicados. Requer endpoint de search terms no CRM.',
      inputSchema: { min_spend: z.number().optional(), date_from: z.string().optional(), date_to: z.string().optional(), ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async () => fail(unavailable),
  );
}

function registerNegativeTools(server: McpServer) {
  server.registerTool(
    'traffic_list_negatives',
    {
      description: 'Lista palavras-chave negativas de uma campanha via CRM.',
      inputSchema: { campaign_id: campaignIdSchema, ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const adGroups = await crmTrafficService.get<AnyRecord[]>('/trafego/ad-groups', { campaign_id: input.campaign_id });
      const keywordSets = await Promise.all(adGroups.map((ag) => crmTrafficService.get<AnyRecord[]>(`/trafego/ad-groups/${ag.id}/keywords`, { negative: true })));
      const negatives: AnyRecord[] = keywordSets.flat().map((k) => ({ ...k, keyword: k.text ?? k.keyword_text ?? k.name }));
      const page = paginate(negatives, input.page, input.limit);
      return ok(page, markdownTable(['ID', 'Keyword', 'Match', 'Ad group'], page.map((k) => [k.id ?? '-', k.keyword ?? '-', k.match_type ?? '-', k.ad_group_id ?? '-'])));
    }),
  );

  server.registerTool(
    'traffic_add_negative',
    {
      description: 'Adiciona palavras-chave negativas em uma campanha via fila de mutate do CRM.',
      inputSchema: { campaign_id: campaignIdSchema, keywords: z.array(z.string()).min(1), match_type: matchTypeSchema, validate_only: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => safe(async () => {
      const result = await crmTrafficService.post(`/trafego/campaigns/${input.campaign_id}/negatives`, {
        scope: 'CAMPAIGN',
        negatives: input.keywords.map((text) => ({ text, match_type: input.match_type })),
        validate_only: input.validate_only,
      });
      return ok(result, `${input.keywords.length} negativa(s) enfileirada(s) no CRM para a campanha ${input.campaign_id}.`);
    }),
  );

  server.registerTool(
    'traffic_remove_negative',
    {
      description: 'Remove uma keyword negativa via CRM.',
      inputSchema: { campaign_id: campaignIdSchema, criterion_id: z.string(), validate_only: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => safe(async () => {
      const result = await crmTrafficService.delete(`/trafego/keywords/${input.criterion_id}`, {
        reason: `Remocao solicitada via MCP para campanha ${input.campaign_id}`,
        validate_only: input.validate_only,
      });
      return ok(result, `Remocao da negativa ${input.criterion_id} enfileirada no CRM.`);
    }),
  );

  server.registerTool(
    'traffic_add_negative_all_campaigns',
    {
      description: 'Adiciona negativas em todas as campanhas ativas via CRM.',
      inputSchema: { keywords: z.array(z.string()).min(1), match_type: matchTypeSchema, validate_only: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => safe(async () => {
      const campaigns = (await crmTrafficService.get<AnyRecord[]>('/trafego/campaigns'))
        .map(normalizeCampaign)
        .filter((c) => c.status === 'ENABLED');
      const results = await Promise.all(campaigns.map((campaign) => crmTrafficService.post(`/trafego/campaigns/${campaign.id}/negatives`, {
        scope: 'CAMPAIGN',
        negatives: input.keywords.map((text) => ({ text, match_type: input.match_type })),
        validate_only: input.validate_only,
      })));
      const data = { campaigns_affected: campaigns.length, total_added: campaigns.length * input.keywords.length, results };
      return ok(data, `${data.total_added} negativa(s) enfileirada(s) em ${campaigns.length} campanha(s) ativas.`);
    }),
  );
}

function registerAdTools(server: McpServer) {
  server.registerTool(
    'traffic_list_ads',
    {
      description: 'Lista anuncios de uma campanha a partir dos ad groups do CRM.',
      inputSchema: { campaign_id: campaignIdSchema, ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const adGroups = await crmTrafficService.get<AnyRecord[]>('/trafego/ad-groups', { campaign_id: input.campaign_id });
      const adSets = await Promise.all(adGroups.map((ag) => crmTrafficService.get<AnyRecord[]>(`/trafego/ad-groups/${ag.id}/ads`)));
      const ads = adSets.flat();
      const page = paginate(ads, input.page, input.limit);
      return ok(page, markdownTable(['ID', 'Status', 'Tipo', 'Forca'], page.map((ad) => [ad.id ?? '-', ad.status ?? '-', ad.ad_type ?? ad.type ?? '-', ad.ad_strength ?? '-'])));
    }),
  );

  server.registerTool(
    'traffic_get_ad_strength',
    {
      description: 'Retorna forca de anuncios sincronizados no CRM.',
      inputSchema: { ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const adGroups = await crmTrafficService.get<AnyRecord[]>('/trafego/ad-groups');
      const adSets = await Promise.all(adGroups.map((ag) => crmTrafficService.get<AnyRecord[]>(`/trafego/ad-groups/${ag.id}/ads`)));
      const ads = adSets.flat().map((ad) => ({ id: ad.id, campaign_id: ad.campaign_id, ad_group_id: ad.ad_group_id, ad_strength: ad.ad_strength ?? null }));
      const page = paginate(ads, input.page, input.limit);
      return ok(page, markdownTable(['Ad', 'Ad group', 'Forca'], page.map((ad) => [ad.id ?? '-', ad.ad_group_id ?? '-', ad.ad_strength ?? '-'])));
    }),
  );
}

function registerScheduleTools(server: McpServer) {
  const unavailable = 'O CRM atual ainda nao expoe endpoint HTTP de agendamento de campanha. Em modo CRM, esta acao deve passar por um endpoint dedicado antes de ser automatizada.';
  server.registerTool(
    'traffic_get_schedule',
    {
      description: 'Retorna agendamento de campanha. Requer endpoint de schedule no CRM.',
      inputSchema: { campaign_id: campaignIdSchema },
      annotations: { readOnlyHint: true },
    },
    async () => fail(unavailable),
  );
  server.registerTool(
    'traffic_update_schedule',
    {
      description: 'Atualiza agendamento de campanha. Requer endpoint de schedule no CRM.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        schedule: z.array(z.object({ day: z.string(), start_hour: z.number(), end_hour: z.number(), bid_modifier: z.number().optional() })),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => fail(unavailable),
  );
}

function registerAnalyticsTools(server: McpServer) {
  const groupedUnavailable = 'O CRM atual expoe serie diaria no dashboard, mas ainda nao expoe breakdown HTTP por hora/dia da semana/dispositivo.';
  server.registerTool(
    'traffic_hourly_performance',
    { description: 'Retorna performance por hora. Requer endpoint analitico no CRM.', inputSchema: { campaign_id: z.string().optional(), ...optionalDateRange }, annotations: { readOnlyHint: true } },
    async () => fail(groupedUnavailable),
  );
  server.registerTool(
    'traffic_daily_performance',
    { description: 'Retorna performance por dia da semana. Requer endpoint analitico no CRM.', inputSchema: { campaign_id: z.string().optional(), ...optionalDateRange }, annotations: { readOnlyHint: true } },
    async () => fail(groupedUnavailable),
  );
  server.registerTool(
    'traffic_device_performance',
    { description: 'Retorna performance por dispositivo. Requer endpoint analitico no CRM.', inputSchema: { campaign_id: z.string().optional(), ...optionalDateRange }, annotations: { readOnlyHint: true } },
    async () => fail(groupedUnavailable),
  );
  server.registerTool(
    'traffic_daily_timeseries',
    {
      description: 'Retorna serie temporal diaria a partir do dashboard do CRM.',
      inputSchema: { campaign_id: z.string().optional(), date_from: z.string(), date_to: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (input) => safe(async () => {
      const dashboard = await crmTrafficService.get<AnyRecord>('/trafego/dashboard', dateQuery(input));
      const data = (dashboard.timeseries ?? []).map((d: AnyRecord) => ({
        date: d.date,
        spend: d.spend_brl ?? 0,
        conversions: d.leads ?? 0,
      }));
      return ok(data, markdownTable(['Data', 'Gasto', 'Leads'], data.map((d: AnyRecord) => [dateBr(d.date), money(d.spend), d.conversions])));
    }),
  );
}

function registerAccountTools(server: McpServer) {
  server.registerTool(
    'traffic_account_status',
    {
      description: 'Retorna status geral da conta de trafego usando o CRM.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => safe(async () => {
      const [account, dashboard, campaigns] = await Promise.all([
        crmTrafficService.get<AnyRecord>('/trafego/account'),
        crmTrafficService.get<AnyRecord>('/trafego/dashboard'),
        crmTrafficService.get<AnyRecord[]>('/trafego/campaigns'),
      ]);
      const normalized = campaigns.map(normalizeCampaign);
      const data = {
        account,
        total_campaigns: normalized.length,
        active_campaigns: normalized.filter((c) => c.status === 'ENABLED').length,
        paused_campaigns: normalized.filter((c) => c.status === 'PAUSED').length,
        total_spend_month: dashboard.kpis?.spend_month_brl ?? 0,
        total_conversions_30d: dashboard.timeseries?.reduce((sum: number, d: AnyRecord) => sum + Number(d.leads ?? 0), 0) ?? 0,
      };
      return ok(data, markdownTable(
        ['Conta', 'Campanhas', 'Ativas', 'Pausadas', 'Gasto mes'],
        [[account.account?.customer_id ?? account.account?.account_name ?? '-', data.total_campaigns, data.active_campaigns, data.paused_campaigns, money(data.total_spend_month)]],
      ));
    }),
  );

  server.registerTool(
    'traffic_health_check',
    {
      description: 'Verifica alertas abertos do Gestor de Trafego no CRM.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => safe(async () => {
      const [alerts, dashboard] = await Promise.all([
        crmTrafficService.get<AnyRecord[]>('/trafego/alerts', { status: 'OPEN', limit: 50 }),
        crmTrafficService.get<AnyRecord>('/trafego/dashboard'),
      ]);
      const data = { alerts, dashboard_kpis: dashboard.kpis ?? {} };
      return ok(data, markdownTable(
        ['Severidade', 'Campanha', 'Mensagem'],
        alerts.map((a) => [a.severity ?? '-', a.campaign?.name ?? a.campaign_id ?? '-', a.message ?? a.title ?? '-']),
      ));
    }),
  );
}

async function mutateCampaign(campaignId: string, action: 'pause' | 'resume', reason?: string, validateOnly?: boolean) {
  return safe(async () => {
    const result = await crmTrafficService.post(`/trafego/campaigns/${campaignId}/${action}`, { reason, validate_only: validateOnly });
    const label = action === 'pause' ? 'pausa' : 'reativacao';
    return ok(result, `Solicitacao de ${label} enfileirada no CRM para a campanha ${campaignId}.`);
  });
}

function normalizeCampaign(campaign: AnyRecord) {
  return {
    ...campaign,
    id: String(campaign.id ?? campaign.google_campaign_id ?? campaign.campaign_id ?? ''),
    google_campaign_id: campaign.google_campaign_id ? String(campaign.google_campaign_id) : undefined,
    name: campaign.name ?? '(sem nome)',
    status: campaign.status ?? 'UNKNOWN',
    budget_per_day: Number(campaign.daily_budget_brl ?? campaign.budget_per_day ?? 0),
    channel_type: campaign.channel_type ?? campaign.advertising_channel_type ?? null,
  };
}

function matchesId(entity: AnyRecord, id: string) {
  return String(entity.id) === id || String(entity.google_campaign_id ?? '') === id;
}

function dateQuery(input: { date_from?: string; date_to?: string; date_preset?: any }) {
  const range = resolveDateRange(input);
  return { date_from: range.from, date_to: range.to };
}

async function safe<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error: any) {
    return fail(formatCrmError(error));
  }
}

function formatCrmError(error: any): string {
  const text = String(error?.message ?? error ?? 'erro desconhecido');
  if (text.includes('401') || text.toLowerCase().includes('unauthorized')) {
    return 'Erro de autenticacao com o CRM. Gere um novo token e confira CRM_API_KEY.';
  }
  if (text.includes('403')) {
    return 'Permissao negada pelo CRM. Use um token de usuario com acesso ao modulo Trafego.';
  }
  return `Erro ao consultar o CRM: ${text}`;
}
