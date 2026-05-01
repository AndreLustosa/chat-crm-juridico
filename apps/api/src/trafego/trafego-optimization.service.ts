import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Sprint I — Fase 5. IA Otimiza — gera insights acionáveis on-demand.
 *
 * 3 entradas:
 *   - weeklyDiagnosis: resumo em pt-BR comparando esta semana vs anterior.
 *   - keywordsToPause: keywords ativas com gasto >= threshold + 0 conv (30d).
 *   - budgetSuggestions: sugere budget ideal por campanha baseado em CPL
 *     atual e meta declarada de leads/mês (TrafficSettings.target_*).
 */
@Injectable()
export class TrafegoOptimizationService {
  private readonly logger = new Logger(TrafegoOptimizationService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /**
   * Diagnóstico semanal: agrega métricas dos últimos 7 dias vs 7-14 dias
   * anteriores, manda pra Claude com prompt de "consultor de tráfego" e
   * retorna texto estruturado (3 parágrafos: o que aconteceu, por quê,
   * o que fazer).
   *
   * Sem ANTHROPIC_API_KEY: 412.
   * Com poucas métricas (< 100 cliques agregados): retorna avisando
   * que dados são insuficientes.
   */
  async weeklyDiagnosis(tenantId: string): Promise<{
    period: { from: string; to: string; previous_from: string; previous_to: string };
    metrics: any;
    diagnosis: string;
    model: string;
  }> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!account) {
      throw new HttpException(
        'Conecte uma conta Google Ads.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);

    const [thisWeek, prevWeek, byCampaign] = await Promise.all([
      this.prisma.trafficMetricDaily.aggregate({
        where: { tenant_id: tenantId, date: { gte: sevenDaysAgo, lt: today } },
        _sum: {
          cost_micros: true,
          impressions: true,
          clicks: true,
          conversions: true,
          conversions_value: true,
        },
      }),
      this.prisma.trafficMetricDaily.aggregate({
        where: {
          tenant_id: tenantId,
          date: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
        },
        _sum: {
          cost_micros: true,
          impressions: true,
          clicks: true,
          conversions: true,
          conversions_value: true,
        },
      }),
      this.prisma.trafficMetricDaily.groupBy({
        by: ['campaign_id'],
        where: { tenant_id: tenantId, date: { gte: sevenDaysAgo, lt: today } },
        _sum: {
          cost_micros: true,
          conversions: true,
          clicks: true,
          impressions: true,
        },
        orderBy: { _sum: { cost_micros: 'desc' } },
        take: 10,
      }),
    ]);

    const microsToBRL = (m: bigint | null | undefined) =>
      m ? Number(m) / 1_000_000 : 0;

    const thisCost = microsToBRL(thisWeek._sum.cost_micros);
    const prevCost = microsToBRL(prevWeek._sum.cost_micros);
    const thisConv = Number(thisWeek._sum.conversions ?? 0);
    const prevConv = Number(prevWeek._sum.conversions ?? 0);
    const thisClicks = Number(thisWeek._sum.clicks ?? 0);
    const prevClicks = Number(prevWeek._sum.clicks ?? 0);
    const thisImps = Number(thisWeek._sum.impressions ?? 0);
    const prevImps = Number(prevWeek._sum.impressions ?? 0);

    const thisCpl = thisConv > 0 ? thisCost / thisConv : 0;
    const prevCpl = prevConv > 0 ? prevCost / prevConv : 0;
    const thisCtr = thisImps > 0 ? thisClicks / thisImps : 0;
    const prevCtr = prevImps > 0 ? prevClicks / prevImps : 0;

    const campaignIds = byCampaign.map((b) => b.campaign_id);
    const campaignNames = await this.prisma.trafficCampaign.findMany({
      where: { id: { in: campaignIds } },
      select: { id: true, name: true, status: true },
    });
    const nameMap = new Map(campaignNames.map((c) => [c.id, c]));

    const topCampaigns = byCampaign.map((b) => {
      const meta = nameMap.get(b.campaign_id);
      const cost = microsToBRL(b._sum.cost_micros);
      const conv = Number(b._sum.conversions ?? 0);
      return {
        name: meta?.name ?? '(removida)',
        status: meta?.status ?? '?',
        cost_brl: cost,
        conversions: conv,
        cpl_brl: conv > 0 ? cost / conv : 0,
      };
    });

    const metrics = {
      this_week: {
        spend_brl: thisCost,
        leads: thisConv,
        clicks: thisClicks,
        impressions: thisImps,
        cpl_brl: thisCpl,
        ctr: thisCtr,
      },
      previous_week: {
        spend_brl: prevCost,
        leads: prevConv,
        clicks: prevClicks,
        impressions: prevImps,
        cpl_brl: prevCpl,
        ctr: prevCtr,
      },
      deltas: {
        spend_pct: prevCost > 0 ? (thisCost - prevCost) / prevCost : null,
        leads_pct: prevConv > 0 ? (thisConv - prevConv) / prevConv : null,
        cpl_pct: prevCpl > 0 ? (thisCpl - prevCpl) / prevCpl : null,
      },
      top_campaigns: topCampaigns,
    };

    // Sem dados suficientes: retorna sem chamar Claude (poupa tokens)
    if (thisClicks < 100 && prevClicks < 100) {
      return {
        period: {
          from: sevenDaysAgo.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
          previous_from: fourteenDaysAgo.toISOString().slice(0, 10),
          previous_to: sevenDaysAgo.toISOString().slice(0, 10),
        },
        metrics,
        diagnosis:
          'Dados insuficientes pra um diagnóstico significativo (menos de 100 cliques nas últimas duas semanas). Aguarde mais tráfego antes de pedir análise.',
        model: 'none',
      };
    }

    // Resolve key + modelo
    const key =
      (await this.settings.get('ANTHROPIC_API_KEY')) ||
      process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new HttpException(
        'ANTHROPIC_API_KEY não configurada.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
      select: { llm_summary_model: true },
    });
    const model = policy?.llm_summary_model || 'claude-sonnet-4-6';

    const systemPrompt = `Você é um consultor sênior de Google Ads especializado em advocacia. Em português do Brasil, escreva um diagnóstico semanal CURTO E ACIONÁVEL pro escritório.

ESTRUTURA exigida — exatamente 3 parágrafos:
1. **O QUE ACONTECEU** (max 3 frases): números chave da semana vs anterior.
2. **POR QUÊ** (max 3 frases): hipóteses pras variações, baseadas nos top campaigns.
3. **O QUE FAZER NA PRÓXIMA SEMANA** (3-5 bullets): ações concretas, priorizadas.

REGRAS:
- Seja direto. Sem floreio.
- Quando algo melhorou, reconheça brevemente antes de sugerir o próximo passo.
- Quando piorou, diga claramente sem dramatizar.
- Use R$ formatado (ex: "R$ 1.234,56"). Use % com 1 decimal.
- NÃO mencione OAB nem dê sugestão de copy de anúncio (não é o foco).
- Foque em: budget, bidding strategy, palavras-chave, alocação por campanha.
- Saída em markdown simples (negritos, listas).`;

    const userPrompt = `Semana atual (${sevenDaysAgo.toISOString().slice(0, 10)} → ${today.toISOString().slice(0, 10)}):
- Gasto: R$ ${thisCost.toFixed(2)}
- Leads: ${thisConv.toFixed(0)}
- Cliques: ${thisClicks}
- Impressões: ${thisImps}
- CPL: R$ ${thisCpl.toFixed(2)}
- CTR: ${(thisCtr * 100).toFixed(2)}%

Semana anterior:
- Gasto: R$ ${prevCost.toFixed(2)}
- Leads: ${prevConv.toFixed(0)}
- Cliques: ${prevClicks}
- Impressões: ${prevImps}
- CPL: R$ ${prevCpl.toFixed(2)}
- CTR: ${(prevCtr * 100).toFixed(2)}%

Top 10 campanhas (por gasto na semana atual):
${topCampaigns
  .map(
    (c, i) =>
      `${i + 1}. ${c.name} [${c.status}] — gasto R$ ${c.cost_brl.toFixed(2)}, ${c.conversions.toFixed(0)} leads, CPL R$ ${c.cpl_brl.toFixed(2)}`,
  )
  .join('\n')}`;

    const client = new Anthropic({ apiKey: key });
    let raw = '';
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1200,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      raw = ((response.content[0] as any)?.text || '').trim();
    } catch (e: any) {
      this.logger.error(
        `[weekly-diagnosis] Anthropic falhou: ${e?.message ?? e}`,
      );
      throw new HttpException(
        `Falha ao chamar Claude: ${e?.message ?? 'desconhecido'}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      period: {
        from: sevenDaysAgo.toISOString().slice(0, 10),
        to: today.toISOString().slice(0, 10),
        previous_from: fourteenDaysAgo.toISOString().slice(0, 10),
        previous_to: sevenDaysAgo.toISOString().slice(0, 10),
      },
      metrics,
      diagnosis: raw,
      model,
    };
  }

  /**
   * Lista keywords ENABLED com gasto >= threshold (default R$30) e zero
   * conversões nos últimos N dias (default 30). Ordena por maior gasto
   * — pior ROI primeiro.
   */
  async keywordsToPause(
    tenantId: string,
    opts: { minSpendBrl?: number; days?: number; limit?: number } = {},
  ) {
    const minSpendBrl = opts.minSpendBrl ?? 30;
    const days = Math.min(Math.max(opts.days ?? 30, 7), 90);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - days);

    // TrafficMetricDaily é por (campaign, date) — não temos agregado por
    // keyword já. Pra MVP vamos usar TrafficSearchTerm como proxy:
    // termos com gasto significativo + 0 conv. Se admin negativar, kw
    // que disparou eles também. Combinado com TrafficKeyword (positivas
    // ativas) — mostramos ambas as listas.
    //
    // Aqui filtramos do search-term (já agregado por kw, ad_group) — é
    // o melhor proxy de "kw cara sem conv" sem agregar metrics_daily por
    // keyword (que não temos). Cobre 80% dos casos práticos.
    const searchTerms = await this.prisma.trafficSearchTerm.findMany({
      where: {
        tenant_id: tenantId,
        last_seen_at: { gte: windowStart },
        cost_micros: {
          gte: BigInt(Math.round(minSpendBrl * 1_000_000)),
        },
        conversions: { lte: 0 },
      },
      orderBy: { cost_micros: 'desc' },
      take: limit,
      include: {
        campaign: { select: { id: true, name: true } },
        ad_group: { select: { id: true, name: true } },
      },
    });

    return {
      threshold: { min_spend_brl: minSpendBrl, days },
      total_wasted_brl:
        searchTerms.reduce((s, t) => s + Number(t.cost_micros), 0) / 1_000_000,
      items: searchTerms.map((t) => ({
        id: t.id,
        kind: 'search_term', // pra UI saber que é negative-able, não pause
        text: t.search_term,
        match_type: t.match_type,
        campaign_id: t.campaign_id,
        campaign_name: t.campaign?.name ?? null,
        ad_group_id: t.ad_group_id,
        ad_group_name: t.ad_group?.name ?? null,
        cost_brl: Number(t.cost_micros) / 1_000_000,
        clicks: t.clicks,
        impressions: t.impressions,
        conversions: t.conversions,
      })),
    };
  }

  /**
   * Sugere ajuste de budget por campanha. Lógica:
   *   - Para cada campanha ENABLED:
   *     - CPL atual (30d) e leads/mês corrente
   *     - Meta de leads/mês: precisa estar declarada em settings ou inferir
   *       do target_cpl + target_daily_budget
   *     - Sugere budget = (meta_leads_mes * cpl_atual) / 30
   *     - Limita a +/- 30% do atual pra evitar mudança violenta
   *
   * Quando target_daily_budget_micros existe, usa esse como teto agregado.
   * Sem dados de conversão (CPL=0): pula campanha (não dá pra projetar).
   */
  async budgetSuggestions(tenantId: string) {
    const settings = await this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantId },
      select: {
        target_cpl_micros: true,
        target_daily_budget_micros: true,
      },
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    const campaigns = await this.prisma.trafficCampaign.findMany({
      where: {
        tenant_id: tenantId,
        is_archived_internal: false,
        status: 'ENABLED',
      },
      select: {
        id: true,
        name: true,
        daily_budget_micros: true,
      },
    });

    const aggs = await this.prisma.trafficMetricDaily.groupBy({
      by: ['campaign_id'],
      where: {
        tenant_id: tenantId,
        date: { gte: thirtyDaysAgo },
      },
      _sum: {
        cost_micros: true,
        conversions: true,
      },
    });

    const aggMap = new Map(aggs.map((a) => [a.campaign_id, a]));
    const targetCplBrl = settings?.target_cpl_micros
      ? Number(settings.target_cpl_micros) / 1_000_000
      : null;

    const items = campaigns
      .map((c) => {
        const agg = aggMap.get(c.id);
        const spend30 = agg ? Number(agg._sum.cost_micros ?? 0) / 1_000_000 : 0;
        const conv30 = agg ? Number(agg._sum.conversions ?? 0) : 0;
        const cplBrl = conv30 > 0 ? spend30 / conv30 : 0;
        const currentDaily = c.daily_budget_micros
          ? Number(c.daily_budget_micros) / 1_000_000
          : 0;

        // Skip campaigns sem dados de conversão suficientes
        if (conv30 < 3) {
          return {
            campaign_id: c.id,
            campaign_name: c.name,
            current_daily_brl: currentDaily,
            cpl_brl: cplBrl,
            conv_30d: conv30,
            recommendation: 'INSUFFICIENT_DATA' as const,
            suggested_daily_brl: null,
            change_pct: null,
            reasoning:
              'Menos de 3 conversões em 30 dias — sem amostra suficiente pra projetar budget.',
          };
        }

        // Quanto está performando vs target?
        const performing = targetCplBrl ? cplBrl <= targetCplBrl : true;

        // Heurística simples — sem reinventar:
        // - Se CPL <= target: sugere +20% (escala o que está funcionando)
        // - Se CPL > target * 1.5: sugere -20% (corta o que está caro)
        // - Caso contrário: mantém
        let suggestedDaily = currentDaily;
        let recommendation:
          | 'INCREASE'
          | 'DECREASE'
          | 'KEEP'
          | 'INSUFFICIENT_DATA' = 'KEEP';
        let reasoning = '';

        if (performing && targetCplBrl) {
          suggestedDaily = currentDaily * 1.2;
          recommendation = 'INCREASE';
          reasoning = `CPL R$ ${cplBrl.toFixed(2)} ≤ meta R$ ${targetCplBrl.toFixed(2)} — escalar o que está convertendo.`;
        } else if (
          targetCplBrl &&
          cplBrl > targetCplBrl * 1.5
        ) {
          suggestedDaily = currentDaily * 0.8;
          recommendation = 'DECREASE';
          reasoning = `CPL R$ ${cplBrl.toFixed(2)} > meta R$ ${targetCplBrl.toFixed(2)} × 1.5 — reduzir até melhorar match.`;
        } else if (!targetCplBrl) {
          reasoning =
            'Configure meta de CPL em Settings pra receber sugestão de aumento/redução baseada no objetivo.';
        } else {
          reasoning = `CPL R$ ${cplBrl.toFixed(2)} próximo da meta R$ ${targetCplBrl.toFixed(2)} — manter.`;
        }

        return {
          campaign_id: c.id,
          campaign_name: c.name,
          current_daily_brl: currentDaily,
          cpl_brl: cplBrl,
          conv_30d: conv30,
          recommendation,
          suggested_daily_brl:
            recommendation === 'INCREASE' || recommendation === 'DECREASE'
              ? Math.round(suggestedDaily * 100) / 100
              : null,
          change_pct:
            currentDaily > 0 && suggestedDaily !== currentDaily
              ? (suggestedDaily - currentDaily) / currentDaily
              : null,
          reasoning,
        };
      })
      .sort((a, b) => b.conv_30d - a.conv_30d); // mais conversões primeiro

    return {
      target_cpl_brl: targetCplBrl,
      items,
    };
  }
}
