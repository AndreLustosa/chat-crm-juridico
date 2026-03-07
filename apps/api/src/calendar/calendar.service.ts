import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

const EVENT_TYPES = ['CONSULTA', 'TAREFA', 'AUDIENCIA', 'PRAZO', 'OUTRO'] as const;
const EVENT_STATUSES = ['AGENDADO', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO', 'ADIADO'] as const;

@Injectable()
export class CalendarService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  // ─── CRUD Events ──────────────────────────────────────

  async findAll(query: {
    start?: string;
    end?: string;
    type?: string;
    userId?: string;
    leadId?: string;
    legalCaseId?: string;
    tenantId?: string;
  }) {
    const where: any = {};

    if (query.tenantId) where.tenant_id = query.tenantId;
    if (query.type) where.type = query.type;
    if (query.userId) where.assigned_user_id = query.userId;
    if (query.leadId) where.lead_id = query.leadId;
    if (query.legalCaseId) where.legal_case_id = query.legalCaseId;

    if (query.start || query.end) {
      where.start_at = {};
      if (query.start) where.start_at.gte = new Date(query.start);
      if (query.end) where.start_at.lte = new Date(query.end);
    }

    return this.prisma.calendarEvent.findMany({
      where,
      include: {
        assigned_user: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true } },
        appointment_type: true,
        reminders: true,
      },
      orderBy: { start_at: 'asc' },
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id },
      include: {
        assigned_user: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true } },
        appointment_type: true,
        reminders: true,
      },
    });
    if (!event) throw new NotFoundException('Evento nao encontrado');
    return event;
  }

  async create(data: {
    type: string;
    title: string;
    description?: string;
    start_at: string;
    end_at?: string;
    all_day?: boolean;
    status?: string;
    priority?: string;
    color?: string;
    location?: string;
    lead_id?: string;
    conversation_id?: string;
    legal_case_id?: string;
    assigned_user_id?: string;
    created_by_id: string;
    appointment_type_id?: string;
    tenant_id?: string;
    reminders?: { minutes_before: number; channel?: string }[];
  }) {
    if (!EVENT_TYPES.includes(data.type as any)) {
      throw new BadRequestException(`Tipo invalido: ${data.type}. Use: ${EVENT_TYPES.join(', ')}`);
    }

    const event = await this.prisma.calendarEvent.create({
      data: {
        type: data.type,
        title: data.title,
        description: data.description,
        start_at: new Date(data.start_at),
        end_at: data.end_at ? new Date(data.end_at) : null,
        all_day: data.all_day ?? false,
        status: data.status ?? 'AGENDADO',
        priority: data.priority ?? 'NORMAL',
        color: data.color,
        location: data.location,
        lead_id: data.lead_id,
        conversation_id: data.conversation_id,
        legal_case_id: data.legal_case_id,
        assigned_user_id: data.assigned_user_id,
        created_by_id: data.created_by_id,
        appointment_type_id: data.appointment_type_id,
        tenant_id: data.tenant_id,
        reminders: data.reminders?.length
          ? {
              create: data.reminders.map((r) => ({
                minutes_before: r.minutes_before,
                channel: r.channel ?? 'PUSH',
              })),
            }
          : undefined,
      },
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        reminders: true,
      },
    });

    // Notificar advogado atribuido via socket
    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: event.id,
          action: 'created',
          title: event.title,
          type: event.type,
          start_at: event.start_at.toISOString(),
        });
      } catch {}
    }

    return event;
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      start_at?: string;
      end_at?: string;
      all_day?: boolean;
      status?: string;
      priority?: string;
      color?: string;
      location?: string;
      type?: string;
      lead_id?: string | null;
      conversation_id?: string | null;
      legal_case_id?: string | null;
      assigned_user_id?: string | null;
      appointment_type_id?: string | null;
    },
  ) {
    if (data.type && !EVENT_TYPES.includes(data.type as any)) {
      throw new BadRequestException(`Tipo invalido: ${data.type}`);
    }
    if (data.status && !EVENT_STATUSES.includes(data.status as any)) {
      throw new BadRequestException(`Status invalido: ${data.status}`);
    }

    const updateData: any = { ...data };
    if (data.start_at) updateData.start_at = new Date(data.start_at);
    if (data.end_at) updateData.end_at = new Date(data.end_at);
    if (data.end_at === null) updateData.end_at = null;

    const event = await this.prisma.calendarEvent.update({
      where: { id },
      data: updateData,
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
      },
    });

    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: event.id,
          action: 'updated',
          title: event.title,
          type: event.type,
        });
      } catch {}
    }

    return event;
  }

  async updateStatus(id: string, status: string) {
    if (!EVENT_STATUSES.includes(status as any)) {
      throw new BadRequestException(`Status invalido: ${status}`);
    }
    return this.prisma.calendarEvent.update({
      where: { id },
      data: { status },
    });
  }

  async remove(id: string) {
    const event = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Evento nao encontrado');

    await this.prisma.calendarEvent.delete({ where: { id } });

    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: id,
          action: 'deleted',
          title: event.title,
        });
      } catch {}
    }

    return { deleted: true };
  }

  // ─── Availability ─────────────────────────────────────

  async getSchedule(userId: string) {
    return this.prisma.userSchedule.findMany({
      where: { user_id: userId },
      orderBy: { day_of_week: 'asc' },
    });
  }

  async setSchedule(userId: string, slots: { day_of_week: number; start_time: string; end_time: string }[]) {
    // Upsert cada dia
    const results = await Promise.all(
      slots.map((s) =>
        this.prisma.userSchedule.upsert({
          where: { user_id_day_of_week: { user_id: userId, day_of_week: s.day_of_week } },
          create: { user_id: userId, day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time },
          update: { start_time: s.start_time, end_time: s.end_time },
        }),
      ),
    );
    return results;
  }

  async getAvailability(userId: string, dateStr: string, durationMinutes: number) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); // 0=dom..6=sab

    // 1. Horario de trabalho do dia
    const schedule = await this.prisma.userSchedule.findUnique({
      where: { user_id_day_of_week: { user_id: userId, day_of_week: dayOfWeek } },
    });
    if (!schedule) return []; // Nao trabalha nesse dia

    // 2. Eventos existentes nesse dia
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        start_at: { gte: dayStart, lte: dayEnd },
        status: { notIn: ['CANCELADO'] },
      },
      select: { start_at: true, end_at: true },
      orderBy: { start_at: 'asc' },
    });

    // 3. Calcular slots livres
    const [startH, startM] = schedule.start_time.split(':').map(Number);
    const [endH, endM] = schedule.end_time.split(':').map(Number);
    const workStart = startH * 60 + startM;
    const workEnd = endH * 60 + endM;

    // Blocos ocupados (em minutos desde meia-noite)
    const busy = events.map((e) => {
      const s = e.start_at.getHours() * 60 + e.start_at.getMinutes();
      const eEnd = e.end_at
        ? e.end_at.getHours() * 60 + e.end_at.getMinutes()
        : s + 30; // default 30min se sem end_at
      return { start: s, end: eEnd };
    });

    const slots: { start: string; end: string }[] = [];
    let cursor = workStart;
    for (const b of busy) {
      while (cursor + durationMinutes <= b.start) {
        const slotEnd = cursor + durationMinutes;
        slots.push({
          start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
          end: `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`,
        });
        cursor = slotEnd;
      }
      if (b.end > cursor) cursor = b.end;
    }
    // Slots apos ultimo evento
    while (cursor + durationMinutes <= workEnd) {
      const slotEnd = cursor + durationMinutes;
      slots.push({
        start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
        end: `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`,
      });
      cursor = slotEnd;
    }

    return slots;
  }

  // ─── Appointment Types ────────────────────────────────

  async findAppointmentTypes(tenantId?: string) {
    return this.prisma.appointmentType.findMany({
      where: tenantId ? { tenant_id: tenantId, active: true } : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createAppointmentType(data: {
    name: string;
    duration: number;
    color?: string;
    tenant_id?: string;
  }) {
    return this.prisma.appointmentType.create({ data });
  }
}
