import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  createLLMClient,
  type LLMProvider,
  type LLMMessage,
} from '../ai/llm-client';
import { CHAT_TOOL_DEFS, type ProposedAction } from './traffic-chat.tools';
import { Prisma } from '@prisma/client';

/**
 * TrafficChatService — assistente conversacional do tráfego (Sprint H.3-H.4).
 *
 * Pipeline ao receber 1 mensagem do user:
 *   1. Persiste TrafficChatMessage role='user'
 *   2. Carrega últimas 20 mensagens da session pra contexto
 *   3. Chama LLM com tools READ_ONLY + propose_action
 *   4. Loop até LLM responder content (max 6 iterações):
 *      - se tool_calls: executa tools, persiste TrafficChatMessage role='tool',
 *        manda resultado de volta pra LLM
 *      - se content: persiste TrafficChatMessage role='assistant'
 *   5. Atualiza session.last_activity_at + tokens/cost
 *   6. Retorna lista das mensagens novas pra UI
 *
 * Sem stream pra simplicidade (essa primeira leva). Streaming entra depois
 * se a UX do request-response começar a doer.
 */
@Injectable()
export class TrafficChatService {
  private readonly logger = new Logger(TrafficChatService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Sessions
  // ──────────────────────────────────────────────────────────────────────

  async createSession(
    tenantId: string,
    userId: string,
    title?: string,
  ): Promise<{ id: string; title: string }> {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) {
      throw new HttpException(
        'Conecte uma conta Google Ads antes de iniciar conversa.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
    });
    const session = await this.prisma.trafficChatSession.create({
      data: {
        tenant_id: tenantId,
        account_id: account.id,
        user_id: userId,
        title: title ?? 'Nova conversa',
        llm_provider: policy?.llm_provider ?? 'anthropic',
        llm_model:
          (policy as any)?.llm_summary_model ?? 'claude-haiku-4-5',
      },
    });
    return { id: session.id, title: session.title };
  }

  async listSessions(tenantId: string, userId: string, limit = 30) {
    return this.prisma.trafficChatSession.findMany({
      where: {
        tenant_id: tenantId,
        // Mostra só do user — admins veem só suas próprias sessions
        user_id: userId,
        status: 'OPEN',
      },
      orderBy: { last_activity_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        title: true,
        started_at: true,
        last_activity_at: true,
        total_cost_brl: true,
      },
    });
  }

  async getMessages(tenantId: string, sessionId: string, userId: string) {
    const session = await this.prisma.trafficChatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.tenant_id !== tenantId || session.user_id !== userId) {
      throw new HttpException('Sessão não encontrada.', HttpStatus.NOT_FOUND);
    }
    return this.prisma.trafficChatMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'asc' },
    });
  }

  async archiveSession(tenantId: string, sessionId: string, userId: string) {
    const session = await this.prisma.trafficChatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.tenant_id !== tenantId || session.user_id !== userId) {
      throw new HttpException('Sessão não encontrada.', HttpStatus.NOT_FOUND);
    }
    return this.prisma.trafficChatSession.update({
      where: { id: sessionId },
      data: { status: 'ARCHIVED' },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Send message — main pipeline
  // ──────────────────────────────────────────────────────────────────────

  async sendMessage(
    tenantId: string,
    sessionId: string,
    userId: string,
    userText: string,
  ): Promise<SendMessageResult> {
    const session = await this.prisma.trafficChatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.tenant_id !== tenantId || session.user_id !== userId) {
      throw new HttpException('Sessão não encontrada.', HttpStatus.NOT_FOUND);
    }
    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!policy) {
      throw new HttpException(
        'Política da IA não configurada.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    const provider = (policy.llm_provider ?? 'anthropic') as LLMProvider;
    const model = (policy as any).llm_summary_model ?? 'claude-haiku-4-5';
    const apiKey =
      provider === 'anthropic'
        ? await this.settings.getAnthropicKey()
        : await this.settings.getOpenAiKey();
    if (!apiKey) {
      throw new HttpException(
        `API key do provider ${provider} não configurada. Configure em Ajustes IA do CRM.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const llm = createLLMClient(provider, apiKey);

    // 1. Persiste mensagem do user
    const userMsg = await this.prisma.trafficChatMessage.create({
      data: {
        tenant_id: tenantId,
        account_id: session.account_id,
        session_id: sessionId,
        role: 'user',
        content: userText.slice(0, 4000),
      },
    });

    // Auto-titulo: se for a primeira mensagem real, usa pra título da session
    if (session.title === 'Nova conversa') {
      const newTitle = userText.slice(0, 60).trim() || 'Conversa';
      await this.prisma.trafficChatSession.update({
        where: { id: sessionId },
        data: { title: newTitle },
      });
    }

    // 2. Carrega contexto (últimas 20 mensagens não-tool, em ordem)
    const recent = await this.prisma.trafficChatMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'asc' },
      take: 60, // tool calls + results podem ocupar muito; limite generoso
    });

    // Monta payload pro LLM
    const messages = this.buildLLMMessages(recent);

    const newMessages: any[] = [userMsg];
    let tokensInTotal = 0;
    let tokensOutTotal = 0;

    // 3. Loop até resposta final (max 6 iterações)
    let iterations = 0;
    let finalResponse: any = null;
    while (iterations < 6) {
      iterations++;

      let response;
      try {
        response = await llm.chat({
          model,
          systemPrompt: SYSTEM_PROMPT,
          messages,
          tools: CHAT_TOOL_DEFS,
          maxTokens: 1500,
          temperature: 0.3,
        });
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        const errMessage = await this.prisma.trafficChatMessage.create({
          data: {
            tenant_id: tenantId,
            account_id: session.account_id,
            session_id: sessionId,
            role: 'assistant',
            content: `Desculpe, tive um erro chamando o LLM (${provider}/${model}): ${errMsg}. Verifique se a API key está correta em Ajustes IA.`,
            error_message: errMsg.slice(0, 1000),
            model_used: model,
          },
        });
        newMessages.push(errMessage);
        return { messages: newMessages };
      }

      tokensInTotal += response.usage?.promptTokens ?? 0;
      tokensOutTotal += response.usage?.completionTokens ?? 0;

      const hasTools =
        Array.isArray(response.toolCalls) && response.toolCalls.length > 0;

      if (!hasTools) {
        // Resposta final
        const assistantMsg = await this.prisma.trafficChatMessage.create({
          data: {
            tenant_id: tenantId,
            account_id: session.account_id,
            session_id: sessionId,
            role: 'assistant',
            content: response.content ?? '(resposta vazia)',
            tokens_input: response.usage?.promptTokens ?? 0,
            tokens_output: response.usage?.completionTokens ?? 0,
            model_used: response.model ?? model,
          },
        });
        newMessages.push(assistantMsg);
        finalResponse = assistantMsg;
        break;
      }

      // Persiste a mensagem assistant que CHAMOU as tools
      const assistantToolMsg = await this.prisma.trafficChatMessage.create({
        data: {
          tenant_id: tenantId,
          account_id: session.account_id,
          session_id: sessionId,
          role: 'assistant',
          content: response.content ?? '',
          tool_calls: response.toolCalls as unknown as Prisma.InputJsonValue,
          tokens_input: response.usage?.promptTokens ?? 0,
          tokens_output: response.usage?.completionTokens ?? 0,
          model_used: response.model ?? model,
        },
      });
      newMessages.push(assistantToolMsg);

      // Adiciona ao histórico do LLM
      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.toolCalls,
      });

      // 4. Executa cada tool e persiste resultados
      for (const toolCall of response.toolCalls) {
        let result: any;
        try {
          const args = JSON.parse(toolCall.arguments || '{}');
          result = await this.runTool(
            toolCall.name,
            args,
            { tenantId, accountId: session.account_id, sessionId, userId },
          );
        } catch (err: any) {
          result = { error: err?.message ?? String(err) };
        }

        // Quando tool é propose_action, criamos uma mensagem com proposed_action
        if (toolCall.name === 'propose_action' && result?.proposed_action) {
          const proposalMsg = await this.prisma.trafficChatMessage.create({
            data: {
              tenant_id: tenantId,
              account_id: session.account_id,
              session_id: sessionId,
              role: 'tool',
              content: '',
              tool_result_for: toolCall.id,
              tool_result: result as Prisma.InputJsonValue,
              proposed_action: result.proposed_action as Prisma.InputJsonValue,
              proposed_action_status: 'PENDING_APPROVAL',
            },
          });
          newMessages.push(proposalMsg);
          messages.push({
            role: 'tool',
            content: JSON.stringify({
              ok: true,
              proposed: true,
              note: 'Ação proposta pro admin via UI. Aguardando aprovação.',
            }),
            tool_call_id: toolCall.id,
          });
        } else {
          const toolMsg = await this.prisma.trafficChatMessage.create({
            data: {
              tenant_id: tenantId,
              account_id: session.account_id,
              session_id: sessionId,
              role: 'tool',
              content: '',
              tool_result_for: toolCall.id,
              tool_result: result as Prisma.InputJsonValue,
            },
          });
          newMessages.push(toolMsg);
          messages.push({
            role: 'tool',
            content: JSON.stringify(result).slice(0, 8000),
            tool_call_id: toolCall.id,
          });
        }
      }
    }

    // 5. Atualiza tokens/cost da session
    await this.prisma.trafficChatSession.update({
      where: { id: sessionId },
      data: {
        last_activity_at: new Date(),
        total_tokens_input: { increment: tokensInTotal },
        total_tokens_output: { increment: tokensOutTotal },
      },
    });

    return { messages: newMessages, finalResponse };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tool execution (read-only + propose_action)
  // ──────────────────────────────────────────────────────────────────────

  private async runTool(
    name: string,
    args: any,
    ctx: { tenantId: string; accountId: string; sessionId: string; userId: string },
  ): Promise<any> {
    switch (name) {
      case 'list_campaigns':
        return this.toolListCampaigns(ctx, args);
      case 'get_dashboard_kpis':
        return this.toolDashboardKpis(ctx, args);
      case 'get_campaign_metrics':
        return this.toolCampaignMetrics(ctx, args);
      case 'compare_periods':
        return this.toolComparePeriods(ctx, args);
      case 'list_keywords':
        return this.toolListKeywords(ctx, args);
      case 'list_ads':
        return this.toolListAds(ctx, args);
      case 'list_recent_alerts':
        return this.toolListAlerts(ctx, args);
      case 'list_recent_decisions':
        return this.toolListDecisions(ctx, args);
      case 'list_recommendations':
        return this.toolListRecommendations(ctx, args);
      case 'propose_action':
        return this.toolProposeAction(ctx, args);
      default:
        return { error: `Tool desconhecida: ${name}` };
    }
  }

  private async toolListCampaigns(ctx: any, args: any) {
    const where: any = { account_id: ctx.accountId };
    if (args.status && args.status !== 'ALL') where.status = args.status;
    else if (!args.status) where.status = 'ENABLED';
    if (args.service_category) where.service_category = args.service_category;
    const items = await this.prisma.trafficCampaign.findMany({
      where,
      take: 50,
      select: {
        id: true,
        google_campaign_id: true,
        name: true,
        status: true,
        channel_type: true,
        service_category: true,
        objective: true,
        daily_budget_micros: true,
      },
    });
    return {
      count: items.length,
      campaigns: items.map((c) => ({
        ...c,
        daily_budget_brl:
          c.daily_budget_micros !== null
            ? Number(c.daily_budget_micros) / 1_000_000
            : null,
      })),
    };
  }

  private async toolDashboardKpis(ctx: any, args: any) {
    const dateFrom = args.date_from
      ? new Date(args.date_from)
      : daysAgo(30);
    const dateTo = args.date_to ? new Date(args.date_to) : new Date();
    const agg = await this.prisma.trafficMetricDaily.aggregate({
      where: {
        account_id: ctx.accountId,
        date: { gte: dateFrom, lte: dateTo },
      },
      _sum: {
        cost_micros: true,
        clicks: true,
        impressions: true,
        conversions: true,
        conversions_value: true,
      },
    });
    const cost = Number(agg._sum.cost_micros ?? 0n) / 1_000_000;
    const conv = Number(agg._sum.conversions ?? 0);
    const clicks = Number(agg._sum.clicks ?? 0);
    const impressions = Number(agg._sum.impressions ?? 0);
    return {
      period: {
        from: dateFrom.toISOString().slice(0, 10),
        to: dateTo.toISOString().slice(0, 10),
      },
      totals: {
        cost_brl: cost,
        clicks,
        impressions,
        conversions: conv,
        ctr: impressions > 0 ? clicks / impressions : 0,
        cpl_brl: conv > 0 ? cost / conv : null,
        avg_cpc_brl: clicks > 0 ? cost / clicks : null,
      },
    };
  }

  private async toolCampaignMetrics(ctx: any, args: any) {
    if (!args.campaign_id) return { error: 'campaign_id obrigatório' };
    const camp = await this.prisma.trafficCampaign.findUnique({
      where: { id: args.campaign_id },
    });
    if (!camp || camp.account_id !== ctx.accountId) {
      return { error: 'Campanha não encontrada' };
    }
    const dateFrom = args.date_from ? new Date(args.date_from) : daysAgo(30);
    const dateTo = args.date_to ? new Date(args.date_to) : new Date();
    const series = await this.prisma.trafficMetricDaily.findMany({
      where: {
        campaign_id: camp.id,
        date: { gte: dateFrom, lte: dateTo },
      },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        cost_micros: true,
        clicks: true,
        impressions: true,
        conversions: true,
      },
    });
    return {
      campaign: { id: camp.id, name: camp.name, status: camp.status },
      period: {
        from: dateFrom.toISOString().slice(0, 10),
        to: dateTo.toISOString().slice(0, 10),
      },
      series: series.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        cost_brl: Number(d.cost_micros ?? 0n) / 1_000_000,
        clicks: d.clicks,
        impressions: d.impressions,
        conversions: Number(d.conversions ?? 0),
      })),
    };
  }

  private async toolComparePeriods(ctx: any, args: any) {
    const a = await this.aggPeriod(ctx.accountId, args.period_a_from, args.period_a_to);
    const b = await this.aggPeriod(ctx.accountId, args.period_b_from, args.period_b_to);
    const delta = (av: number, bv: number) => ({
      a: av,
      b: bv,
      delta_abs: bv - av,
      delta_pct: av > 0 ? ((bv - av) / av) * 100 : null,
    });
    return {
      period_a: a,
      period_b: b,
      compare: {
        cost_brl: delta(a.cost_brl, b.cost_brl),
        clicks: delta(a.clicks, b.clicks),
        conversions: delta(a.conversions, b.conversions),
        cpl_brl:
          a.cpl_brl !== null && b.cpl_brl !== null
            ? delta(a.cpl_brl, b.cpl_brl)
            : null,
      },
    };
  }

  private async aggPeriod(accountId: string, fromStr: string, toStr: string) {
    const from = new Date(fromStr);
    const to = new Date(toStr);
    const agg = await this.prisma.trafficMetricDaily.aggregate({
      where: { account_id: accountId, date: { gte: from, lte: to } },
      _sum: {
        cost_micros: true,
        clicks: true,
        conversions: true,
      },
    });
    const cost = Number(agg._sum.cost_micros ?? 0n) / 1_000_000;
    const clicks = Number(agg._sum.clicks ?? 0);
    const conv = Number(agg._sum.conversions ?? 0);
    return {
      from: fromStr,
      to: toStr,
      cost_brl: cost,
      clicks,
      conversions: conv,
      cpl_brl: conv > 0 ? cost / conv : null,
    };
  }

  private async toolListKeywords(ctx: any, args: any) {
    const where: any = { account_id: ctx.accountId };
    if (args.ad_group_id) where.ad_group_id = args.ad_group_id;
    if (args.campaign_id) {
      const ags = await this.prisma.trafficAdGroup.findMany({
        where: { campaign_id: args.campaign_id },
        select: { id: true },
      });
      where.ad_group_id = { in: ags.map((a) => a.id) };
    }
    const items = await this.prisma.trafficKeyword.findMany({
      where,
      take: Math.min(Math.max(args.limit ?? 50, 1), 200),
      select: {
        id: true,
        text: true,
        match_type: true,
        status: true,
        cpc_bid_micros: true,
        quality_score: true,
        ad_group_id: true,
      },
    });
    return { count: items.length, keywords: items };
  }

  private async toolListAds(ctx: any, args: any) {
    const where: any = { account_id: ctx.accountId };
    if (args.ad_group_id) where.ad_group_id = args.ad_group_id;
    if (args.approval_status && args.approval_status !== 'ALL') {
      where.approval_status = args.approval_status;
    }
    if (args.campaign_id) {
      const ags = await this.prisma.trafficAdGroup.findMany({
        where: { campaign_id: args.campaign_id },
        select: { id: true },
      });
      where.ad_group_id = { in: ags.map((a) => a.id) };
    }
    const items = await this.prisma.trafficAd.findMany({
      where,
      take: Math.min(Math.max(args.limit ?? 30, 1), 100),
      select: {
        id: true,
        ad_type: true,
        status: true,
        approval_status: true,
        policy_topics: true,
        headlines: true,
        descriptions: true,
        ad_group_id: true,
      },
    });
    return { count: items.length, ads: items };
  }

  private async toolListAlerts(ctx: any, args: any) {
    const where: any = { account_id: ctx.accountId, status: 'OPEN' };
    if (args.severity && args.severity !== 'ALL') where.severity = args.severity;
    const items = await this.prisma.trafficAlert.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(args.limit ?? 20, 1), 50),
      select: {
        id: true,
        kind: true,
        severity: true,
        message: true,
        created_at: true,
      },
    });
    return { count: items.length, alerts: items };
  }

  private async toolListDecisions(ctx: any, args: any) {
    const days = Math.min(Math.max(args.days ?? 7, 1), 90);
    const where: any = {
      account_id: ctx.accountId,
      created_at: { gte: daysAgo(days) },
    };
    if (args.action && args.action !== 'ALL') where.action = args.action;
    const items = await this.prisma.trafficIADecision.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(args.limit ?? 30, 1), 100),
      select: {
        id: true,
        decision_kind: true,
        resource_name: true,
        confidence: true,
        action: true,
        executed: true,
        human_feedback: true,
        summary: true,
        created_at: true,
      },
    });
    return {
      count: items.length,
      decisions: items.map((d) => ({
        ...d,
        confidence: d.confidence?.toFixed(3) ?? null,
      })),
    };
  }

  private async toolListRecommendations(ctx: any, args: any) {
    const where: any = { account_id: ctx.accountId };
    if (args.status && args.status !== 'ALL') where.status = args.status;
    else where.status = { in: ['READY', 'OAB_BLOCKED', 'PENDING'] };
    if (args.type) where.recommendation_type = args.type;
    const items = await this.prisma.trafficRecommendation.findMany({
      where,
      orderBy: [{ status: 'asc' }, { last_seen_at: 'desc' }],
      take: Math.min(Math.max(args.limit ?? 30, 1), 100),
      select: {
        id: true,
        recommendation_type: true,
        status: true,
        oab_summary: true,
        impact_potential: true,
        last_seen_at: true,
      },
    });
    return { count: items.length, recommendations: items };
  }

  private async toolProposeAction(
    ctx: any,
    args: ProposedAction,
  ): Promise<any> {
    if (!args.action_kind || !args.reason) {
      return { error: 'action_kind e reason são obrigatórios' };
    }
    // Sanity check do recurso (existe + pertence à conta)
    if (
      ['PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'UPDATE_BUDGET', 'ADD_NEGATIVE_KEYWORD_CAMPAIGN'].includes(
        args.action_kind,
      )
    ) {
      if (!args.campaign_id) {
        return { error: 'campaign_id obrigatório pra esta ação.' };
      }
      const camp = await this.prisma.trafficCampaign.findUnique({
        where: { id: args.campaign_id },
      });
      if (!camp || camp.account_id !== ctx.accountId) {
        return { error: 'Campanha não encontrada na sua conta.' };
      }
    }
    if (
      ['PAUSE_AD_GROUP', 'RESUME_AD_GROUP', 'ADD_NEGATIVE_KEYWORD_AD_GROUP'].includes(
        args.action_kind,
      )
    ) {
      if (!args.ad_group_id) return { error: 'ad_group_id obrigatório' };
      const ag = await this.prisma.trafficAdGroup.findUnique({
        where: { id: args.ad_group_id },
      });
      if (!ag || ag.account_id !== ctx.accountId) {
        return { error: 'Ad group não encontrado.' };
      }
    }
    if (args.action_kind === 'PAUSE_AD') {
      if (!args.ad_id) return { error: 'ad_id obrigatório' };
      const ad = await this.prisma.trafficAd.findUnique({
        where: { id: args.ad_id },
      });
      if (!ad || ad.account_id !== ctx.accountId) {
        return { error: 'Ad não encontrado.' };
      }
    }
    if (args.action_kind === 'UPDATE_BUDGET' && !args.new_amount_brl) {
      return { error: 'new_amount_brl obrigatório pra UPDATE_BUDGET' };
    }
    if (
      ['ADD_NEGATIVE_KEYWORD_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD_AD_GROUP'].includes(
        args.action_kind,
      ) &&
      !args.negative_keyword
    ) {
      return { error: 'negative_keyword obrigatório' };
    }
    return {
      proposed_action: args,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Traduz mensagens persistidas pra payload do LLM (chat completions).
   * tool_call/tool_result são re-emitidos no formato esperado por OpenAI/Anthropic.
   */
  private buildLLMMessages(persisted: any[]): LLMMessage[] {
    const out: LLMMessage[] = [];
    for (const m of persisted) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        if (m.tool_calls) {
          out.push({
            role: 'assistant',
            content: m.content || '',
            tool_calls: m.tool_calls,
          });
        } else {
          out.push({ role: 'assistant', content: m.content });
        }
      } else if (m.role === 'tool') {
        out.push({
          role: 'tool',
          content: JSON.stringify(m.tool_result ?? {}).slice(0, 8000),
          tool_call_id: m.tool_result_for ?? '',
        });
      }
    }
    return out;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// System prompt
// ──────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é a assistente de IA da gestão de tráfego do escritório Andre Lustosa Advogados (Maceió/AL). Foco em advocacia Trabalhista, Civil, Família, Empresarial.

CAPACIDADES
- Você tem ferramentas (tools) pra consultar dados em tempo real do CRM e do Google Ads:
  campanhas, métricas, keywords, ads, alertas, decisões da IA, recomendações Google.
- Você pode propor ações via tool 'propose_action' (pausar campanha, ajustar budget, adicionar negative keyword). NÃO executa direto — vira card "Aplicar/Rejeitar" pro admin confirmar.
- Sempre que precisar de dados, USE A TOOL. Não invente números.

TOM E ESTILO
- Português brasileiro, profissional mas natural.
- Responda direto, sem floreio ("certamente!", "claro que sim!" são proibidos).
- Use bullet points pra listas, números formatados pt-BR (1.234,56).
- Evite emojis exceto pra status muito objetivos (✅⚠️❌).

REGRAS OAB (obrigatório respeitar)
- NUNCA prometa resultado ("garanto vitória", "100% de sucesso").
- NUNCA recomende termos como "melhor advogado", "advogado top", "advogado garantido".
- Ao propor adicionar keyword positiva, evite termos com "garantia", "promessa", "milagre".
- OK: termos descritivos do serviço ("indenização trabalhista", "rescisão indireta").

QUANDO PROPOR AÇÃO
- Só proponha ação concreta quando o user pediu explicitamente OU quando você consultou dados que apontam claro problema E o user perguntou o que fazer.
- Sempre forneça 'reason' detalhado em pt-BR no propose_action — vai aparecer pro admin no card de aprovação.
- Pra mudanças de budget: max +20% por aplicação. Se quiser mais, propõe em etapas.

ERROS
- Se uma tool retornar { error: ... }, explique pro user em pt-BR e sugira o que fazer (ex: "A campanha que você mencionou não existe — me dá o nome ou o ID?").
- Não invente IDs. Use list_campaigns primeiro pra descobrir.

FORMATAÇÃO
- Valores em R$: use Intl.NumberFormat tipo "R$ 1.234,56".
- Datas: dd/mm/yyyy.
- CTR/conversão: percentual com 2 decimais ("3,42%").
- Se user pediu uma análise comparativa, use compare_periods pra ter números exatos.

LIMITES
- Não responda perguntas fora do tráfego/Google Ads. Se vier pergunta jurídica geral, redirecione: "Pra dúvida jurídica use os outros agentes do CRM. Aqui é só sobre tráfego."`;

// ──────────────────────────────────────────────────────────────────────────
// Util
// ──────────────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export type SendMessageResult = {
  messages: any[];
  finalResponse?: any;
};
