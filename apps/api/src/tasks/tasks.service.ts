import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
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

  // ─── Complete Task & Reopen Conversation ───────────────────────

  async completeAndReopen(taskId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    const [updatedTask] = await this.prisma.$transaction([
      this.prisma.task.update({ where: { id: taskId }, data: { status: 'CONCLUIDA' } }),
      ...(task.conversation_id ? [
        this.prisma.conversation.update({ where: { id: task.conversation_id }, data: { status: 'ABERTO' } }),
      ] : []),
    ]);

    // Sync calendar event status
    if (updatedTask.calendar_event_id) {
      try {
        await this.calendarService.updateStatus(updatedTask.calendar_event_id, 'CONCLUIDO');
      } catch (e: any) {
        this.logger.warn(`Erro ao sync calendario para task ${taskId}: ${e.message}`);
      }
    }

    // Emit socket update para atualizar sidebar em tempo real
    this.chatGateway.emitConversationsUpdate(task.tenant_id ?? null);

    return { task: updatedTask, conversationId: task.conversation_id };
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
}
