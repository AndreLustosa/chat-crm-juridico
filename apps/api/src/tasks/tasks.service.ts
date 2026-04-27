import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import OpenAI from 'openai';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { CalendarService } from '../calendar/calendar.service';
import { MediaS3Service } from '../media/s3.service';
import { NotificationsService } from '../notifications/notifications.service';

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

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB por arquivo

// Pastas validas pra espelhamento no workspace do processo
const VALID_FOLDERS = new Set([
  'CLIENTE', 'PROVAS', 'CONTRATOS', 'PETICOES',
  'DECISOES', 'PROCURACOES', 'OUTROS',
]);

/**
 * Sugere automaticamente a pasta CaseDocument baseada no titulo da Task.
 * Acerta ~80% dos casos comuns; estagiario pode trocar manualmente no UI.
 *
 * Calibrado em titulos reais do escritorio:
 *   "Pegar comprovante de residencia" → CLIENTE
 *   "Buscar RG/CPF do cliente" → CLIENTE
 *   "Imprimir contrato de honorarios" → CONTRATOS
 *   "Anexar procuracao assinada" → PROCURACOES
 *   "Baixar decisao do TJ" → DECISOES
 */
function inferFolder(title: string): string {
  const t = (title || '').toLowerCase();
  if (/\b(rg|cpf|comprovante|endere[cç]o|cnh|carteira|identidade)\b/.test(t)) return 'CLIENTE';
  if (/\b(contrato|honor[aá]rio|honorarios)\b/.test(t)) return 'CONTRATOS';
  if (/\b(procura[cç][aã]o|procuracao)\b/.test(t)) return 'PROCURACOES';
  if (/\b(decis[aã]o|senten[cç]a|ac[oó]rd[aã]o|despacho)\b/.test(t)) return 'DECISOES';
  if (/\b(prova|laudo|per[ií]cia|testemunho)\b/.test(t)) return 'PROVAS';
  if (/\b(peti[cç][aã]o|peticao)\b/.test(t)) return 'PETICOES';
  return 'OUTROS';
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private calendarService: CalendarService,
    private s3: MediaS3Service,
    private notifications: NotificationsService,
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

  async updateStatus(id: string, status: string, tenantId?: string) {
    await this.verifyTenantOwnership(id, tenantId);
    // Auto-set started_at na 1a transicao pra EM_PROGRESSO — advogado
    // quer saber QUANDO o estagiario comecou a executar a diligencia.
    // Idempotente: se ja foi setado uma vez, nao reescreve em re-clicks
    // ou voltas (caso a task tenha sido reaberta).
    const updateData: any = { status };
    if (status === 'EM_PROGRESSO') {
      const current = await this.prisma.task.findUnique({
        where: { id },
        select: { started_at: true },
      });
      if (!current?.started_at) {
        updateData.started_at = new Date();
      }
    }
    const task = await this.prisma.task.update({
      where: { id },
      data: updateData,
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
    const tasks = await this.prisma.task.findMany({
      where: {
        created_by_id: userId,
        calendar_event_id: null, // diligencias orfas (sem evento processual)
        assigned_user_id: { not: userId }, // auto-tarefa nao conta
        // Mostra A_FAZER, EM_PROGRESSO E concluidas das ultimas 24h
        // (concluidas antigas escondem pra nao poluir)
        OR: [
          { status: { in: ['A_FAZER', 'EM_PROGRESSO'] } },
          {
            status: 'CONCLUIDA',
            completed_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
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
        { status: 'asc' }, // A_FAZER vem antes de EM_PROGRESSO
        { due_at: 'asc' }, // mais urgente primeiro
        { created_at: 'desc' },
      ],
      take: 50,
    });

    // Stats agregadas pro UI mostrar contadores
    const stats = {
      pending: tasks.filter(t => t.status === 'A_FAZER').length,
      inProgress: tasks.filter(t => t.status === 'EM_PROGRESSO').length,
      completedRecent: tasks.filter(t => t.status === 'CONCLUIDA').length,
      // Quantas pendentes/em-progresso ainda nao foram VISTAS pelo
      // responsavel — vermelho de alerta no UI
      notViewed: tasks.filter(t =>
        t.status !== 'CONCLUIDA' && !t.viewed_at,
      ).length,
    };

    return { tasks, stats };
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
      select: { id: true, viewed_at: true, assigned_user_id: true },
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

    await this.prisma.task.update({
      where: { id: taskId },
      data: { viewed_at: new Date() },
    });
    return { ok: true, viewedAt: new Date().toISOString() };
  }

  // ─── Attachments (anexos da diligência) ───────────────────────

  /**
   * Sugere pasta automatica baseada no titulo da Task.
   * Exposto no controller como GET /tasks/:id/suggest-folder pra UI.
   */
  async suggestFolderForTask(taskId: string, tenantId?: string): Promise<string> {
    await this.verifyTenantOwnership(taskId, tenantId);
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
  async listAttachments(taskId: string, tenantId?: string) {
    await this.verifyTenantOwnership(taskId, tenantId);
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
  ) {
    await this.verifyTenantOwnership(taskId, tenantId);
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

    // Sobe tudo no S3 em paralelo, depois persiste em transação
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

    const created = await this.prisma.$transaction(
      uploads.map((u) =>
        (this.prisma as any).taskAttachment.create({
          data: {
            task_id: taskId,
            tenant_id: task.tenant_id || tenantId || null,
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

    this.logger.log(
      `[TaskAttachment] ${created.length} anexo(s) na task ${taskId} ` +
      `(folder=${folder}, tem_caso=${!!task.legal_case_id})`,
    );

    return created;
  }

  /**
   * Stream de download de um anexo. Verifica ownership via tenant antes.
   */
  async downloadAttachment(attachmentId: string, tenantId?: string) {
    const att = await (this.prisma as any).taskAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    if (tenantId && att.tenant_id && att.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
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
   * errado precisa sumir do workspace tambem.
   */
  async removeAttachment(attachmentId: string, tenantId?: string) {
    const att = await (this.prisma as any).taskAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    if (tenantId && att.tenant_id && att.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
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
        model: 'gpt-4.1-mini',
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
