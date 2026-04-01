import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { TasksService } from '../tasks/tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import OpenAI from 'openai';

// ─── Session Types ────────────────────────────────────────────────────────────

interface BotMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

interface AdminBotSession {
  userId: string;
  tenantId: string | null;
  messages: BotMessage[];
  lastActivity: Date;
}

// ─── Admin Bot Service ────────────────────────────────────────────────────────

@Injectable()
export class AdminBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminBotService.name);
  private readonly sessions = new Map<string, AdminBotSession>();
  private openai: OpenAI | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private enabledCache: { value: boolean; expiry: number } | null = null;

  /** Palavras-chave que identificam intenção de comando admin */
  private static readonly COMMAND_KEYWORDS = [
    'criar', 'crie', 'criar tarefa', 'crie uma tarefa', 'nova tarefa',
    'agendar', 'agende', 'marcar', 'marque', 'criar evento', 'crie um evento',
    'nova consulta', 'agendar consulta', 'audiência', 'prazo',
    'listar tarefas', 'minhas tarefas', 'tarefas pendentes', 'ver tarefas',
    'buscar cliente', 'procurar cliente', 'listar clientes',
    'ajuda', 'help', 'comandos',
  ];

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private tasksService: TasksService,
    private calendarService: CalendarService,
  ) {}

  onModuleInit() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      this.logger.log('[AdminBot] Inicializado com OpenAI');
    } else {
      this.logger.warn('[AdminBot] OPENAI_API_KEY não configurada — bot desativado');
    }

    // Limpa sessões inativas a cada 5 minutos
    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutos
      for (const [key, session] of this.sessions.entries()) {
        if (session.lastActivity.getTime() < cutoff) {
          this.sessions.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Verifica se o telefone pertence a um usuário ADMIN ou ADVOGADO do sistema.
   * Retorna o user se encontrado, null caso contrário.
   */
  async findAdminByPhone(phone: string): Promise<any | null> {
    const normalized = phone.replace(/\D/g, '');
    return this.prisma.user.findFirst({
      where: {
        phone: { in: [normalized, phone] },
        role: { in: ['ADMIN', 'ADVOGADO'] },
      },
      select: { id: true, name: true, role: true, tenant_id: true },
    });
  }

  /**
   * Detecta se o texto parece ser um comando administrativo.
   * Retorna true se já há sessão ativa (conversa em andamento) ou se contém palavras-chave.
   */
  /** Verifica se o Admin Bot está habilitado no banco (cache de 60s) */
  async isEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.enabledCache && now < this.enabledCache.expiry) {
      return this.enabledCache.value;
    }
    const row = await this.prisma.globalSetting.findUnique({ where: { key: 'ADMIN_BOT_ENABLED' } });
    const value = row?.value !== 'false'; // padrão: habilitado
    this.enabledCache = { value, expiry: now + 60_000 };
    return value;
  }

  /** Invalida o cache de enabled (usado ao salvar a config) */
  clearEnabledCache() {
    this.enabledCache = null;
  }

  isAdminCommand(sessionKey: string, text: string): boolean {
    // Bot desativado (OPENAI_API_KEY ausente no ambiente) — não interceptar
    if (!this.openai) return false;
    // Se há sessão ativa, qualquer mensagem é parte do comando
    if (this.sessions.has(sessionKey)) return true;
    // Verifica palavras-chave de comando
    const lower = text.toLowerCase().trim();
    return AdminBotService.COMMAND_KEYWORDS.some(kw => lower.includes(kw));
  }

  /**
   * Processa uma mensagem de comando administrativo.
   * Envia a resposta de volta via WhatsApp.
   */
  async handle(
    instanceName: string,
    phone: string,
    text: string,
    userId: string,
    tenantId: string | null,
  ): Promise<void> {
    if (!this.openai) return;

    const sessionKey = `${instanceName}:${phone}`;
    const jid = `${phone}@s.whatsapp.net`;

    // Comando de cancelamento
    if (/^(cancelar|sair|parar|quit|cancel|tchau)$/i.test(text.trim())) {
      this.sessions.delete(sessionKey);
      await this.sendReply(instanceName, jid, '❌ Operação cancelada.');
      return;
    }

    // Obter ou criar sessão
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = { userId, tenantId, messages: [], lastActivity: new Date() };
      this.sessions.set(sessionKey, session);
    }
    session.lastActivity = new Date();
    session.messages.push({ role: 'user', content: text });

    // Manter janela de contexto (últimas 20 mensagens)
    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }

    // Enviar indicador de "digitando"
    await this.whatsapp.sendPresence(instanceName, jid, 'composing').catch(() => {});

    try {
      const response = await this.runAgentLoop(session);

      if (response) {
        await this.sendReply(instanceName, jid, response);
        session.messages.push({ role: 'assistant', content: response });
      }

      // Se a ação foi concluída (tool create_task ou create_calendar_event executada),
      // limpar a sessão após resposta de confirmação
      const lastMsgs = session.messages.slice(-3);
      const hasCompletion = lastMsgs.some(m =>
        m.role === 'assistant' && (m.content.includes('✅') || m.content.includes('criada') || m.content.includes('agendado'))
      );
      if (hasCompletion) {
        setTimeout(() => this.sessions.delete(sessionKey), 5000);
      }
    } catch (e: any) {
      this.logger.error(`[AdminBot] Erro ao processar comando: ${e.message}`);
      await this.sendReply(instanceName, jid, '❌ Erro interno. Tente novamente ou digite "cancelar".');
    }
  }

  // ─── Agent Loop (OpenAI Function Calling) ────────────────────────────────

  private async runAgentLoop(session: AdminBotSession): Promise<string> {
    const messages: any[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      ...session.messages,
    ];

    let iterations = 0;
    const MAX_ITERATIONS = 6;

    while (iterations++ < MAX_ITERATIONS) {
      const completion = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: this.getTools(),
        tool_choice: 'auto',
        max_tokens: 600,
        temperature: 0.2,
      });

      const choice = completion.choices[0];
      const msg = choice.message;
      messages.push(msg);

      // Sem tool calls → retornar resposta textual
      if (!msg.tool_calls?.length) {
        return msg.content?.trim() || '';
      }

      // Executar tool calls em paralelo
      const toolResults = await Promise.all(
        msg.tool_calls.map(async (tc) => {
          const result = await this.executeTool(
            tc.function.name,
            JSON.parse(tc.function.arguments),
            session.userId,
            session.tenantId,
          );
          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(result),
          };
        }),
      );

      messages.push(...toolResults);
    }

    return 'Não consegui completar a operação. Tente reformular ou digite "cancelar".';
  }

  // ─── System Prompt ────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });
    const timeStr = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });

    return `Você é o assistente administrativo do CRM Jurídico — acessível via WhatsApp pelo administrador.

📅 Hoje: ${dateStr} às ${timeStr} (Horário de Brasília)

## O que você pode fazer
- Criar tarefas para clientes e processos
- Agendar eventos: consultas, audiências, prazos, reuniões
- Listar tarefas pendentes do usuário
- Buscar clientes e processos

## Regras de Resposta
- Português brasileiro, linguagem direta
- Mensagens CURTAS (WhatsApp, não e-mail)
- Emojis com moderação para clareza
- UMA pergunta por vez
- Listas numeradas para o usuário selecionar opções
- Confirmar ações executadas com ✅
- Para cancelar: o usuário digita "cancelar"

## Interpretação de Datas (fuso: America/Sao_Paulo)
- "amanhã às 14h" → próximo dia 14:00
- "sexta" ou "na sexta" → próxima sexta-feira
- "15/04" → 15 de abril (ano atual ou próximo se já passou)
- "em 2 dias" → daqui a 2 dias
- Sempre incluir fuso -03:00 no ISO 8601

## Fluxo Criar Tarefa
1. Buscar cliente pelo nome (search_leads)
2. Se múltiplos: listar e perguntar qual
3. Buscar processos do cliente (get_legal_cases)
4. Perguntar o processo (ou "nenhum")
5. Confirmar/perguntar título da tarefa
6. Perguntar data/hora de vencimento
7. Criar a tarefa (create_task) e confirmar com ✅

## Fluxo Agendar Evento
1. Identificar tipo: consulta, audiência, prazo ou reunião
2. Buscar cliente se mencionado
3. Buscar processos se aplicável
4. Perguntar data e hora
5. Criar o evento (create_calendar_event) e confirmar com ✅

## Exemplo de resposta de lista
Encontrei 3 processos de Beatriz:
1️⃣ Trabalhista — Rescisão indireta (ativo)
2️⃣ Consumidor — Plano de saúde (ativo)
3️⃣ Civil — Indenização (arquivado)

Para qual processo? (responda 1, 2, 3 ou "nenhum")`;
  }

  // ─── Tools Definition ─────────────────────────────────────────────────────

  private getTools(): OpenAI.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'search_leads',
          description: 'Busca clientes/leads no CRM pelo nome. Use para encontrar o ID do cliente.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Nome ou parte do nome do cliente' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_legal_cases',
          description: 'Lista os processos jurídicos de um cliente. Use após identificar o lead_id.',
          parameters: {
            type: 'object',
            properties: {
              lead_id: { type: 'string', description: 'ID do lead/cliente' },
            },
            required: ['lead_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_users',
          description: 'Lista usuários do CRM (advogados e operadores) para atribuição.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_task',
          description: 'Cria uma nova tarefa no CRM. Use somente após ter todas as informações necessárias.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Título claro e objetivo da tarefa' },
              description: { type: 'string', description: 'Detalhes adicionais (opcional)' },
              lead_id: { type: 'string', description: 'ID do cliente (opcional)' },
              legal_case_id: { type: 'string', description: 'ID do processo (opcional)' },
              assigned_user_id: { type: 'string', description: 'ID do responsável (opcional — padrão: usuário atual)' },
              due_at: { type: 'string', description: 'Vencimento em ISO 8601 com fuso -03:00 (ex: 2026-04-15T14:00:00-03:00)' },
            },
            required: ['title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_calendar_event',
          description: 'Cria um evento no calendário. Use somente após ter todas as informações necessárias.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Título do evento' },
              type: {
                type: 'string',
                enum: ['CONSULTA', 'AUDIENCIA', 'PRAZO', 'TAREFA', 'OUTRO'],
                description: 'Tipo do evento',
              },
              start_at: { type: 'string', description: 'Início em ISO 8601 com fuso -03:00' },
              end_at: { type: 'string', description: 'Fim em ISO 8601 (opcional — padrão: início +1h)' },
              lead_id: { type: 'string', description: 'ID do cliente (opcional)' },
              legal_case_id: { type: 'string', description: 'ID do processo (opcional)' },
              assigned_user_id: { type: 'string', description: 'ID do responsável (opcional)' },
            },
            required: ['title', 'type', 'start_at'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_my_tasks',
          description: 'Lista as tarefas pendentes do usuário atual (A_FAZER ou EM_PROGRESSO).',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Máximo de tarefas (padrão: 10)' },
            },
          },
        },
      },
    ];
  }

  // ─── Tool Executor ────────────────────────────────────────────────────────

  private async executeTool(
    name: string,
    args: any,
    userId: string,
    tenantId: string | null,
  ): Promise<any> {
    this.logger.log(`[AdminBot] Tool: ${name} | args: ${JSON.stringify(args)}`);

    try {
      switch (name) {
        case 'search_leads': {
          const leads = await this.prisma.lead.findMany({
            where: {
              name: { contains: args.query, mode: 'insensitive' },
              ...(tenantId ? { tenant_id: tenantId } : {}),
            },
            select: { id: true, name: true, phone: true, stage: true },
            orderBy: { name: 'asc' },
            take: 6,
          });
          if (!leads.length) {
            return { found: false, message: 'Nenhum cliente encontrado com esse nome.' };
          }
          return { found: true, count: leads.length, leads };
        }

        case 'get_legal_cases': {
          const cases = await this.prisma.legalCase.findMany({
            where: { lead_id: args.lead_id },
            select: {
              id: true, case_number: true,
              legal_area: true, action_type: true,
              stage: true, opposing_party: true,
            },
            orderBy: { created_at: 'desc' },
            take: 8,
          });
          if (!cases.length) {
            return { found: false, message: 'Nenhum processo encontrado para este cliente.' };
          }
          return { found: true, count: cases.length, cases };
        }

        case 'list_users': {
          const users = await this.prisma.user.findMany({
            where: { role: { in: ['ADMIN', 'ADVOGADO', 'OPERADOR'] } },
            select: { id: true, name: true, role: true },
            orderBy: { name: 'asc' },
          });
          return { users };
        }

        case 'create_task': {
          const task = await this.tasksService.create({
            title: args.title,
            description: args.description,
            lead_id: args.lead_id,
            legal_case_id: args.legal_case_id,
            assigned_user_id: args.assigned_user_id || userId,
            due_at: args.due_at,
            tenant_id: tenantId || undefined,
            created_by_id: userId,
          });
          return {
            success: true,
            task: {
              id: task.id,
              title: task.title,
              due_at: task.due_at
                ? new Date(task.due_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                : null,
            },
          };
        }

        case 'create_calendar_event': {
          const startAt = new Date(args.start_at);
          const endAt = args.end_at
            ? new Date(args.end_at)
            : new Date(startAt.getTime() + 60 * 60 * 1000);

          const event = await this.calendarService.create({
            title: args.title,
            type: args.type,
            start_at: startAt.toISOString(),
            end_at: endAt.toISOString(),
            lead_id: args.lead_id,
            legal_case_id: args.legal_case_id,
            assigned_user_id: args.assigned_user_id || userId,
            created_by_id: userId,
            tenant_id: tenantId || undefined,
          });
          return {
            success: true,
            event: {
              id: event.id,
              title: event.title,
              start_at: new Date(event.start_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            },
          };
        }

        case 'list_my_tasks': {
          const limit = Math.min(args.limit || 10, 15);
          const tasks = await this.prisma.task.findMany({
            where: {
              assigned_user_id: userId,
              status: { in: ['A_FAZER', 'EM_PROGRESSO'] },
              ...(tenantId ? { tenant_id: tenantId } : {}),
            },
            include: { lead: { select: { name: true } } },
            orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
            take: limit,
          });
          return {
            count: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              title: t.title,
              client: t.lead?.name || null,
              due_at: t.due_at
                ? new Date(t.due_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                : 'Sem prazo',
              status: t.status,
            })),
          };
        }

        default:
          return { error: `Ferramenta '${name}' não implementada` };
      }
    } catch (e: any) {
      this.logger.error(`[AdminBot] Erro na tool '${name}': ${e.message}`);
      return { error: e.message };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async sendReply(instanceName: string, jid: string, text: string): Promise<void> {
    await this.whatsapp.sendText(jid, text, instanceName).catch((e) =>
      this.logger.error(`[AdminBot] Falha ao enviar resposta: ${e.message}`),
    );
  }
}
