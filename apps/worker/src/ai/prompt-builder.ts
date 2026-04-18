import { Logger } from '@nestjs/common';
import type { LLMToolDef } from './llm-client';

/**
 * Injeção de comportamento fora do expediente.
 * Inserida no system prompt quando a IA foi ativada pelo cron AfterHours
 * (conversation.ai_mode_source = 'CRON_AFTER_HOURS'). Define o papel de
 * plantão noturno sem dar orientação jurídica e foca em agendamento.
 */
export const AFTER_HOURS_PROMPT_INJECTION = `

═══════════════════════════════════════════════════════════════════════
CONTEXTO: FORA DO HORÁRIO DE EXPEDIENTE
═══════════════════════════════════════════════════════════════════════

Você está atendendo FORA do horário de expediente do escritório
André Lustosa Advogados.

HORÁRIO DE FUNCIONAMENTO: segunda a sexta, das 8h às 18h.
SITUAÇÃO ATUAL: o escritório está fechado — você é a assistente virtual
de plantão.

REGRAS PARA ATENDIMENTO NOTURNO:

1. NA PRIMEIRA interação da conversa nesta janela, informe ao cliente:
   - Que o escritório funciona de segunda a sexta, das 8h às 18h.
   - Que você pode ajudar com informações sobre processos e
     agendamentos.
   - Que, em caso de urgência (prisão, flagrante, medida protetiva),
     você aciona o advogado de plantão.

2. VOCÊ PODE:
   - Informar andamento de processos já existentes do cliente.
   - Informar datas de audiências e prazos já marcados.
   - Agendar reuniões/consultas usando a tool book_appointment.
   - Receber documentos/informações para triagem posterior.
   - Responder dúvidas sobre o escritório (endereço, áreas, contato).

3. VOCÊ NÃO PODE:
   - Dar parecer jurídico ou orientação estratégica sobre o caso.
   - Tomar decisões em nome do advogado.
   - Prometer resultados ou prazos.
   - Informar valores de honorários.

4. SE O CLIENTE QUISER FALAR COM O ADVOGADO:
   - Use check_availability para buscar horários reais do próximo dia
     útil. NUNCA invente horários.
   - Ofereça 2-3 opções ao cliente.
   - Quando ele confirmar, use book_appointment para registrar a
     reunião. O advogado responsável será notificado automaticamente.

5. SE FOR URGÊNCIA (prisão, flagrante, ameaça, violência doméstica,
   medida protetiva):
   - Use escalate_to_human IMEDIATAMENTE com reason =
     "URGÊNCIA NOTURNA: [descrição curta]".
   - Informe ao cliente que está acionando o advogado de plantão.
   - Confirme o número para contato, se ainda não tiver.

6. TOM: cordial, acolhedor, profissional. Assuma explicitamente o
   papel de "assistente virtual do Escritório André Lustosa Advogados".
   Nunca finja estar no horário comercial — transparência sobre o
   horário ajuda a confiança do cliente.
`;

/**
 * PromptBuilder: monta o system prompt final e as definições de tools
 * a partir da skill selecionada, suas references e variáveis de contexto.
 */
export class PromptBuilder {
  private readonly logger = new Logger(PromptBuilder.name);

  /**
   * Monta o system prompt completo para uma chamada LLM.
   * Composição: MEDIA_CAPABILITIES + BEHAVIOR_RULES + skill.system_prompt + references
   */
  buildSystemPrompt(params: {
    mediaCapabilities: string;
    behaviorRules: string;
    skillPrompt: string;
    references: { name: string; content: string }[];
    maxContextTokens: number;
    vars: Record<string, string>;
    extraInjections?: string; // ex: FORM_DATA_INJECTION legado
    afterHoursMode?: boolean; // true quando conversation.ai_mode_source = 'CRON_AFTER_HOURS'
  }): string {
    const { mediaCapabilities, behaviorRules, skillPrompt, references, maxContextTokens, vars, extraInjections, afterHoursMode } = params;

    let prompt = mediaCapabilities + '\n\n';
    prompt += this.injectVariables(behaviorRules, vars) + '\n\n';
    prompt += this.injectVariables(skillPrompt, vars);

    if (afterHoursMode) {
      prompt += '\n' + this.injectVariables(AFTER_HOURS_PROMPT_INJECTION, vars);
    }

    // Inject references within token budget
    if (references.length > 0) {
      let refBlock = '\n\n--- DOCUMENTOS DE REFERÊNCIA ---\n';
      let totalChars = 0;
      const charBudget = maxContextTokens * 4; // rough token-to-char ratio

      for (const ref of references) {
        if (totalChars + ref.content.length > charBudget) {
          this.logger.warn(`[PromptBuilder] Reference "${ref.name}" truncada (budget de ${maxContextTokens} tokens)`);
          const remaining = charBudget - totalChars;
          if (remaining > 100) {
            refBlock += `\n### ${ref.name}\n${ref.content.slice(0, remaining)}...[truncado]\n`;
          }
          break;
        }
        refBlock += `\n### ${ref.name}\n${ref.content}\n`;
        totalChars += ref.content.length;
      }

      prompt += refBlock;
      this.logger.log(`[PromptBuilder] ${references.length} references injetadas (${totalChars} chars)`);
    } else {
      this.logger.warn('[PromptBuilder] NENHUMA reference encontrada para injeção');
    }

    if (extraInjections) {
      prompt += '\n\n' + this.injectVariables(extraInjections, vars);
    }

    this.logger.log(`[PromptBuilder] Prompt total: ${prompt.length} chars (~${Math.round(prompt.length/4)} tokens)`);
    return prompt;
  }

  /**
   * Converte SkillTool[] do banco para o formato OpenAI/Anthropic function calling.
   */
  buildToolDefinitions(skillTools: any[]): LLMToolDef[] {
    return skillTools
      .filter((t: any) => t.active)
      .map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters_json || { type: 'object', properties: {} },
        },
      }));
  }

  /**
   * Tool especial "respond_to_client" que garante o formato de saída consistente.
   * O modelo DEVE chamar este tool como ação final quando tem tools disponíveis.
   */
  buildRespondToClientTool(): LLMToolDef {
    return {
      type: 'function',
      function: {
        name: 'respond_to_client',
        description: 'Envia a resposta final ao cliente via WhatsApp. SEMPRE use esta função como sua ação final para responder ao cliente.',
        parameters: {
          type: 'object',
          properties: {
            reply: {
              type: 'string',
              description: 'Texto da mensagem a enviar ao cliente via WhatsApp',
            },
            updates: {
              type: 'object',
              description: 'Atualizações opcionais do lead. Preencha sempre que houver mudança de estágio ou informação nova coletada.',
              properties: {
                name: {
                  type: 'string',
                  description: 'Nome real do cliente quando informado',
                },
                status: {
                  type: 'string',
                  enum: [
                    'QUALIFICANDO',
                    'AGUARDANDO_FORM',
                    'AGUARDANDO_DOCS',
                    'AGUARDANDO_PROC',
                    'REUNIAO_AGENDADA',
                    'FINALIZADO',
                    'PERDIDO',
                  ],
                  description: 'Novo estágio do lead no funil. Use QUALIFICANDO ao iniciar triagem, AGUARDANDO_FORM ao enviar formulário, AGUARDANDO_DOCS ao pedir documentos, AGUARDANDO_PROC ao pedir procuração, REUNIAO_AGENDADA ao confirmar reunião, FINALIZADO ao contratar, PERDIDO ao desistir.',
                },
                loss_reason: {
                  type: 'string',
                  description: 'Motivo da perda (obrigatório quando status = PERDIDO)',
                },
                area: {
                  type: 'string',
                  description: 'Área jurídica do caso (ex: Trabalhista, Cível, Criminal)',
                },
                lead_summary: {
                  type: 'string',
                  description: 'Resumo do caso coletado até agora',
                },
                next_step: {
                  type: 'string',
                  description: 'Próximo passo do atendimento',
                },
                notes: {
                  type: 'string',
                  description: 'Observações internas sobre o lead',
                },
                form_data: {
                  type: 'object',
                  description: 'Campos do formulário trabalhista coletados. Inclua todos os campos já obtidos.',
                },
              },
            },
            scheduling_action: {
              type: 'object',
              description: 'Use para confirmar agendamento de reunião. Preencha quando o lead CONFIRMAR o horário.',
              properties: {
                action: { type: 'string', enum: ['confirm_slot'] },
                date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
                time: { type: 'string', description: 'Horário no formato HH:MM' },
              },
            },
            slots_to_offer: {
              type: 'array',
              description: 'Quando oferecer horários de reunião ao lead, liste aqui os horários disponíveis. O sistema enviará como mensagem interativa (lista clicável) no WhatsApp. Use APENAS quando estiver na etapa de oferecer horários, NÃO quando já confirmou.',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', description: 'Data YYYY-MM-DD' },
                  time: { type: 'string', description: 'Horário HH:MM' },
                  label: { type: 'string', description: 'Texto amigável ex: "Segunda 07/04 às 09:00"' },
                },
              },
            },
          },
          required: ['reply'],
        },
      },
    };
  }

  private injectVariables(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }
    return result;
  }
}
