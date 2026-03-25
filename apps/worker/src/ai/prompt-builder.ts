import { Logger } from '@nestjs/common';
import type { LLMToolDef } from './llm-client';

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
  }): string {
    const { mediaCapabilities, behaviorRules, skillPrompt, references, maxContextTokens, vars, extraInjections } = params;

    let prompt = mediaCapabilities + '\n\n';
    prompt += this.injectVariables(behaviorRules, vars) + '\n\n';
    prompt += this.injectVariables(skillPrompt, vars);

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
    }

    if (extraInjections) {
      prompt += '\n\n' + this.injectVariables(extraInjections, vars);
    }

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
