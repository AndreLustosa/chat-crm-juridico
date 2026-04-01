import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { CalendarService } from '../calendar/calendar.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private calendarService: CalendarService,
  ) {}

  private tenantWhere(tenantId?: string) {
    return tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {};
  }

  private async verifyTenantOwnership(id: string, tenantId?: string) {
    if (!tenantId) return;
    const task = await this.prisma.task.findUnique({ where: { id }, select: { tenant_id: true } });
    if (task?.tenant_id && task.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
  }

  async findAll(
    tenantId?: string,
    page?: number,
    limit?: number,
    filters?: {
      status?: string;
      assignedUserId?: string;
      dueFilter?: string; // 'today' | 'week' | 'overdue'
      search?: string;
    },
  ) {
    const baseTenant = this.tenantWhere(tenantId);
    const andClauses: any[] = [baseTenant];

    if (filters?.status && filters.status !== 'all') {
      andClauses.push({ status: filters.status });
    }
    if (filters?.assignedUserId) {
      andClauses.push({ assigned_user_id: filters.assignedUserId });
    }
    if (filters?.search?.trim()) {
      andClauses.push({ title: { contains: filters.search.trim(), mode: 'insensitive' } });
    }
    if (filters?.dueFilter === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      andClauses.push({ due_at: { gte: start, lte: end } });
    } else if (filters?.dueFilter === 'week') {
      const end = new Date(); end.setDate(end.getDate() + 7); end.setHours(23, 59, 59, 999);
      andClauses.push({ due_at: { lte: end } });
    } else if (filters?.dueFilter === 'overdue') {
      andClauses.push({ due_at: { lt: new Date() }, status: { notIn: ['CONCLUIDA', 'CANCELADA'] } });
    }

    const where = andClauses.length === 1 ? baseTenant : { AND: andClauses };

    const includeOpts = {
      lead: true,
      assigned_user: true,
      _count: { select: { comments: true } },
    };

    if (page && limit) {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.task.findMany({
          where,
          include: includeOpts,
          orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.task.count({ where }),
      ]);
      return { data, total, page, limit };
    }

    const data = await this.prisma.task.findMany({
      where,
      include: includeOpts,
      orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }],
    });
    return { data, total: data.length, page: 1, limit: data.length };
  }

  async findOne(id: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    return this.prisma.task.findUnique({
      where: { id },
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true } },
        comments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { created_at: 'asc' },
        },
        checklist_items: { orderBy: { position: 'asc' } },
        _count: { select: { comments: true, checklist_items: true } },
      },
    });
  }

  // ─── Checklist CRUD ───────────────────────────────────────────────────────

  async addChecklistItem(taskId: string, text: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    const count = await this.prisma.taskChecklistItem.count({ where: { task_id: taskId } });
    return this.prisma.taskChecklistItem.create({
      data: { task_id: taskId, text, position: count },
    });
  }

  async toggleChecklistItem(taskId: string, itemId: string, done: boolean, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    return this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: { done },
    });
  }

  async deleteChecklistItem(taskId: string, itemId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    await this.prisma.taskChecklistItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  async create(data: {
    title: string;
    description?: string;
    lead_id?: string;
    conversation_id?: string;
    legal_case_id?: string;
    assigned_user_id?: string;
    due_at?: string | Date;
    tenant_id?: string;
    created_by_id?: string;
  }) {
    const task = await this.prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        lead_id: data.lead_id,
        conversation_id: data.conversation_id,
        legal_case_id: data.legal_case_id,
        assigned_user_id: data.assigned_user_id,
        due_at: data.due_at ? new Date(data.due_at) : null,
        tenant_id: data.tenant_id,
        status: 'A_FAZER',
      },
    });

    // Sync to calendar if has due_at
    if (task.due_at && data.created_by_id) {
      await this.syncTaskToCalendar(task, data.created_by_id);
    }

    return task;
  }

  async updateStatus(id: string, status: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    const task = await this.prisma.task.update({
      where: { id },
      data: { status },
    });

    // Sync calendar event status
    if (task.calendar_event_id) {
      try {
        const statusMap: Record<string, string> = {
          'CONCLUIDA': 'CONCLUIDO',
          'CANCELADA': 'CANCELADO',
          'EM_PROGRESSO': 'CONFIRMADO',
          'A_FAZER': 'AGENDADO',
        };
        const calStatus = statusMap[status];
        if (calStatus) {
          await this.calendarService.updateStatus(task.calendar_event_id, calStatus);
        }
      } catch (e: any) {
        this.logger.warn(`Erro ao sincronizar status do calendario para task ${id}: ${e.message}`);
      }
    }

    return task;
  }

  async update(id: string, data: {
    title?: string;
    description?: string;
    status?: string;
    due_at?: string | Date | null;
    assigned_user_id?: string | null;
  }, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.due_at !== undefined) updateData.due_at = data.due_at ? new Date(data.due_at) : null;
    if (data.assigned_user_id !== undefined) updateData.assigned_user_id = data.assigned_user_id;

    const task = await this.prisma.task.update({
      where: { id },
      data: updateData,
    });

    // Sync calendar event status if status changed via full update
    if (task.calendar_event_id && data.status !== undefined) {
      try {
        const statusMap: Record<string, string> = {
          'CONCLUIDA': 'CONCLUIDO',
          'CANCELADA': 'CANCELADO',
          'EM_PROGRESSO': 'CONFIRMADO',
          'A_FAZER': 'AGENDADO',
        };
        const calStatus = statusMap[data.status];
        if (calStatus) {
          await this.calendarService.updateStatus(task.calendar_event_id, calStatus);
        }
      } catch (e: any) {
        this.logger.warn(`Erro ao sincronizar status do calendario via update() para task ${id}: ${e.message}`);
      }
    }

    // Update linked calendar event if due_at changed
    if (task.calendar_event_id && data.due_at !== undefined) {
      try {
        if (data.due_at) {
          await this.calendarService.update(task.calendar_event_id, {
            start_at: new Date(data.due_at).toISOString(),
            end_at: new Date(new Date(data.due_at).getTime() + 30 * 60000).toISOString(),
          });
        } else {
          // Prazo removido: deletar CalendarEvent vinculado e desvincular da task
          await this.calendarService.remove(task.calendar_event_id).catch(() => {});
          await this.prisma.task.update({ where: { id }, data: { calendar_event_id: null } });
        }
      } catch (e: any) {
        this.logger.warn(`Erro ao atualizar evento do calendario para task ${id}: ${e.message}`);
      }
    }

    return task;
  }

  // ─── Complete Task & Reopen Conversation (legado) ─────────────

  async completeAndReopen(taskId: string, tenantId?: string) {
    return this.complete(taskId, '', 'system', tenantId);
  }

  // ─── Complete com nota de resultado ───────────────────────────

  async complete(taskId: string, note: string, userId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    const ops: any[] = [
      this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'CONCLUIDA', completion_note: note?.trim() || null },
      }),
    ];
    if (task.conversation_id) {
      ops.push(
        this.prisma.conversation.update({ where: { id: task.conversation_id }, data: { status: 'ABERTO' } }),
      );
    }
    if (note?.trim() && userId !== 'system') {
      ops.push(
        this.prisma.taskComment.create({
          data: { task_id: taskId, user_id: userId, text: `✅ Concluída: ${note.trim()}` },
        }),
      );
    }

    const [updatedTask] = await this.prisma.$transaction(ops);

    if (updatedTask.calendar_event_id) {
      try { await this.calendarService.updateStatus(updatedTask.calendar_event_id, 'CONCLUIDO'); } catch {}
    }

    this.chatGateway.emitConversationsUpdate(task.tenant_id ?? null);
    return { task: updatedTask, conversationId: task.conversation_id };
  }

  // ─── Adiar com motivo + histórico de adiamentos ───────────────

  async postpone(taskId: string, newDueAt: string, reason: string, userId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    const newDate = new Date(newDueAt);
    const dateLabel = newDate.toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: taskId },
        data: { due_at: newDate, postpone_count: { increment: 1 } },
      }),
      (this.prisma as any).taskPostponement.create({
        data: {
          task_id: taskId,
          old_due_at: task.due_at ?? new Date(),
          new_due_at: newDate,
          reason: reason.trim(),
          created_by_id: userId,
        },
      }),
      this.prisma.taskComment.create({
        data: {
          task_id: taskId,
          user_id: userId,
          text: `⏰ Adiada para ${dateLabel}: ${reason.trim()}`,
        },
      }),
    ]);

    if (task.calendar_event_id) {
      try {
        await this.calendarService.update(task.calendar_event_id, {
          start_at: newDate.toISOString(),
          end_at: new Date(newDate.getTime() + 30 * 60000).toISOString(),
        });
      } catch {}
    }

    this.chatGateway.emitConversationsUpdate(task.tenant_id ?? null);
    return { ok: true, conversationId: task.conversation_id };
  }

  // ─── Find Active Task by Conversation ─────────────────────────

  async findActiveByConversation(conversationId: string, tenantId?: string) {
    if (tenantId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { tenant_id: true },
      });
      if (conv?.tenant_id && conv.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
      }
    }
    return this.prisma.task.findFirst({
      where: { conversation_id: conversationId, status: { in: ['A_FAZER', 'EM_PROGRESSO'] } },
      orderBy: { created_at: 'desc' },
    });
  }

  // ─── Calendar Sync ──────────────────────────────────────────────

  private async syncTaskToCalendar(task: any, createdById: string) {
    try {
      const event = await this.calendarService.create({
        type: 'TAREFA',
        title: task.title,
        description: task.description || undefined,
        start_at: task.due_at.toISOString(),
        end_at: new Date(task.due_at.getTime() + 30 * 60000).toISOString(),
        assigned_user_id: task.assigned_user_id || createdById,
        lead_id: task.lead_id || undefined,
        legal_case_id: task.legal_case_id || undefined,
        created_by_id: createdById,
        tenant_id: task.tenant_id || undefined,
        // Lembretes PUSH: no momento exato + 15min antes + 1h antes
        reminders: [
          { minutes_before: 0, channel: 'PUSH' },
          { minutes_before: 15, channel: 'PUSH' },
          { minutes_before: 60, channel: 'PUSH' },
        ],
      });

      // Link task to calendar event
      await this.prisma.task.update({
        where: { id: task.id },
        data: { calendar_event_id: event.id },
      });

      this.logger.log(`Task ${task.id} sincronizada com CalendarEvent ${event.id}`);
    } catch (e: any) {
      this.logger.warn(`Erro ao sincronizar task ${task.id} com calendario: ${e.message}`);
    }
  }

  // ─── Legal Case Tasks ──────────────────────────────────────────

  async findByLegalCase(legalCaseId: string, tenantId?: string) {
    if (tenantId) {
      const lc = await this.prisma.legalCase.findUnique({
        where: { id: legalCaseId },
        select: { tenant_id: true },
      });
      if (lc?.tenant_id && lc.tenant_id !== tenantId) {
        throw new ForbiddenException('Acesso negado a este recurso');
      }
    }
    return this.prisma.task.findMany({
      where: { legal_case_id: legalCaseId },
      include: {
        assigned_user: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ─── Task Comments ─────────────────────────────────────────────

  async addComment(taskId: string, userId: string, text: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    const comment = await this.prisma.taskComment.create({
      data: { task_id: taskId, user_id: userId, text },
      include: { user: { select: { id: true, name: true } } },
    });

    // Notificar o atribuido da tarefa (se for diferente de quem comentou)
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assigned_user_id: true },
    });
    if (task?.assigned_user_id && task.assigned_user_id !== userId) {
      try {
        this.chatGateway.emitTaskComment(task.assigned_user_id, {
          taskId,
          text,
          fromUserName: comment.user.name,
        });
      } catch {}
    }

    return comment;
  }

  async findComments(taskId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    return this.prisma.taskComment.findMany({
      where: { task_id: taskId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { created_at: 'asc' },
    });
  }

  // ─── SPRINT 4: Escalonamento progressivo de tarefas vencidas ──────────────

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    try {
      const now = new Date();
      const overdueTasks = await this.prisma.task.findMany({
        where: {
          due_at: { lt: now },
          status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
          assigned_user_id: { not: null },
        },
        select: {
          id: true,
          title: true,
          due_at: true,
          assigned_user_id: true,
          assigned_user: { select: { id: true, name: true } },
        },
      });

      for (const task of overdueTasks) {
        if (!task.assigned_user_id || !task.due_at) continue;
        const hoursOverdue = (now.getTime() - new Date(task.due_at).getTime()) / 3_600_000;

        // Escalonamento: apenas notifica em intervalos específicos para evitar spam
        const level = hoursOverdue >= 72 ? 'critical' : hoursOverdue >= 24 ? 'urgent' : 'warning';
        // Emitir apenas 1x por intervalo (na primeira hora de cada nível)
        const shouldNotify = (
          (level === 'warning'  && hoursOverdue < 2) ||
          (level === 'urgent'   && hoursOverdue >= 24 && hoursOverdue < 25) ||
          (level === 'critical' && hoursOverdue >= 72 && hoursOverdue < 73)
        );

        if (shouldNotify) {
          this.chatGateway.server?.to(`user:${task.assigned_user_id}`).emit('task_overdue_alert', {
            taskId: task.id,
            title: task.title,
            dueAt: task.due_at,
            hoursOverdue: Math.round(hoursOverdue),
            level,
          });
        }
      }

      this.logger.log(`[TasksCron] Verificadas ${overdueTasks.length} tarefas vencidas`);
    } catch (e: any) {
      this.logger.error(`[TasksCron] Erro ao verificar tarefas vencidas: ${e.message}`);
    }
  }

  // ─── SPRINT 4: Carga de trabalho por usuário (smart assignment) ───────────

  async getWorkload(tenantId?: string) {
    const baseTenant = this.tenantWhere(tenantId);
    const tasks = await this.prisma.task.findMany({
      where: {
        ...baseTenant,
        status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
        assigned_user_id: { not: null },
      },
      select: {
        assigned_user_id: true,
        status: true,
        due_at: true,
        assigned_user: { select: { id: true, name: true } },
      },
    });

    const now = new Date();
    const map = new Map<string, { id: string; name: string; total: number; overdue: number; urgent: number }>();

    for (const task of tasks) {
      if (!task.assigned_user_id || !task.assigned_user) continue;
      if (!map.has(task.assigned_user_id)) {
        map.set(task.assigned_user_id, {
          id: task.assigned_user_id,
          name: task.assigned_user.name,
          total: 0, overdue: 0, urgent: 0,
        });
      }
      const entry = map.get(task.assigned_user_id)!;
      entry.total++;
      if (task.due_at && new Date(task.due_at) < now) entry.overdue++;
      if (task.due_at) {
        const daysLeft = (new Date(task.due_at).getTime() - now.getTime()) / 86_400_000;
        if (daysLeft >= 0 && daysLeft <= 2) entry.urgent++;
      }
    }

    // Ordenar do menos carregado ao mais carregado
    return Array.from(map.values()).sort((a, b) => a.total - b.total);
  }

  // ─── SPRINT 4: Sugestão de próxima ação por IA (Next-Best-Action) ─────────

  async suggestNextAction(context: {
    title?: string;
    description?: string;
    leadName?: string;
    caseSummary?: string;
    recentTasks?: string[];
    assignedTo?: string;
  }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        acao: null,
        urgencia: 'media',
        justificativa: 'API OpenAI não configurada. Defina OPENAI_API_KEY no ambiente.',
        tipo: 'outro',
      };
    }

    try {
      const openai = new OpenAI({ apiKey });
      // Sanitizar inputs para prevenir prompt injection: truncar e remover backticks
      const sanitize = (s?: string, max = 200) =>
        (s || '').slice(0, max).replace(/`/g, "'").replace(/[\r\n]+/g, ' ').trim();
      const safeTitle      = sanitize(context.title, 200)      || 'Não informado';
      const safeDesc       = sanitize(context.description, 400) || 'Não disponível';
      const safeLead       = sanitize(context.leadName, 100)    || 'Não informado';
      const safeCase       = sanitize(context.caseSummary, 300) || 'Não disponível';
      const safeTasks      = (context.recentTasks || []).map(t => sanitize(t, 80)).join('; ') || 'Nenhuma';
      const safeAssigned   = sanitize(context.assignedTo, 100)  || 'Não definido';
      const prompt = `Você é um assistente jurídico especializado. Analise o contexto abaixo e sugira a próxima ação mais importante que o responsável deveria tomar.

Contexto:
- Tarefa/Situação: ${safeTitle}
- Descrição: ${safeDesc}
- Cliente/Lead: ${safeLead}
- Resumo do caso: ${safeCase}
- Tarefas recentes relacionadas: ${safeTasks}
- Responsável atual: ${safeAssigned}

Responda APENAS em JSON válido no formato:
{"acao": "texto da ação sugerida (máx 80 chars)", "urgencia": "alta|media|baixa", "justificativa": "por que esta ação é prioritária (máx 120 chars)", "tipo": "ligacao|email|elaborar_peca|reuniao|protocolar|outro"}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 256,
        temperature: 0.4,
      });

      return JSON.parse(completion.choices[0].message.content || '{}');
    } catch (e: any) {
      this.logger.warn(`[NBA] Erro ao consultar OpenAI: ${e.message}`);
      return { acao: null, urgencia: 'media', justificativa: 'Erro ao consultar IA.', tipo: 'outro' };
    }
  }
}
