import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';

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

  // ─── Helpers ────────────────────────────────────────────

  private async verifyCaseAccess(caseId: string, tenantId?: string) {
    const lc = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { id: true, tenant_id: true, lead_id: true, conversation_id: true },
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
    const calendarEvent = await this.calendarService.create({
      type: 'PRAZO',
      title: `Prazo: ${data.title}`,
      description: data.description,
      start_at: data.due_at,
      all_day: true,
      priority: 'ALTA',
      legal_case_id: caseId,
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
        tenant_id: tenantId || null,
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

  async complete(deadlineId: string, tenantId?: string) {
    const deadline = await this.prisma.caseDeadline.findUnique({
      where: { id: deadlineId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!deadline) throw new NotFoundException('Prazo não encontrado');
    if (tenantId && deadline.legal_case.tenant_id && deadline.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    // Marcar CalendarEvent como CONCLUIDO
    if (deadline.calendar_event_id) {
      await this.prisma.calendarEvent.update({
        where: { id: deadline.calendar_event_id },
        data: { status: 'CONCLUIDO' },
      });
    }

    return this.prisma.caseDeadline.update({
      where: { id: deadlineId },
      data: {
        completed: true,
        completed_at: new Date(),
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
