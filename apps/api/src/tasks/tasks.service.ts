import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import OpenAI from 'openai';
import { buildTokenParam } from '../common/utils/openai-token-param.util';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { CalendarService } from '../calendar/calendar.service';
import { MediaS3Service } from '../media/s3.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import { tenantOrDefault } from '../common/constants/tenant';
import { isAdmin } from '../common/utils/permissions.util';
import { inferFolder, VALID_FOLDERS } from './task-folder-inference.util';
import { MAX_ATTACHMENT_BYTES, ACK_BATCH_MAX_IDS, OVERDUE_SLA_WINDOW_HOURS, OVERDUE_TASKS_BATCH_LIMIT, WORKLOAD_WINDOW_DAYS, DELEGATION_METRICS_TASKS_LIMIT, OPENAI_NBA_TIMEOUT_MS } from '../calendar/calendar.constants';

// Whitelist de MIME types pra anexos de Task. Mesma do portal/upload —
// PDF, imagens, Office, TXT. Bloqueia executaveis e scripts.
const ALLOWED_ATTACHMENT_MIMES = new Set<string>([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private calendarService: CalendarService,
    private s3: MediaS3Service,
    private notifications: NotificationsService,
    private cronRunner: CronRunnerService,
  ) {}

  private tenantWhere(tenantId?: string) {
    return tenantId ? { tenant_id: tenantId } : {};
  }

  private async verifyTenantOwnership(id: string, tenantId?: string) {
    if (!tenantId) return;
    const task = await this.prisma.task.findUnique({ where: { id }, select: { tenant_id: true } });
    if (task?.tenant_id && task.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
  }

  /**
   * Bug fix 2026-05-10 (PR2 #1): ownership check de Task — substitui
   * `verifyTenantOwnership` em todos os endpoints user-facing. Sem isso,
   * qualquer user do mesmo tenant podia editar/comentar/anexar/marcar
   * concluida diligencia de outro advogado. Agora:
   *   - ADMIN passa direto
   *   - User precisa ser assigned_user_id, created_by_id, ou
   *     acknowledged_by_id pra alterar
   *   - Tenant ainda checado (defesa contra manipulacao de IDs)
   *
   * Quando legacy task.tenant_id esta NULL (pre-hardening 2026-05-07),
   * exigimos tenant_id no caller — diferente do `verifyTenantOwnership`
   * que era permissivo (pulava check). Tasks legacy podem precisar
   * backfill de tenant_id antes de serem editadas.
   */
  private async verifyTaskOwnership(
    id: string,
    userId: string | undefined,
    roles: string | string[] | undefined,
    tenantId?: string,
  ): Promise<void> {
    if (!userId) {
      throw new ForbiddenException('Operacao requer usuario autenticado');
    }
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { tenant_id: true, assigned_user_id: true, created_by_id: true, acknowledged_by_id: true },
    });
    if (!task) throw new NotFoundException('Tarefa nao encontrada');
    // Tenant check primeiro
    if (tenantId && task.tenant_id && task.tenant_id !== tenantId) {
      throw new ForbiddenException('Tarefa de outro tenant');
    }
    // Admin passa
    if (isAdmin(roles || [])) return;
    // Owner: assigned, criador, ou ack-er
    const isOwner =
      task.assigned_user_id === userId ||
      task.created_by_id === userId ||
      task.acknowledged_by_id === userId;
    if (!isOwner) {
      throw new ForbiddenException('Sem permissao para acessar esta tarefa');
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

  async findOne(id: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    // Bug fix 2026-05-10 (PR2 #1): findOne agora exige ownership — antes
    // qualquer user do mesmo tenant lia titulo/descricao/comments/checklist
    // de diligencia alheia.
    if (userId) {
      await this.verifyTaskOwnership(id, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(id, tenantId);
    }
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

  async addChecklistItem(taskId: string, text: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    if (userId) {
      await this.verifyTaskOwnership(taskId, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(taskId, tenantId);
    }
    const count = await this.prisma.taskChecklistItem.count({ where: { task_id: taskId } });
    return this.prisma.taskChecklistItem.create({
      data: { task_id: taskId, text, position: count },
    });
  }

  async toggleChecklistItem(taskId: string, itemId: string, done: boolean, tenantId?: string, userId?: string, roles?: string | string[]) {
    if (userId) {
      await this.verifyTaskOwnership(taskId, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(taskId, tenantId);
    }
    return this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: { done },
    });
  }

  async deleteChecklistItem(taskId: string, itemId: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    if (userId) {
      await this.verifyTaskOwnership(taskId, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(taskId, tenantId);
    }
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
        tenant_id: tenantOrDefault(data.tenant_id),
        status: 'A_FAZER',
        // Sem isso, a notificacao de conclusao nao sabe pra quem voltar
        // o aviso ("estagiario X concluiu Y" precisa do criador). Tambem
        // usado pra exibir "criada por" nos cards.
        created_by_id: data.created_by_id || null,
      },
    });

    // Sync to calendar if has due_at
    if (task.due_at && data.created_by_id) {
      await this.syncTaskToCalendar(task, data.created_by_id);
    }

    // ─── Notificacao imediata ao responsavel (BUG fix) ─────────
    //
    // Antes a notif so chegava via syncTaskToCalendar quando havia due_at,
    // e mesmo assim era um *reminder* X minutos antes do horario, nao um
    // aviso de "voce tem nova diligencia". Resultado: estagiario nao sabia
    // que recebeu tarefa nova ate abrir o app por outra razao.
    //
    // Agora dispara push + WhatsApp 5min depois (com dedup) na hora da
    // delegacao, igual ao fluxo de upload no portal do cliente. Pula se
    // o proprio criador eh o responsavel (auto-tarefa nao notifica) ou se
    // a Task nao tem responsavel atribuido.
    if (data.assigned_user_id && data.assigned_user_id !== data.created_by_id) {
      try {
        const [creator, lead, legalCase] = await Promise.all([
          data.created_by_id ? this.prisma.user.findUnique({
            where: { id: data.created_by_id },
            select: { name: true },
          }) : Promise.resolve(null),
          data.lead_id ? this.prisma.lead.findUnique({
            where: { id: data.lead_id },
            select: { name: true },
          }) : Promise.resolve(null),
          data.legal_case_id ? this.prisma.legalCase.findUnique({
            where: { id: data.legal_case_id },
            select: { case_number: true },
          }) : Promise.resolve(null),
        ]);
        const creatorName = creator?.name || 'Sistema';
        const lines: string[] = [];
        lines.push(`Delegado por ${creatorName}`);
        if (legalCase?.case_number) lines.push(`Processo: ${legalCase.case_number}`);
        else if (lead?.name) lines.push(`Cliente: ${lead.name}`);
        if (data.due_at) {
          const due = new Date(data.due_at);
          lines.push(`Prazo: ${due.toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          })}`);
        }
        if (data.description?.trim()) {
          const desc = data.description.trim();
          lines.push(desc.length > 200 ? desc.slice(0, 197) + '…' : desc);
        }

        this.notifications.create({
          userId: data.assigned_user_id,
          tenantId: data.tenant_id || null,
          type: 'task_assigned',
          title: `Nova diligência: ${data.title}`,
          body: lines.join('\n') || undefined,
          data: {
            taskId: task.id,
            createdBy: data.created_by_id,
            legalCaseId: data.legal_case_id,
            leadId: data.lead_id,
          },
        }).catch(() => { /* fire and forget */ });
      } catch (e: any) {
        this.logger.warn(`[Task create] notif imediata falhou: ${e.message}`);
      }
    }

    return task;
  }

  async updateStatus(id: string, status: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    if (userId) {
      await this.verifyTaskOwnership(id, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(id, tenantId);
    }
    // Auto-set started_at na 1a transicao pra EM_PROGRESSO — advogado
    // quer saber QUANDO o estagiario comecou a executar a diligencia.
    // Idempotente: se ja foi setado uma vez, nao reescreve em re-clicks
    // ou voltas (caso a task tenha sido reaberta).
    //
    // Bug fix 2026-05-10 (PR2 #6): race condition no SELECT+UPDATE separado.
    // Tentamos primeiro UPDATE atomico (started_at IS NULL), depois UPDATE
    // simples (status only). Se o updateMany pegar 0 linhas, outro caller
    // ja marcou started_at — fazemos so o status update sem reescrever.
    let task: any;
    if (status === 'EM_PROGRESSO') {
      // Tenta atomicamente setar status + started_at se ainda eh null
      const startResult = await this.prisma.task.updateMany({
        where: { id, started_at: null },
        data: { status, started_at: new Date() },
      });
      if (startResult.count === 0) {
        // started_at ja existe: so atualiza status
        task = await this.prisma.task.update({ where: { id }, data: { status } });
      } else {
        task = await this.prisma.task.findUnique({ where: { id } });
      }
    } else {
      task = await this.prisma.task.update({ where: { id }, data: { status } });
    }

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

    // Sinal real-time pro delegante — painel atualiza sem polling.
    if (task.created_by_id && task.created_by_id !== task.assigned_user_id) {
      this.chatGateway.emitTaskStatusChanged(task.created_by_id, {
        taskId: id,
        status,
        assignedUserId: task.assigned_user_id,
      });
    }

    return task;
  }

  async update(id: string, data: {
    title?: string;
    description?: string;
    status?: string;
    due_at?: string | Date | null;
    assigned_user_id?: string | null;
  }, tenantId?: string, userId?: string, roles?: string | string[]) {
    if (userId) {
      await this.verifyTaskOwnership(id, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(id, tenantId);
    }
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.due_at !== undefined) updateData.due_at = data.due_at ? new Date(data.due_at) : null;
    if (data.assigned_user_id !== undefined) updateData.assigned_user_id = data.assigned_user_id;

    // Re-delegacao: se o responsavel mudou (e nao eh o mesmo do antes),
    // resetamos viewed_at e started_at — o painel da PESSOA NOVA deve
    // mostrar a Task como nao-vista, nao-iniciada. Sem isso, painel
    // exibia "vista em X" e "iniciada em Y" baseado no responsavel
    // anterior, confundindo a nova atribuicao.
    if (data.assigned_user_id !== undefined) {
      const current = await this.prisma.task.findUnique({
        where: { id },
        select: { assigned_user_id: true },
      });
      if (current && current.assigned_user_id !== data.assigned_user_id) {
        updateData.viewed_at = null;
        updateData.started_at = null;
      }
    }

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
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        legal_case: { select: { id: true, case_number: true } },
        lead: { select: { id: true, name: true } },
      },
    });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    const ops: any[] = [
      this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'CONCLUIDA',
          completion_note: note?.trim() || null,
          completed_at: new Date(),
          ...(userId && userId !== 'system' ? { completed_by_id: userId } : {}),
        },
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
      try {
        await this.calendarService.updateStatus(
          updatedTask.calendar_event_id,
          'CONCLUIDO',
          note?.trim() || undefined,
          userId !== 'system' ? userId : undefined,
        );
      } catch {}
    }

    this.chatGateway.emitConversationsUpdate(task.tenant_id ?? null);

    // Sinal real-time pro painel "Diligencias Delegadas" do advogado
    if (task.created_by_id && task.created_by_id !== userId) {
      this.chatGateway.emitTaskStatusChanged(task.created_by_id, {
        taskId,
        status: 'CONCLUIDA',
        assignedUserId: task.assigned_user_id,
      });
    }

    // ─── Notificacao enriquecida ao criador (advogado) ──────────
    //
    // Quando estagiario marca diligencia como concluida, o advogado que
    // delegou recebe push + WhatsApp (delay 5min com dedup) com:
    //   - Quem concluiu
    //   - Quantos anexos foram subidos
    //   - Vinculo a processo se houver
    //
    // Pula se userId='system' (cron interno) ou se eh o proprio criador
    // marcando como concluido (auto-update nao notifica).
    if (
      userId !== 'system' &&
      task.created_by_id &&
      task.created_by_id !== userId
    ) {
      try {
        const [completer, attachmentCount] = await Promise.all([
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          }),
          (this.prisma as any).taskAttachment.count({ where: { task_id: taskId } }),
        ]);

        const completerName = completer?.name || 'Estagiário';
        const caseLabel = task.legal_case?.case_number || task.lead?.name || null;

        const lines: string[] = [];
        if (attachmentCount > 0) {
          lines.push(
            `📎 ${attachmentCount} ${attachmentCount === 1 ? 'anexo' : 'anexos'}` +
            (caseLabel ? ` → ${caseLabel}` : ''),
          );
        } else if (caseLabel) {
          lines.push(`Vinculado a: ${caseLabel}`);
        }
        if (note?.trim()) {
          const trimmedNote = note.trim().length > 200
            ? note.trim().slice(0, 197) + '…'
            : note.trim();
          lines.push(`"${trimmedNote}"`);
        }

        this.notifications.create({
          userId: task.created_by_id,
          tenantId: task.tenant_id || null,
          type: 'task_completed',
          title: `${completerName} concluiu: ${task.title}`,
          body: lines.join('\n') || undefined,
          data: {
            taskId,
            completedBy: userId,
            attachmentCount,
            legalCaseId: task.legal_case_id,
            leadId: task.lead_id,
          },
        }).catch(() => { /* fire and forget */ });
      } catch (e: any) {
        this.logger.warn(`[Task complete] notif enriquecida falhou: ${e.message}`);
      }
    }

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

  // ─── Diligencias delegadas pelo advogado ──────────────────────

  /**
   * Lista Tasks que `userId` delegou (created_by_id=userId E
   * assigned_user_id != userId — auto-tarefas nao contam aqui).
   * Foco em diligencias orfas (sem calendar_event_id) — Tasks vinculadas
   * a CalendarEvent processual ja aparecem em outros paineis.
   *
   * Inclui contagem de comentarios e anexos pra UI mostrar indicadores
   * sem N+1. Tracking timestamps (viewed_at, started_at, completed_at)
   * vem direto pra timeline visual.
   */
  async findDelegatedByMe(userId: string, tenantId?: string) {
    // Filtro: Tasks que userId DELEGOU (nao auto-tarefas).
    //
    // Bug fix 2026-04-27: removidos 2 filtros que excluiam diligencias reais:
    //   1. `calendar_event_id: null` — Tasks com due_at sao auto-sincronizadas
    //      com CalendarEvent (syncTaskToCalendar) e ganham calendar_event_id.
    //      Antes esse filtro excluia toda diligencia COM PRAZO, que eh
    //      justamente o uso mais comum.
    //   2. assigned_user_id: { not: userId } sozinho — em SQL three-valued
    //      logic, NULL != userId retorna NULL (nao TRUE), entao Tasks com
    //      assigned_user_id NULL eram excluidas. Mas tudo bem, faz sentido:
    //      Task sem responsavel nao eh "delegacao". Mantido.
    //
    // Tasks criadas ANTES do commit f15156b (que persistia created_by_id)
    // ficam com created_by_id NULL e nao aparecem aqui — limitacao
    // retroativa, sem backfill seguro. Novas diligencias aparecem normais.
    // Concluidas continuam aparecendo enquanto o advogado nao deu
    // "Visto / Arquivar" (acknowledged_at IS NULL). Janela hard de 30 dias
    // como teto de seguranca pro caso de tasks orfas que nunca foram
    // arquivadas (ex: advogado ficou de ferias). Antes filtro era 24h
    // hardcoded — diligencia concluida sumia em 1 dia mesmo sem o
    // advogado ter visto.
    const ACKNOWLEDGE_HARD_LIMIT_DAYS = 30;
    const ackHardLimit = new Date(Date.now() - ACKNOWLEDGE_HARD_LIMIT_DAYS * 24 * 60 * 60 * 1000);

    const tasks = await this.prisma.task.findMany({
      where: {
        created_by_id: userId,
        assigned_user_id: { not: userId }, // auto-tarefa nao conta
        OR: [
          { status: { in: ['A_FAZER', 'EM_PROGRESSO'] } },
          {
            status: 'CONCLUIDA',
            acknowledged_at: null,
            completed_at: { gte: ackHardLimit },
          },
        ],
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: {
          select: {
            id: true, case_number: true, legal_area: true,
            lead: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            comments: true,
            attachments: true,
          },
        },
      },
      orderBy: [
        // Pendentes primeiro (A_FAZER, EM_PROGRESSO), depois CONCLUIDA
        // aguardando OK. asc serve: A_FAZER < CONCLUIDA < EM_PROGRESSO
        // alfabeticamente, o que nao da a ordem certa. Fazemos ordering
        // composto manualmente por status na query, mas Prisma nao tem
        // CASE — entao ordenamos em JS depois.
        { due_at: 'asc' },
        { created_at: 'desc' },
      ],
      take: 100,
    });

    // Re-ordenacao em JS: pendentes primeiro, concluidas-aguardando depois.
    const STATUS_ORDER: Record<string, number> = {
      A_FAZER: 0,
      EM_PROGRESSO: 1,
      CONCLUIDA: 2,
    };
    tasks.sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 9;
      const sb = STATUS_ORDER[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      return 0;
    });

    // Stats agregadas pro UI mostrar contadores
    const stats = {
      pending: tasks.filter(t => t.status === 'A_FAZER').length,
      inProgress: tasks.filter(t => t.status === 'EM_PROGRESSO').length,
      // Concluidas aguardando OK — ANTES era "completedRecent" baseado em
      // janela 24h. Renomeado pra refletir o novo modelo (acknowledged).
      awaitingAcknowledge: tasks.filter(t => t.status === 'CONCLUIDA').length,
      // Quantas pendentes/em-progresso ainda nao foram VISTAS pelo
      // responsavel — vermelho de alerta no UI
      notViewed: tasks.filter(t =>
        t.status !== 'CONCLUIDA' && !t.viewed_at,
      ).length,
    };

    return { tasks, stats };
  }

  /**
   * Metricas de delegacao do advogado: tempo medio de cumprimento, taxa
   * de aprovacao (vs reabertas), volume da semana e top tipos delegados.
   * Usado pelo widget no header da secao "Diligencias Delegadas".
   *
   * Janela: ultimos 30 dias por default. Tasks reabertas aparecem como
   * TaskComment com prefixo "↩️ Reaberta para correção" — usamos isso
   * pra contar a taxa.
   */
  async getDelegationMetrics(userId: string, tenantId?: string) {
    const SINCE_DAYS = 30;
    const since = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Todas as tasks delegadas no periodo (status final + datas).
    // Bug fix 2026-05-10 (PR3 medio #8): cap em 2000 tasks pra evitar
    // OOM. Advogado prolifico (5000+ delegacoes em 30d) representa um
    // outlier — calcular metrics em cima de 5000 tasks via reduce JS
    // estoura memoria do Node + bloqueia event loop. Cap conservador
    // mantem metricas representativas (sample dos 2000 mais recentes).
    const tasks = await this.prisma.task.findMany({
      where: {
        created_by_id: userId,
        assigned_user_id: { not: userId },
        created_at: { gte: since },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      select: {
        id: true, title: true, status: true,
        created_at: true, completed_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: DELEGATION_METRICS_TASKS_LIMIT,
    });

    // Contagem de reaberturas — taskComment com texto começando em "↩️ Reaberta"
    const reopenedCommentsRaw = await this.prisma.taskComment.findMany({
      where: {
        user_id: userId,
        text: { startsWith: '↩️ Reaberta para correção' },
        task: {
          created_by_id: userId,
          created_at: { gte: since },
        },
      },
      select: { task_id: true },
    });
    const reopenedTaskIds = new Set(reopenedCommentsRaw.map(c => c.task_id));

    const completed = tasks.filter(t => t.status === 'CONCLUIDA' && t.completed_at);
    const completedThisWeek = completed.filter(t =>
      t.completed_at && new Date(t.completed_at) >= weekAgo,
    ).length;

    // Tempo medio de cumprimento — millis entre created_at e completed_at
    let avgCompletionHours: number | null = null;
    if (completed.length > 0) {
      const sumMs = completed.reduce((acc, t) => {
        const ms = new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime();
        return acc + Math.max(0, ms);
      }, 0);
      avgCompletionHours = Math.round((sumMs / completed.length) / (60 * 60 * 1000) * 10) / 10;
    }

    // Taxa de aprovacao — concluidas que NAO foram reabertas / total concluidas
    const approvalRate = completed.length > 0
      ? Math.round((completed.filter(t => !reopenedTaskIds.has(t.id)).length / completed.length) * 100)
      : null;

    // Top 3 tipos: pega primeiras 3 palavras do title como "tipo".
    // Heuristica simples mas eficaz — diligencias do escritorio sao
    // bem padronizadas ("Pegar comprovante", "Ligar para o cliente",
    // "Imprimir contrato", etc.).
    const typeCount = new Map<string, number>();
    for (const t of tasks) {
      const key = (t.title || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .slice(0, 3)
        .join(' ');
      if (!key) continue;
      typeCount.set(key, (typeCount.get(key) || 0) + 1);
    }
    const topTypes = Array.from(typeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }));

    return {
      totalIn30Days: tasks.length,
      completedIn30Days: completed.length,
      completedThisWeek,
      avgCompletionHours,
      approvalRate,
      reopenedCount: reopenedTaskIds.size,
      topTypes,
    };
  }

  // ─── Acknowledge: advogado marca diligencia concluida como vista ──

  /**
   * Marca a Task concluida como "vista pelo delegante" (advogado que criou).
   * Apos isso, o card sai do painel "Diligencias delegadas" do advogado.
   *
   * Idempotente — primeiro acknowledge ganha o timestamp, subsequentes
   * sao no-op. Permitido apenas pro created_by_id (advogado dono da
   * delegacao). Ack so faz sentido pra status=CONCLUIDA.
   */
  async acknowledge(taskId: string, userId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true, status: true, created_by_id: true,
        acknowledged_at: true,
      },
    });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    if (task.created_by_id && task.created_by_id !== userId) {
      throw new ForbiddenException('Apenas o delegante pode marcar como visto.');
    }
    if (task.status !== 'CONCLUIDA') {
      throw new BadRequestException('Só é possível marcar como visto tarefas concluídas.');
    }
    if (task.acknowledged_at) {
      return { ok: true, alreadyAcknowledged: true };
    }

    // Bug fix 2026-05-10 (PR2 #6): optimistic lock — usa updateMany com
    // WHERE acknowledged_at IS NULL pra garantir que so 1 caller vence em
    // caso de duplo clique / race entre acknowledge individual e
    // acknowledgeMany batch. Antes update() sobrescrevia
    // acknowledged_by_id e double-disparava notificacao downstream.
    const now = new Date();
    const result = await this.prisma.task.updateMany({
      where: {
        id: taskId,
        acknowledged_at: null,
        status: 'CONCLUIDA',
        // Defensa extra: nao deixa user errado vencer corrida
        ...(task.created_by_id ? { created_by_id: userId } : {}),
      },
      data: { acknowledged_at: now, acknowledged_by_id: userId },
    });
    if (result.count === 0) {
      // Outro request venceu a corrida — sucesso silencioso (idempotente)
      return { ok: true, alreadyAcknowledged: true };
    }
    return { ok: true, acknowledgedAt: now.toISOString() };
  }

  /**
   * Batch: marca varias diligencias concluidas como vistas de uma vez.
   * Usado pelo botao "Visto em todas" no header do painel.
   *
   * Filtra silenciosamente IDs invalidos (nao sao do delegante, nao
   * estao concluidas, ja ack'd) — retorna so a contagem do que foi
   * efetivamente marcado.
   */
  async acknowledgeMany(taskIds: string[], userId: string, tenantId?: string) {
    if (!taskIds?.length) return { acknowledged: 0 };

    // Bug fix 2026-05-10 (PR3 medio #13): cap em 200 IDs por request.
    // Antes cliente buggy/malicioso podia mandar 100k IDs — IN (...) com
    // muitos elementos pode estourar limite do PG ou bloquear o pool.
    if (taskIds.length > ACK_BATCH_MAX_IDS) {
      throw new BadRequestException(`Maximo ${ACK_BATCH_MAX_IDS} tarefas por request — quebre em batches menores`);
    }

    const now = new Date();
    const result = await this.prisma.task.updateMany({
      where: {
        id: { in: taskIds },
        created_by_id: userId,
        status: 'CONCLUIDA',
        acknowledged_at: null,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      data: { acknowledged_at: now, acknowledged_by_id: userId },
    });
    return { acknowledged: result.count };
  }

  /**
   * Reabre uma diligencia concluida com pedido de correcao. Estagiaria
   * recebe push + WhatsApp explicando o que precisa refazer. Status volta
   * pra A_FAZER, completed_at limpa, comment registra a justificativa
   * pra historico (igual fluxo de petitions reopen).
   *
   * Permitido apenas pro created_by_id (advogado que delegou).
   */
  async reopenWithNote(taskId: string, note: string, userId: string, tenantId?: string) {
    if (!note?.trim()) {
      throw new BadRequestException('Informe o motivo da correção.');
    }
    await this.verifyTenantOwnership(taskId, tenantId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        legal_case: { select: { id: true, case_number: true } },
        lead: { select: { id: true, name: true } },
      },
    });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    if (task.created_by_id && task.created_by_id !== userId) {
      throw new ForbiddenException('Apenas o delegante pode pedir correção.');
    }
    if (task.status !== 'CONCLUIDA') {
      throw new BadRequestException('Só é possível reabrir tarefas concluídas.');
    }

    const trimmedNote = note.trim();

    const ops: any[] = [
      this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'A_FAZER',
          completed_at: null,
          completed_by_id: null,
          completion_note: null,
          // Mantemos viewed_at/started_at: estagiaria ja tinha visto e
          // iniciado da primeira vez, nao precisa refazer esse passo.
          // Mas zeramos acknowledged_at por seguranca.
          acknowledged_at: null,
          acknowledged_by_id: null,
        },
      }),
      this.prisma.taskComment.create({
        data: {
          task_id: taskId,
          user_id: userId,
          text: `↩️ Reaberta para correção: ${trimmedNote}`,
        },
      }),
    ];
    await this.prisma.$transaction(ops);

    // Sync calendar event status back to AGENDADO se houver
    if (task.calendar_event_id) {
      try {
        await this.calendarService.updateStatus(task.calendar_event_id, 'AGENDADO');
      } catch {}
    }

    // Notificacao push pra estagiaria (so se assigned_user_id != userId)
    if (task.assigned_user_id && task.assigned_user_id !== userId) {
      try {
        const lawyer = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        const lawyerName = lawyer?.name || 'Advogado';
        const trimmed = trimmedNote.length > 200 ? trimmedNote.slice(0, 197) + '…' : trimmedNote;
        this.notifications.create({
          userId: task.assigned_user_id,
          tenantId: task.tenant_id || null,
          type: 'task_reopened',
          title: `${lawyerName} pediu correção: ${task.title}`,
          body: `"${trimmed}"`,
          data: {
            taskId,
            reopenedBy: userId,
            legalCaseId: task.legal_case_id,
            leadId: task.lead_id,
          },
        }).catch(() => { /* fire and forget */ });
      } catch (e: any) {
        this.logger.warn(`[Task reopen] notif falhou: ${e.message}`);
      }
    }

    return { ok: true, taskId, status: 'A_FAZER' };
  }

  // ─── Tracking de visualizacao ─────────────────────────────────

  /**
   * Marca a Task como vista pelo responsavel (estagiario abriu o app
   * e o card renderizou). Idempotente — primeiro view ganha o timestamp,
   * subsequentes nao mexem em nada.
   *
   * Frontend chama isso via useEffect quando o card aparece. Nao chama
   * se o user atual nao eh o assigned_user_id (advogado vendo painel
   * proprio nao conta como "vista" do estagiario).
   */
  async markViewed(taskId: string, userId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, viewed_at: true, assigned_user_id: true, created_by_id: true, status: true },
    });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    // So conta como "vista" se foi vista pelo PROPRIO responsavel —
    // advogado abrindo o painel dele nao deveria marcar a Task como
    // vista pelo estagiario. Returns silently se nao for o caso.
    if (task.assigned_user_id !== userId) {
      return { ok: true, skipped: true };
    }
    if (task.viewed_at) {
      return { ok: true, alreadyViewed: true };
    }

    // Bug fix 2026-05-10 (PR2 #6): optimistic lock — useEffect do card
    // pode disparar 2-3 calls em paralelo no mount/re-render. Sem lock,
    // todos UPDATE viewed_at e o socket emit (linha abaixo) dispara N vezes
    // pro delegante.
    const result = await this.prisma.task.updateMany({
      where: { id: taskId, viewed_at: null, assigned_user_id: userId },
      data: { viewed_at: new Date() },
    });
    if (result.count === 0) {
      return { ok: true, alreadyViewed: true };
    }

    // Sinal real-time pro painel do delegante — timeline da Task no
    // card pula de "Delegada" pra "Vista" sem o advogado precisar
    // refrescar a página.
    if (task.created_by_id && task.created_by_id !== userId) {
      this.chatGateway.emitTaskStatusChanged(task.created_by_id, {
        taskId,
        status: task.status,
        assignedUserId: task.assigned_user_id,
      });
    }

    return { ok: true, viewedAt: new Date().toISOString() };
  }

  // ─── Attachments (anexos da diligência) ───────────────────────

  /**
   * Sugere pasta automatica baseada no titulo da Task.
   * Exposto no controller como GET /tasks/:id/suggest-folder pra UI.
   */
  async suggestFolderForTask(taskId: string, tenantId?: string, userId?: string, roles?: string | string[]): Promise<string> {
    if (userId) {
      await this.verifyTaskOwnership(taskId, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(taskId, tenantId);
    }
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true },
    });
    return task ? inferFolder(task.title) : 'OUTROS';
  }

  /**
   * Lista anexos de uma Task. Inclui dados do uploader pra UI mostrar
   * "anexado por X em Y".
   */
  async listAttachments(taskId: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    if (userId) {
      await this.verifyTaskOwnership(taskId, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(taskId, tenantId);
    }
    return (this.prisma as any).taskAttachment.findMany({
      where: { task_id: taskId },
      include: { uploaded_by: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Sobe arquivos como anexos da Task. Cria registros TaskAttachment em
   * batch — cada arquivo eh validado (MIME whitelist + tamanho 25MB).
   *
   * Quando a Task tem legal_case_id, esses anexos aparecem TAMBEM na aba
   * Documentos do workspace via UNION na query do TabDocumentos. Sem
   * duplicar registros — TaskAttachment eh fonte unica.
   *
   * folder eh sugerida automaticamente pelo titulo da Task se o caller
   * nao passar override (ex: "comprovante" -> CLIENTE).
   */
  async addAttachments(
    taskId: string,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string; size: number }>,
    userId: string,
    tenantId?: string,
    folderOverride?: string,
    roles?: string | string[],
  ) {
    // Bug fix 2026-05-10 (PR2 #5): exige ownership ANTES de qualquer upload S3.
    // verifyTaskOwnership tambem rejeita task com tenant_id NULL (legacy
    // pre-hardening 2026-05-07) — sem isso anyone com taskId podia subir
    // arquivo em diligencia legacy. Antes verifyTenantOwnership pulava o check
    // se task.tenant_id era null.
    await this.verifyTaskOwnership(taskId, userId, roles, tenantId);

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, tenant_id: true, legal_case_id: true },
    });
    if (!task) throw new NotFoundException('Tarefa não encontrada');

    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    // Valida cada arquivo antes de subir qualquer um — falha rapido
    // se algum estiver fora de spec, sem orfaos no S3
    for (const f of files) {
      if (!f?.buffer) throw new BadRequestException('Arquivo vazio');
      if (f.size > MAX_ATTACHMENT_BYTES) {
        throw new PayloadTooLargeException(
          `Arquivo "${f.originalname}" muito grande (max 25MB)`,
        );
      }
      if (!ALLOWED_ATTACHMENT_MIMES.has(f.mimetype)) {
        throw new UnsupportedMediaTypeException(
          `Tipo de arquivo não permitido: ${f.mimetype} (${f.originalname})`,
        );
      }
    }

    // Pasta efetiva: override do caller > sugestao automatica > OUTROS
    const folder = folderOverride && VALID_FOLDERS.has(folderOverride)
      ? folderOverride
      : inferFolder(task.title);

    // Sobe tudo no S3 em paralelo, depois persiste em transação.
    // Bug fix 2026-05-10 (PR2 #5): se a transacao do DB falhar, removemos
    // os objetos S3 ja subidos pra evitar acumulo de orfaos (custo + GDPR).
    const uploads = await Promise.all(files.map(async (f) => {
      const ext = extname(f.originalname) || '';
      const s3Key = `task-attachments/${taskId}/${randomUUID()}${ext}`;
      await this.s3.uploadBuffer(s3Key, f.buffer, f.mimetype);
      return {
        s3Key,
        name: f.originalname,
        original_name: f.originalname,
        mime_type: f.mimetype,
        size: f.size,
      };
    }));

    let created: any[];
    try {
      created = await this.prisma.$transaction(
        uploads.map((u) =>
          (this.prisma as any).taskAttachment.create({
            data: {
              task_id: taskId,
              tenant_id: tenantOrDefault(task.tenant_id || tenantId),
              uploaded_by_id: userId,
              name: u.name,
              original_name: u.original_name,
              s3_key: u.s3Key,
              mime_type: u.mime_type,
              size: u.size,
              folder,
            },
          }),
        ),
      );
    } catch (txErr: any) {
      // Cleanup S3: rollback orfaos
      this.logger.warn(`[TaskAttachment] Transacao DB falhou — limpando ${uploads.length} S3 orfaos: ${txErr.message}`);
      await Promise.all(uploads.map(u =>
        this.s3.deleteObject(u.s3Key).catch(e =>
          this.logger.warn(`[TaskAttachment] Falha cleanup S3 ${u.s3Key}: ${e.message}`)
        )
      ));
      throw txErr;
    }

    this.logger.log(
      `[TaskAttachment] ${created.length} anexo(s) na task ${taskId} ` +
      `(folder=${folder}, tem_caso=${!!task.legal_case_id})`,
    );

    return created;
  }

  /**
   * Stream de download de um anexo. Bug fix 2026-05-10 (PR2 #1): agora
   * exige ownership da Task pai (nao apenas tenant). Antes qualquer user do
   * mesmo tenant baixava anexo de diligencia alheia (GDPR + sigilo).
   */
  async downloadAttachment(attachmentId: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    const att = await (this.prisma as any).taskAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, tenant_id: true, task_id: true, s3_key: true, original_name: true, mime_type: true },
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    if (tenantId && att.tenant_id && att.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }
    if (userId && att.task_id) {
      await this.verifyTaskOwnership(att.task_id, userId, roles, tenantId);
    }
    const result = await this.s3.getObjectStream(att.s3_key);
    return {
      ...result,
      fileName: att.original_name,
      mimeType: att.mime_type,
    };
  }

  /**
   * Remove anexo (S3 + DB). Soft delete nao faz sentido aqui — anexo
   * errado precisa sumir do workspace tambem. Bug fix 2026-05-10 (PR2 #1):
   * exige ownership da Task pai.
   */
  async removeAttachment(attachmentId: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    const att = await (this.prisma as any).taskAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, tenant_id: true, task_id: true, s3_key: true },
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    if (tenantId && att.tenant_id && att.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }
    if (userId && att.task_id) {
      await this.verifyTaskOwnership(att.task_id, userId, roles, tenantId);
    }
    try {
      await this.s3.deleteObject(att.s3_key);
    } catch (e: any) {
      this.logger.warn(`Falha ao deletar S3 ${att.s3_key}: ${e.message}`);
    }
    await (this.prisma as any).taskAttachment.delete({ where: { id: attachmentId } });
    return { deleted: true };
  }

  // ─── /Attachments ─────────────────────────────────────────────

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

  async findByLegalCase(legalCaseId: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    // Bug fix 2026-05-10 (PR2 #3): antes so checava tenant. Qualquer
    // user nao-admin via TODAS as tasks de qualquer processo do tenant —
    // vazava nomes de oponentes, valores, comentarios sigilosos. Agora:
    //   - ADMIN passa
    //   - Demais precisam ser lawyer_id do processo
    if (tenantId || userId) {
      const lc = await this.prisma.legalCase.findUnique({
        where: { id: legalCaseId },
        select: { tenant_id: true, lawyer_id: true },
      });
      if (!lc) throw new NotFoundException('Processo nao encontrado');
      if (tenantId && lc.tenant_id && lc.tenant_id !== tenantId) {
        throw new ForbiddenException('Processo de outro tenant');
      }
      if (userId && !isAdmin(roles || []) && lc.lawyer_id !== userId) {
        throw new ForbiddenException('Sem permissao para ver tarefas deste processo');
      }
    }
    // Inclui tracking timestamps + count attachments pra TabDiligencias
    // do workspace mostrar timeline visual e indicadores corretamente.
    // created_by_id eh raw (sem relacao formal no schema atual) — caller
    // mapeia user_id pro nome via /users se precisar.
    return this.prisma.task.findMany({
      where: { legal_case_id: legalCaseId },
      include: {
        assigned_user: { select: { id: true, name: true } },
        _count: { select: { comments: true, attachments: true } },
      },
      orderBy: [
        { status: 'asc' },         // A_FAZER vem antes de EM_PROGRESSO
        { due_at: 'asc' },          // mais urgente primeiro
        { created_at: 'desc' },
      ],
    });
  }

  // ─── Task Comments ─────────────────────────────────────────────

  async addComment(taskId: string, userId: string, text: string, tenantId?: string, roles?: string | string[]) {
    // Bug fix 2026-05-10 (PR2 #1+#9): exige ownership ANTES de criar comment
    // (vazava sigilo + abria vetor de DoS via notifications.create
    // disparando WhatsApp ao destinatario sem rate limit).
    await this.verifyTaskOwnership(taskId, userId, roles, tenantId);

    // Validacao basica de input — comments nao podem ser vazios nem
    // arbitrariamente grandes (DoS no notification body).
    const trimmed = (text || '').trim();
    if (!trimmed) throw new BadRequestException('Comentario vazio');
    if (trimmed.length > 2000) throw new BadRequestException('Comentario muito longo (max 2000 chars)');

    const comment = await this.prisma.taskComment.create({
      data: { task_id: taskId, user_id: userId, text: trimmed },
      include: { user: { select: { id: true, name: true } } },
    });

    // Cria canal de chat real entre advogado <-> estagiario:
    //   - Estagiario comenta -> advogado (criador) recebe push
    //   - Advogado comenta   -> estagiario (responsavel) recebe push
    //   - Terceiro comenta   -> ambos recebem (raro)
    //
    // Push ao vivo (socket) + Push/WhatsApp persistente (NotificationsService
    // com delay 5min e dedup 60min). Sem isso, comentarios morrem se a app
    // estiver fechada e a outra parte nunca sabe que foi respondida.
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        title: true, assigned_user_id: true, created_by_id: true, tenant_id: true,
      },
    });
    if (task) {
      const recipients = new Set<string>();
      if (task.assigned_user_id && task.assigned_user_id !== userId) {
        recipients.add(task.assigned_user_id);
      }
      if (task.created_by_id && task.created_by_id !== userId) {
        recipients.add(task.created_by_id);
      }

      const truncated = text.length > 200 ? text.slice(0, 197) + '…' : text;
      for (const recipientId of recipients) {
        // Socket (live) — pra notif center atualizar imediato se o user
        // estiver com o app aberto
        try {
          this.chatGateway.emitTaskComment(recipientId, {
            taskId,
            text,
            fromUserName: comment.user.name,
          });
        } catch {}
        // Push + WhatsApp (persistente) — chega mesmo com app fechado
        this.notifications.create({
          userId: recipientId,
          tenantId: task.tenant_id || null,
          type: 'task_comment',
          title: `${comment.user.name} comentou em "${task.title}"`,
          body: truncated,
          data: {
            taskId,
            commentId: comment.id,
            fromUserId: userId,
          },
        }).catch(() => { /* fire and forget */ });
      }
    }

    return comment;
  }

  async findComments(taskId: string, tenantId?: string, userId?: string, roles?: string | string[]) {
    // Bug fix 2026-05-10 (PR2 #1): comments tem texto sigiloso entre
    // advogado <-> estagiario sobre cliente, nao pode vazar pra terceiros.
    if (userId) {
      await this.verifyTaskOwnership(taskId, userId, roles, tenantId);
    } else {
      await this.verifyTenantOwnership(taskId, tenantId);
    }
    return this.prisma.taskComment.findMany({
      where: { task_id: taskId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { created_at: 'asc' },
    });
  }

  // ─── SPRINT 4: Escalonamento progressivo de tarefas vencidas ──────────────

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    await this.cronRunner.run(
      'tasks-overdue-escalation',
      30 * 60,
      async () => {
      const now = new Date();
      // Bug fix 2026-05-10 (PR2 #12): paginacao + filtro de janela.
      // Antes findMany sem take pegava TODAS as tasks vencidas
      // historicas — escritorio com 10k tasks legacy = OOM no API +
      // spam massivo de notifications. Agora limitamos:
      //   - Janela: vencidas entre 1min e 75h atras (cobre os 3 niveis
      //     warning/urgent/critical com folga). Tasks vencidas ha mais
      //     de 75h NAO disparam mais — quem nao olhou nesse tempo
      //     precisa de intervencao manual, nao mais alerta.
      //   - Paginacao: 500 por execucao (cron de 1h, 1 escritorio com
      //     >500 tasks vencidas em janela e sinal de problema operacional)
      // tenant_id e raw — cron roda para todos os tenants.
      const lowerBound = new Date(now.getTime() - OVERDUE_SLA_WINDOW_HOURS * 3_600_000);
      const upperBound = new Date(now.getTime() - 60_000); // 1min atras (evita race com inserts)

      const overdueTasks = await this.prisma.task.findMany({
        where: {
          due_at: { lt: upperBound, gte: lowerBound },
          status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
          assigned_user_id: { not: null },
        },
        select: {
          id: true,
          title: true,
          due_at: true,
          started_at: true,
          tenant_id: true,
          assigned_user_id: true,
          created_by_id: true,
          legal_case_id: true,
          assigned_user: { select: { id: true, name: true } },
        },
        orderBy: { due_at: 'desc' }, // mais recentemente vencidas primeiro (mais relevantes)
        take: OVERDUE_TASKS_BATCH_LIMIT,
      });

      for (const task of overdueTasks) {
        if (!task.assigned_user_id || !task.due_at) continue;
        const hoursOverdue = (now.getTime() - new Date(task.due_at).getTime()) / 3_600_000;

        // SLA escalonado de 3 níveis pro responsável (estagiário):
        //   warning  : vencida AGORA (1ª notificação ao passar do prazo)
        //   urgent   : +24h sem cumprir
        //   critical : +72h sem cumprir
        const level = hoursOverdue >= 72 ? 'critical' : hoursOverdue >= 24 ? 'urgent' : 'warning';
        const notifyAssignee = (
          (level === 'warning'  && hoursOverdue < 2) ||
          (level === 'urgent'   && hoursOverdue >= 24 && hoursOverdue < 25) ||
          (level === 'critical' && hoursOverdue >= 72 && hoursOverdue < 73)
        );

        if (notifyAssignee) {
          this.chatGateway.server?.to(`user:${task.assigned_user_id}`).emit('task_overdue_alert', {
            taskId: task.id,
            title: task.title,
            dueAt: task.due_at,
            hoursOverdue: Math.round(hoursOverdue),
            level,
          });
        }

        // Escalada pro DELEGANTE (advogado que criou a Task) se o
        // estagiário ainda não iniciou OU passou de 4h sem cumprir.
        // Notificação persistida (push + WhatsApp) — não só socket
        // efêmero — pra advogado VER mesmo offline. Idempotência por
        // janela única no nível.
        const notifyDelegate = (
          task.created_by_id &&
          task.created_by_id !== task.assigned_user_id &&
          (
            // 4h vencida sem ter sido iniciada (estagiária ignorou)
            (!task.started_at && hoursOverdue >= 4 && hoursOverdue < 5) ||
            // 24h vencida (mesmo iniciada — algo travou)
            (hoursOverdue >= 24 && hoursOverdue < 25) ||
            // 72h vencida (escalada crítica)
            (hoursOverdue >= 72 && hoursOverdue < 73)
          )
        );

        if (notifyDelegate && task.created_by_id) {
          const assigneeName = task.assigned_user?.name || 'responsável';
          const titleByLevel: Record<string, string> = {
            warning: `⏰ ${assigneeName} ainda não iniciou: ${task.title}`,
            urgent: `🟠 24h vencida: ${task.title}`,
            critical: `🚨 72h sem cumprimento: ${task.title}`,
          };
          this.notifications.create({
            userId: task.created_by_id,
            tenantId: task.tenant_id || null,
            type: 'task_overdue_delegate',
            title: titleByLevel[level] || titleByLevel.warning,
            body: `Atribuída a ${assigneeName} • venceu há ${Math.round(hoursOverdue)}h`,
            data: {
              taskId: task.id,
              legalCaseId: task.legal_case_id,
              level,
              hoursOverdue: Math.round(hoursOverdue),
            },
          }).catch(() => { /* fire-and-forget */ });
        }
      }

      this.logger.log(`[TasksCron] Verificadas ${overdueTasks.length} tarefas vencidas`);
      },
      { description: 'Escalonamento progressivo (warning/urgent/critical) de tarefas vencidas', schedule: '0 * * * *' },
    );
  }

  // ─── SPRINT 4: Carga de trabalho por usuário (smart assignment) ───────────

  async getWorkload(tenantId?: string) {
    // Bug fix 2026-05-10 (PR3 medio #9): janela de 90d nas tasks
    // pendentes. Antes agregava TODAS as tasks pendentes historicas
    // (algumas legacy nunca concluidas inflam contagem) — smart-
    // assignment escolhia o user com menos pendentes, mas a contagem
    // estava distorcida por lixo. Agora considera so tasks ativas
    // (criadas ou com due_at nos ultimos 90d).
    const baseTenant = this.tenantWhere(tenantId);
    const cutoff = new Date(Date.now() - WORKLOAD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const tasks = await this.prisma.task.findMany({
      where: {
        ...baseTenant,
        status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
        assigned_user_id: { not: null },
        OR: [
          { due_at: { gte: cutoff } },
          { created_at: { gte: cutoff } },
        ],
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

      // Bug fix 2026-05-10 (PR3 medio #10): timeout de 10s pra evitar
      // travamento do request HTTP do frontend se OpenAI degradar (6h+
      // ja aconteceram em outages historicas). Sem AbortController, o
      // SDK aguarda timeout default do undici (~5min) e o usuario fica
      // com loader infinito.
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), OPENAI_NBA_TIMEOUT_MS);
      let completion: any;
      try {
        completion = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          ...buildTokenParam('gpt-4.1-mini', 256),
          temperature: 0.4,
        }, { signal: ctrl.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      return JSON.parse(completion.choices[0].message.content || '{}');
    } catch (e: any) {
      this.logger.warn(`[NBA] Erro ao consultar OpenAI: ${e.message}`);
      return { acao: null, urgencia: 'media', justificativa: 'Erro ao consultar IA.', tipo: 'outro' };
    }
  }
}
