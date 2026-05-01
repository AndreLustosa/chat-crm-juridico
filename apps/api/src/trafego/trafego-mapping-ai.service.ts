import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Sugere mapeamento ConversionAction → evento CRM via Claude API.
 *
 * Padrão alinhado com `legal-cases.service.ts`:
 *   - Lê ANTHROPIC_API_KEY de SettingsService (DB) com fallback pra env.
 *   - Modelo configurável via TrafficIAPolicy.llm_classify_model (cheap),
 *     fallback claude-haiku-4-5.
 *   - Sem key → erro explícito (não silencioso).
 *
 * Estratégia: 1 prompt único com TODAS as ConversionActions não-mapeadas,
 * Claude retorna JSON com sugestões. Mais barato que 1 chamada/action,
 * Claude consegue contextualizar (ex: "Click em Falar com Advogado" + "Calls"
 * provavelmente são leads, com "Calls" mapeado pra atendimento).
 */
@Injectable()
export class TrafegoMappingAiService {
  private readonly logger = new Logger(TrafegoMappingAiService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async suggestMappings(tenantId: string): Promise<{
    suggestions: Array<{
      conversion_action_id: string;
      name: string;
      category: string;
      current_mapping: string | null;
      suggested_event: string | null;
      confidence: number;
      reasoning: string;
    }>;
    model: string;
    total_unmapped: number;
  }> {
    // Pega todas as actions ENABLED — inclui já-mapeadas pra IA poder
    // sugerir override quando heurística for melhor. Front filtra UI.
    const actions = await this.prisma.trafficConversionAction.findMany({
      where: { tenant_id: tenantId, status: 'ENABLED' },
      select: {
        id: true,
        name: true,
        category: true,
        type: true,
        crm_event_kind: true,
      },
      orderBy: { name: 'asc' },
    });

    if (actions.length === 0) {
      return { suggestions: [], model: '', total_unmapped: 0 };
    }

    const totalUnmapped = actions.filter((a) => !a.crm_event_kind).length;

    // Resolve key + modelo
    const key =
      (await this.settings.get('ANTHROPIC_API_KEY')) ||
      process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new HttpException(
        'ANTHROPIC_API_KEY não configurada. Configure em Configurações > IA antes de usar "Mapear com IA".',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
      select: { llm_classify_model: true },
    });
    const model = policy?.llm_classify_model || 'claude-haiku-4-5';

    const systemPrompt = `Você é um analista de Marketing Performance de um CRM jurídico brasileiro. Sua tarefa é mapear ConversionActions do Google Ads pra eventos do CRM.

Eventos CRM disponíveis (use APENAS estes, NUNCA invente):
- "lead.created"     → entrada de lead novo no CRM (ex: lead form, click em "Falar com advogado", click no WhatsApp do anúncio)
- "lead.qualified"   → lead foi triado e aprovado pelo SDR/atendente
- "client.signed"    → contrato assinado, virou cliente
- "payment.received" → pagamento de honorário recebido
- null               → ConversionAction NÃO deve disparar OCI (ex: page views, scroll, ações off-funnel)

Regras:
- Para CADA action, sugira UM evento (ou null) + confidence (0..1) + reasoning curto (1 frase em pt-BR).
- "Calls" / "Phone Call" / "Ligar" / "Chamada telefônica" → "lead.created" (alguém ligou após ver anúncio)
- "Click WhatsApp" / "Falar com advogado" / "Lead Form" → "lead.created"
- "Page View" / "Scroll" / "Time on page" → null (engagement, não conversão real)
- "Compra" / "Pagamento" / "Purchase" → "payment.received"
- "Signup" / "Cadastro" → "lead.created"
- Sem dados suficientes → null com confidence baixa

Responda APENAS um JSON válido (sem markdown), formato:
{"suggestions":[{"id":"...","event":"lead.created"|null,"confidence":0.9,"reasoning":"..."}]}`;

    const userPrompt = `ConversionActions a mapear:\n\n${actions
      .map(
        (a) =>
          `- id=${a.id} name="${a.name}" category=${a.category} type=${
            a.type ?? '—'
          } current=${a.crm_event_kind ?? 'null'}`,
      )
      .join('\n')}`;

    const client = new Anthropic({ apiKey: key });
    let raw = '';
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1500,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      raw = ((response.content[0] as any)?.text || '').trim();
    } catch (e: any) {
      this.logger.error(
        `[mapping-ai] Anthropic falhou: ${e?.message ?? e}`,
      );
      throw new HttpException(
        `Falha ao chamar Claude API: ${e?.message ?? 'desconhecido'}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Parse defensivo — Claude às vezes envolve em ```json
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn(`[mapping-ai] resposta sem JSON: ${raw.slice(0, 200)}`);
      throw new HttpException(
        'IA retornou resposta sem JSON válido — tente novamente.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new HttpException(
        'IA retornou JSON inválido — tente novamente.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const items: any[] = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : [];

    // Indexa por id, valida campos, descarta entradas inválidas
    const valid = new Set([
      'lead.created',
      'lead.qualified',
      'client.signed',
      'payment.received',
    ]);
    const byId = new Map<string, any>();
    for (const it of items) {
      if (!it?.id || typeof it.id !== 'string') continue;
      const ev =
        typeof it.event === 'string' && valid.has(it.event) ? it.event : null;
      byId.set(it.id, {
        event: ev,
        confidence:
          typeof it.confidence === 'number' && it.confidence >= 0 && it.confidence <= 1
            ? it.confidence
            : 0.5,
        reasoning:
          typeof it.reasoning === 'string'
            ? it.reasoning.slice(0, 200)
            : 'Sem justificativa.',
      });
    }

    const suggestions = actions.map((a) => {
      const sug = byId.get(a.id);
      return {
        conversion_action_id: a.id,
        name: a.name,
        category: a.category,
        current_mapping: a.crm_event_kind,
        suggested_event: sug?.event ?? null,
        confidence: sug?.confidence ?? 0,
        reasoning: sug?.reasoning ?? 'IA não sugeriu mapeamento.',
      };
    });

    this.logger.log(
      `[mapping-ai] tenant=${tenantId} model=${model} actions=${actions.length} unmapped=${totalUnmapped}`,
    );

    return {
      suggestions,
      model,
      total_unmapped: totalUnmapped,
    };
  }
}
