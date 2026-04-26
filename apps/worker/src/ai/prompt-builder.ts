import { Logger } from '@nestjs/common';
import type { LLMToolDef } from './llm-client';

/**
 * Rotulos legiveis das subcategorias de memoria organizacional.
 * Usado para compor o bloco "Informacoes do Escritorio" no prompt.
 */
const ORG_SUBCATEGORY_LABELS: Record<string, string> = {
  office_info: 'Escritorio',
  team: 'Equipe',
  fees: 'Honorarios',
  procedures: 'Procedimentos',
  court_info: 'Foruns e Varas',
  legal_knowledge: 'Conhecimento Local',
  contacts: 'Contatos Uteis',
  rules: 'Regras',
  geral: 'Geral',
};

/**
 * PromptBuilder: monta o system prompt final e as definições de tools
 * a partir da skill selecionada, suas references e variáveis de contexto.
 */
export class PromptBuilder {
  private readonly logger = new Logger(PromptBuilder.name);

  /**
   * Compoe o bloco de "Informacoes do Escritorio" a partir das memorias
   * organizacionais ativas (agrupadas por subcategoria).
   * Retorna null quando nao ha memorias suficientes.
   *
   * Token budget: truncado em ~2000 chars (~500 tokens).
   */
  buildOrganizationMemoryBlock(memories: Array<{ content: string; subcategory: string | null }>): string | null {
    if (!memories || memories.length === 0) return null;

    const grouped: Record<string, string[]> = {};
    for (const m of memories) {
      const cat = m.subcategory || 'geral';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(m.content);
    }

    let block = '';
    for (const [cat, items] of Object.entries(grouped)) {
      const label = ORG_SUBCATEGORY_LABELS[cat] || cat;
      block += `**${label}:** ${items.join('. ')}.\n`;
    }

    if (block.length > 2000) {
      block = block.substring(0, 2000) + '\n[...memorias omitidas por espaco]';
    }
    return block.trim();
  }

  /**
   * Compoe as 3 camadas de memoria que vao no inicio do system prompt:
   *   1. Informacoes do Escritorio (OrganizationProfile.summary OU fallback
   *      bloco agrupado de memorias organizacionais cruas)
   *   2. Perfil do Cliente (LeadProfile.summary)
   *   3. Interacoes Recentes (memorias episodicas)
   *
   * Aceita:
   *   - `orgSummary` (preferido) — texto ja consolidado pronto para injetar
   *   - `orgMemories` (fallback) — lista crua para agrupar via buildOrganizationMemoryBlock
   */
  buildMemoryLayers(params: {
    orgSummary?: string | null;
    orgMemories?: Array<{ content: string; subcategory: string | null }>;
    leadProfileSummary?: string | null;
    recentEpisodes?: Array<{ content: string }>;
  }): string {
    const parts: string[] = [];

    let orgText: string | null = null;
    if (params.orgSummary && params.orgSummary.trim()) {
      orgText = params.orgSummary.trim();
    } else if (params.orgMemories && params.orgMemories.length > 0) {
      orgText = this.buildOrganizationMemoryBlock(params.orgMemories);
    }
    if (orgText) {
      parts.push(`## Informacoes do Escritorio (use naturalmente, nao cite como "base de dados"):\n${orgText}`);
    }

    if (params.leadProfileSummary && params.leadProfileSummary.trim()) {
      parts.push(`## Perfil do Cliente (use naturalmente, nao cite como "ficha"):\n${params.leadProfileSummary.trim()}`);
    }

    if (params.recentEpisodes && params.recentEpisodes.length > 0) {
      const lines = params.recentEpisodes.map((m) => `- ${m.content}`).join('\n');
      parts.push(`## Interacoes Recentes:\n${lines}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
  }

  /**
   * Monta o system prompt completo para uma chamada LLM.
   * Composição: MEDIA_CAPABILITIES + BEHAVIOR_RULES + skill.system_prompt + references
   *
   * Regras específicas de plantão noturno não ficam aqui — a skill decide
   * via variável {{business_hours_info}} (injetada por ai.processor.ts).
   */
  buildSystemPrompt(params: {
    mediaCapabilities: string;
    behaviorRules: string;
    skillPrompt: string;
    references: { name: string; content: string }[];
    maxContextTokens: number;
    vars: Record<string, string>;
    extraInjections?: string; // ex: FORM_DATA_INJECTION legado
    memoryBlock?: string; // 3 camadas de memoria (org + perfil + episodios)
  }): string {
    const { mediaCapabilities, behaviorRules, skillPrompt, references, maxContextTokens, vars, extraInjections, memoryBlock } = params;

    let prompt = mediaCapabilities + '\n\n';
    prompt += this.injectVariables(behaviorRules, vars) + '\n\n';
    prompt += this.injectVariables(skillPrompt, vars);

    // Injeta bloco de memoria automaticamente APENAS se a skill nao referenciar
    // nenhuma das variaveis de memoria novas ({{office_memories}},
    // {{lead_profile}}, {{recent_episodes}}, {{memory_block}}).
    // Assim skills adaptadas controlam o posicionamento via {{...}}, e skills
    // antigas continuam recebendo a memoria no final por retrocompatibilidade.
    if (memoryBlock && memoryBlock.trim()) {
      const usesNewVars = /\{\{(office_memories|lead_profile|recent_episodes|memory_block)\}\}/.test(skillPrompt);
      if (!usesNewVars) {
        prompt += '\n\n' + memoryBlock;
      }
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
   * Tools UNIVERSAIS — adicionadas automaticamente em toda skill que usa
   * tool calling. Cobrem busca de dados do lead/processo/memoria sem
   * precisar que o admin configure SkillTool por skill.
   *
   * Motivacao (2026-04-21): antes pre-consolidavamos LeadProfile via LLM
   * a cada movimentacao nova — alto custo e muitas vezes desperdicio.
   * Agora a IA busca direto no banco quando o cliente pergunta. Input
   * tokens sao baratos ($2/1M no GPT-4.1), entao pode trazer muita info.
   */
  private readonly UNIVERSAL_TOOL_DEFS: LLMToolDef[] = [
    {
      type: 'function',
      function: {
        name: 'get_lead_info',
        description:
          'Retorna dados cadastrais e situacao atual do lead: nome, telefone, email, ' +
          'processos ativos (numero, area, vara, advogado), stage no funil, tags, ' +
          'eventos do calendario. Use antes de saudar pelo nome ou quando precisar ' +
          'de qualquer informacao basica sobre o cliente.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_case_movements',
        description:
          'Retorna TODAS as movimentacoes judiciais do processo do lead (ate 500). ' +
          'Use quando o cliente perguntar sobre status, andamento, decisoes, audiencias, ' +
          'prazos, ou qualquer detalhe processual. Se o lead tem multiplos processos, ' +
          'traz de todos. Pode filtrar por case_number opcional. Input tokens sao baratos, ' +
          'entao nao se preocupe com volume — LLM filtra o relevante na hora de responder.',
        parameters: {
          type: 'object',
          properties: {
            case_number: {
              type: 'string',
              description:
                'Opcional. Numero CNJ (ex: "0700223-79.2022.8.02.0204") para filtrar ' +
                'apenas aquele processo. Se omitido, traz de todos os processos ativos do lead.',
            },
            limit: {
              type: 'number',
              description: 'Opcional. Max de movimentacoes a retornar. Default 200, max 500.',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_memory',
        description:
          'Busca semantica nas memorias do lead + organizacao + mensagens passadas. ' +
          'Use quando precisar lembrar de algo especifico que foi dito no passado ' +
          '(ex: "o cliente ja mandou o RG?", "falei com ele sobre honorarios?"). ' +
          'Retorna trechos mais relevantes com fonte e data.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Termo de busca em portugues natural.',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'abrir_caso_viabilidade',
        description:
          'USO EXCLUSIVO PARA CLIENTES JA CONTRATADOS (is_client=true). ' +
          'Cria um novo caso em stage=VIABILIDADE quando o cliente menciona um ' +
          'assunto juridico NOVO, diferente dos processos que ja tem no CRM. ' +
          'Exemplos pra USAR: "agora tenho outro problema", "queria tirar duvida sobre ' +
          'outro assunto", "meu vizinho esta me processando", "minha mae precisa aposentar". ' +
          'NAO USE quando: lead ainda nao e cliente (a tool retorna erro); cliente pergunta ' +
          'sobre processo existente (use get_lead_info / get_case_movements); cliente confirma ' +
          'compromisso ou envia documento. O handler valida is_client=true antes de criar — ' +
          'leads normais recebem erro. Tambem ha protecao contra duplicatas em 24h. ' +
          'Apos criar, o advogado responsavel e notificado automaticamente.',
        parameters: {
          type: 'object',
          properties: {
            subject: {
              type: 'string',
              description:
                'Descricao breve (1-2 frases) do novo assunto que o cliente mencionou. ' +
                'Use as palavras dele o mais proximo possivel. Ex: "Vizinho esta me ' +
                'processando por causa de cerca no terreno" ou "Quer entrar com acao ' +
                'de aposentadoria pra mae dele de 62 anos".',
            },
            legal_area: {
              type: 'string',
              description:
                'Opcional. Area juridica inferida. Valores aceitos: trabalhista, civel, ' +
                'previdenciario, consumidor, familia, criminal, tributario, empresarial. ' +
                'Se incerto, omita — o advogado classifica depois.',
            },
            urgency: {
              type: 'string',
              enum: ['baixa', 'media', 'alta'],
              description:
                'Opcional. Urgencia reportada: alta se ha prazo iminente ou risco de ' +
                'dano grave; media se precisa resposta em dias; baixa se so quer ' +
                'orcamento/avaliacao. Default: media.',
            },
          },
          required: ['subject'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'book_appointment',
        description:
          'AGENDAR CONSULTA com o advogado responsavel. Use quando o cliente quer ' +
          'falar diretamente com o advogado humano (frases tipo "quero falar com o advogado", ' +
          '"preciso conversar pessoalmente", "marca um horario", "humano por favor"). ' +
          'NAO USE pra duvidas que voce mesmo pode responder consultando processo/movimentacao. ' +
          'Antes de chamar, sempre pergunte qual data/hora prefere o cliente. ' +
          'Cria CalendarEvent type=CONSULTA, notifica advogado e cliente, agenda lembretes. ' +
          'Importante: aceitar slots em horario comercial (seg-sex 8h-18h).',
        parameters: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Data no formato YYYY-MM-DD (ex: 2026-04-30)',
            },
            time: {
              type: 'string',
              description: 'Hora no formato HH:MM 24h (ex: "14:00")',
            },
            title: {
              type: 'string',
              description: 'Opcional. Titulo da consulta. Default: "Consulta — {nome do cliente}"',
            },
            description: {
              type: 'string',
              description: 'Opcional. Motivo/contexto resumido pra advogado se preparar.',
            },
            duration_minutes: {
              type: 'number',
              description: 'Opcional. Duracao em minutos. Default: 60.',
            },
          },
          required: ['date', 'time'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_portal_link',
        description:
          'COMPLEMENTO ao agendamento — envia link do PORTAL DO CLIENTE pra que o ' +
          'cliente possa acessar self-service. Use quando: ' +
          '(a) cliente prefere escolher horario sozinho ao inves de voce agendar; ' +
          '(b) cliente quer ver documentos/pagamentos/contratos/processo; ' +
          '(c) cliente insiste em informacao detalhada que esta melhor no portal. ' +
          'IMPORTANTE: ofereca SEMPRE como ALTERNATIVA quando cliente quer falar com advogado: ' +
          '"posso agendar agora ou voce pode escolher horario pelo portal: [link]". ' +
          'Diferente de escalate_to_human (que desliga a IA), aqui voce continua atendendo.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Opcional. Razao breve do envio do link (debug).',
            },
          },
          required: [],
        },
      },
    },
  ];

  /**
   * Converte SkillTool[] do banco para o formato OpenAI/Anthropic function calling
   * e INJETA as tools universais (get_lead_info, get_case_movements, search_memory).
   */
  buildToolDefinitions(skillTools: any[]): LLMToolDef[] {
    const skillDefs = skillTools
      .filter((t: any) => t.active)
      .map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters_json || { type: 'object', properties: {} },
        },
      }));

    // Tools universais sao injetadas se ainda nao estiverem presentes como
    // SkillTool customizado no banco (evita duplicacao caso admin configure).
    const skillNames = new Set(skillDefs.map((d) => d.function.name));
    const universalToAdd = this.UNIVERSAL_TOOL_DEFS.filter(
      (def) => !skillNames.has(def.function.name),
    );

    return [...skillDefs, ...universalToAdd];
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
