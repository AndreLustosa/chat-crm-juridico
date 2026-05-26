import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { tenantOrDefault } from '../common/constants/tenant';

const DEADLINE_TYPES = [
  'CONTESTACAO',
  'RECURSO',
  'IMPUGNACAO',
  'MANIFESTACAO',
  'AUDIENCIA',
  'PERICIA',
  'OUTRO',
] as const;

@Injectable()
export class CaseDeadlinesService {
  private readonly logger = new Logger(CaseDeadlinesService.name);

  constructor(
    private prisma: PrismaService,
    private calendarService: CalendarService,
  ) {}

  /**
   * "Dias sem perder prazo" do escritório (badge do Cockpit).
   *
   * PERDER UM PRAZO = um CaseDeadline cujo vencimento (due_at) já passou e que
   * NÃO foi cumprido no prazo: segue vencido em aberto (PENDENTE/ADIADO) OU foi
   * concluído DEPOIS do vencimento. CANCELADO não conta.
   *
   * Retorna os dias desde o ÚLTIMO prazo perdido. Se nunca perdeu, conta desde
   * o 1º prazo cadastrado. Sem nenhum prazo ainda → 0.
   */
  async deadlineStreak(tenantId: string): Promise<{ days: number; last_miss_at: string | null }> {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Vencimento mais recente entre os prazos PERDIDOS (vencidos e não cumpridos no prazo).
    const rows = (await this.prisma.$queryRaw`
      SELECT MAX(due_at) AS last_miss
      FROM "CaseDeadline"
      WHERE tenant_id = ${tenantId}
        AND due_at < NOW()
        AND status <> 'CANCELADO'
        AND NOT (completed = true AND completed_at IS NOT NULL AND completed_at <= due_at)
    `) as Array<{ last_miss: Date | null }>;
    const lastMiss = rows[0]?.last_miss ?? null;

    if (lastMiss) {
      const days = Math.max(0, Math.floor((now - new Date(lastMiss).getTime()) / MS_PER_DAY));
      return { days, last_miss_at: new Date(lastMiss).toISOString() };
    }

    // Nunca perdeu um prazo: conta desde o 1º prazo cadastrado.
    const first = await this.prisma.caseDeadline.findFirst({
      where: { tenant_id: tenantId },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    });
    if (!first) return { days: 0, last_miss_at: null };
    const days = Math.max(0, Math.floor((now - first.created_at.getTime()) / MS_PER_DAY));
    return { days, last_miss_at: null };
  }

  // ─── Helpers ────────────────────────────────────────────

  private async verifyCaseAccess(caseId: string, tenantId?: string) {
    const lc = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      // lawyer_id incluido pra herdar como assigned_user_id do CalendarEvent
      // do prazo (antes vinha null e aparecia "Sem responsavel" na UI —
      // bug reportado 2026-04-24).
      select: { id: true, tenant_id: true, lead_id: true, conversation_id: true, lawyer_id: true },
    });
    if (!lc) throw new NotFoundException('Caso não encontrado');
    if (tenantId && lc.tenant_id && lc.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return lc;
  }

  // ─── CRUD ──────────────────────────────────────────────

  async findByCaseId(
    caseId: string,
    tenantId?: string,
    completed?: boolean,
  ) {
    await this.verifyCaseAccess(caseId, tenantId);

    const where: any = { legal_case_id: caseId };
    if (completed !== undefined) where.completed = completed;

    return this.prisma.caseDeadline.findMany({
      where,
      include: {
        created_by: { select: { id: true, name: true } },
        calendar_event: { select: { id: true, status: true } },
      },
      orderBy: { due_at: 'asc' },
    });
  }

  async create(
    caseId: string,
    data: {
      type: string;
      title: string;
      description?: string;
      due_at: string;
      alert_days?: number;
    },
    userId: string,
    tenantId?: string,
  ) {
    const legalCase = await this.verifyCaseAccess(caseId, tenantId);

    // Criar CalendarEvent automaticamente tipo PRAZO
    // assigned_user_id herda lawyer_id do LegalCase por padrao — evita
    // prazos aparecerem como "Sem responsavel" na Triagem. Usuario pode
    // reatribuir depois via PATCH /calendar/events/:id.
    const calendarEvent = await this.calendarService.create({
      type: 'PRAZO',
      title: `Prazo: ${data.title}`,
      description: data.description,
      start_at: data.due_at,
      all_day: true,
      priority: 'ALTA',
      legal_case_id: caseId,
      assigned_user_id: legalCase.lawyer_id,
      created_by_id: userId,
      tenant_id: tenantId,
      reminders: [
        {
          minutes_before: (data.alert_days ?? 2) * 1440, // Converter dias para minutos
          channel: 'PUSH',
        },
      ],
    });

    const deadline = await this.prisma.caseDeadline.create({
      data: {
        legal_case_id: caseId,
        created_by_id: userId,
        tenant_id: tenantOrDefault(tenantId),
        type: DEADLINE_TYPES.includes(data.type as any) ? data.type : 'OUTRO',
        title: data.title,
        description: data.description || null,
        due_at: new Date(data.due_at),
        alert_days: data.alert_days ?? 2,
        calendar_event_id: calendarEvent.id,
      },
      include: {
        created_by: { select: { id: true, name: true } },
        calendar_event: { select: { id: true, status: true } },
      },
    });

    this.logger.log(`Prazo criado: ${deadline.id} (case ${caseId}, vence ${data.due_at})`);
    return deadline;
  }

  async update(
    deadlineId: string,
    data: {
      type?: string;
      title?: string;
      description?: string;
      due_at?: string;
      alert_days?: number;
    },
    tenantId?: string,
  ) {
    const deadline = await this.prisma.caseDeadline.findUnique({
      where: { id: deadlineId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!deadline) throw new NotFoundException('Prazo não encontrado');
    if (tenantId && deadline.legal_case.tenant_id && deadline.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    const updateData: any = {};
    if (data.type && DEADLINE_TYPES.includes(data.type as any)) updateData.type = data.type;
    if (data.title) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.due_at) updateData.due_at = new Date(data.due_at);
    if (data.alert_days !== undefined) updateData.alert_days = data.alert_days;

    // Se alterou data, atualizar CalendarEvent via service (re-enfileira lembretes BullMQ)
    if (data.due_at && deadline.calendar_event_id) {
      await this.calendarService.update(deadline.calendar_event_id, {
        start_at: data.due_at,
        ...(data.title ? { title: `Prazo: ${data.title}` } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      }).catch((e: any) => {
        this.logger.warn(`Erro ao atualizar CalendarEvent do prazo ${deadlineId}: ${e.message}`);
      });
    }

    return this.prisma.caseDeadline.update({
      where: { id: deadlineId },
      data: updateData,
      include: {
        created_by: { select: { id: true, name: true } },
        calendar_event: { select: { id: true, status: true } },
      },
    });
  }

  async complete(deadlineId: string, tenantId?: string, userId?: string, note?: string) {
    const deadline = await this.prisma.caseDeadline.findUnique({
      where: { id: deadlineId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!deadline) throw new NotFoundException('Prazo não encontrado');
    if (tenantId && deadline.legal_case.tenant_id && deadline.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    // Detecta se e cancelamento (note com prefix [CANCELADO]) pra status correto
    const isCancelled = note?.startsWith('[CANCELADO]') ?? false;
    const newStatus = isCancelled ? 'CANCELADO' : 'CONCLUIDO';

    // Marcar CalendarEvent com status correspondente + audit completo
    if (deadline.calendar_event_id) {
      await this.prisma.calendarEvent.update({
        where: { id: deadline.calendar_event_id },
        data: {
          status: newStatus,
          completed_at: new Date(),
          ...(userId ? { completed_by_id: userId } : {}),
          ...(note ? { completion_note: note } : {}),
        },
      });
    }

    return this.prisma.caseDeadline.update({
      where: { id: deadlineId },
      data: {
        status: newStatus,
        completed: true, // sempre true em estado terminal (CONCLUIDO ou CANCELADO)
        completed_at: new Date(),
        ...(userId ? { completed_by_id: userId } : {}),
        ...(note ? { completion_note: note } : {}),
      },
      include: {
        created_by: { select: { id: true, name: true } },
        calendar_event: { select: { id: true, status: true } },
      },
    });
  }

  /**
   * Reabre um prazo (volta pra PENDENTE). Util quando advogado marca errado.
   * Limpa audit fields e sincroniza com CalendarEvent.
   */
  async reopen(deadlineId: string, tenantId?: string) {
    const deadline = await this.prisma.caseDeadline.findUnique({
      where: { id: deadlineId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!deadline) throw new NotFoundException('Prazo não encontrado');
    if (tenantId && deadline.legal_case.tenant_id && deadline.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    if (deadline.calendar_event_id) {
      await this.prisma.calendarEvent.update({
        where: { id: deadline.calendar_event_id },
        data: {
          status: 'AGENDADO',
          completed_at: null,
          completed_by_id: null,
          completion_note: null,
        },
      });
    }

    return this.prisma.caseDeadline.update({
      where: { id: deadlineId },
      data: {
        status: 'PENDENTE',
        completed: false,
        completed_at: null,
        completed_by_id: null,
        completion_note: null,
      },
      include: {
        created_by: { select: { id: true, name: true } },
        calendar_event: { select: { id: true, status: true } },
      },
    });
  }

  async remove(deadlineId: string, tenantId?: string) {
    const deadline = await this.prisma.caseDeadline.findUnique({
      where: { id: deadlineId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!deadline) throw new NotFoundException('Prazo não encontrado');
    if (tenantId && deadline.legal_case.tenant_id && deadline.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    // Deletar CalendarEvent vinculado
    if (deadline.calendar_event_id) {
      await this.prisma.calendarEvent.delete({
        where: { id: deadline.calendar_event_id },
      }).catch(() => {});
    }

    await this.prisma.caseDeadline.delete({ where: { id: deadlineId } });
    this.logger.log(`Prazo ${deadlineId} removido`);
    return { deleted: true };
  }
}
