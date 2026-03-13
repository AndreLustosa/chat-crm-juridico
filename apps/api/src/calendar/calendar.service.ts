import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

const EVENT_TYPES = ['CONSULTA', 'TAREFA', 'AUDIENCIA', 'PRAZO', 'OUTRO'] as const;
const EVENT_STATUSES = ['AGENDADO', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO', 'ADIADO'] as const;

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    @InjectQueue('calendar-reminders') private reminderQueue: Queue,
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
    search?: string;
  }) {
    const where: any = {};

    if (query.tenantId) where.tenant_id = query.tenantId;
    if (query.type) where.type = query.type;
    if (query.leadId) where.lead_id = query.leadId;
    if (query.legalCaseId) where.legal_case_id = query.legalCaseId;

    // Filtrar por userId: inclui eventos onde o usuário é responsável OU criador
    if (query.userId) {
      if (!where.AND) where.AND = [];
      where.AND.push({
        OR: [
          { assigned_user_id: query.userId },
          { created_by_id: query.userId },
        ],
      });
    }

    if (query.search) {
      if (!where.AND) where.AND = [];
      where.AND.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.start || query.end) {
      // Schedule-x pode enviar datas com sufixo IANA entre colchetes ex: "2026-03-09T07:00:00+00:00[UTC]"
      // que new Date() não consegue parsear → remover o sufixo antes de converter
      const parseDate = (s: string) => new Date(s.replace(/\[.*?\]$/, ''));
      where.start_at = {};
      if (query.start) where.start_at.gte = parseDate(query.start);
      if (query.end) where.start_at.lte = parseDate(query.end);
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
        _count: { select: { comments: true } },
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
        _count: { select: { comments: true } },
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
    recurrence_rule?: string;
    recurrence_end?: string;
    recurrence_days?: number[];
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
        recurrence_rule: data.recurrence_rule,
        recurrence_end: data.recurrence_end ? new Date(data.recurrence_end) : null,
        recurrence_days: data.recurrence_days ?? [],
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

    // Enqueue WhatsApp + Email reminders
    await this.enqueueReminders(event.id, event.start_at, event.reminders || []);

    // Expand recurrence if rule set
    if (data.recurrence_rule) {
      await this.expandRecurrence(event);
    }

    return event;
  }

  private async enqueueReminders(eventId: string, startAt: Date, reminders: { id: string; minutes_before: number; channel: string }[]) {
    for (const r of reminders) {
      if (r.channel !== 'WHATSAPP' && r.channel !== 'EMAIL') continue; // PUSH handled by cron
      const triggerAt = startAt.getTime() - r.minutes_before * 60 * 1000;
      const delay = Math.max(triggerAt - Date.now(), 1000); // min 1s
      const jobId = `reminder-${r.id}`;
      try {
        await this.reminderQueue.add('send-reminder', {
          reminderId: r.id,
          eventId,
          channel: r.channel,
        }, { delay, jobId });
        this.logger.log(`Lembrete ${r.id} enfileirado: canal=${r.channel}, delay=${Math.round(delay / 60000)}min`);
      } catch (e: any) {
        this.logger.error(`Erro ao enfileirar lembrete ${r.id}: ${e.message}`);
      }
    }
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

  // ─── Conflict Detection ─────────────────────────────────

  async checkConflicts(userId: string, startAt: string, endAt: string, excludeEventId?: string) {
    const where: any = {
      assigned_user_id: userId,
      status: { notIn: ['CANCELADO'] },
      start_at: { lt: new Date(endAt) },
      end_at: { gt: new Date(startAt) },
    };
    if (excludeEventId) where.id = { not: excludeEventId };
    return this.prisma.calendarEvent.findMany({
      where,
      select: { id: true, title: true, start_at: true, end_at: true },
    });
  }

  // ─── Availability ─────────────────────────────────────

  async getSchedule(userId: string) {
    return this.prisma.userSchedule.findMany({
      where: { user_id: userId },
      orderBy: { day_of_week: 'asc' },
    });
  }

  async setSchedule(
    userId: string,
    slots: { day_of_week: number; start_time: string; end_time: string; lunch_start?: string | null; lunch_end?: string | null }[],
  ) {
    const results = await Promise.all(
      slots.map((s) =>
        this.prisma.userSchedule.upsert({
          where: { user_id_day_of_week: { user_id: userId, day_of_week: s.day_of_week } },
          create: {
            user_id: userId,
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
            lunch_start: s.lunch_start ?? null,
            lunch_end: s.lunch_end ?? null,
          },
          update: {
            start_time: s.start_time,
            end_time: s.end_time,
            lunch_start: s.lunch_start ?? null,
            lunch_end: s.lunch_end ?? null,
          },
        }),
      ),
    );
    return results;
  }

  async getAvailability(userId: string, dateStr: string, durationMinutes: number) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); // 0=dom..6=sab

    // 0. Verificar se e feriado
    const isHoliday = await this.isHoliday(date);
    if (isHoliday) return [];

    // 1. Horario de trabalho do dia
    const schedule = await this.prisma.userSchedule.findUnique({
      where: { user_id_day_of_week: { user_id: userId, day_of_week: dayOfWeek } },
    });
    if (!schedule) return [];

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

    const busy = events.map((e) => {
      const s = e.start_at.getHours() * 60 + e.start_at.getMinutes();
      const eEnd = e.end_at
        ? e.end_at.getHours() * 60 + e.end_at.getMinutes()
        : s + 30;
      return { start: s, end: eEnd };
    });

    // Adicionar pausa de almoço como período ocupado
    if (schedule.lunch_start && schedule.lunch_end) {
      const [lsH, lsM] = schedule.lunch_start.split(':').map(Number);
      const [leH, leM] = schedule.lunch_end.split(':').map(Number);
      busy.push({ start: lsH * 60 + lsM, end: leH * 60 + leM });
      busy.sort((a, b) => a.start - b.start);
    }

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
      where: tenantId ? { tenant_id: tenantId } : {},
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

  async updateAppointmentType(id: string, data: { name?: string; duration?: number; color?: string; active?: boolean }) {
    return this.prisma.appointmentType.update({ where: { id }, data });
  }

  async deleteAppointmentType(id: string) {
    await this.prisma.appointmentType.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Holidays ─────────────────────────────────────────

  async findHolidays(tenantId?: string) {
    return this.prisma.holiday.findMany({
      where: tenantId ? { tenant_id: tenantId } : {},
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(data: { date: string; name: string; recurring_yearly?: boolean; tenant_id?: string }) {
    return this.prisma.holiday.create({
      data: {
        date: new Date(data.date),
        name: data.name,
        recurring_yearly: data.recurring_yearly ?? false,
        tenant_id: data.tenant_id,
      },
    });
  }

  async updateHoliday(id: string, data: { date?: string; name?: string; recurring_yearly?: boolean }) {
    const updateData: any = {};
    if (data.date) updateData.date = new Date(data.date);
    if (data.name !== undefined) updateData.name = data.name;
    if (data.recurring_yearly !== undefined) updateData.recurring_yearly = data.recurring_yearly;
    return this.prisma.holiday.update({ where: { id }, data: updateData });
  }

  async deleteHoliday(id: string) {
    await this.prisma.holiday.delete({ where: { id } });
    return { deleted: true };
  }

  private async isHoliday(date: Date): Promise<boolean> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Check exact date holidays
    const exactMatch = await this.prisma.holiday.findFirst({
      where: {
        date: { gte: dayStart, lte: dayEnd },
        recurring_yearly: false,
      },
    });
    if (exactMatch) return true;

    // Check recurring yearly holidays (same month + day, any year)
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const recurringMatch = await this.prisma.$queryRaw`
      SELECT id FROM "Holiday"
      WHERE recurring_yearly = true
        AND EXTRACT(MONTH FROM date) = ${month}
        AND EXTRACT(DAY FROM date) = ${day}
      LIMIT 1
    ` as any[];
    return recurringMatch.length > 0;
  }

  // ─── Recurrence ───────────────────────────────────────

  async expandRecurrence(parentEvent: any) {
    const rule = parentEvent.recurrence_rule;
    if (!rule) return [];

    const startAt = new Date(parentEvent.start_at);
    const endAt = parentEvent.end_at ? new Date(parentEvent.end_at) : null;
    const duration = endAt ? endAt.getTime() - startAt.getTime() : 30 * 60 * 1000;
    const recurrenceEnd = parentEvent.recurrence_end
      ? new Date(parentEvent.recurrence_end)
      : new Date(startAt.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 dias

    const dates: Date[] = [];
    let cursor = new Date(startAt);

    const advanceCursor = () => {
      switch (rule) {
        case 'DAILY':
          cursor.setDate(cursor.getDate() + 1);
          break;
        case 'WEEKLY':
          cursor.setDate(cursor.getDate() + 7);
          break;
        case 'BIWEEKLY':
          cursor.setDate(cursor.getDate() + 14);
          break;
        case 'MONTHLY':
          cursor.setMonth(cursor.getMonth() + 1);
          break;
        case 'CUSTOM':
          cursor.setDate(cursor.getDate() + 1);
          break;
      }
    };

    // Gerar datas (pular a primeira que ja e o pai)
    advanceCursor();
    while (cursor <= recurrenceEnd && dates.length < 365) {
      if (rule === 'CUSTOM') {
        const dow = cursor.getDay();
        if ((parentEvent.recurrence_days || []).includes(dow)) {
          dates.push(new Date(cursor));
        }
      } else {
        dates.push(new Date(cursor));
      }
      advanceCursor();
    }

    // Criar instancias filhas em batch
    if (dates.length === 0) return [];

    const children = await Promise.all(
      dates.map((d) => {
        const childStart = new Date(d);
        childStart.setHours(startAt.getHours(), startAt.getMinutes(), startAt.getSeconds());
        const childEnd = new Date(childStart.getTime() + duration);

        return this.prisma.calendarEvent.create({
          data: {
            type: parentEvent.type,
            title: parentEvent.title,
            description: parentEvent.description,
            start_at: childStart,
            end_at: childEnd,
            all_day: parentEvent.all_day,
            status: parentEvent.status || 'AGENDADO',
            priority: parentEvent.priority || 'NORMAL',
            color: parentEvent.color,
            location: parentEvent.location,
            lead_id: parentEvent.lead_id,
            legal_case_id: parentEvent.legal_case_id,
            assigned_user_id: parentEvent.assigned_user_id,
            created_by_id: parentEvent.created_by_id,
            appointment_type_id: parentEvent.appointment_type_id,
            tenant_id: parentEvent.tenant_id,
            parent_event_id: parentEvent.id,
          },
        });
      }),
    );

    this.logger.log(`Criadas ${children.length} instancias recorrentes para evento ${parentEvent.id}`);
    return children;
  }

  async updateRecurrenceAll(parentId: string, data: any) {
    // Atualizar pai
    const parent = await this.update(parentId, data);
    // Atualizar todos os filhos
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.assigned_user_id !== undefined) updateData.assigned_user_id = data.assigned_user_id;

    if (Object.keys(updateData).length > 0) {
      await this.prisma.calendarEvent.updateMany({
        where: { parent_event_id: parentId },
        data: updateData,
      });
    }
    return parent;
  }

  async removeRecurrenceAll(parentId: string) {
    // Deletar filhos primeiro, depois o pai
    await this.prisma.calendarEvent.deleteMany({ where: { parent_event_id: parentId } });
    await this.prisma.calendarEvent.delete({ where: { id: parentId } });
    return { deleted: true };
  }

  // ─── Search ───────────────────────────────────────────

  async search(query: string, tenantId?: string) {
    return this.prisma.calendarEvent.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { start_at: 'desc' },
      take: 20,
    });
  }

  // ─── ICS Export ───────────────────────────────────────

  async exportICS(eventIds: string[]): Promise<string> {
    const events = await this.prisma.calendarEvent.findMany({
      where: { id: { in: eventIds } },
      include: {
        assigned_user: { select: { name: true } },
        lead: { select: { name: true } },
      },
    });

    const formatIcsDate = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LexCRM//Calendar//PT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    for (const evt of events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${evt.id}@lexcrm`);
      lines.push(`DTSTART:${formatIcsDate(evt.start_at)}`);
      if (evt.end_at) lines.push(`DTEND:${formatIcsDate(evt.end_at)}`);
      lines.push(`SUMMARY:${(evt.title || '').replace(/[,;\\]/g, ' ')}`);
      if (evt.description) lines.push(`DESCRIPTION:${evt.description.replace(/\n/g, '\\n').replace(/[,;\\]/g, ' ')}`);
      if (evt.location) lines.push(`LOCATION:${evt.location.replace(/[,;\\]/g, ' ')}`);
      lines.push(`STATUS:${evt.status === 'CONFIRMADO' ? 'CONFIRMED' : evt.status === 'CANCELADO' ? 'CANCELLED' : 'TENTATIVE'}`);
      lines.push(`CREATED:${formatIcsDate(evt.created_at)}`);
      lines.push(`LAST-MODIFIED:${formatIcsDate(evt.updated_at)}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ─── Ownership Check ──────────────────────────────────

  async checkOwnership(eventId: string, userId: string, userRole: string): Promise<boolean> {
    if (userRole === 'ADMIN') return true;
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { created_by_id: true, assigned_user_id: true },
    });
    if (!event) throw new NotFoundException('Evento nao encontrado');
    return event.created_by_id === userId || event.assigned_user_id === userId;
  }

  // ─── Comments ─────────────────────────────────────────

  async addComment(eventId: string, userId: string, text: string) {
    const comment = await (this.prisma as any).calendarEventComment.create({
      data: { event_id: eventId, user_id: userId, text },
      include: { user: { select: { id: true, name: true } } },
    });

    // Notificar assigned e creator (exceto quem comentou)
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { assigned_user_id: true, created_by_id: true, title: true },
    });
    if (event) {
      const notifyIds = new Set<string>();
      if (event.assigned_user_id && event.assigned_user_id !== userId) notifyIds.add(event.assigned_user_id);
      if (event.created_by_id !== userId) notifyIds.add(event.created_by_id);
      for (const uid of notifyIds) {
        try { this.chatGateway.server?.to(`user_${uid}`).emit('calendar_update'); } catch {}
      }
    }

    return comment;
  }

  async findComments(eventId: string) {
    return (this.prisma as any).calendarEventComment.findMany({
      where: { event_id: eventId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { created_at: 'asc' },
    });
  }

  // ─── Legal Case Tasks ─────────────────────────────────

  async findByLegalCase(legalCaseId: string) {
    return this.prisma.calendarEvent.findMany({
      where: { legal_case_id: legalCaseId, type: 'TAREFA' },
      include: {
        assigned_user: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ─── Migrate Tasks ────────────────────────────────────

  async migrateOrphanTasks() {
    const orphanTasks = await this.prisma.task.findMany({
      where: { calendar_event_id: null },
      include: { comments: true },
    });

    let migrated = 0;
    for (const task of orphanTasks) {
      const creatorId = task.assigned_user_id || (await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }))?.id;
      if (!creatorId) continue;

      const event = await this.prisma.calendarEvent.create({
        data: {
          type: 'TAREFA',
          title: task.title,
          description: task.description,
          start_at: task.due_at || task.created_at,
          end_at: task.due_at ? new Date(task.due_at.getTime() + 30 * 60000) : null,
          status: task.status === 'CONCLUIDO' || task.status === 'CONCLUIDA' ? 'CONCLUIDO'
                : task.status === 'CANCELADA' ? 'CANCELADO'
                : 'AGENDADO',
          assigned_user_id: task.assigned_user_id,
          created_by_id: creatorId,
          lead_id: task.lead_id,
          conversation_id: task.conversation_id,
          legal_case_id: task.legal_case_id,
          tenant_id: task.tenant_id,
        },
      });

      await this.prisma.task.update({
        where: { id: task.id },
        data: { calendar_event_id: event.id },
      });

      // Migrar comentários
      for (const c of task.comments) {
        await (this.prisma as any).calendarEventComment.create({
          data: { event_id: event.id, user_id: c.user_id, text: c.text, created_at: c.created_at },
        });
      }
      migrated++;
    }

    // Migrar comentários de tasks já vinculadas
    const linkedTasks = await this.prisma.task.findMany({
      where: { calendar_event_id: { not: null } },
      include: { comments: true },
    });
    let commentsMigrated = 0;
    for (const task of linkedTasks) {
      for (const c of task.comments) {
        const exists = await (this.prisma as any).calendarEventComment.findFirst({
          where: { event_id: task.calendar_event_id!, user_id: c.user_id, text: c.text },
        });
        if (!exists) {
          await (this.prisma as any).calendarEventComment.create({
            data: { event_id: task.calendar_event_id!, user_id: c.user_id, text: c.text, created_at: c.created_at },
          });
          commentsMigrated++;
        }
      }
    }

    return { orphanTasksMigrated: migrated, commentsMigrated };
  }
}
