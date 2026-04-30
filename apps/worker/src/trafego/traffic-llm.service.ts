import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { SettingsService } from '../settings/settings.service';
import {
  createLLMClient,
  type LLMProvider,
  type LLMResponse,
} from '../ai/llm-client';
import { Prisma } from '@prisma/client';

/**
 * TrafficLLMService — funções LLM-based pra IA do tráfego (Sprint G.3 + G.4).
 *
 * 1. classifyBadSearchTerms(accountId)
 *    Loop weekly: pega search_terms_view com 30d+ de gasto sem conversão.
 *    LLM (provider/model do TrafficIAPolicy) classifica em
 *    RELEVANT/MARGINAL/OFF_TOPIC/UNCERTAIN. Term OFF_TOPIC com
 *    confidence ≥ 0.95 vira TrafficIADecision kind=ADD_NEGATIVE_KEYWORD
 *    (auto-aplicável se policy permite).
 *
 * 2. generateSummary(accountId, decisions, format)
 *    Gera 1-2 parágrafos pt-BR resumindo a rodada (executadas, sugestões,
 *    bloqueadas) pra ser inserido em PDF/relatório/WhatsApp.
 *    Quando provider/key não configurados, devolve fallback determinístico
 *    (lista bullets) — nunca falha hard.
 */
@Injectable()
export class TrafficLLMService {
  private readonly logger = new Logger(TrafficLLMService.name);

  constructor(
    private prisma: PrismaService,
    private adsClient: GoogleAdsClientService,
    private settings: SettingsService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // G.3 — Classify bad search terms
  // ──────────────────────────────────────────────────────────────────────

  async classifyBadSearchTerms(
    accountId: string,
    opts: { maxTerms?: number } = {},
  ): Promise<ClassifyReport> {
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.status !== 'ACTIVE') {
      return { accountId, candidatesCreated: 0, classified: 0, skipped: 'account_inactive' };
    }

    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: account.tenant_id },
    });
    if (!policy?.agent_enabled) {
      return { accountId, candidatesCreated: 0, classified: 0, skipped: 'agent_disabled' };
    }

    const llmClient = await this.buildClient(policy);
    if (!llmClient) {
      return { accountId, candidatesCreated: 0, classified: 0, skipped: 'no_llm_key' };
    }

    // Pega search terms com gasto sem conversão (30d)
    const customer = await this.adsClient.getCustomer(
      account.tenant_id,
      account.id,
    );
    const maxTerms = Math.min(Math.max(opts.maxTerms ?? 30, 1), 100);

    const rows: any[] = await customer.query(`
      SELECT
        search_term_view.search_term,
        segments.search_term_match_type,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM search_term_view
      WHERE
        segments.date DURING LAST_30_DAYS
        AND metrics.cost_micros > 50000000
        AND metrics.conversions = 0
      ORDER BY metrics.cost_micros DESC
      LIMIT ${maxTerms}
    `);

    if (rows.length === 0) {
      return { accountId, candidatesCreated: 0, classified: 0, skipped: 'no_terms' };
    }

    const model = (policy as any).llm_classify_model ?? 'claude-haiku-4-5';
    let candidatesCreated = 0;
    let classified = 0;

    for (const row of rows) {
      const term: string = row.search_term_view?.search_term ?? '';
      const campaignName: string = row.campaign?.name ?? '(sem nome)';
      const cost = Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
      const clicks = Number(row.metrics?.clicks ?? 0);
      if (!term) continue;

      let result: SearchTermClassification | null = null;
      try {
        result = await this.callClassifyLLM(
          llmClient,
          model,
          term,
          campaignName,
          cost,
          clicks,
        );
        classified++;
      } catch (err: any) {
        this.logger.warn(
          `[llm-classify] falha em "${term}": ${err?.message ?? err}`,
        );
        continue;
      }
      if (!result) continue;

      // Só cria candidato pra OFF_TOPIC com confidence alta
      if (result.category !== 'OFF_TOPIC' || result.confidence < 0.85) continue;

      // Resolve campaign local
      const localCampaign = row.campaign?.id
        ? await this.prisma.trafficCampaign.findUnique({
            where: {
              account_id_google_campaign_id: {
                account_id: accountId,
                google_campaign_id: String(row.campaign.id),
              },
            },
            select: { id: true },
          })
        : null;

      // Idempotência: se já temos uma decisão IGNORED ou pendente pra esse
      // termo dentro da janela do cooldown, pulamos. Tabela TrafficIADecision
      // não tem unique direto pra term — usamos resource_name pra carry.
      const existing = await this.prisma.trafficIADecision.findFirst({
        where: {
          account_id: accountId,
          decision_kind: 'ADD_NEGATIVE_KEYWORD',
          resource_name: term,
          created_at: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      });
      if (existing) continue;

      await this.prisma.trafficIADecision.create({
        data: {
          tenant_id: account.tenant_id,
          account_id: accountId,
          loop_kind: 'WEEKLY',
          decision_kind: 'ADD_NEGATIVE_KEYWORD',
          resource_type: 'KEYWORD',
          resource_id: localCampaign?.id ?? null,
          resource_name: term,
          inputs: {
            search_term: term,
            campaign_name: campaignName,
            cost_30d_brl: cost,
            clicks_30d: clicks,
            llm_category: result.category,
            llm_confidence: result.confidence,
            llm_reason: result.reason,
            model_used: model,
          } as Prisma.InputJsonValue,
          confidence: new Prisma.Decimal(result.confidence.toFixed(3)),
          reasons: [
            `LLM classificou como OFF_TOPIC (conf ${result.confidence.toFixed(2)}): ${result.reason}`,
            `Gasto 30d: R$ ${cost.toFixed(2)} sem conversão.`,
            `Recomendação: adicionar "${term}" como negative keyword.`,
          ] as unknown as Prisma.InputJsonValue,
          action: 'SUGGEST',
          executed: false,
          summary: `Sugerido: adicionar "${term}" como palavra negativa.`,
        },
      });
      candidatesCreated++;
    }

    this.logger.log(
      `[llm-classify] account=${accountId} terms=${rows.length} classified=${classified} candidates=${candidatesCreated}`,
    );
    return { accountId, candidatesCreated, classified };
  }

  private async callClassifyLLM(
    client: any,
    model: string,
    term: string,
    campaignName: string,
    cost: number,
    clicks: number,
  ): Promise<SearchTermClassification | null> {
    const prompt = `Você é especialista em Google Ads para escritório de advocacia em Maceió/AL (foco Trabalhista, Civil, Família, Empresarial).

Search term que disparou anúncio: "${term}"
Campanha: "${campaignName}"
Performance 30d: ${clicks} cliques, R$ ${cost.toFixed(2)} gasto, 0 conversões.

Classifique a relevância em UMA das categorias:
- "RELEVANT": termo pertinente, manter (mesmo sem conversão).
- "MARGINAL": termo lateral, monitorar mais tempo.
- "OFF_TOPIC": termo irrelevante (ex: outra área/serviço, gratuito, faculdade, OAB exame, concurso, etc), recomendar adicionar como negative.
- "UNCERTAIN": falta contexto, deixar pra humano.

Regras OAB: NUNCA classifique como RELEVANT termos com promessa de resultado, "garantia", "grátis", "100%". Esses são ruído.

Responda APENAS JSON: {"category":"...","confidence":0.0-1.0,"reason":"uma frase em pt-BR"}`;

    const response: LLMResponse = await client.chat({
      model,
      systemPrompt: 'Especialista em Google Ads pra escritório de advocacia.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      temperature: 0.2,
      jsonMode: true,
    });

    if (!response?.content) return null;
    const text = response.content.trim();
    try {
      // Pode vir com markdown fence
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(cleaned);
      if (
        typeof parsed?.category !== 'string' ||
        typeof parsed?.confidence !== 'number' ||
        typeof parsed?.reason !== 'string'
      ) {
        return null;
      }
      const cat = parsed.category.toUpperCase();
      if (!['RELEVANT', 'MARGINAL', 'OFF_TOPIC', 'UNCERTAIN'].includes(cat)) {
        return null;
      }
      return {
        category: cat as SearchTermClassification['category'],
        confidence: Math.max(0, Math.min(1, parsed.confidence)),
        reason: parsed.reason.slice(0, 300),
      };
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // G.4 — Generate summary (pt-BR pra PDF e WhatsApp)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Gera 1-2 parágrafos resumindo a rodada da IA. Quando LLM indisponível,
   * cai pra texto determinístico em bullets — nunca lança.
   */
  async generateSummary(
    tenantId: string,
    decisions: SummaryDecisionInput[],
    format: 'pdf' | 'whatsapp' = 'whatsapp',
  ): Promise<string> {
    if (decisions.length === 0) {
      return format === 'whatsapp'
        ? '✅ IA Tráfego: nada relevante na última análise.'
        : 'A IA não encontrou ajustes relevantes nesta análise.';
    }

    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
    });
    const llmClient = policy ? await this.buildClient(policy) : null;

    if (!llmClient || !policy) {
      return this.fallbackSummary(decisions, format);
    }

    const model = (policy as any).llm_summary_model ?? 'claude-haiku-4-5';
    try {
      const bullets = decisions
        .slice(0, 15)
        .map(
          (d, i) =>
            `${i + 1}. [${d.action}] ${d.kind} em "${d.resourceName ?? '—'}" (conf ${d.confidence.toFixed(2)}): ${d.summary ?? ''}`,
        )
        .join('\n');

      const prompt =
        format === 'whatsapp'
          ? `Resuma em 2-3 frases curtas (com 1-2 emojis discretos, tom profissional) o que a IA do tráfego fez nesta rodada. Mensagem vai pro WhatsApp do dono do escritório.

Decisões:
${bullets}

Não use linguagem mercantil, não prometa resultado, não use "garantido". Tom calmo. Português brasileiro.`
          : `Resuma em 1-2 parágrafos formais (sem emoji) o que a IA do tráfego fez. Vai num PDF semanal de relatório.

Decisões:
${bullets}

Português brasileiro, sem emojis, sem promessa de resultado, sem linguagem mercantil. Cite os totais (executadas vs sugestões) e o ponto mais relevante.`;

      const response = await llmClient.chat({
        model,
        systemPrompt:
          'Você é um redator técnico que resume decisões de IA em português brasileiro.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: format === 'whatsapp' ? 300 : 500,
        temperature: 0.3,
      });

      const text = response?.content?.trim();
      if (text && text.length > 20) return text;
      return this.fallbackSummary(decisions, format);
    } catch (err: any) {
      this.logger.warn(`[llm-summary] falhou: ${err?.message ?? err}`);
      return this.fallbackSummary(decisions, format);
    }
  }

  private fallbackSummary(
    decisions: SummaryDecisionInput[],
    format: 'pdf' | 'whatsapp',
  ): string {
    const exec = decisions.filter((d) => d.action === 'EXECUTE').length;
    const sug = decisions.filter((d) => d.action === 'SUGGEST').length;
    const blk = decisions.filter((d) => d.action === 'BLOCK').length;
    const head =
      format === 'whatsapp'
        ? `🤖 IA Tráfego: ${exec} aplicada(s), ${sug} sugestão(ões)${blk ? `, ${blk} bloqueada(s)` : ''}.`
        : `Análise da IA: ${exec} ações aplicadas, ${sug} sugestões aguardando revisão${blk ? `, ${blk} bloqueadas por OAB` : ''}.`;
    const bullets = decisions
      .slice(0, 5)
      .map((d) => `• ${d.summary ?? `${d.kind} em ${d.resourceName ?? '—'}`}`)
      .join('\n');
    return `${head}\n${bullets}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  private async buildClient(policy: any) {
    const provider = (policy.llm_provider ?? 'anthropic') as LLMProvider;
    const apiKey =
      provider === 'anthropic'
        ? await this.settings.getAnthropicKey()
        : await this.settings.getOpenAiKey();
    if (!apiKey) {
      this.logger.warn(
        `[llm] ${provider} sem API key — operação LLM pulada (configure em Ajustes IA).`,
      );
      return null;
    }
    return createLLMClient(provider, apiKey);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

type SearchTermClassification = {
  category: 'RELEVANT' | 'MARGINAL' | 'OFF_TOPIC' | 'UNCERTAIN';
  confidence: number;
  reason: string;
};

export type ClassifyReport = {
  accountId: string;
  candidatesCreated: number;
  classified: number;
  skipped?: string;
};

export type SummaryDecisionInput = {
  action: string;
  kind: string;
  resourceName: string | null;
  confidence: number;
  summary?: string | null;
};
