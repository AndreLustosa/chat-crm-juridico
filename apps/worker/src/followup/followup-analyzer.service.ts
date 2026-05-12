import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { buildTokenParam } from '../common/openai-token-param.util';

/**
 * Analisa o contexto de um lead e decide o que fazer no followup automatico.
 * Substitui os templates fixos por mensagens geradas pela IA com base na
 * conversa inteira.
 *
 * 3 possiveis decisoes:
 * - ARCHIVE: lead sinalizou desinteresse/desistencia -> marcar como PERDIDO
 * - SEND: vale enviar followup agora -> retorna mensagem personalizada
 * - SKIP: nao eh hora (interacao recente, contexto nao pede followup)
 *
 * Custo: ~$0.02 por analise (GPT-4.1-mini, input tokens baratos mesmo com
 * historico grande). Roda so uma vez por lead por dia, no cron das 9h.
 */
@Injectable()
export class FollowupAnalyzerService {
  private readonly logger = new Logger(FollowupAnalyzerService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /**
   * Decide o que fazer com o lead no followup automatico.
   * Context rico: todo historico de mensagens + dados do lead + perfil LLM.
   */
  async analyzeAndDecide(params: {
    leadId: string;
    conversationId: string;
    stage: string;
    stageHint?: string; // ex: "aguardando documentos faltantes ha 3 dias"
  }): Promise<FollowupDecision> {
    const { leadId, conversationId, stage, stageHint } = params;

    // 1. Carregar contexto completo do lead
    const [lead, messages, profile] = await Promise.all([
      this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          legal_cases: {
            where: { archived: false },
            select: {
              case_number: true,
              legal_area: true,
              tracking_stage: true,
              opposing_party: true,
            },
          },
          ficha_trabalhista: {
            select: { completion_pct: true, finalizado: true },
          },
        },
      }),
      // Todas as mensagens da conversa, limitado a 100 mais recentes
      // (cobre ~95% dos casos; leads com 100+ msgs ja sao qualificados).
      this.prisma.message.findMany({
        where: { conversation_id: conversationId },
        orderBy: { created_at: 'desc' },
        take: 100,
        select: { direction: true, text: true, type: true, created_at: true },
      }),
      this.prisma.leadProfile.findUnique({
        where: { lead_id: leadId },
        select: { summary: true },
      }),
    ]);

    if (!lead) {
      return { action: 'SKIP', reason: 'Lead nao encontrado' };
    }

    // Sem mensagens inbound = lead novo ou so importado. Nao gera followup
    // sem contexto nenhum.
    const inboundCount = messages.filter((m) => m.direction === 'in').length;
    if (inboundCount === 0) {
      return { action: 'SKIP', reason: 'Lead sem mensagens do cliente (contexto vazio)' };
    }

    // 2. Montar contexto textual para o LLM
    const chronological = [...messages].reverse();
    const historyText = chronological
      .slice(-80) // Ultimas 80 para caber no context — 100 total indexada mas LLM ve 80
      .map((m) => {
        const who = m.direction === 'in' ? 'CLIENTE' : 'SOPHIA';
        const when = new Date(m.created_at).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Maceio',
        });
        const text = m.text || `[${m.type || 'sem texto'}]`;
        return `[${when}] ${who}: ${text.slice(0, 500)}`;
      })
      .join('\n');

    const leadInfo = [
      `Nome: ${lead.name || 'sem nome'}`,
      `Telefone: ${lead.phone}`,
      `Stage CRM: ${stage}`,
      stageHint && `Motivo do followup: ${stageHint}`,
      lead.is_client ? 'E CLIENTE contratado' : 'LEAD em qualificacao',
      lead.legal_cases?.length
        ? `Processos: ${lead.legal_cases.length} ativos — ${lead.legal_cases.map((c: any) => `${c.legal_area} vs ${c.opposing_party || 'sem parte'}`).join('; ')}`
        : 'Sem processos ativos',
      lead.ficha_trabalhista
        ? `Ficha trabalhista: ${lead.ficha_trabalhista.completion_pct}% preenchida${lead.ficha_trabalhista.finalizado ? ' (finalizada)' : ''}`
        : null,
      profile?.summary ? `Perfil consolidado: ${profile.summary.slice(0, 400)}` : null,
    ].filter(Boolean).join('\n');

    // 3. Chamar LLM para decidir
    const openAiKey = await this.settings.getOpenAiKey();
    if (!openAiKey) {
      this.logger.warn('[FollowupAnalyzer] OPENAI_API_KEY ausente — fallback SKIP');
      return { action: 'SKIP', reason: 'OpenAI key nao configurada' };
    }

    const openai = new OpenAI({ apiKey: openAiKey });
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(leadInfo, historyText);

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...buildTokenParam('gpt-4.1-mini', 400),
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);

      // Normalizar resposta
      const action = String(parsed.action || '').toUpperCase();
      if (action === 'ARCHIVE') {
        return {
          action: 'ARCHIVE',
          reason: parsed.reason || 'IA detectou sinal de desinteresse',
        };
      }
      if (action === 'SKIP') {
        return {
          action: 'SKIP',
          reason: parsed.reason || 'IA decidiu nao enviar agora',
        };
      }
      if (action === 'SEND' && parsed.message) {
        return {
          action: 'SEND',
          message: String(parsed.message).trim(),
          reason: parsed.reason || null,
        };
      }

      // Resposta malformada — fallback pra SKIP
      this.logger.warn(
        `[FollowupAnalyzer] Resposta malformada do LLM — action=${action} temMsg=${!!parsed.message}. Fallback SKIP.`,
      );
      return { action: 'SKIP', reason: 'LLM retornou formato invalido' };
    } catch (err: any) {
      this.logger.warn(`[FollowupAnalyzer] Erro LLM: ${err.message}. Fallback SKIP.`);
      return { action: 'SKIP', reason: `Erro LLM: ${err.message}` };
    }
  }

  private buildSystemPrompt(): string {
    return `Voce e a Sophia, atendente virtual do escritorio Andre Lustosa Advogados.
Sua tarefa AGORA nao e responder ao cliente — e DECIDIR se vale a pena enviar
um followup automatico pra um lead que nao conversa ha dias.

Voce recebe:
  - Dados do lead (nome, stage CRM, processos)
  - Historico COMPLETO da conversa (mensagens CLIENTE e SOPHIA)

Decida ENTRE 3 acoes:

1. **ARCHIVE** — Arquivar o lead (marcar como PERDIDO)
   Use quando o lead sinalizou claramente:
   * "Nao quero mais", "sem interesse", "desisti"
   * "Ja contratei outro escritorio", "ja resolvi"
   * "Pare de me mandar mensagem", "me deixa em paz"
   * Ou qualquer manifestacao inequivoca de desengajamento
   Exemplo de reason: "Cliente disse explicitamente 'desisti' em 15/04"

2. **SEND** — Enviar followup personalizado (voce escreve a mensagem)
   Use quando o lead ESTA engajado mas parou de responder recentemente, e
   faz sentido retomar com uma mensagem especifica baseada no ultimo contexto.
   A mensagem DEVE:
   * Ser curta (max 2 frases, estilo WhatsApp)
   * Referenciar algo REAL do historico (documento que falta, pergunta
     pendente, audiencia marcada)
   * Perguntar algo ESPECIFICO em vez de generico (nao "tudo bem?")
   * NAO usar "obrigado", "agradeco", nem saudacao formal
   * NAO comecar com "Ola" repetitivo se ja teve varia msgs
   * Ser em portugues brasileiro, tom profissional mas proximo

3. **SKIP** — Nao enviar agora
   Use quando:
   * Ultima interacao foi muito recente (ja e obvio que esta em andamento)
   * Conversa esta em ponto natural (lead acabou de enviar documento,
     aguarda voce voltar)
   * Stage indica que a acao ja foi tomada e nao precisa cobrar
   * Contexto ambiguo — prefira nao spammar

RESPONDA APENAS JSON:
{"action": "ARCHIVE"|"SEND"|"SKIP", "message": "..." (so se SEND), "reason": "motivo curto"}`;
  }

  private buildUserPrompt(leadInfo: string, historyText: string): string {
    return `=== DADOS DO LEAD ===
${leadInfo}

=== HISTORICO DA CONVERSA (cronologico) ===
${historyText || '(sem mensagens registradas)'}

Decida e retorne JSON conforme instruido.`;
  }
}

export interface FollowupDecision {
  action: 'ARCHIVE' | 'SEND' | 'SKIP';
  message?: string; // so quando action === 'SEND'
  reason?: string | null;
}
