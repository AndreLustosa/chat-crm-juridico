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
  // Sprint 1 backlog (2026-05-17): Conversion Actions, Ad Groups, RSAs
  registerSprint1Tools(server);
  // Sprint 2 backlog (2026-05-17): Extensions/Assets + Quality Score
  registerSprint2Tools(server);
  // Sprint 3 backlog (2026-05-17): Targeting + Bulk + Recommendations dismiss
  registerSprint3Tools(server);
  // Sprint 4 backlog (2026-05-17): Tier P2 (PMax + reads + oauth)
  registerSprint4Tools(server);
  // Sprint 3.1 backlog (2026-05-17): Shared library + Location bid
  registerSprint3_1Tools(server);
  // Sprint 4.1 backlog (2026-05-17): PMax asset groups + Experiments
  registerSprint4_1Tools(server);
  // Sprint 4.2 backlog (2026-05-17): Experiments lifecycle completo
  registerSprint4_2Tools(server);
  // Bug-fix batch (2026-05-17): cleanup asset orfaos
  registerBugFixBatchTools(server);
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
        'Lista campanhas Google Ads do CRM com metricas agregadas da janela. Use days pra controlar a janela (1-90, default 30). include_archived=true pra ver tambem as ocultas/removidas. ' +
        'Cada campanha vem com `ad_schedule` resumido — { is_24_7, summary ("Seg-Sex 08:00-18:00" ou "24/7" etc), slots_count, has_custom_bid_modifiers, slots[] } — ' +
        'sem precisar chamada extra. Pra detalhe completo + history use traffic_get_schedule.',
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
          ['ID', 'Google ID', 'Campanha', 'Status', 'Budget/dia', 'Canal', 'Schedule'],
          page.map((c) => [
            c.id,
            c.google_campaign_id ?? '-',
            c.name,
            c.status,
            money(c.budget_per_day),
            c.channel_type ?? '-',
            (c as any).ad_schedule?.summary ?? '-',
          ]),
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
    'traffic_remove_campaign',
    {
      description:
        'Remove (soft-delete) uma campanha no Google Ads. Operacao irreversivel pela UI normal — ' +
        'a campanha sai das listagens default mas continua no historico (acessivel via include_archived=true). ' +
        'Remove em cascata: ad groups, ads, keywords, extensions vao junto. ' +
        'EXIGE confirm=true e reason (min 3 chars) sempre. ' +
        'Bloqueia remocao de campanhas ENABLED sem force_if_enabled=true (salvaguarda — pause primeiro). ' +
        'Bloqueia remocao de campanhas com historico relevante (>=10 conv lifetime, >=R$500 gastos, ' +
        'OU ativa nos ultimos 7d) sem confirm_with_history=true. ' +
        'NAO usa para apenas pausar — use traffic_pause_campaign.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        confirm: z
          .boolean()
          .describe('OBRIGATORIO. Sempre exige true. Operacao irreversivel pela UI.'),
        reason: z
          .string()
          .min(3)
          .describe('OBRIGATORIO. Justificativa da remocao (vai pro audit log permanente, min 3 chars).'),
        force_if_enabled: z
          .boolean()
          .optional()
          .describe('Required se a campanha esta ENABLED no momento. Caso false (default), tool exige pausar primeiro como salvaguarda.'),
        confirm_with_history: z
          .boolean()
          .optional()
          .describe('Required quando a campanha tem historico relevante (>=10 conv lifetime, >=R$500 gastos, OU esteve ENABLED nos ultimos 7d).'),
        validate_only: z
          .boolean()
          .optional()
          .describe('Dry-run: retorna preview do cascade (ad_groups, ads, keywords afetados) sem aplicar.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_remove_campaign', async (toolCallId) => {
        applyMutateGuards('traffic_remove_campaign');

        const result = await crmTrafficService.post<{
          ok?: boolean;
          validate_only?: boolean;
          message?: string;
          mutate_log_id?: string;
          warnings?: string[];
          preview?: {
            campaign_name?: string;
            campaign_id_local?: string;
            google_campaign_id?: string;
            current_status?: string;
            lifetime_conversions?: number;
            lifetime_spend_brl?: number;
            enabled_recently?: boolean;
            cascade?: {
              ad_groups?: number;
              ads?: number;
              keywords?: number;
              negative_keywords?: number;
            };
          };
        }>(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/remove`,
          {
            confirm: input.confirm,
            reason: input.reason,
            force_if_enabled: input.force_if_enabled,
            confirm_with_history: input.confirm_with_history,
            validate_only: input.validate_only,
          },
          { toolCallId },
        );

        const preview = result?.preview ?? {};
        const cascade = preview.cascade ?? {};
        const lines: string[] = [];
        if (input.validate_only) {
          lines.push(
            `DRY-RUN: Remocao validada para campanha "${preview.campaign_name ?? input.campaign_id}".`,
          );
        } else {
          lines.push(
            `Remocao enfileirada para campanha "${preview.campaign_name ?? input.campaign_id}". AVISO: operacao nao pode ser revertida pela UI normal.`,
          );
        }
        lines.push(
          `Cascade: ${cascade.ad_groups ?? 0} ad_groups, ${cascade.ads ?? 0} ads, ${cascade.keywords ?? 0} keywords positivas, ${cascade.negative_keywords ?? 0} negativas.`,
        );
        if (preview.lifetime_conversions != null && preview.lifetime_conversions > 0) {
          lines.push(
            `Historico: ${preview.lifetime_conversions.toFixed(1)} conv lifetime, R$ ${(preview.lifetime_spend_brl ?? 0).toFixed(2)} gastos.`,
          );
        }
        if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
          lines.push('Avisos:');
          for (const w of result.warnings) lines.push(`  - ${w}`);
        }
        return ok(result, lines.join('\n'));
      }),
  );

  server.registerTool(
    'traffic_remove_ad_group',
    {
      description:
        'Remove (soft-delete) um ad_group no Google Ads. Mesmo padrao de traffic_remove_campaign ' +
        'mas em sub-recurso. Remove em cascata: ads + keywords (positivas e negativas) do grupo. ' +
        'EXIGE confirm=true e reason (min 3 chars). Bloqueia se status=ENABLED sem force_if_enabled=true. ' +
        'BLOQUEIA se for o UNICO ad group ativo da campanha (sem isso a campanha fica orfã, sem onde servir) — ' +
        'nesse caso considere pausar ou usar traffic_remove_campaign.',
      inputSchema: {
        ad_group_id: z
          .string()
          .describe('UUID interno do CRM OU google_ad_group_id numerico. Ambos aceitos.'),
        confirm: z.boolean().describe('OBRIGATORIO. Sempre exige true.'),
        reason: z.string().min(3).describe('OBRIGATORIO. Min 3 chars.'),
        force_if_enabled: z
          .boolean()
          .optional()
          .describe('Required se o ad_group esta ENABLED no momento.'),
        validate_only: z.boolean().optional().describe('Dry-run.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_remove_ad_group', async (toolCallId) => {
        applyMutateGuards('traffic_remove_ad_group');

        const result = await crmTrafficService.post<{
          ok?: boolean;
          validate_only?: boolean;
          message?: string;
          mutate_log_id?: string;
          warnings?: string[];
          preview?: {
            ad_group_name?: string;
            ad_group_id_local?: string;
            google_ad_group_id?: string;
            campaign_id_local?: string;
            current_status?: string;
            is_only_active?: boolean;
            cascade?: {
              ads?: number;
              keywords?: number;
              negative_keywords?: number;
            };
          };
        }>(
          `/trafego/ad-groups/${encodeURIComponent(input.ad_group_id)}/remove`,
          {
            confirm: input.confirm,
            reason: input.reason,
            force_if_enabled: input.force_if_enabled,
            validate_only: input.validate_only,
          },
          { toolCallId },
        );

        const preview = result?.preview ?? {};
        const cascade = preview.cascade ?? {};
        const lines: string[] = [];
        if (input.validate_only) {
          lines.push(
            `DRY-RUN: Remocao validada para ad_group "${preview.ad_group_name ?? input.ad_group_id}".`,
          );
        } else {
          lines.push(
            `Remocao enfileirada para ad_group "${preview.ad_group_name ?? input.ad_group_id}".`,
          );
        }
        lines.push(
          `Cascade: ${cascade.ads ?? 0} ads, ${cascade.keywords ?? 0} keywords positivas, ${cascade.negative_keywords ?? 0} negativas.`,
        );
        if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
          lines.push('Avisos:');
          for (const w of result.warnings) lines.push(`  - ${w}`);
        }
        return ok(result, lines.join('\n'));
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
  // ─── Schedule reads (companion to traffic_update_schedule) ─────────────
  server.registerTool(
    'traffic_get_schedule',
    {
      description:
        'Retorna o ad schedule completo (dayparting) de uma campanha — slots configurados por dia/hora com bid modifiers, ' +
        'resumo humanizado em PT-BR (ex: "Seg-Sex 08:00-18:00" ou "24/7"), indicação de 24/7, timezone da conta, ' +
        'e warnings de freshness (se a ultima sync foi >24h atras). ' +
        'Use ANTES de chamar traffic_update_schedule — como update faz substituicao COMPLETA dos slots, sem leitura previa ' +
        'voce arrisca apagar slots sem querer. ' +
        'include_history=true anexa as ultimas 10 mutacoes de schedule via TrafficMutateLog (initiator, status, changed_at). ' +
        'campaign_id aceita UUID interno OU google_campaign_id numerico.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        include_history: z
          .boolean()
          .optional()
          .describe('Inclui ultimas 10 mutacoes do schedule (audit trail).'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_get_schedule', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          campaign_id_local: string;
          google_campaign_id: string | null;
          campaign_name: string;
          campaign_status: string;
          time_zone: string | null;
          is_24_7: boolean;
          summary: string;
          slots_count: number;
          has_custom_bid_modifiers: boolean;
          slots: any[];
          warnings?: string[];
          history?: any[];
        }>(
          `/trafego/campaigns/${encodeURIComponent(input.campaign_id)}/schedule`,
          input.include_history ? { include_history: 'true' } : undefined,
          { toolCallId },
        );
        const lines: string[] = [];
        lines.push(
          `Campanha "${result.campaign_name}" (status: ${result.campaign_status}, tz: ${result.time_zone ?? '-'})`,
        );
        lines.push(`Schedule: ${result.summary}`);
        if (result.slots_count > 0) {
          lines.push(`${result.slots_count} slots configurados.`);
        }
        if (result.warnings && result.warnings.length > 0) {
          lines.push(`Avisos: ${result.warnings.join(' | ')}`);
        }
        if (result.history && result.history.length > 0) {
          lines.push(
            `Ultimas ${result.history.length} mutacoes — mais recente: ${result.history[0]?.changed_at} por ${result.history[0]?.initiator}`,
          );
        }
        return ok(result, lines.join('\n'));
      }),
  );

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

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 1 backlog (2026-05-17) — 9 tools novas
// ═══════════════════════════════════════════════════════════════════════════

const conversionActionIdSchema = z
  .string()
  .describe('UUID interno do CRM OR google_conversion_id. Ambos aceitos.');

const adGroupIdSchemaSprint1 = z
  .string()
  .describe('UUID interno do CRM OR google_ad_group_id. Ambos aceitos.');

const adIdSchema = z
  .string()
  .describe('UUID interno do CRM OR google_ad_id. Ambos aceitos.');

function registerSprint1Tools(server: McpServer) {
  // ─── Conversion Actions ─────────────────────────────────────────────────
  server.registerTool(
    'traffic_create_conversion_action',
    {
      description:
        'Cria uma ConversionAction nova no Google Ads. Categoria + tipo definem o comportamento. ' +
        'include_in_conversions=true (default): entra no Smart Bidding. ' +
        'default_value_brl: valor monetario default por evento (importante pra TARGET_ROAS). ' +
        'phone_call_duration_seconds: so PHONE_CALL_LEAD type — conta conversao apos X seg.',
      inputSchema: {
        name: z.string().max(100),
        category: z.enum([
          'SUBMIT_LEAD_FORM',
          'CONTACT',
          'PHONE_CALL_LEAD',
          'SIGNUP',
          'DOWNLOAD',
          'PAGE_VIEW',
          'PURCHASE',
          'ADD_TO_CART',
          'BEGIN_CHECKOUT',
          'BOOK_APPOINTMENT',
          'REQUEST_QUOTE',
          'GET_DIRECTIONS',
          'OUTBOUND_CLICK',
          'ENGAGEMENT',
          'QUALIFIED_LEAD',
          'CONVERTED_LEAD',
          'OTHER',
        ]),
        type: z.enum([
          'WEBPAGE',
          'AD_CALL',
          'CLICK_TO_CALL',
          'WEBSITE_CALL',
          'UPLOAD_CALLS',
          'UPLOAD_CLICKS',
          'GOOGLE_HOSTED',
        ]),
        include_in_conversions: z.boolean().optional(),
        default_value_brl: z.number().positive().optional(),
        counting_type: z.enum(['ONE_PER_CLICK', 'MANY_PER_CLICK']).optional(),
        click_through_lookback_days: z.number().int().min(1).max(90).optional(),
        view_through_lookback_days: z.number().int().min(1).max(30).optional(),
        phone_call_duration_seconds: z.number().int().min(0).max(3600).optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_conversion_action', async (toolCallId) => {
        applyMutateGuards('traffic_create_conversion_action');
        const result = await crmTrafficService.post(
          '/trafego/conversion-actions',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Criacao de ConversionAction "${input.name}" enfileirada (${input.category} / ${input.type}).`,
        );
      }),
  );

  server.registerTool(
    'traffic_update_conversion_action',
    {
      description:
        'Atualiza ConversionAction existente. Patch parcial — so envia o que muda. ' +
        'CRITICAL: alterar include_in_conversions em acao com volume reseta aprendizado do Smart Bidding. ' +
        'confirm=true exigido quando muda include_in_conversions ou attribution_model.',
      inputSchema: {
        conversion_action_id: conversionActionIdSchema,
        name: z.string().optional(),
        include_in_conversions: z.boolean().optional(),
        primary_for_goal: z.boolean().optional(),
        default_value_brl: z.number().min(0).optional(),
        always_use_default_value: z.boolean().optional(),
        attribution_model: z
          .enum([
            'LAST_CLICK',
            'DATA_DRIVEN',
            'FIRST_CLICK',
            'LINEAR',
            'TIME_DECAY',
            'POSITION_BASED',
          ])
          .optional(),
        click_through_lookback_days: z.number().int().min(1).max(90).optional(),
        view_through_lookback_days: z.number().int().min(1).max(30).optional(),
        counting_type: z.enum(['ONE_PER_CLICK', 'MANY_PER_CLICK']).optional(),
        status: z.enum(['ENABLED', 'HIDDEN']).optional(),
        confirm: z.boolean().optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_conversion_action', async (toolCallId) => {
        applyMutateGuards('traffic_update_conversion_action');
        const { conversion_action_id, ...body } = input;
        const result = await crmTrafficService.patch(
          `/trafego/conversion-actions/${encodeURIComponent(conversion_action_id)}`,
          body,
          { toolCallId },
        );
        return ok(
          result,
          `Atualizacao de ConversionAction ${conversion_action_id} enfileirada.`,
        );
      }),
  );

  server.registerTool(
    'traffic_remove_conversion_action',
    {
      description:
        'Remove (soft-delete) uma ConversionAction. Status=REMOVED. Exige confirm + reason. ' +
        'force_if_used=true necessario se conv action esta em uso por bidding strategy ativa.',
      inputSchema: {
        conversion_action_id: conversionActionIdSchema,
        confirm: z.boolean(),
        reason: z.string().min(3),
        force_if_used: z.boolean().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_remove_conversion_action', async (toolCallId) => {
        applyMutateGuards('traffic_remove_conversion_action');
        const { conversion_action_id, ...body } = input;
        const result = await crmTrafficService.post(
          `/trafego/conversion-actions/${encodeURIComponent(conversion_action_id)}/remove`,
          body,
          { toolCallId },
        );
        // O endpoint REST eh DELETE no controller atual; mas usei POST pra
        // ter body com confirm — entao tem que adicionar DELETE com body OK.
        // Fallback: chamada por DELETE com body via _method override.
        return ok(
          result,
          `Remocao de ConversionAction ${conversion_action_id} enfileirada.`,
        );
      }),
  );

  server.registerTool(
    'traffic_trigger_enhanced_conv_upload',
    {
      description:
        'Trigger manual do cron diario de upload Enhanced Conversions for Leads. ' +
        'So funciona se traffic_enable_enhanced_conversions_for_leads ja foi rodado com mode=API ou BOTH. ' +
        'Processa leads dos ultimos days_back dias (default 14, max 90) — pra cada lead com email/phone, ' +
        'sobe userIdentifiers (hashed SHA-256) via UploadClickConversions. Mesmo lead nao eh re-uploadado ' +
        '(dedupe por conversion_action+gclid+timestamp; sem gclid, dedupe por unique no DB). ' +
        'Util pra processar leads recentes apos primeira habilitacao da feature ou pra re-tentar ' +
        'leads que ficaram pendentes apos manutencao do worker. Cron diario roda 04h Maceio automatico.',
      inputSchema: {
        days_back: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe('Janela retroativa em dias. Default 14, max 90 (limite Google Ads).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_trigger_enhanced_conv_upload', async (toolCallId) => {
        applyMutateGuards('traffic_trigger_enhanced_conv_upload');
        const result = await crmTrafficService.post<{
          ok?: boolean;
          message?: string;
          tenants_processed?: number;
          leads_enqueued?: number;
          leads_skipped?: number;
          errors?: number;
        }>(
          '/trafego/conversion-tracking/trigger-enhanced-conv-upload',
          { days_back: input.days_back },
          { toolCallId },
        );
        const lines = [
          `Upload Enhanced Conv (${input.days_back ?? 14}d retroativos) concluido.`,
          `Tenants: ${result?.tenants_processed ?? 0}`,
          `Leads enfileirados: ${result?.leads_enqueued ?? 0}`,
          `Leads skipados (dedupe / sem identifier): ${result?.leads_skipped ?? 0}`,
          `Erros: ${result?.errors ?? 0}`,
        ];
        return ok(result, lines.join('\n'));
      }),
  );

  server.registerTool(
    'traffic_enable_enhanced_conversions_for_leads',
    {
      description:
        'Habilita Enhanced Conversions for Leads. ' +
        'mode=GOOGLE_TAG: liga flag na conta (gtag/GTM no browser sobe userIdentifiers). ' +
        'mode=API: liga cron BullMQ diario que sobe userIdentifiers (email/phone hashed SHA-256) de leads recentes via UploadClickConversions. ' +
        'mode=BOTH: ambos (recomendado pra cobertura maxima — cookie + cookieless).',
      inputSchema: {
        mode: z.enum(['GOOGLE_TAG', 'API', 'BOTH']),
        user_data_fields: z
          .array(z.enum(['email', 'phone', 'address']))
          .optional(),
        confirm: z.boolean(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_enable_enhanced_conversions_for_leads', async (toolCallId) => {
        applyMutateGuards('traffic_enable_enhanced_conversions_for_leads');
        const result = await crmTrafficService.post(
          '/trafego/conversion-tracking/enable-enhanced-conversions-for-leads',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Enhanced Conversions for Leads (modo ${input.mode}) habilitado.`,
        );
      }),
  );

  // ─── Ad Groups ──────────────────────────────────────────────────────────
  server.registerTool(
    'traffic_create_ad_group',
    {
      description:
        'Cria novo Ad Group dentro de uma campanha. Status default PAUSED (admin/gestor ativa depois). ' +
        'cpc_bid_brl: usado em MANUAL_CPC. target_cpa_brl/target_roas: overrides opcionais no nivel ad_group.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        name: z.string().max(80),
        type: z
          .enum(['SEARCH_STANDARD', 'SEARCH_DYNAMIC_ADS', 'DISPLAY_STANDARD'])
          .optional(),
        status: z.enum(['ENABLED', 'PAUSED']).optional(),
        cpc_bid_brl: z.number().positive().optional(),
        target_cpa_brl: z.number().positive().optional(),
        target_roas: z.number().positive().optional(),
        confirm: z.boolean().optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_ad_group', async (toolCallId) => {
        applyMutateGuards('traffic_create_ad_group');
        const { campaign_id, ...body } = input;
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(campaign_id)}/ad-groups`,
          body,
          { toolCallId },
        );
        return ok(result, `Criacao de Ad Group "${input.name}" enfileirada.`);
      }),
  );

  server.registerTool(
    'traffic_update_ad_group',
    {
      description:
        'Atualiza Ad Group existente. Patch parcial. ' +
        'rotation: OPTIMIZE (default, Google escolhe melhor ad) vs ROTATE_FOREVER (igual entre ads — perde otimizacao, usar so em A/B test).',
      inputSchema: {
        ad_group_id: adGroupIdSchemaSprint1,
        name: z.string().max(80).optional(),
        status: z.enum(['ENABLED', 'PAUSED']).optional(),
        cpc_bid_brl: z.number().positive().optional(),
        target_cpa_brl: z.number().positive().optional(),
        target_roas: z.number().positive().optional(),
        rotation: z.enum(['OPTIMIZE', 'ROTATE_FOREVER']).optional(),
        confirm: z.boolean().optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_ad_group', async (toolCallId) => {
        applyMutateGuards('traffic_update_ad_group');
        const { ad_group_id, ...body } = input;
        const result = await crmTrafficService.patch(
          `/trafego/ad-groups/${encodeURIComponent(ad_group_id)}`,
          body,
          { toolCallId },
        );
        return ok(
          result,
          `Atualizacao de Ad Group ${ad_group_id} enfileirada.`,
        );
      }),
  );

  // ─── RSAs / Ads ─────────────────────────────────────────────────────────
  server.registerTool(
    'traffic_update_rsa',
    {
      description:
        'Atualiza um RSA existente. Google Ads NAO suporta UPDATE em ads — sao imutaveis. ' +
        'Tool usa pattern "substituir": cria novo RSA + remove o antigo (atomico do ponto de vista do CRM). ' +
        'Validacao OAB automatica nos headlines/descriptions. ' +
        'confirm=true exigido se ad tem >=100 impressoes nos ultimos 7d (mudanca reseta aprendizado).',
      inputSchema: {
        ad_id: adIdSchema,
        final_url: z.string().url(),
        headlines: z.array(z.string().max(30)).min(3).max(15),
        descriptions: z.array(z.string().max(90)).min(2).max(4),
        path1: z.string().max(15).optional(),
        path2: z.string().max(15).optional(),
        confirm: z.boolean().optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_rsa', async (toolCallId) => {
        applyMutateGuards('traffic_update_rsa');
        const { ad_id, ...body } = input;
        const result = await crmTrafficService.patch(
          `/trafego/ads/${encodeURIComponent(ad_id)}/rsa`,
          body,
          { toolCallId },
        );
        return ok(result, `Substituicao de RSA ${ad_id} enfileirada.`);
      }),
  );

  server.registerTool(
    'traffic_remove_ad',
    {
      description:
        'Remove (soft-delete) um ad individual. Status=REMOVED. Exige confirm + reason.',
      inputSchema: {
        ad_id: adIdSchema,
        confirm: z.boolean(),
        reason: z.string().min(3),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_remove_ad', async (toolCallId) => {
        applyMutateGuards('traffic_remove_ad');
        const { ad_id, ...body } = input;
        const result = await crmTrafficService.post(
          `/trafego/ads/${encodeURIComponent(ad_id)}/remove`,
          body,
          { toolCallId },
        );
        return ok(result, `Remocao de Ad ${ad_id} enfileirada.`);
      }),
  );

  server.registerTool(
    'traffic_attach_call_asset',
    {
      description:
        'Cria Call Asset (substituto do CallAd removido em Google Ads API v23) e anexa em conta/campanha/ad_group. ' +
        'phone_number e country_code default vem de TrafficSettings se nao explicito. ' +
        'call_tracked=true (default): Google injeta tracking number visivel + reporta calls como conversoes.',
      inputSchema: {
        level: z.enum(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP']),
        campaign_id: campaignIdSchema.optional(),
        ad_group_id: adGroupIdSchemaSprint1.optional(),
        phone_number: z
          .string()
          .regex(/^\+[1-9]\d{1,14}$/)
          .optional()
          .describe('E.164 (ex: +5582999999999). Default: TrafficSettings.business_phone_e164.'),
        country_code: z.string().length(2).optional(),
        call_tracked: z.boolean().optional(),
        confirm: z.boolean().optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_attach_call_asset', async (toolCallId) => {
        applyMutateGuards('traffic_attach_call_asset');
        const result = await crmTrafficService.post(
          '/trafego/assets/call',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Call Asset enfileirado para anexar em ${input.level.toLowerCase()}.`,
        );
      }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 2 backlog (2026-05-17) — 6 tools novas (Extensions + Quality Score)
// ═══════════════════════════════════════════════════════════════════════════

function registerSprint2Tools(server: McpServer) {
  // ─── Extensions / Assets ───────────────────────────────────────────────
  server.registerTool(
    'traffic_list_extensions',
    {
      description:
        'Lista extensions (assets) da conta — sitelinks, callouts, snippets, calls, prices, promotions, lead forms. ' +
        'Filtra por campaign_id (so attachments daquela campanha), ad_group_id (so daquele grupo), type, status. ' +
        'Quando campaign_id ou ad_group_id passados, retorna SO os assets anexados naquele scope. ' +
        'Sem filtro: retorna todos os assets do customer (max 500) + attachments em qualquer nivel. ' +
        'GAQL live via worker queue — pode demorar 1-3s.',
      inputSchema: {
        campaign_id: campaignIdSchema.optional(),
        ad_group_id: z.string().optional(),
        type: z
          .enum([
            'SITELINK',
            'CALLOUT',
            'STRUCTURED_SNIPPET',
            'CALL',
            'LOCATION',
            'PRICE',
            'PROMOTION',
            'LEAD_FORM',
          ])
          .optional(),
        status: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_extensions', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          extensions: any[];
          note?: string;
        }>('/trafego/extensions', input, { toolCallId });
        const lines = [`${result?.extensions?.length ?? 0} extensions encontradas.`];
        if (result?.note) lines.push(`Nota: ${result.note}`);
        return ok(result, lines.join('\n'));
      }),
  );

  server.registerTool(
    'traffic_create_extension',
    {
      description:
        'Cria asset novo (sitelink, callout, snippet, call, location, price, promotion, lead_form). ' +
        'Pode ja anexar atomico via attach_level + campaign_id/ad_group_id. ' +
        'Cada `type` exige campos especificos em `data` (validado no backend, erro instrutivo se faltar). ' +
        'Validacao OAB automatica nos textos quando aplicavel. ' +
        'EXEMPLOS:\n' +
        '  SITELINK: data={link_text, final_url, description1?, description2?}\n' +
        '  CALLOUT: data={text} (max 25 chars)\n' +
        '  STRUCTURED_SNIPPET: data={header, values:[]} (3-10 itens)\n' +
        '  CALL: data={phone_number (E.164), country_code?, call_tracked?}\n' +
        '  PRICE: data={type, items:[{header, description, amount_brl, unit?}]}\n' +
        '  PROMOTION: data={promotion_target, occasion, percent_off OR money_amount_off_brl}\n' +
        '  LEAD_FORM: data={business_name, call_to_action_type, headline?, fields:[]}',
      inputSchema: {
        type: z.enum([
          'SITELINK',
          'CALLOUT',
          'STRUCTURED_SNIPPET',
          'CALL',
          'LOCATION',
          'PRICE',
          'PROMOTION',
          'LEAD_FORM',
        ]),
        data: z
          .record(z.any())
          .describe('Payload especifico do type — ver exemplos na description.'),
        attach_level: z
          .enum(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP'])
          .optional()
          .describe('Se passado, ja anexa o asset apos criar (atomic).'),
        campaign_id: campaignIdSchema.optional(),
        ad_group_id: z.string().optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_extension', async (toolCallId) => {
        applyMutateGuards('traffic_create_extension');
        const result = await crmTrafficService.post(
          '/trafego/extensions',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Criacao de extension ${input.type}${
            input.attach_level
              ? ` + attach em ${input.attach_level.toLowerCase()}`
              : ''
          } enfileirada.`,
        );
      }),
  );

  server.registerTool(
    'traffic_attach_extension',
    {
      description:
        'Anexa asset existente a conta/campanha/ad_group. Asset precisa ter sido criado antes ' +
        'via traffic_create_extension. Passa asset_id (UUID local ou resource_name Google).',
      inputSchema: {
        asset_id: z
          .string()
          .describe('resource_name (customers/X/assets/Y) ou ID numerico.'),
        level: z.enum(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP']),
        campaign_id: campaignIdSchema.optional(),
        ad_group_id: z.string().optional(),
        field_type: z
          .enum([
            'SITELINK',
            'CALLOUT',
            'STRUCTURED_SNIPPET',
            'CALL',
            'LOCATION',
            'PRICE',
            'PROMOTION',
            'LEAD_FORM',
          ])
          .describe('Tipo do asset — necessario pro Google saber como anexar.'),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_attach_extension', async (toolCallId) => {
        applyMutateGuards('traffic_attach_extension');
        const result = await crmTrafficService.post(
          '/trafego/extensions/attach',
          input,
          { toolCallId },
        );
        return ok(result, `Attach do asset enfileirado em ${input.level.toLowerCase()}.`);
      }),
  );

  server.registerTool(
    'traffic_detach_extension',
    {
      description:
        'Desanexa asset de conta/campanha/ad_group. NAO remove o asset — apenas o vinculo. ' +
        'Pra remover use traffic_remove_extension. ' +
        'EXIGE asset_link_resource_name (do CustomerAsset/CampaignAsset/AdGroupAsset, NAO do asset em si). ' +
        'Obtem via traffic_list_extensions.',
      inputSchema: {
        asset_link_resource_name: z
          .string()
          .describe(
            'resource_name do link (customers/X/{customerAssets|campaignAssets|adGroupAssets}/Y).',
          ),
        level: z.enum(['ACCOUNT', 'CAMPAIGN', 'AD_GROUP']),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_detach_extension', async (toolCallId) => {
        applyMutateGuards('traffic_detach_extension');
        const result = await crmTrafficService.post(
          '/trafego/extensions/detach',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Detach do asset enfileirado (level=${input.level.toLowerCase()}).`,
        );
      }),
  );

  server.registerTool(
    'traffic_remove_extension',
    {
      description:
        'Remove (soft-delete) um asset propriamente. Cascade no Google: vinculos sao removidos automatic. ' +
        'EXIGE confirm + reason (min 3 chars). Operacao irreversivel pela UI.',
      inputSchema: {
        asset_id: z.string(),
        confirm: z.boolean(),
        reason: z.string().min(3),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_remove_extension', async (toolCallId) => {
        applyMutateGuards('traffic_remove_extension');
        const result = await crmTrafficService.post(
          '/trafego/extensions/remove',
          input,
          { toolCallId },
        );
        return ok(result, `Remocao do asset ${input.asset_id} enfileirada.`);
      }),
  );

  // ─── Quality Score Visibility ──────────────────────────────────────────
  server.registerTool(
    'traffic_get_quality_score_history',
    {
      description:
        'Retorna Quality Score de uma keyword + sub-scores (expected_ctr, ad_relevance, ' +
        'landing_page_experience). Inclui SERIE TEMPORAL dos ultimos N dias ' +
        '(snapshot diario via cron QualityScoreSnapshotCron 03h Maceio). ' +
        'Sprint 2.1 (2026-05-17): pra keywords criadas/uploadadas recentemente, history ' +
        'pode ter poucos pontos ate o cron rodar algumas vezes. Use `current` pra ver ' +
        'valor mais fresco do snapshot principal.',
      inputSchema: {
        keyword_id: z
          .string()
          .describe('UUID interno do CRM OR google_criterion_id.'),
        days: z
          .number()
          .int()
          .min(7)
          .max(90)
          .optional()
          .describe('Janela em dias (placeholder — MVP retorna so atual).'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_get_quality_score_history', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          keyword_id: string;
          text: string;
          current: {
            quality_score: number | null;
            expected_ctr: string | null;
            ad_relevance: string | null;
            landing_page_experience: string | null;
            last_seen_at: string;
          };
          history: any[];
          note: string;
        }>(
          `/trafego/keywords/${encodeURIComponent(input.keyword_id)}/quality-score-history`,
          { days: input.days },
          { toolCallId },
        );
        const c = result?.current;
        const lines = [
          `Keyword "${result?.text ?? input.keyword_id}":`,
          `  Quality Score: ${c?.quality_score ?? '—'}/10`,
          `  Expected CTR: ${c?.expected_ctr ?? '—'}`,
          `  Ad Relevance: ${c?.ad_relevance ?? '—'}`,
          `  Landing Page Experience: ${c?.landing_page_experience ?? '—'}`,
          `  Last seen: ${c?.last_seen_at ?? '—'}`,
        ];
        if (result?.note) lines.push(`Nota: ${result.note}`);
        return ok(result, lines.join('\n'));
      }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 3 backlog (2026-05-17) — 6 tools novas (Targeting + Bulk + Dismiss)
// ═══════════════════════════════════════════════════════════════════════════

function registerSprint3Tools(server: McpServer) {
  // ─── Recommendations dismiss ───────────────────────────────────────────
  server.registerTool(
    'traffic_dismiss_recommendation',
    {
      description:
        'Marca recomendacao do Google Ads como dismissed (ignorada). Diferente de apply, ' +
        'nao executa a acao recomendada — apenas remove da fila pra nao aparecer mais. ' +
        'recommendation_id vem de traffic_list_recommendations.',
      inputSchema: {
        recommendation_id: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_dismiss_recommendation', async (toolCallId) => {
        applyMutateGuards('traffic_dismiss_recommendation');
        const result = await crmTrafficService.post(
          `/trafego/recommendations/${encodeURIComponent(input.recommendation_id)}/dismiss`,
          {},
          { toolCallId },
        );
        return ok(
          result,
          `Recomendacao ${input.recommendation_id} dismissed.`,
        );
      }),
  );

  // ─── Targeting ────────────────────────────────────────────────────────
  server.registerTool(
    'traffic_update_geo_targets',
    {
      description:
        'Adiciona/remove geo targets de uma campanha (Search/Display/PMax). ' +
        'add=IDs numericos do Google ou resource_names geoTargetConstants/X ' +
        '(ex: "1031620"=Maceio/AL, "1001775"=Brasil — lista em ' +
        'developers.google.com/google-ads/api/data/geotargets). ' +
        'remove=resource_names dos campaign_criterion existentes (obtem via Google Ads UI ou GAQL). ' +
        'negative=true: adiciona como EXCLUSAO (campanha NAO veicula la).',
      inputSchema: {
        campaign_id: campaignIdSchema,
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
        negative: z.boolean().optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_geo_targets', async (toolCallId) => {
        applyMutateGuards('traffic_update_geo_targets');
        const { campaign_id, ...body } = input;
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(campaign_id)}/geo-targets`,
          body,
          { toolCallId },
        );
        return ok(
          result,
          `Update geo targets enfileirado pra campanha ${campaign_id} (+${(input.add ?? []).length}, -${(input.remove ?? []).length}).`,
        );
      }),
  );

  server.registerTool(
    'traffic_update_language_targets',
    {
      description:
        'Adiciona/remove language targets de uma campanha. ' +
        'add=IDs numericos do Google ou resource_names languageConstants/X ' +
        '(ex: "1014"=portuguese, "1000"=english).',
      inputSchema: {
        campaign_id: campaignIdSchema,
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_language_targets', async (toolCallId) => {
        applyMutateGuards('traffic_update_language_targets');
        const { campaign_id, ...body } = input;
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(campaign_id)}/language-targets`,
          body,
          { toolCallId },
        );
        return ok(
          result,
          `Update language targets enfileirado pra campanha ${campaign_id}.`,
        );
      }),
  );

  server.registerTool(
    'traffic_update_device_targeting',
    {
      description:
        'Define bid modifiers por device (mobile/desktop/tablet) na campanha. ' +
        'Valores: 1.0=sem ajuste, 0.5=-50%, 1.5=+50%, 0.1=quase nao aparece. ' +
        'Pra MVP, omite=mantem atual. null vira 1.0. ' +
        'AdGroup-level modifiers ficam pra Sprint 3.1 (precisa de outro endpoint).',
      inputSchema: {
        campaign_id: campaignIdSchema,
        mobile_modifier: z.number().min(0.1).max(10).optional(),
        desktop_modifier: z.number().min(0.1).max(10).optional(),
        tablet_modifier: z.number().min(0.1).max(10).optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_device_targeting', async (toolCallId) => {
        applyMutateGuards('traffic_update_device_targeting');
        const { campaign_id, ...body } = input;
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(campaign_id)}/device-targeting`,
          body,
          { toolCallId },
        );
        return ok(
          result,
          `Device bid modifiers atualizados pra campanha ${campaign_id}.`,
        );
      }),
  );

  // ─── Bulk operations ───────────────────────────────────────────────────
  server.registerTool(
    'traffic_bulk_add_negatives',
    {
      description:
        'Adiciona MESMA lista de keywords negativas em N campanhas/ad_groups numa unica chamada. ' +
        'Mais eficiente que N traffic_add_negative_to_* separados (1 mutate batch no Google). ' +
        'targets aceita mix de campaign_id e ad_group_id (cada target = 1 scope). ' +
        'Total operations = targets.length * keywords.length — limite Google ~5000 por mutate.',
      inputSchema: {
        targets: z
          .array(
            z.object({
              campaign_id: campaignIdSchema.optional(),
              ad_group_id: z.string().optional(),
            }),
          )
          .min(1)
          .max(100)
          .describe('Lista de campaigns OR ad_groups (cada objeto: exatamente um id).'),
        keywords: z.array(z.string()).min(1).max(50),
        match_type: z.enum(['EXACT', 'PHRASE', 'BROAD']),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_bulk_add_negatives', async (toolCallId) => {
        applyMutateGuards('traffic_bulk_add_negatives');
        const result = await crmTrafficService.post(
          '/trafego/negatives/bulk',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Bulk add negatives: ${input.keywords.length} keywords x ${input.targets.length} targets = ${input.keywords.length * input.targets.length} ops enfileiradas.`,
        );
      }),
  );

  server.registerTool(
    'traffic_bulk_update_status',
    {
      description:
        'Pausa ou reativa N campanhas/ad_groups numa unica chamada. ' +
        'targets aceita mix de campaign e ad_group (cada um com seu type + id). ' +
        'Pra remove use traffic_remove_campaign/traffic_remove_ad_group individualmente ' +
        '(safeguards diferentes — esta tool eh so pause/resume).',
      inputSchema: {
        targets: z
          .array(
            z.object({
              type: z.enum(['campaign', 'ad_group']),
              id: z
                .string()
                .describe('UUID interno OR google_id.'),
            }),
          )
          .min(1)
          .max(100),
        status: z.enum(['ENABLED', 'PAUSED']),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_bulk_update_status', async (toolCallId) => {
        applyMutateGuards('traffic_bulk_update_status');
        const result = await crmTrafficService.post(
          '/trafego/status/bulk',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Bulk update status: ${input.targets.length} targets → ${input.status}.`,
        );
      }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 4 backlog (2026-05-17) — 4 tools novas (Tier P2)
// ═══════════════════════════════════════════════════════════════════════════

function registerSprint4Tools(server: McpServer) {
  server.registerTool(
    'traffic_create_pmax_campaign',
    {
      description:
        'Cria campanha Performance Max nova. PMax otimiza automatico em todos os inventarios ' +
        'Google (Search, Display, YouTube, Discover, Gmail, Maps). Bidding via Smart Bidding ' +
        '(MAXIMIZE_CONVERSIONS ou MAXIMIZE_CONVERSION_VALUE). ' +
        'MVP nesta entrega: cria campaign + budget + criteria de geo/language. ' +
        'asset_group (assets visuais — logo, business name, headlines, descriptions, images) ' +
        'AINDA PRECISA SER POPULADO MANUALMENTE no Google Ads UI pra campanha ficar serveable. ' +
        'Sprint 4.1 implementa traffic_manage_pmax_asset_group pra automacao. ' +
        'Status inicial sempre PAUSED por seguranca.',
      inputSchema: {
        name: z.string().max(255),
        daily_budget_brl: z.number().positive(),
        bidding_strategy: z
          .enum(['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE'])
          .optional(),
        target_cpa_brl: z
          .number()
          .positive()
          .optional()
          .describe('Pra MAXIMIZE_CONVERSIONS. Opcional.'),
        target_roas: z
          .number()
          .positive()
          .optional()
          .describe('Pra MAXIMIZE_CONVERSION_VALUE. Opcional.'),
        final_url: z.string().url(),
        geo_target_ids: z
          .array(z.string())
          .min(1)
          .describe('IDs numericos Google ex: ["1001775"]=Brasil.'),
        language_ids: z
          .array(z.string())
          .min(1)
          .describe('IDs numericos. Default usar ["1014"]=portuguese.'),
        initial_status: z.enum(['ENABLED', 'PAUSED']).optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_pmax_campaign', async (toolCallId) => {
        applyMutateGuards('traffic_create_pmax_campaign');
        const result = await crmTrafficService.post(
          '/trafego/campaigns/pmax',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `PMax campaign "${input.name}" criada (status: ${input.initial_status ?? 'PAUSED'}). ` +
            `IMPORTANTE: popule o asset_group no Google Ads UI antes de ativar.`,
        );
      }),
  );

  server.registerTool(
    'traffic_reconnect_oauth_link',
    {
      description:
        'Gera URL de OAuth pra reconectar a conta Google Ads quando refresh_token expirou. ' +
        'Util quando se ve erros de auth ou apos rotacao manual do token. ' +
        'Retorna `authorize_url` — usuario abre no browser pra refazer o consent. ' +
        'Apos completar, refresh_token novo eh salvo automatic em TrafficAccount.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () =>
      safe('traffic_reconnect_oauth_link', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          authorize_url: string;
          message: string;
        }>('/trafego/oauth/reconnect-link', undefined, { toolCallId });
        return ok(
          result,
          `URL gerada — abra no browser:\n${result?.authorize_url ?? '(falha)'}`,
        );
      }),
  );

  server.registerTool(
    'traffic_get_call_history',
    {
      description:
        'Lista chamadas (call_view) registradas pelo Google Ads call tracking. ' +
        'Retorna duration_seconds, status, started_at, caller_country/area, type, campaign. ' +
        'Use pra reconciliar com leads do CRM ou auditar performance de call extensions. ' +
        'Filtra por janela retroativa (max 90d) e opcional campaign_id. ' +
        'GAQL live — pode demorar alguns segundos.',
      inputSchema: {
        days_back: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe('Default 30, max 90 (limite Google).'),
        campaign_id: z
          .string()
          .optional()
          .describe('Filtra por google_campaign_id.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_get_call_history', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          calls: any[];
          total: number;
          note?: string;
        }>('/trafego/reads/call-history', input, { toolCallId });
        const lines = [
          `${result?.total ?? 0} chamadas em ${input.days_back ?? 30}d.`,
        ];
        if (result?.note) lines.push(`Nota: ${result.note}`);
        return ok(result, lines.join('\n'));
      }),
  );

  server.registerTool(
    'traffic_get_billing_status',
    {
      description:
        'Lista billing setups + account budgets da conta. Util pra ver status de pagamento, ' +
        'limites, datas de aprovacao. Retorna estrutura com billing_setups[] + account_budgets[]. ' +
        'GAQL live — pode demorar alguns segundos.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      safe('traffic_get_billing_status', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          billing_setups: any[];
          account_budgets: any[];
          note?: string;
        }>('/trafego/reads/billing-status', undefined, { toolCallId });
        const lines = [
          `${result?.billing_setups?.length ?? 0} billing setups, ${result?.account_budgets?.length ?? 0} account budgets.`,
        ];
        if (result?.note) lines.push(`Nota: ${result.note}`);
        return ok(result, lines.join('\n'));
      }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 3.1 backlog (2026-05-17) — 4 tools novas (Shared library + Location bid)
// ═══════════════════════════════════════════════════════════════════════════

function registerSprint3_1Tools(server: McpServer) {
  // ─── Shared negative lists ─────────────────────────────────────────────
  server.registerTool(
    'traffic_list_shared_negative_lists',
    {
      description:
        'Lista shared sets de negative keywords + suas attachments a campanhas. ' +
        'Inclui member_count (quantas keywords tem na lista) e reference_count ' +
        '(quantas campanhas usam). GAQL live via worker queue.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      safe('traffic_list_shared_negative_lists', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          shared_sets: any[];
          note?: string;
        }>('/trafego/shared-negative-lists', undefined, { toolCallId });
        return ok(
          result,
          `${result?.shared_sets?.length ?? 0} shared negative lists.`,
        );
      }),
  );

  server.registerTool(
    'traffic_create_shared_negative_list',
    {
      description:
        'Cria SharedSet de negative keywords + adiciona keywords + opcionalmente anexa a N campanhas. ' +
        'Diferenca vs traffic_bulk_add_negatives: bulk_add cria criterion separado por campanha (cada uma tem seus); ' +
        'shared_negative_list cria UMA lista compartilhada — adicionar keyword nova depois propaga ' +
        'pra todas as campanhas anexadas. Mais higienico pra manter quando lista cresce. ' +
        'Operacao atomica em 3 passos: SharedSet → SharedCriterion[] → CampaignSharedSet[]. ',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(255)
          .describe('Nome identificador da lista (ex: "Negativas globais").'),
        keywords: z.array(z.string()).min(1).max(500),
        match_type: z.enum(['EXACT', 'PHRASE', 'BROAD']),
        attach_campaign_ids: z
          .array(campaignIdSchema)
          .max(100)
          .optional()
          .describe('Campanhas a anexar. Opcional — pode anexar depois via traffic_attach_shared_negative_list.'),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_shared_negative_list', async (toolCallId) => {
        applyMutateGuards('traffic_create_shared_negative_list');
        const result = await crmTrafficService.post(
          '/trafego/shared-negative-lists',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Shared negative list "${input.name}" criada com ${input.keywords.length} keywords` +
            (input.attach_campaign_ids?.length
              ? ` + anexada a ${input.attach_campaign_ids.length} campanhas.`
              : ` (sem attach inicial).`),
        );
      }),
  );

  server.registerTool(
    'traffic_attach_shared_negative_list',
    {
      description:
        'Anexa SharedSet (negative list) ja existente a N campanhas. ' +
        'Util quando a lista ja foi criada (via UI ou create anterior) e quer aplicar a campanhas novas.',
      inputSchema: {
        shared_set_id: z
          .string()
          .describe('resource_name (customers/X/sharedSets/Y) OU ID numerico.'),
        campaign_ids: z.array(campaignIdSchema).min(1).max(100),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_attach_shared_negative_list', async (toolCallId) => {
        applyMutateGuards('traffic_attach_shared_negative_list');
        const result = await crmTrafficService.post(
          '/trafego/shared-negative-lists/attach',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Shared list ${input.shared_set_id} anexada a ${input.campaign_ids.length} campanhas.`,
        );
      }),
  );

  // ─── Location bid modifiers ────────────────────────────────────────────
  server.registerTool(
    'traffic_update_location_bid_modifiers',
    {
      description:
        'Define bid modifiers por location (regiao/cidade) na campanha. Complementa ' +
        'traffic_update_device_targeting (que cobre device). ' +
        'modifier: 1.0=sem ajuste, 1.5=+50%, 0.5=-50% (range 0.1-10.0). ' +
        'geo_target_id: ID numerico Google (ex: "1031620"=Maceio/AL) OU resource_name geoTargetConstants/X. ' +
        'Pra audience_modifiers/schedule_modifiers: nao cobertos nesta entrega — audience precisa de Sprint 3.2, ' +
        'schedule ja eh feito via traffic_update_ad_schedule com bid_modifier embedded no slot.',
      inputSchema: {
        campaign_id: campaignIdSchema,
        modifiers: z
          .array(
            z.object({
              geo_target_id: z.string(),
              bid_modifier: z.number().min(0.1).max(10),
            }),
          )
          .min(1)
          .max(100),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_update_location_bid_modifiers', async (toolCallId) => {
        applyMutateGuards('traffic_update_location_bid_modifiers');
        const { campaign_id, ...body } = input;
        const result = await crmTrafficService.post(
          `/trafego/campaigns/${encodeURIComponent(campaign_id)}/location-bid-modifiers`,
          body,
          { toolCallId },
        );
        return ok(
          result,
          `Location bid modifiers atualizados pra campanha ${campaign_id} (${input.modifiers.length} locations).`,
        );
      }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 4.1 backlog (2026-05-17) — 4 tools novas (PMax asset groups + Experiments)
// ═══════════════════════════════════════════════════════════════════════════

function registerSprint4_1Tools(server: McpServer) {
  // ─── PMax asset groups ─────────────────────────────────────────────────
  server.registerTool(
    'traffic_list_pmax_asset_groups',
    {
      description:
        'Lista asset_groups das campanhas PMax + counts de assets por field_type + ' +
        'readiness_warnings (quais field_types ainda nao atingiram o minimo Google ' +
        'pra ficar serveable: 3-5 HEADLINE, 2-5 DESCRIPTION, 1 LONG_HEADLINE, ' +
        '1 BUSINESS_NAME, 1 LOGO, 1 MARKETING_IMAGE, 1 SQUARE_MARKETING_IMAGE). ' +
        'Filtra por campaign_id opcional (apenas PMax campaigns sao retornadas). ' +
        'GAQL live via worker queue.',
      inputSchema: {
        campaign_id: z
          .string()
          .optional()
          .describe('Filtra por google_campaign_id (numerico).'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_list_pmax_asset_groups', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          asset_groups: any[];
          note?: string;
        }>('/trafego/pmax-asset-groups', input, { toolCallId });
        const lines = [
          `${result?.asset_groups?.length ?? 0} asset groups.`,
        ];
        const withWarnings =
          result?.asset_groups?.filter(
            (g: any) => (g.readiness_warnings?.length ?? 0) > 0,
          ).length ?? 0;
        if (withWarnings > 0) {
          lines.push(`${withWarnings} groups com gaps de readiness — confira readiness_warnings.`);
        }
        if (result?.note) lines.push(`Nota: ${result.note}`);
        return ok(result, lines.join('\n'));
      }),
  );

  server.registerTool(
    'traffic_create_pmax_asset_group',
    {
      description:
        'Cria asset_group VAZIO numa campanha PMax existente. Asset group eh o ' +
        '"container" que agrupa todos os assets de uma temática (uma PMax pode ter ' +
        'múltiplos asset_groups pra públicos/produtos diferentes). ' +
        'IMPORTANTE: status default PAUSED — pra serveable, popule com assets via ' +
        'traffic_add_assets_to_pmax_asset_group (min 5 HEADLINE, 5 DESCRIPTION, ' +
        '1 LONG_HEADLINE, 1 BUSINESS_NAME, 1 LOGO, 1 MARKETING_IMAGE, ' +
        '1 SQUARE_MARKETING_IMAGE).',
      inputSchema: {
        campaign_id: campaignIdSchema,
        name: z.string().min(1).max(255),
        final_urls: z.array(z.string().url()).min(1).max(20),
        final_mobile_urls: z.array(z.string().url()).max(20).optional(),
        path1: z
          .string()
          .max(15)
          .optional()
          .describe('Path1 do display URL.'),
        path2: z
          .string()
          .max(15)
          .optional()
          .describe('Path2 do display URL. So tem efeito se path1 setado.'),
        status: z.enum(['ENABLED', 'PAUSED']).optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_pmax_asset_group', async (toolCallId) => {
        applyMutateGuards('traffic_create_pmax_asset_group');
        const result = await crmTrafficService.post(
          '/trafego/pmax-asset-groups',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Asset group "${input.name}" criado (status: ${input.status ?? 'PAUSED'}). ` +
            `Popule com assets via traffic_add_assets_to_pmax_asset_group antes de ativar.`,
        );
      }),
  );

  server.registerTool(
    'traffic_add_assets_to_pmax_asset_group',
    {
      description:
        'Adiciona assets a um asset_group de PMax. Operacao em 2 mutates sequenciais: ' +
        '(1) cria Assets novos (text/youtube) ou usa existentes (source=existing); ' +
        '(2) cria AssetGroupAssets vinculando ao asset_group via field_type. ' +
        'Source types: ' +
        '  - text: payload={text:"..."} — cria Asset novo (HEADLINE/DESCRIPTION/LONG_HEADLINE/BUSINESS_NAME). ' +
        '  - youtube: payload={youtube_video_id:"VID",title:"..."} — cria Asset video novo. ' +
        '  - existing: payload={asset_resource_name:"customers/X/assets/Y"} — usa Asset ja criado ' +
        '(util pra imagens uploadeadas via UI). ' +
        'Field types: HEADLINE (max 30 chars), DESCRIPTION (max 90), LONG_HEADLINE (max 90), ' +
        'BUSINESS_NAME (max 25), LOGO/LANDSCAPE_LOGO (image), MARKETING_IMAGE (1.91:1), ' +
        'SQUARE_MARKETING_IMAGE (1:1), PORTRAIT_MARKETING_IMAGE (4:5), YOUTUBE_VIDEO. ' +
        'Use validate_only=true antes pra checar payload sem aplicar.',
      inputSchema: {
        asset_group_id: z
          .string()
          .describe('ID numerico Google OU resource_name customers/X/assetGroups/Y.'),
        assets: z
          .array(
            z.object({
              source: z.enum(['text', 'existing', 'youtube']),
              field_type: z.enum([
                'HEADLINE',
                'DESCRIPTION',
                'LONG_HEADLINE',
                'BUSINESS_NAME',
                'LOGO',
                'LANDSCAPE_LOGO',
                'MARKETING_IMAGE',
                'SQUARE_MARKETING_IMAGE',
                'PORTRAIT_MARKETING_IMAGE',
                'YOUTUBE_VIDEO',
                'CALL_TO_ACTION',
              ]),
              payload: z.record(z.any()),
            }),
          )
          .min(1)
          .max(50),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_add_assets_to_pmax_asset_group', async (toolCallId) => {
        applyMutateGuards('traffic_add_assets_to_pmax_asset_group');
        const result = await crmTrafficService.post(
          '/trafego/pmax-asset-groups/assets',
          input,
          { toolCallId },
        );
        const byType = input.assets.reduce(
          (acc: Record<string, number>, a: any) => {
            acc[a.field_type] = (acc[a.field_type] ?? 0) + 1;
            return acc;
          },
          {},
        );
        const breakdown = Object.entries(byType)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ');
        return ok(
          result,
          `${input.assets.length} assets adicionados ao asset_group ${input.asset_group_id} (${breakdown}).`,
        );
      }),
  );

  // ─── Experiments ───────────────────────────────────────────────────────
  server.registerTool(
    'traffic_create_experiment',
    {
      description:
        'Cria Experiment (A/B test de campanha) na nova API v23 do Google Ads. ' +
        'MVP nesta entrega: cria Experiment em estado SETUP + 1 control arm ' +
        'apontando pra base_campaign_id. Treatment arm (variant) + scheduling + ' +
        'promotion ainda precisam ser configurados via Google Ads UI ou Sprint 4.2 ' +
        '(tools futuras: traffic_schedule_experiment, traffic_promote_experiment). ' +
        'Type SEARCH_CUSTOM (default) permite A/B livre de qualquer setting da ' +
        'campanha Search. DISPLAY_CUSTOM equivalente pra Display. ' +
        'SEARCH_AUTOMATED_BIDDING_STRATEGY testa estrategias de lance especificas. ' +
        'AD_VARIATION compara variacoes de RSA. ' +
        'IMPORTANTE: Experiment em SETUP nao consome budget e nao veicula — apenas ' +
        'apos schedule (ENABLED) o traffic split comeca.',
      inputSchema: {
        name: z.string().min(1).max(255),
        base_campaign_id: campaignIdSchema,
        type: z
          .enum([
            'SEARCH_CUSTOM',
            'DISPLAY_CUSTOM',
            'SEARCH_AUTOMATED_BIDDING_STRATEGY',
            'DISPLAY_AUTOMATED_BIDDING_STRATEGY',
            'AD_VARIATION',
          ])
          .optional(),
        description: z.string().max(1000).optional(),
        suffix: z
          .string()
          .max(64)
          .optional()
          .describe('Sufixo aplicado ao nome do treatment campaign. Default "[experiment]".'),
        goals: z
          .array(
            z.object({
              metric: z.enum([
                'CLICKS',
                'IMPRESSIONS',
                'COST',
                'CTR',
                'AVERAGE_CPC',
                'CONVERSIONS',
                'CONVERSION_VALUE',
                'COST_PER_CONVERSION',
              ]),
              direction: z.enum([
                'INCREASE',
                'DECREASE',
                'NO_CHANGE',
                'NO_CHANGE_OR_INCREASE',
                'NO_CHANGE_OR_DECREASE',
              ]),
            }),
          )
          .max(10)
          .optional(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_create_experiment', async (toolCallId) => {
        applyMutateGuards('traffic_create_experiment');
        const result = await crmTrafficService.post(
          '/trafego/experiments',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Experiment "${input.name}" criado (type: ${input.type ?? 'SEARCH_CUSTOM'}, status: SETUP). ` +
            `Configure treatment arm + schedule via Google Ads UI pra ativar A/B.`,
        );
      }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 4.2 backlog (2026-05-17) — 6 tools novas (Experiments lifecycle)
// ═══════════════════════════════════════════════════════════════════════════

function registerSprint4_2Tools(server: McpServer) {
  server.registerTool(
    'traffic_add_treatment_arm',
    {
      description:
        'Adiciona o ExperimentArm de TREATMENT (variant) a um experiment em SETUP. ' +
        'Cada experiment precisa de 2 arms minimos pra schedule: control (criado automaticamente ' +
        'por traffic_create_experiment apontando pra base_campaign) + treatment (criado aqui). ' +
        'trial_campaign_id: ID/google_campaign_id do campaign que vira o treatment — geralmente eh ' +
        'um draft/clone da base_campaign com modificacoes (criado via Google Ads UI ou via ' +
        'traffic_create_search_campaign separado). Sera passado em in_design_campaigns no arm — ' +
        'auto-materializado em trial campaign real quando o experiment for scheduled. ' +
        'traffic_split: % de trafego pro treatment (1-99). Control herda 100-traffic_split. Default 50.',
      inputSchema: {
        experiment_id: z
          .string()
          .describe('resource_name customers/X/experiments/Y OR ID numerico.'),
        name: z.string().min(1).max(255),
        trial_campaign_id: campaignIdSchema.describe(
          'ID interno OR google_campaign_id do draft/clone campaign.',
        ),
        traffic_split: z
          .number()
          .int()
          .min(1)
          .max(99)
          .optional()
          .describe('% trafego treatment. Default 50.'),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_add_treatment_arm', async (toolCallId) => {
        applyMutateGuards('traffic_add_treatment_arm');
        const result = await crmTrafficService.post(
          '/trafego/experiments/treatment-arms',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Treatment arm "${input.name}" adicionado ao experiment ${input.experiment_id} (traffic_split: ${input.traffic_split ?? 50}%). ` +
            `Agora chame traffic_schedule_experiment pra ativar o A/B.`,
        );
      }),
  );

  server.registerTool(
    'traffic_schedule_experiment',
    {
      description:
        'Schedule experiment — passa SETUP -> INITIATED (async, Google materializa drafts em trial campaigns) ' +
        '-> ENABLED (split traffic ativo). Apos schedule, metrics comecam a acumular em ambos arms. ' +
        'PRE-REQUISITO: experiment precisa ter >=2 arms configurados (control + treatment). ' +
        'Use validate_only=true pra checar se Google aceita sem rodar de fato. ' +
        'Operacao assincrona — schedule retorna ok rapido, mas materializacao real dos drafts ' +
        'pode levar minutos. Confira status via traffic_get_experiment_results pra ver se ja virou ENABLED.',
      inputSchema: {
        experiment_id: z.string(),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      safe('traffic_schedule_experiment', async (toolCallId) => {
        applyMutateGuards('traffic_schedule_experiment');
        const result = await crmTrafficService.post(
          '/trafego/experiments/schedule',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Experiment ${input.experiment_id} agendado. Materializacao async pode levar minutos — verifique status via traffic_get_experiment_results.`,
        );
      }),
  );

  server.registerTool(
    'traffic_end_experiment',
    {
      description:
        'End experiment — encerra um experiment em ENABLED (status vira HALTED). ' +
        'NAO promove ningem — apenas para o traffic split. Trial campaigns ficam paradas, ' +
        'base_campaign continua veiculando normal. ' +
        'USE quando: viu que o treatment esta pior e quer parar logo de queimar budget, ' +
        'ou quando o experimento ja rodou tempo suficiente e voce quer encerrar sem promover ' +
        'nem graduate. Diferente de promote/graduate: end NAO aplica nada da treatment na base.',
      inputSchema: {
        experiment_id: z.string(),
        reason: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_end_experiment', async (toolCallId) => {
        applyMutateGuards('traffic_end_experiment');
        const result = await crmTrafficService.post(
          '/trafego/experiments/end',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Experiment ${input.experiment_id} encerrado (HALTED). Base campaign mantida; treatment paralisado.`,
        );
      }),
  );

  server.registerTool(
    'traffic_promote_experiment',
    {
      description:
        'Promote experiment — encerra ENABLED e PROMOVE o treatment como nova versao da base_campaign ' +
        '(aplica as mudancas do treatment de volta na base). Trial campaigns viram removidas. Status: PROMOTED. ' +
        'USE SO se: ' +
        '  - metrics do treatment validamente melhores (CPL menor, ou CTR maior, ou conv maior); ' +
        '  - treatment teve traffic significativo (>=1000 impressions ou >=2 semanas exposicao); ' +
        '  - voce confirmou via traffic_get_experiment_results que delta eh estatisticamente robusto. ' +
        'Diferente de graduate: promote SUBSTITUI a base, graduate cria standalone paralela. ' +
        'Async — retorna ok rapido, mas aplicacao real das mudancas pode levar alguns minutos.',
      inputSchema: {
        experiment_id: z.string(),
        reason: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_promote_experiment', async (toolCallId) => {
        applyMutateGuards('traffic_promote_experiment');
        const result = await crmTrafficService.post(
          '/trafego/experiments/promote',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Experiment ${input.experiment_id} promovido — treatment aplicado na base_campaign. Async, pode levar minutos.`,
        );
      }),
  );

  server.registerTool(
    'traffic_graduate_experiment',
    {
      description:
        'Graduate experiment — separa o treatment como campanha STANDALONE (NAO aplica na base). ' +
        'Cria nova campanha permanente partindo do treatment, em paralelo com a base. Status: GRADUATED. ' +
        'USE quando: voce gostou do treatment MAS quer rodar paralelo (ex: treatment foca audiencia X, ' +
        'base mantem audiencia Y); ou quando treatment e base sao ambos boas estrategias com publicos diferentes. ' +
        'REQUER mappings: pra cada experiment_campaign, qual budget usar quando virar standalone. ' +
        'Trial campaigns nao tem budget proprio (herdam da base no experimento), entao ao graduate ' +
        'precisa atribuir budget novo a cada uma. ' +
        'experiment_campaign_id: ID/resource_name do trial campaign (pega de traffic_get_experiment_results.treatment_arm.campaigns). ' +
        'campaign_budget_id: ID/resource_name do budget existente (de traffic_list_budgets) ou crie via traffic_create_search_campaign primeiro.',
      inputSchema: {
        experiment_id: z.string(),
        mappings: z
          .array(
            z.object({
              experiment_campaign_id: z.string(),
              campaign_budget_id: z.string(),
            }),
          )
          .min(1)
          .max(20),
        reason: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_graduate_experiment', async (toolCallId) => {
        applyMutateGuards('traffic_graduate_experiment');
        const result = await crmTrafficService.post(
          '/trafego/experiments/graduate',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Experiment ${input.experiment_id} graduated — ${input.mappings.length} trial campaign(s) agora standalone.`,
        );
      }),
  );

  server.registerTool(
    'traffic_get_experiment_results',
    {
      description:
        'Get experiment results — metrics comparativas TREATMENT vs CONTROL. ' +
        'Retorna experiment metadata (status, dates), ambos arms com metrics agregados ' +
        '(spend, clicks, impressions, conversions, CPL, CTR) na janela days_back, e deltas ' +
        '(diferenca absoluta + percentual treatment-control) pra cada metric. ' +
        'USE pra decidir se vale promote, graduate ou end. Recomendacao: aguarde >=2 semanas + ' +
        '>=1000 impressions em cada arm antes de decidir — deltas em <1 semana sao instaveis. ' +
        'note vem populado se status ainda eh SETUP/INITIATED (metrics nao acumularam) ou ' +
        'se treatment arm nao foi configurado. ' +
        'GAQL live via worker queue (pode demorar uns segundos).',
      inputSchema: {
        experiment_id: z.string(),
        days_back: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe('Janela de metricas em dias. Default 30, max 90.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      safe('traffic_get_experiment_results', async (toolCallId) => {
        const result = await crmTrafficService.get<{
          experiment: any;
          control_arm: any;
          treatment_arm: any;
          deltas: Record<string, any>;
          days_back: number;
          note?: string;
        }>(
          `/trafego/experiments/${encodeURIComponent(input.experiment_id)}/results`,
          input.days_back ? { days_back: String(input.days_back) } : undefined,
          { toolCallId },
        );
        const exp = result.experiment;
        const lines: string[] = [];
        if (exp) {
          lines.push(
            `Experiment "${exp.name}" (status: ${exp.status}, type: ${exp.type}, janela: ${result.days_back}d)`,
          );
        }
        if (result.control_arm && result.treatment_arm) {
          const c = result.control_arm.metrics;
          const t = result.treatment_arm.metrics;
          lines.push(
            `Control:    spend R$${c.spend.toFixed(2)}, clicks ${c.clicks}, conv ${c.conversions.toFixed(2)}, CPL R$${c.cpl.toFixed(2)}, CTR ${(c.ctr * 100).toFixed(2)}%`,
          );
          lines.push(
            `Treatment:  spend R$${t.spend.toFixed(2)}, clicks ${t.clicks}, conv ${t.conversions.toFixed(2)}, CPL R$${t.cpl.toFixed(2)}, CTR ${(t.ctr * 100).toFixed(2)}%`,
          );
          const cplDelta = result.deltas.cpl;
          if (cplDelta && cplDelta.pct !== null) {
            const sign = cplDelta.abs <= 0 ? '✓ melhor' : '✗ pior';
            lines.push(
              `CPL delta: ${cplDelta.pct >= 0 ? '+' : ''}${cplDelta.pct.toFixed(1)}% (${sign})`,
            );
          }
        }
        if (result.note) lines.push(`Nota: ${result.note}`);
        return ok(result, lines.join('\n'));
      }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Bug-fix batch (2026-05-17) — tools de cleanup pos-bugs
// ═══════════════════════════════════════════════════════════════════════════

function registerBugFixBatchTools(server: McpServer) {
  server.registerTool(
    'traffic_remove_asset',
    {
      description:
        'Remove um Asset orfao da conta Google Ads. Util pra limpar assets criados ' +
        'mas nunca anexados — ex: Call Assets criados pelo bug do traffic_attach_call_asset ' +
        'antes do fix de 2026-05-17. Aceita asset_id como resource_name ' +
        '(customers/X/assets/Y) OU ID numerico (auto-prefixa). ' +
        'PRE-REQUISITO: asset deve estar SEM attachments ativos. Se ainda anexado, ' +
        'Google rejeita com erro claro — desanexe primeiro via traffic_detach_extension ' +
        'ou via Google Ads UI.',
      inputSchema: {
        asset_id: z
          .string()
          .min(1)
          .describe('resource_name customers/X/assets/Y OU ID numerico do asset.'),
        reason: z.string().optional(),
        validate_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) =>
      safe('traffic_remove_asset', async (toolCallId) => {
        applyMutateGuards('traffic_remove_asset');
        const result = await crmTrafficService.post(
          '/trafego/assets/remove',
          input,
          { toolCallId },
        );
        return ok(
          result,
          `Asset ${input.asset_id} removido (status: ${(result as any)?.status ?? 'ok'}).`,
        );
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
