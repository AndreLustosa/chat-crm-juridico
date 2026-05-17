import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { crmTrafficService } from '../services/crm.js';
import { campaignIdSchema, matchTypeSchema, optionalDateRange, paginationSchema } from '../schemas/index.js';
import {
  CrmError,
  dateBr,
  fail,
  markdownTable,
  money,
  ok,
  paginate,
  percent,
  resolveDateRange,
} from '../utils/format.js';
import { logger } from '../utils/logger.js';
import {
  GuardRailError,
  checkBudgetChange,
  checkKillSwitch,
  checkRateLimit,
} from '../utils/guard-rails.js';

type AnyRecord = Record<string, any>;

/**
 * Catalogo de tools Fase 1 aprovado em docs/mcp-server/fase-0-descoberta.md §10.1.
 * 29 tools no total: 15 leitura + 14 escrita.
 *
 * Princípios:
 *   - Cada tool mapeia direto pra um endpoint /trafego/* da API NestJS.
 *   - Mutates passam por guard-rails (kill switch, rate limit, budget caps).
 *   - Toda chamada eh logada estruturado: tool, args (PII redacted), duracao, status.
 *   - Erros sao tipados via CrmError -> structuredContent.error.kind.
 */
export function registerCrmTrafficTools(server: McpServer) {
  // Leitura
  registerCampaignReadTools(server);
  registerAdGroupAndKeywordReadTools(server);
  registerSearchTermReadTools(server);
  registerBudgetAndConversionReadTools(server);
  registerHealthReadTools(server);
  registerRecommendationReadTools(server);

  // Escrita
  registerCampaignMutateTools(server);
  registerAdGroupMutateTools(server);
  registerKeywordMutateTools(server);
  registerScheduleMutateTools(server);
  registerCreationTools(server);
  registerRecommendationMutateTools(server);
  registerOpsMutateTools(server);
}

// ─── LEITURA ────────────────────────────────────────────────────────────────

function registerCampaignReadTools(server: McpServer) {
  server.registerTool(
    'traffic_list_accounts',
    {
      description:
        'Lista a(s) conta(s) Google Ads conectadas ao CRM (status de conexao, customer_id, ultima sync).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      safe('traffic_list_accounts', async (toolCallId) => {
        const account = await crmTrafficService.get<AnyRecord>('/trafego/account', undefined, { toolCallId });
        const data = { connected: Boolean(account?.account), account: account?.account ?? null };
        const md = data.connected
          ? markdownTable(
              ['Customer ID', 'Login MCC', 'Conta', 'Status', 'Ultima sync'],
              [[
                data.account.customer_id ?? '-',
                data.account.login_customer_id ?? '-',
                data.account.account_name ?? '-',
                data.account.status ?? '-',
                data.account.last_sync_at ?? 'nunca',
              ]],
            )
          : 'Nenhuma conta Google Ads conectada. Use o painel do CRM em Configuracoes > Trafego pra autorizar via OAuth.';
        return ok(data, md);
      }),
  );

  server.registerTool(
    'traffic_list_campaigns',
    {
      description:
        'Lista campanhas Google Ads do CRM com metricas agregadas da janela. Use days pra controlar a janela (1-90, default 30). include_archived=true pra ver tambem as ocultas/removidas.',
      inputSchema: {
        include_archived: z.boolean().optional().describe('Incluir campanhas arquivadas/removidas'),
        days: z.number().int().min(1).max(90).optional().describe('Janela de metricas em dias (default 30)'),
        status_filter: z.enum(['ENABLED', 'PAUSED', 'ALL']).optional().describe('Filtro de status'),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_campaigns', async (toolCallId) => {
        const campaigns = await crmTrafficService.get<AnyRecord[]>(
          '/trafego/campaigns',
          { include_archived: input.include_archived, days: input.days },
          { toolCallId },
        );
        const filter = input.status_filter ?? 'ALL';
        const filtered = campaigns
          .map(normalizeCampaign)
          .filter((c) => filter === 'ALL' || c.status === filter);
        const page = paginate(filtered, input.page, input.limit);
        return ok(page, markdownTable(
          ['ID', 'Google ID', 'Campanha', 'Status', 'Budget/dia', 'Canal'],
          page.map((c) => [c.id, c.google_campaign_id ?? '-', c.name, c.status, money(c.budget_per_day), c.channel_type ?? '-']),
        ));
      }),
  );

  server.registerTool(
    'traffic_get_dashboard',
    {
      description:
        'KPIs agregados do dashboard de trafego (gasto, CPL, CTR, CPC, top campanhas, serie temporal). Use date_from/date_to OU date_preset.',
      inputSchema: {
        ...optionalDateRange,
        channel_type: z.string().optional().describe('Filtrar por tipo (SEARCH, PERFORMANCE_MAX, etc)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_get_dashboard', async (toolCallId) => {
        const range = resolveDateRange(input);
        const dashboard = await crmTrafficService.get<AnyRecord>(
          '/trafego/dashboard',
          { date_from: range.from, date_to: range.to, channel_type: input.channel_type },
          { toolCallId },
        );
        const kpis = dashboard.kpis ?? {};
        const md = [
          `Periodo: ${dateBr(range.from)} a ${dateBr(range.to)}`,
          markdownTable(
            ['Gasto hoje', 'Gasto mes', 'CPL 7d', 'CTR 7d', 'CPC medio'],
            [[
              money(kpis.spend_today_brl),
              money(kpis.spend_month_brl),
              money(kpis.cpl_brl),
              percent(kpis.ctr),
              money(kpis.avg_cpc_brl),
            ]],
          ),
        ].join('\n');
        return ok(dashboard, md);
      }),
  );

  server.registerTool(
    'traffic_compare_periods',
    {
      description:
        'Compara KPIs do dashboard entre dois periodos (period_a vs period_b). Util pra diagnosticar variacao semana sobre semana ou mes a mes.',
      inputSchema: {
        period_a_from: z.string().describe('Inicio do periodo A (YYYY-MM-DD)'),
        period_a_to: z.string().describe('Fim do periodo A (YYYY-MM-DD)'),
        period_b_from: z.string().describe('Inicio do periodo B (YYYY-MM-DD)'),
        period_b_to: z.string().describe('Fim do periodo B (YYYY-MM-DD)'),
        channel_type: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_compare_periods', async (toolCallId) => {
        const [a, b] = await Promise.all([
          crmTrafficService.get<AnyRecord>('/trafego/dashboard', { date_from: input.period_a_from, date_to: input.period_a_to, channel_type: input.channel_type }, { toolCallId }),
          crmTrafficService.get<AnyRecord>('/trafego/dashboard', { date_from: input.period_b_from, date_to: input.period_b_to, channel_type: input.channel_type }, { toolCallId }),
        ]);
        const data = {
          period_a: { range: { from: input.period_a_from, to: input.period_a_to }, kpis: a.kpis ?? {} },
          period_b: { range: { from: input.period_b_from, to: input.period_b_to }, kpis: b.kpis ?? {} },
          delta: computeKpiDelta(a.kpis ?? {}, b.kpis ?? {}),
        };
        return ok(data, markdownTable(
          ['Metrica', 'A', 'B', 'Delta'],
          [
            ['Gasto hoje', money(a.kpis?.spend_today_brl), money(b.kpis?.spend_today_brl), formatDelta(data.delta.spend_today_brl)],
            ['Gasto mes', money(a.kpis?.spend_month_brl), money(b.kpis?.spend_month_brl), formatDelta(data.delta.spend_month_brl)],
            ['CPL 7d', money(a.kpis?.cpl_brl), money(b.kpis?.cpl_brl), formatDelta(data.delta.cpl_brl)],
            ['CTR 7d', percent(a.kpis?.ctr), percent(b.kpis?.ctr), formatDelta(data.delta.ctr)],
          ],
        ));
      }),
  );

  server.registerTool(
    'traffic_get_account_health_summary',
    {
      description:
        'Visao agregada da saude da conta: status, ultima sync, KPIs da janela, alertas abertos e falhas recentes de sincronizacao. Use isso como primeira leitura ao iniciar uma sessao de gestao.',
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().describe('Janela de KPIs (default 30)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_get_account_health_summary', async (toolCallId) => {
        const days = input.days ?? 30;
        const range = resolveDateRange({ date_preset: days === 7 ? 'LAST_7_DAYS' : days === 30 ? 'LAST_30_DAYS' : undefined, date_from: undefined, date_to: undefined });
        const [account, dashboard, syncLogs, alerts] = await Promise.all([
          crmTrafficService.get<AnyRecord>('/trafego/account', undefined, { toolCallId }),
          crmTrafficService.get<AnyRecord>('/trafego/dashboard', { date_from: range.from, date_to: range.to }, { toolCallId }),
          crmTrafficService.get<AnyRecord[]>('/trafego/sync-logs', { limit: 5 }, { toolCallId }),
          crmTrafficService.get<AnyRecord[]>('/trafego/alerts', { status: 'OPEN', limit: 50 }, { toolCallId }),
        ]);
        const data = {
          connected: Boolean(account?.account),
          account: account?.account ?? null,
          last_sync_at: account?.account?.last_sync_at ?? null,
          last_sync_error: account?.account?.last_error ?? null,
          window_kpis: dashboard.kpis ?? {},
          open_alerts_count: Array.isArray(alerts) ? alerts.length : 0,
          recent_sync_failures: (syncLogs ?? []).filter((s) => s.status === 'ERROR').slice(0, 3),
          recent_sync_logs: syncLogs ?? [],
        };
        const md = [
          `Conta: ${data.connected ? data.account?.customer_id : 'nao conectada'} | Status: ${data.account?.status ?? '-'} | Ultima sync: ${data.last_sync_at ?? 'nunca'}`,
          `Alertas abertos: ${data.open_alerts_count} | Falhas recentes de sync: ${data.recent_sync_failures.length}`,
          data.last_sync_error ? `Erro mais recente: ${String(data.last_sync_error).slice(0, 200)}` : 'Sem erro de sync recente.',
        ].join('\n');
        return ok(data, md);
      }),
  );
}

function registerAdGroupAndKeywordReadTools(server: McpServer) {
  server.registerTool(
    'traffic_list_ad_groups',
    {
      description: 'Lista ad groups da conta. Filtre por campaign_id e/ou status.',
      inputSchema: {
        campaign_id: z.string().optional().describe('ID interno (UUID) ou Google ID da campanha'),
        status: z.string().optional().describe('ENABLED, PAUSED, REMOVED'),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_ad_groups', async (toolCallId) => {
        const adGroups = await crmTrafficService.get<AnyRecord[]>(
          '/trafego/ad-groups',
          { campaign_id: input.campaign_id, status: input.status },
          { toolCallId },
        );
        const page = paginate(adGroups, input.page, input.limit);
        return ok(page, markdownTable(
          ['ID', 'Nome', 'Campanha', 'Status', 'CPC default'],
          page.map((g) => [g.id ?? '-', g.name ?? '-', g.campaign_id ?? '-', g.status ?? '-', g.default_cpc_brl ? money(g.default_cpc_brl) : '-']),
        ));
      }),
  );

  server.registerTool(
    'traffic_list_keywords',
    {
      description:
        'Lista keywords (positivas ou negativas) de um ad group. Use negative=true pra listar apenas negativas.',
      inputSchema: {
        ad_group_id: z.string().describe('ID interno do ad group'),
        negative: z.boolean().optional().describe('true = somente negativas; false = somente positivas; undefined = ambas'),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_keywords', async (toolCallId) => {
        const keywords = await crmTrafficService.get<AnyRecord[]>(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/keywords`,
          { negative: input.negative },
          { toolCallId },
        );
        const page = paginate(keywords, input.page, input.limit);
        return ok(page, markdownTable(
          ['ID', 'Texto', 'Match', 'Status', 'Negativa', 'CPC bid'],
          page.map((k) => [
            k.id ?? '-',
            k.text ?? k.keyword_text ?? '-',
            k.match_type ?? '-',
            k.status ?? '-',
            k.negative ? 'sim' : 'nao',
            k.cpc_bid_brl ? money(k.cpc_bid_brl) : '-',
          ]),
        ));
      }),
  );

  server.registerTool(
    'traffic_list_ads',
    {
      description: 'Lista anuncios de um ad group.',
      inputSchema: {
        ad_group_id: z.string().describe('ID interno do ad group'),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_ads', async (toolCallId) => {
        const ads = await crmTrafficService.get<AnyRecord[]>(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/ads`,
          undefined,
          { toolCallId },
        );
        const page = paginate(ads, input.page, input.limit);
        return ok(page, markdownTable(
          ['ID', 'Tipo', 'Status', 'Forca'],
          page.map((a) => [a.id ?? '-', a.ad_type ?? a.type ?? '-', a.status ?? '-', a.ad_strength ?? '-']),
        ));
      }),
  );
}

function registerSearchTermReadTools(server: McpServer) {
  server.registerTool(
    'traffic_list_search_terms',
    {
      description:
        'Lista termos de busca cacheados (do search_term_view do Google Ads). Filtros opcionais: campaign_id, ad_group_id, gasto minimo, somente sem conversao, busca textual. Defaults retornam piores ofensores.',
      inputSchema: {
        campaign_id: z.string().optional(),
        ad_group_id: z.string().optional(),
        min_spend_brl: z.number().nonnegative().optional().describe('Gasto minimo em BRL'),
        zero_conv_only: z.boolean().optional().describe('Apenas termos com 0 conversao'),
        search: z.string().optional().describe('Busca textual no termo'),
        limit: z.number().int().positive().max(500).optional().describe('Maximo de itens (default 50, max 500)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_search_terms', async (toolCallId) => {
        const items = await crmTrafficService.get<AnyRecord[]>(
          '/trafego/search-terms',
          {
            campaign_id: input.campaign_id,
            ad_group_id: input.ad_group_id,
            min_spend_brl: input.min_spend_brl,
            zero_conv_only: input.zero_conv_only,
            search: input.search,
            limit: input.limit,
          },
          { toolCallId },
        );
        return ok(items, markdownTable(
          ['Termo', 'Match', 'Impr.', 'Cliques', 'Gasto', 'Conv.', 'Status'],
          items.slice(0, 50).map((t) => [
            String(t.search_term ?? t.term ?? '-').slice(0, 60),
            t.match_type ?? '-',
            t.impressions ?? 0,
            t.clicks ?? 0,
            money(t.cost_brl ?? 0),
            t.conversions ?? 0,
            t.status ?? '-',
          ]),
        ));
      }),
  );
}

function registerBudgetAndConversionReadTools(server: McpServer) {
  server.registerTool(
    'traffic_list_budgets',
    {
      description: 'Lista budgets configurados na conta (compartilhados ou individuais).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      safe('traffic_list_budgets', async (toolCallId) => {
        const budgets = await crmTrafficService.get<AnyRecord[]>('/trafego/budgets', undefined, { toolCallId });
        return ok(budgets, markdownTable(
          ['ID', 'Nome', 'Diario', 'Tipo', 'Status'],
          (budgets ?? []).map((b) => [b.id ?? '-', b.name ?? '-', money(b.daily_brl ?? b.amount_brl), b.delivery_method ?? '-', b.status ?? '-']),
        ));
      }),
  );

  server.registerTool(
    'traffic_list_conversion_actions',
    {
      description:
        'Lista as ConversionActions configuradas no Google Ads, com mapeamento atual pra eventos do CRM (lead.created, client.signed, etc).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      safe('traffic_list_conversion_actions', async (toolCallId) => {
        const items = await crmTrafficService.get<AnyRecord[]>('/trafego/conversion-actions', undefined, { toolCallId });
        return ok(items, markdownTable(
          ['ID', 'Nome', 'Categoria', 'Status', 'Mapeamento CRM'],
          (items ?? []).map((c) => [c.id ?? '-', c.name ?? '-', c.category ?? '-', c.status ?? '-', c.crm_event ?? c.mapped_to ?? '-']),
        ));
      }),
  );
}

function registerHealthReadTools(server: McpServer) {
  server.registerTool(
    'traffic_list_alerts',
    {
      description: 'Lista alertas internos do CRM (CPL alto, CTR baixo, falhas de sync). Filtros: status (OPEN, ACKED, RESOLVED), limit.',
      inputSchema: {
        status: z.enum(['OPEN', 'ACKED', 'RESOLVED']).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_alerts', async (toolCallId) => {
        const alerts = await crmTrafficService.get<AnyRecord[]>(
          '/trafego/alerts',
          { status: input.status, limit: input.limit },
          { toolCallId },
        );
        return ok(alerts, markdownTable(
          ['Severidade', 'Tipo', 'Campanha', 'Mensagem', 'Status'],
          (alerts ?? []).map((a) => [a.severity ?? '-', a.alert_type ?? a.kind ?? '-', a.campaign?.name ?? a.campaign_id ?? '-', String(a.message ?? a.title ?? '-').slice(0, 80), a.status ?? '-']),
        ));
      }),
  );

  server.registerTool(
    'traffic_list_sync_logs',
    {
      description: 'Lista logs de sincronizacao com a Google Ads API (Cron 06h e gatilhos manuais). Util pra entender freshness dos dados.',
      inputSchema: {
        limit: z.number().int().positive().max(200).optional().describe('Default 20'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_sync_logs', async (toolCallId) => {
        const logs = await crmTrafficService.get<AnyRecord[]>(
          '/trafego/sync-logs',
          { limit: input.limit },
          { toolCallId },
        );
        return ok(logs, markdownTable(
          ['Quando', 'Trigger', 'Status', 'Duracao (ms)', 'Erro'],
          (logs ?? []).map((l) => [l.started_at ?? '-', l.trigger ?? '-', l.status ?? '-', l.duration_ms ?? '-', String(l.error ?? '').slice(0, 80)]),
        ));
      }),
  );

  server.registerTool(
    'traffic_list_mutate_logs',
    {
      description:
        'Lista o audit trail de TODAS as escritas feitas no Google Ads via CRM. Filtre por initiator pra ver apenas suas proprias acoes (initiator começa com mcp:). Use isso pra revisar o que voce ja fez antes de novas alteracoes.',
      inputSchema: {
        limit: z.number().int().positive().max(200).optional().describe('Default 50, max 200'),
        initiator: z.string().optional().describe('Filtrar por initiator (ex: mcp:cowork:user-id)'),
        status: z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'VALIDATED']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_mutate_logs', async (toolCallId) => {
        const logs = await crmTrafficService.get<AnyRecord[]>(
          '/trafego/mutate-logs',
          { limit: input.limit, initiator: input.initiator, status: input.status },
          { toolCallId },
        );
        return ok(logs, markdownTable(
          ['Quando', 'Operacao', 'Recurso', 'Status', 'Initiator'],
          (logs ?? []).map((l) => [l.created_at ?? '-', `${l.operation ?? '?'}:${l.resource_type ?? '?'}`, l.resource_id ?? '-', l.status ?? '-', l.initiator ?? '-']),
        ));
      }),
  );
}

function registerRecommendationReadTools(server: McpServer) {
  server.registerTool(
    'traffic_list_recommendations',
    {
      description:
        'Lista as recomendacoes do PROPRIO Google Ads (sincronizadas via API). Inclui tipo, impacto estimado, payload. Use como insumo pra decidir o que aplicar ou ignorar.',
      inputSchema: {
        type: z.string().optional().describe('Filtrar por tipo (KEYWORD, CALLOUT_EXTENSION, etc)'),
        // Enum corrigido em 2026-05-17 (BUG #1 reportado pelo agente externo).
        // Backend aceita os 7 status do TrafficRecommendation: PENDING e READY
        // sao as ativas, OAB_BLOCKED tem termo vetado, APPLIED ja foi aplicada,
        // DISMISSED descartada, EXPIRED Google removeu, ERROR falhou ao aplicar.
        // Quando omitido, backend filtra automaticamente as nao-ativas
        // (mostra PENDING+READY+OAB_BLOCKED+ERROR).
        status: z
          .enum(['PENDING', 'READY', 'OAB_BLOCKED', 'APPLIED', 'DISMISSED', 'EXPIRED', 'ERROR'])
          .optional()
          .describe('Default (omitido): mostra apenas as ativas (PENDING+READY+OAB_BLOCKED+ERROR).'),
        limit: z.number().int().positive().max(300).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_recommendations', async (toolCallId) => {
        // Backend retorna { items, counts_by_status } — nao um array plano.
        // Antes o handler chamava .map() em recs direto, falhando com
        // "(recs ?? []).map is not a function". Fix em 2026-05-17 (BUG #1).
        const response = await crmTrafficService.get<{
          items?: AnyRecord[];
          counts_by_status?: Record<string, number>;
        }>(
          '/trafego/recommendations',
          { type: input.type, status: input.status, limit: input.limit },
          { toolCallId },
        );
        const items = Array.isArray(response?.items) ? response.items : [];
        const counts = response?.counts_by_status ?? {};
        const countsLine = Object.entries(counts)
          .map(([s, n]) => `${s}=${n}`)
          .join(' · ') || 'sem dados';
        return ok(
          { items, counts_by_status: counts },
          [
            `Total por status: ${countsLine}`,
            markdownTable(
              ['ID', 'Tipo', 'Campanha', 'Impacto', 'Status'],
              items.map((r) => [
                r.id ?? '-',
                r.recommendation_type ?? r.type ?? '-',
                r.campaign?.name ?? r.campaign_id ?? '-',
                r.impact_text ?? r.estimated_impact ?? '-',
                r.status ?? '-',
              ]),
            ),
          ].join('\n'),
        );
      }),
  );
}

// ─── ESCRITA ─────────────────────────────────────────────────────────────────

function registerCampaignMutateTools(server: McpServer) {
  server.registerTool(
    'traffic_pause_campaign',
    {
      description: 'Pausa uma campanha no Google Ads. Vai pra fila de mutate do CRM com auditoria automatica.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        reason: z.string().optional().describe('Motivo da pausa (vai pro audit log)'),
        validate_only: z.boolean().optional().describe('Dry-run: nao aplica, apenas valida'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_pause_campaign', async (toolCallId) => {
        applyMutateGuards('traffic_pause_campaign');
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/pause`,
          { reason: input.reason, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `Pausa enfileirada para a campanha ${input.campaign_id}.`);
      }),
  );

  server.registerTool(
    'traffic_enable_campaign',
    {
      description: 'Reativa uma campanha pausada. Mesma semantica de pause, com auditoria.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_enable_campaign', async (toolCallId) => {
        applyMutateGuards('traffic_enable_campaign');
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/resume`,
          { reason: input.reason, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `Reativacao enfileirada para a campanha ${input.campaign_id}.`);
      }),
  );

  server.registerTool(
    'traffic_update_campaign_budget',
    {
      description:
        'Altera o budget diario de uma campanha. Sujeito a guard-rails: hard cap MCP_BUDGET_DAILY_HARD_CAP_BRL, delta maximo MCP_BUDGET_CHANGE_MAX_PERCENT, confirmacao explicita acima de MCP_BUDGET_REQUIRE_CONFIRM_PERCENT.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        new_daily_budget_brl: z.number().positive().describe('Novo budget diario em BRL'),
        current_daily_budget_brl: z.number().positive().optional().describe('Budget atual conhecido — usado para validar magnitude do delta. Quando omitido, MCP busca antes.'),
        reason: z.string().optional(),
        confirm: z.boolean().optional().describe('Required quando o delta excede MCP_BUDGET_REQUIRE_CONFIRM_PERCENT'),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_campaign_budget', async (toolCallId) => {
        applyMutateGuards('traffic_update_campaign_budget');

        // Se nao informado o budget atual, busca pra calcular delta com seguranca.
        let current = input.current_daily_budget_brl;
        if (current === undefined) {
          const campaigns = await crmTrafficService.get<AnyRecord[]>('/trafego/campaigns', undefined, { toolCallId });
          const found = campaigns.map(normalizeCampaign).find((c) => matchesId(c, input.campaign_id));
          current = found?.budget_per_day;
        }

        checkBudgetChange({
          toolName: 'traffic_update_campaign_budget',
          currentBrl: current,
          newBrl: input.new_daily_budget_brl,
          confirmed: Boolean(input.confirm),
        });

        const result = await crmTrafficService.patch(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/budget`,
          { new_amount_brl: input.new_daily_budget_brl, reason: input.reason, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `Budget atualizado: ${money(current)} -> ${money(input.new_daily_budget_brl)}.`);
      }),
  );

  server.registerTool(
    'traffic_update_campaign_bidding_strategy',
    {
      description:
        'Altera a estrategia de lance de uma campanha existente. ' +
        'Mudanca derruba a fase de aprendizado do Smart Bidding (7-14 dias) — ' +
        'exige confirm=true quando saindo de Smart Bidding com >=30 conv/30d. ' +
        'TARGET_SPEND eh bloqueado por padrao (depreciada pelo Google). ' +
        'MANUAL_CPC exige confirm. Params condicionais: TARGET_CPA exige ' +
        'target_cpa_brl, TARGET_ROAS exige target_roas, TARGET_IMPRESSION_SHARE ' +
        'exige target_impression_share_pct. Backend retorna warnings quando ' +
        'historico de conversoes esta baixo ou conv actions nao tem valor monetario.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        bidding_strategy: z.enum([
          'MAXIMIZE_CONVERSIONS',
          'MAXIMIZE_CONVERSION_VALUE',
          'TARGET_CPA',
          'TARGET_ROAS',
          'MAXIMIZE_CLICKS',
          'TARGET_IMPRESSION_SHARE',
          'MANUAL_CPC',
          'TARGET_SPEND',
        ]).describe('Nova estrategia. TARGET_SPEND eh bloqueada — use MAXIMIZE_CLICKS.'),
        target_cpa_brl: z
          .number()
          .positive()
          .optional()
          .describe('CPA alvo em BRL. Obrigatorio se bidding_strategy=TARGET_CPA.'),
        target_roas: z
          .number()
          .positive()
          .optional()
          .describe('ROAS alvo multiplicador (4.0 = 400%). Obrigatorio se TARGET_ROAS.'),
        target_impression_share_pct: z
          .number()
          .min(0.01)
          .max(1.0)
          .optional()
          .describe('% alvo de impression share (0.01-1.0). Obrigatorio se TARGET_IMPRESSION_SHARE.'),
        target_impression_share_location: z
          .enum(['ANYWHERE_ON_PAGE', 'TOP_OF_PAGE', 'ABSOLUTE_TOP_OF_PAGE'])
          .optional()
          .describe('Default ANYWHERE_ON_PAGE quando TARGET_IMPRESSION_SHARE.'),
        max_cpc_bid_ceiling_brl: z
          .number()
          .positive()
          .optional()
          .describe('Teto de CPC opcional pra TARGET_CPA/TARGET_ROAS/TARGET_IMPRESSION_SHARE.'),
        confirm: z
          .boolean()
          .optional()
          .describe(
            'Required em: MANUAL_CPC, saida de Smart Bidding com >=30 conv/30d, target_cpa_brl<0.5, target_roas>50.',
          ),
        reason: z.string().optional().describe('Motivo da mudanca (vai pro audit log)'),
        validate_only: z.boolean().optional().describe('Dry-run: retorna preview + warnings sem aplicar.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_campaign_bidding_strategy', async (toolCallId) => {
        applyMutateGuards('traffic_update_campaign_bidding_strategy');

        // Backend faz: resolve campaign (UUID ou google_id) + 9 validacoes +
        // warnings + enqueue. Tool aqui eh thin client — repassa tudo.
        const result = await crmTrafficService.patch<{
          ok?: boolean;
          validate_only?: boolean;
          message?: string;
          mutate_log_id?: string;
          warnings?: string[];
          preview?: {
            from?: string | null;
            to?: string;
            campaign_name?: string;
            learning_period_days_estimate?: number;
          };
        }>(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/bidding-strategy`,
          {
            bidding_strategy: input.bidding_strategy,
            target_cpa_brl: input.target_cpa_brl,
            target_roas: input.target_roas,
            target_impression_share_pct: input.target_impression_share_pct,
            target_impression_share_location: input.target_impression_share_location,
            max_cpc_bid_ceiling_brl: input.max_cpc_bid_ceiling_brl,
            confirm: input.confirm,
            reason: input.reason,
            validate_only: input.validate_only,
          },
          { toolCallId },
        );

        const preview = result?.preview ?? {};
        const lines: string[] = [];
        if (input.validate_only) {
          lines.push(`DRY-RUN: ${preview.from ?? '?'} -> ${preview.to ?? input.bidding_strategy}.`);
        } else {
          lines.push(
            `Mudanca de estrategia enfileirada para "${preview.campaign_name ?? input.campaign_id}": ${preview.from ?? '?'} -> ${preview.to ?? input.bidding_strategy}.`,
          );
        }
        if (preview.learning_period_days_estimate != null) {
          lines.push(`Learning period estimado: ${preview.learning_period_days_estimate} dia(s).`);
        }
        if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
          lines.push('Avisos:');
          for (const w of result.warnings) lines.push(`  - ${w}`);
        }
        return ok(result, lines.join('\n'));
      }),
  );
}

function registerAdGroupMutateTools(server: McpServer) {
  server.registerTool(
    'traffic_pause_ad_group',
    {
      description: 'Pausa um ad group inteiro.',
      inputSchema: {
        ad_group_id: z.string(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_pause_ad_group', async (toolCallId) => {
        applyMutateGuards('traffic_pause_ad_group');
        const result = await crmTrafficService.post(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/pause`,
          { reason: input.reason, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `Pausa enfileirada para ad group ${input.ad_group_id}.`);
      }),
  );

  server.registerTool(
    'traffic_enable_ad_group',
    {
      description: 'Reativa um ad group.',
      inputSchema: {
        ad_group_id: z.string(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_enable_ad_group', async (toolCallId) => {
        applyMutateGuards('traffic_enable_ad_group');
        const result = await crmTrafficService.post(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/resume`,
          { reason: input.reason, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `Reativacao enfileirada para ad group ${input.ad_group_id}.`);
      }),
  );
}

function registerKeywordMutateTools(server: McpServer) {
  server.registerTool(
    'traffic_add_keywords',
    {
      description:
        'Adiciona keywords positivas em um ad group. Validacao OAB roda automaticamente no CRM — termos vetados abortam o batch inteiro.',
      inputSchema: {
        ad_group_id: z.string(),
        keywords: z.array(z.object({
          text: z.string().min(1).max(80),
          match_type: matchTypeSchema,
          cpc_bid_brl: z.number().positive().optional(),
        })).min(1).max(50),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_add_keywords', async (toolCallId) => {
        applyMutateGuards('traffic_add_keywords');
        const result = await crmTrafficService.post(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/keywords`,
          { keywords: input.keywords, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `${input.keywords.length} keyword(s) enfileirada(s) no ad group ${input.ad_group_id}.`);
      }),
  );

  server.registerTool(
    'traffic_add_negative_to_campaign',
    {
      description: 'Adiciona keywords negativas no nivel de CAMPANHA (afetam todos os ad groups).',
      inputSchema: {
        campaign_id: campaignIdSchema,
        keywords: z.array(z.string().min(1).max(80)).min(1).max(50),
        match_type: matchTypeSchema,
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_add_negative_to_campaign', async (toolCallId) => {
        applyMutateGuards('traffic_add_negative_to_campaign');
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/negatives`,
          {
            scope: 'CAMPAIGN',
            negatives: input.keywords.map((text) => ({ text, match_type: input.match_type })),
            validate_only: input.validate_only,
          },
          { toolCallId },
        );
        return ok(result, `${input.keywords.length} negativa(s) enfileirada(s) na campanha ${input.campaign_id}.`);
      }),
  );

  server.registerTool(
    'traffic_add_negative_to_ad_group',
    {
      description: 'Adiciona keywords negativas no nivel de AD GROUP (afeta apenas um grupo).',
      inputSchema: {
        ad_group_id: z.string(),
        keywords: z.array(z.string().min(1).max(80)).min(1).max(50),
        match_type: matchTypeSchema,
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_add_negative_to_ad_group', async (toolCallId) => {
        applyMutateGuards('traffic_add_negative_to_ad_group');
        const result = await crmTrafficService.post(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/negatives`,
          {
            scope: 'AD_GROUP',
            negatives: input.keywords.map((text) => ({ text, match_type: input.match_type })),
            validate_only: input.validate_only,
          },
          { toolCallId },
        );
        return ok(result, `${input.keywords.length} negativa(s) enfileirada(s) no ad group ${input.ad_group_id}.`);
      }),
  );

  server.registerTool(
    'traffic_remove_keyword',
    {
      description:
        'Remove uma keyword (positiva ou negativa) pelo ID interno. Acao DESTRUTIVA — Google nao reconcilia automaticamente; reverter exige re-adicionar.',
      inputSchema: {
        keyword_id: z.string(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_remove_keyword', async (toolCallId) => {
        applyMutateGuards('traffic_remove_keyword');
        const result = await crmTrafficService.delete(
          `/trafego/keywords/${encodeURIComponent(input.keyword_id)}`,
          { reason: input.reason, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `Remocao da keyword ${input.keyword_id} enfileirada.`);
      }),
  );
}

function registerScheduleMutateTools(server: McpServer) {
  server.registerTool(
    'traffic_update_schedule',
    {
      description:
        'Atualiza o agendamento (ad schedule) de uma campanha. Permite definir janelas de exibicao por dia/hora com bid modifier. Substituicao completa — envie todos os slots desejados (vazio = roda 24/7).',
      inputSchema: {
        campaign_id: campaignIdSchema,
        schedule: z
          .array(
            z.object({
              day_of_week: z.enum([
                'MONDAY',
                'TUESDAY',
                'WEDNESDAY',
                'THURSDAY',
                'FRIDAY',
                'SATURDAY',
                'SUNDAY',
              ]),
              start_hour: z.number().int().min(0).max(23),
              start_minute: z
                .union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)])
                .optional()
                .describe('Minutos do inicio (0|15|30|45). Default 0.'),
              end_hour: z.number().int().min(0).max(24),
              end_minute: z
                .union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)])
                .optional()
                .describe('Minutos do fim (0|15|30|45). Default 0.'),
              bid_modifier: z
                .number()
                .min(0.1)
                .max(10)
                .optional()
                .describe(
                  'Multiplicador do bid 0.1..10.0 (1.0 = neutro, 0.8 = -20%, 1.2 = +20%)',
                ),
            }),
          )
          .min(0)
          .max(168),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_schedule', async (toolCallId) => {
        applyMutateGuards('traffic_update_schedule');
        // CRM espera o campo no formato `slots` (nao `schedule`) e cada
        // item precisa ter start_minute/end_minute obrigatorios. Esta
        // camada normaliza: aceita o que o Claude mandou e completa
        // minutes=0 quando ausente. Achado durante uso real em 2026-05-16.
        const slots = input.schedule.map((s) => ({
          day_of_week: s.day_of_week,
          start_hour: s.start_hour,
          start_minute: s.start_minute ?? 0,
          end_hour: s.end_hour,
          end_minute: s.end_minute ?? 0,
          ...(s.bid_modifier !== undefined && { bid_modifier: s.bid_modifier }),
        }));
        const result = await crmTrafficService.put(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/schedule`,
          { slots, validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(
          result,
          `Agendamento atualizado para a campanha ${input.campaign_id} (${slots.length} janela${slots.length === 1 ? '' : 's'}).`,
        );
      }),
  );
}

function registerCreationTools(server: McpServer) {
  server.registerTool(
    'traffic_create_search_campaign',
    {
      description:
        'Cria uma nova campanha SEARCH. Default PAUSED — voce precisa chamar traffic_enable_campaign explicitamente. Inclui budget, geo targets e linguagens.',
      inputSchema: {
        name: z.string().min(3).max(120),
        daily_budget_brl: z.number().positive(),
        bidding_strategy: z.enum(['MAXIMIZE_CONVERSIONS', 'TARGET_CPA', 'MAXIMIZE_CLICKS', 'TARGET_IMPRESSION_SHARE']),
        target_cpa_brl: z.number().positive().optional().describe('Obrigatorio se bidding_strategy=TARGET_CPA'),
        geo_targets: z.array(z.string()).optional().describe('Codigos de geo target Google (ex: 1031793 para Maceio/AL)'),
        language_codes: z.array(z.string()).optional().describe('Codigos de lingua (ex: 1014 = portugues)'),
        confirm: z.boolean().optional().describe('Required — criacao de campanha exige confirmacao explicita'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_search_campaign', async (toolCallId) => {
        applyMutateGuards('traffic_create_search_campaign');
        if (!input.confirm) {
          throw new GuardRailError({
            rule: 'requires_confirmation',
            message: 'Criar campanha exige confirm=true. Re-envie com confirm=true se a configuracao estiver correta.',
            details: { tool: 'traffic_create_search_campaign' },
          });
        }
        checkBudgetChange({
          toolName: 'traffic_create_search_campaign',
          currentBrl: undefined,
          newBrl: input.daily_budget_brl,
          confirmed: true,
        });
        if (input.bidding_strategy === 'TARGET_CPA' && input.target_cpa_brl === undefined) {
          throw new GuardRailError({
            rule: 'requires_confirmation',
            message: 'bidding_strategy=TARGET_CPA exige target_cpa_brl.',
            details: { tool: 'traffic_create_search_campaign' },
          });
        }
        const result = await crmTrafficService.post(
          '/trafego/campaigns',
          {
            name: input.name,
            daily_budget_brl: input.daily_budget_brl,
            bidding_strategy: input.bidding_strategy,
            target_cpa_brl: input.target_cpa_brl,
            geo_targets: input.geo_targets,
            language_codes: input.language_codes,
          },
          { toolCallId },
        );
        return ok(result, `Campanha "${input.name}" enfileirada (PAUSED). Use traffic_enable_campaign apos revisar.`);
      }),
  );

  server.registerTool(
    'traffic_create_rsa',
    {
      description:
        'Cria um Responsive Search Ad (RSA) num ad group. Validacao OAB roda automaticamente no CRM — qualquer headline/description com termo vetado aborta o batch.',
      inputSchema: {
        ad_group_id: z.string(),
        headlines: z.array(z.string().min(1).max(30)).min(3).max(15).describe('3 a 15 headlines, max 30 chars cada'),
        descriptions: z.array(z.string().min(1).max(90)).min(2).max(4).describe('2 a 4 descriptions, max 90 chars cada'),
        final_urls: z.array(z.string().url()).min(1).max(10),
        path1: z.string().max(15).optional(),
        path2: z.string().max(15).optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_rsa', async (toolCallId) => {
        applyMutateGuards('traffic_create_rsa');
        const result = await crmTrafficService.post(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/ads/rsa`,
          {
            headlines: input.headlines,
            descriptions: input.descriptions,
            final_urls: input.final_urls,
            path1: input.path1,
            path2: input.path2,
            validate_only: input.validate_only,
          },
          { toolCallId },
        );
        return ok(result, `RSA enfileirado no ad group ${input.ad_group_id} (${input.headlines.length} headlines, ${input.descriptions.length} descriptions).`);
      }),
  );
}

function registerRecommendationMutateTools(server: McpServer) {
  server.registerTool(
    'traffic_apply_recommendation',
    {
      description:
        'Aplica uma recomendacao do Google Ads (id obtido de traffic_list_recommendations). Acao destrutiva conforme tipo da recomendacao.',
      inputSchema: {
        recommendation_id: z.string(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_apply_recommendation', async (toolCallId) => {
        applyMutateGuards('traffic_apply_recommendation');
        const result = await crmTrafficService.post(
          `/trafego/recommendations/${encodeURIComponent(input.recommendation_id)}/apply`,
          { validate_only: input.validate_only },
          { toolCallId },
        );
        return ok(result, `Recomendacao ${input.recommendation_id} enfileirada para aplicacao.`);
      }),
  );
}

function registerOpsMutateTools(server: McpServer) {
  server.registerTool(
    'traffic_trigger_sync',
    {
      description:
        'Forca um sync da Google Ads API agora. Use antes de uma analise quando suspeita que os dados estao defasados (ultima sync ha muitas horas). NAO conta para o rate limit de mutate de campanhas — eh apenas refresh de leitura.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () =>
      safe('traffic_trigger_sync', async (toolCallId) => {
        // Nao aplica budget/rate caps — eh refresh, nao mutate de campanha.
        // Mas honra kill-switch global.
        checkKillSwitch('traffic_trigger_sync');
        const result = await crmTrafficService.post('/trafego/sync', undefined, { toolCallId });
        return ok(result, 'Sync enfileirado. Os dados aparecerao em alguns minutos.');
      }),
  );
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Wrapper unificado pra toda tool: aplica logging, gera tool_call_id pra
 * correlacao em logs, mapeia erros pra structured response e bloqueia
 * propagacao de stack trace pro Claude.
 */
async function safe<T>(
  toolName: string,
  fn: (toolCallId: string) => Promise<{ content: any; structuredContent?: any; isError?: boolean }>,
): Promise<{ content: any; structuredContent?: any; isError?: boolean }> {
  const toolCallId = `tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  logger.info('tool_call_start', { tool: toolName, tool_call_id: toolCallId });
  try {
    const result = await fn(toolCallId);
    logger.info('tool_call_end', {
      tool: toolName,
      tool_call_id: toolCallId,
      duration_ms: Date.now() - startedAt,
      status: result.isError ? 'tool_error' : 'ok',
    });
    return result;
  } catch (error: any) {
    const errInfo = errorInfo(error);
    logger.error('tool_call_end', {
      tool: toolName,
      tool_call_id: toolCallId,
      duration_ms: Date.now() - startedAt,
      status: 'exception',
      error_kind: errInfo.kind,
      error_message: errInfo.message.slice(0, 500),
    });
    return fail(errInfo.message, errInfo.kind, errInfo.details);
  }
}

function errorInfo(error: any): { kind: import('../utils/format.js').ErrorKind; message: string; details?: Record<string, unknown> } {
  if (error instanceof GuardRailError) {
    return {
      kind: 'guard_rail',
      message: error.violation.message,
      details: { rule: error.violation.rule, ...(error.violation.details ?? {}) },
    };
  }
  if (error instanceof CrmError) {
    return { kind: error.kind, message: error.message, details: error.details };
  }
  return {
    kind: 'unknown',
    message: String(error?.message ?? error ?? 'erro desconhecido').slice(0, 800),
  };
}

function applyMutateGuards(toolName: string): void {
  checkKillSwitch(toolName);
  checkRateLimit(toolName);
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

function matchesId(entity: AnyRecord, id: string): boolean {
  return String(entity.id) === id || String(entity.google_campaign_id ?? '') === id;
}

function computeKpiDelta(a: AnyRecord, b: AnyRecord): Record<string, { abs: number; pct: number | null }> {
  const keys = ['spend_today_brl', 'spend_month_brl', 'cpl_brl', 'ctr', 'avg_cpc_brl'];
  const delta: Record<string, { abs: number; pct: number | null }> = {};
  for (const k of keys) {
    const aV = Number(a?.[k] ?? 0);
    const bV = Number(b?.[k] ?? 0);
    const abs = bV - aV;
    delta[k] = {
      abs,
      pct: aV !== 0 ? (abs / aV) * 100 : null,
    };
  }
  return delta;
}

function formatDelta(d: { abs: number; pct: number | null } | undefined): string {
  if (!d) return '-';
  const pctText = d.pct === null ? 'n/a' : `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%`;
  return `${pctText} (${d.abs >= 0 ? '+' : ''}${d.abs.toFixed(2)})`;
}
