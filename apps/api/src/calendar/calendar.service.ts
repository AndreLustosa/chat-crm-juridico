import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { isAdmin } from '../common/utils/permissions.util';

const EVENT_TYPES = ['CONSULTA', 'TAREFA', 'AUDIENCIA', 'PERICIA', 'PRAZO', 'OUTRO'] as const;
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

    if (query.tenantId) {
      where.OR = [{ tenant_id: query.tenantId }, { tenant_id: null }];
    }
    if (query.type) where.type = query.type;
    if (query.leadId) where.lead_id = query.leadId;
    if (query.legalCaseId) where.legal_case_id = query.legalCaseId;

    // Filtrar por userId:
    // - Se o evento TEM um responsável (assigned_user_id preenchido), apenas ele vê.
    // - Se o evento NÃO TEM responsável, o criador (created_by_id) vê.
    // Isso garante que ao trocar o advogado, o antigo para de ver o evento.
    if (query.userId) {
      if (!where.AND) where.AND = [];
      where.AND.push({
        OR: [
          { assigned_user_id: query.userId },
          { assigned_user_id: null, created_by_id: query.userId },
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
      // Schedule-x pode enviar datas em vários formatos:
      // - "2026-03-09T07:00:00+00:00[UTC]" → remover sufixo IANA
      // - "2026-03-09 00:00" → converter espaço para T
      // - "2026-03-09" → date-only
      const parseDate = (s: string) => {
        const cleaned = s.replace(/\[.*?\]$/, '').trim();
        // Se é formato "YYYY-MM-DD HH:mm", converter para ISO
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(cleaned)) {
          return new Date(cleaned.replace(' ', 'T'));
        }
        return new Date(cleaned);
      };
      // Overlap query: inclui eventos que começam antes do range mas terminam dentro dele
      // Evento visível se: start_at < rangeEnd AND (end_at > rangeStart OR end_at IS NULL AND start_at >= rangeStart)
      if (query.start && query.end) {
        const rangeStart = parseDate(query.start);
        const rangeEnd = parseDate(query.end);
        // Defensive: skip filter if dates are invalid
        if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
          this.logger.warn(`[findAll] Invalid date range: start=${query.start}, end=${query.end}`);
        } else {
          where.start_at = { lt: rangeEnd };
          if (!where.AND) where.AND = [];
          where.AND.push({
            OR: [
              { end_at: { gt: rangeStart } },
              { end_at: null, start_at: { gte: rangeStart } },
            ],
          });
        }
      } else {
        where.start_at = {};
        if (query.start) where.start_at.gte = parseDate(query.start);
        if (query.end) where.start_at.lte = parseDate(query.end);
      }
    }

    return this.prisma.calendarEvent.findMany({
      where,
      include: {
        assigned_user: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true, lead: { select: { name: true } } } },
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
        legal_case: { select: { id: true, case_number: true, legal_area: true, lead: { select: { name: true } } } },
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

    // Auto-preencher lead_id a partir do processo vinculado, se não informado
    let resolvedLeadId = data.lead_id;
    if (!resolvedLeadId && data.legal_case_id) {
      const legalCase = await this.prisma.legalCase.findUnique({
        where: { id: data.legal_case_id },
        select: { lead_id: true },
      });
      if (legalCase?.lead_id) resolvedLeadId = legalCase.lead_id;
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
        lead_id: resolvedLeadId,
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

    // Se não tem lead direto mas tem processo, buscar lead do processo
    let leadPhone: string | undefined = event.lead?.phone || undefined;
    if (!leadPhone && data.legal_case_id) {
      try {
        const lc = await this.prisma.legalCase.findUnique({
          where: { id: data.legal_case_id },
          select: { lead_id: true, lead: { select: { phone: true } } },
        });
        leadPhone = lc?.lead?.phone || undefined;
        // Vincular lead_id ao evento para futuras referências
        if (lc?.lead_id && !event.lead_id) {
          await this.prisma.calendarEvent.update({
            where: { id: event.id },
            data: { lead_id: lc.lead_id },
          }).catch(() => {});
        }
      } catch {}
    }

    // Notificação imediata ao cliente (1 min de delay) quando audiência ou perícia é agendada
    if ((data.type === 'AUDIENCIA' || data.type === 'PERICIA') && leadPhone) {
      try {
        await this.reminderQueue.add(
          'notify-hearing-scheduled',
          { eventId: event.id },
          {
            delay: 60_000, // 1 minuto — dá tempo ao operador de corrigir antes do envio
            jobId: `hearing-notify-${event.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
        this.logger.log(`[NOTIFY] Notificação ${data.type} agendada ao cliente em 1 min (evento ${event.id}, lead: ${event.lead?.phone})`);
      } catch (e: any) {
        this.logger.error(`[NOTIFY] Erro ao enfileirar notificação ${data.type}: ${e.message}`);
      }
    }

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
        // Remove job anterior (se existir) antes de enfileirar — garante idempotência em re-agendamentos
        try { const old = await this.reminderQueue.getJob(jobId); if (old) await old.remove(); } catch {}
        await this.reminderQueue.add('send-reminder', {
          reminderId: r.id,
          eventId,
          channel: r.channel,
        }, {
          delay,
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 50,
        });
        this.logger.log(`Lembrete ${r.id} enfileirado: canal=${r.channel}, delay=${Math.round(delay / 60000)}min`);
      } catch (e: any) {
        this.logger.error(`Erro ao enfileirar lembrete ${r.id}: ${e.message}`);
      }
    }
  }

  /** Remove todos os jobs de lembrete de um evento da fila BullMQ */
  private async cancelReminderJobs(eventId: string) {
    try {
      const reminders = await this.prisma.eventReminder.findMany({
        where: { event_id: eventId },
        select: { id: true },
      });
      for (const r of reminders) {
        try {
          const job = await this.reminderQueue.getJob(`reminder-${r.id}`);
          if (job) await job.remove();
        } catch {}
      }
    } catch (e: any) {
      this.logger.warn(`Erro ao cancelar jobs de lembrete do evento ${eventId}: ${e.message}`);
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

    // Auto-preencher lead_id a partir do processo vinculado, se legal_case_id mudou e lead_id não foi informado
    if (data.legal_case_id && data.lead_id === undefined) {
      const legalCase = await this.prisma.legalCase.findUnique({
        where: { id: data.legal_case_id },
        select: { lead_id: true },
      });
      if (legalCase?.lead_id) updateData.lead_id = legalCase.lead_id;
    }

    // Carrega estado anterior para detectar mudanças relevantes na audiência
    const before = await this.prisma.calendarEvent.findUnique({
      where: { id },
      select: { type: true, start_at: true, location: true, lead_id: true },
    });

    const event = await this.prisma.calendarEvent.update({
      where: { id },
      data: updateData,
      include: {
        assigned_user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true } },
        reminders: true,
      },
    });

    // Se start_at mudou, re-enfileirar todos os lembretes com o novo delay
    if (data.start_at && event.reminders?.length) {
      await this.enqueueReminders(event.id, event.start_at, event.reminders);
      this.logger.log(`Lembretes re-enfileirados para evento ${event.id} (start_at alterado)`);
    }

    // Se é AUDIÊNCIA ou PERÍCIA e data ou local mudaram → notificar cliente sobre a remarcação
    const isAudiencia = ['AUDIENCIA', 'PERICIA'].includes(before?.type ?? event.type);
    const dateChanged = data.start_at && new Date(data.start_at).getTime() !== before?.start_at?.getTime();
    const locationChanged = data.location !== undefined && data.location !== before?.location;
    if (isAudiencia && (dateChanged || locationChanged) && event.lead?.phone) {
      try {
        // Cancela notificação anterior pendente (se operador ainda não enviou)
        const oldJob = await this.reminderQueue.getJob(`hearing-notify-${event.id}`);
        if (oldJob) await oldJob.remove();
        // Enfileira nova notificação de remarcação com 1 minuto de delay
        await this.reminderQueue.add(
          'notify-hearing-rescheduled',
          { eventId: event.id },
          {
            delay: 60_000,
            jobId: `hearing-notify-${event.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
        this.logger.log(`[AUDIENCIA] Notificação de remarcação enfileirada para evento ${event.id}`);
      } catch (e: any) {
        this.logger.error(`[AUDIENCIA] Erro ao enfileirar notificação de remarcação: ${e.message}`);
      }
    }

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

    const event = await this.prisma.calendarEvent.update({
      where: { id },
      data: { status },
      include: { assigned_user: { select: { id: true, name: true } } },
    });

    // Cancelar jobs de lembrete quando evento é cancelado/concluído
    if (['CANCELADO', 'CONCLUIDO'].includes(status)) {
      await this.cancelReminderJobs(id);
      this.logger.log(`Lembretes cancelados para evento ${id} (status → ${status})`);
    }

    // Notificar advogado
    if (event.assigned_user_id) {
      try {
        this.chatGateway.emitCalendarUpdate(event.assigned_user_id, {
          eventId: id,
          action: 'status_changed',
          title: event.title,
          type: event.type,
        });
      } catch {}
    }

    return event;
  }

  async remove(id: string) {
    const event = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Evento nao encontrado');

    // Cancelar jobs de lembrete pendentes na fila BullMQ antes de deletar
    await this.cancelReminderJobs(id);

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

  async checkConflicts(userId: string, startAt: string, endAt: string, excludeEventId?: string, tenantId?: string) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const where: any = {
      assigned_user_id: userId,
      status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
      // Overlap: evento começa antes do fim do range E (termina após início do range OU sem end_at mas começa dentro do range)
      start_at: { lt: end },
      OR: [
        { end_at: { gt: start } },
        { end_at: null, start_at: { gte: start } },
      ],
    };
    // Isolamento de tenant: admin de um tenant não vê agenda de outro tenant
    if (tenantId) {
      where.AND = [
        ...(where.AND || []),
        { OR: [{ tenant_id: tenantId }, { tenant_id: null }] },
      ];
    }
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

  async getAvailability(userId: string, dateStr: string, durationMinutes: number, tenantId?: string) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Data inválida');
    }
    // UTC naive: datas armazenadas como horário local em UTC — usar getUTCDay()
    const dayOfWeek = date.getUTCDay(); // 0=dom..6=sab

    // 0. Verificar se e feriado (com filtro de tenant)
    const isHoliday = await this.isHoliday(date, tenantId);
    if (isHoliday) return [];

    // 1. Horario de trabalho do dia
    const schedule = await this.prisma.userSchedule.findUnique({
      where: { user_id_day_of_week: { user_id: userId, day_of_week: dayOfWeek } },
    });
    if (!schedule) return [];

    // 2. Eventos existentes nesse dia (inclui eventos que começaram antes mas terminam durante o dia)
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        // Overlap: evento começa antes do fim do dia E (termina após início do dia OU sem end_at mas começa no dia)
        start_at: { lte: dayEnd },
        OR: [
          { end_at: { gte: dayStart } },
          { end_at: null, start_at: { gte: dayStart } },
        ],
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
      },
      select: { start_at: true, end_at: true },
      orderBy: { start_at: 'asc' },
    });

    // 3. Calcular slots livres
    const [startH, startM] = schedule.start_time.split(':').map(Number);
    const [endH, endM] = schedule.end_time.split(':').map(Number);
    const workStart = startH * 60 + startM;
    const workEnd = endH * 60 + endM;

    // UTC naive: extrair hora/minuto direto em UTC (datas armazenadas como horário local)
    const toLocalMinutes = (d: Date): number => {
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    };

    const busy = events.map((e) => {
      const s = Math.max(toLocalMinutes(e.start_at), workStart);
      const eEnd = e.end_at
        ? Math.min(toLocalMinutes(e.end_at), workEnd)
        : Math.min(s + durationMinutes, workEnd);
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

  private async isHoliday(date: Date, tenantId?: string): Promise<boolean> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Filtro de tenant: feriados globais (tenant_id NULL) + feriados do tenant
    const tenantFilter = tenantId
      ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] }
      : {};

    // Check exact date holidays
    const exactMatch = await this.prisma.holiday.findFirst({
      where: {
        date: { gte: dayStart, lte: dayEnd },
        recurring_yearly: false,
        ...tenantFilter,
      },
    });
    if (exactMatch) return true;

    // Check recurring yearly holidays (same month + day, any year)
    const month = date.getMonth() + 1;
    const day = date.getDate();
    if (tenantId) {
      const recurringMatch = await this.prisma.$queryRaw`
        SELECT id FROM "Holiday"
        WHERE recurring_yearly = true
          AND EXTRACT(MONTH FROM date) = ${month}
          AND EXTRACT(DAY FROM date) = ${day}
          AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
        LIMIT 1
      ` as any[];
      return recurringMatch.length > 0;
    }
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

    // Calcular duração: prioridade → end_at, appointment_type.duration, fallback 30min
    let duration: number;
    if (endAt) {
      duration = endAt.getTime() - startAt.getTime();
    } else if (parentEvent.appointment_type_id) {
      const apptType = parentEvent.appointment_type?.duration
        ?? (await this.prisma.appointmentType.findUnique({
            where: { id: parentEvent.appointment_type_id },
            select: { duration: true },
          }))?.duration;
      duration = (apptType || 30) * 60 * 1000;
    } else {
      duration = 30 * 60 * 1000;
    }
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

    // Buscar lembretes do evento pai para replicar nos filhos
    const parentReminders = parentEvent.reminders?.length
      ? parentEvent.reminders
      : await this.prisma.eventReminder.findMany({
          where: { event_id: parentEvent.id },
          select: { minutes_before: true, channel: true },
        });

    // Processar em lotes de 20 para não sobrecarregar o pool de conexões do DB
    const BATCH_SIZE = 20;
    const children: any[] = [];
    const createChild = async (d: Date) => {
      const childStart = new Date(d);
      childStart.setHours(startAt.getHours(), startAt.getMinutes(), startAt.getSeconds());
      const childEnd = new Date(childStart.getTime() + duration);

      const child = await this.prisma.calendarEvent.create({
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
          // Replicar lembretes do pai nos filhos
          ...(parentReminders.length > 0
            ? {
                reminders: {
                  create: parentReminders.map((r: any) => ({
                    minutes_before: r.minutes_before,
                    channel: r.channel ?? 'PUSH',
                  })),
                },
              }
            : {}),
        },
        include: { reminders: true },
      });

      // Enfileirar lembretes WhatsApp/Email para o filho
      if (child.reminders?.length) {
        await this.enqueueReminders(child.id, child.start_at, child.reminders);
      }

      return child;
    };

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(createChild));
      children.push(...batchResults);
    }

    this.logger.log(`Criadas ${children.length} instancias recorrentes (com lembretes) para evento ${parentEvent.id}`);
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

    // UTC naive: datas armazenadas como horário local em UTC — extrair componentes UTC
    // O TZID no ICS é America/Sao_Paulo, então os valores devem ser horário local (= UTC raw)
    const formatIcsLocalDate = (d: Date) => {
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const da = String(d.getUTCDate()).padStart(2, '0');
      const h = String(d.getUTCHours()).padStart(2, '0');
      const mi = String(d.getUTCMinutes()).padStart(2, '0');
      const s = String(d.getUTCSeconds()).padStart(2, '0');
      return `${y}${mo}${da}T${h}${mi}${s}`;
    };

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LexCRM//Calendar//PT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      // VTIMEZONE para America/Sao_Paulo
      'BEGIN:VTIMEZONE',
      'TZID:America/Sao_Paulo',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:-0300',
      'TZOFFSETTO:-0300',
      'TZNAME:BRT',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];

    for (const evt of events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${evt.id}@lexcrm`);
      lines.push(`DTSTART;TZID=America/Sao_Paulo:${formatIcsLocalDate(evt.start_at)}`);
      if (evt.end_at) lines.push(`DTEND;TZID=America/Sao_Paulo:${formatIcsLocalDate(evt.end_at)}`);
      lines.push(`SUMMARY:${(evt.title || '').replace(/[,;\\]/g, ' ')}`);
      if (evt.description) lines.push(`DESCRIPTION:${evt.description.replace(/\n/g, '\\n').replace(/[,;\\]/g, ' ')}`);
      if (evt.location) lines.push(`LOCATION:${evt.location.replace(/[,;\\]/g, ' ')}`);
      lines.push(`STATUS:${evt.status === 'CONFIRMADO' ? 'CONFIRMED' : evt.status === 'CANCELADO' ? 'CANCELLED' : 'TENTATIVE'}`);
      lines.push(`CREATED:${formatIcsLocalDate(evt.created_at)}`);
      lines.push(`LAST-MODIFIED:${formatIcsLocalDate(evt.updated_at)}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ─── Ownership Check ──────────────────────────────────

  async checkOwnership(eventId: string, userId: string, userRoles: string | string[], tenantId?: string): Promise<boolean> {
    if (isAdmin(userRoles)) return true;
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: { created_by_id: true, assigned_user_id: true, tenant_id: true },
    });
    if (!event) throw new NotFoundException('Evento nao encontrado');
    // Tenant isolation check
    if (tenantId && event.tenant_id && event.tenant_id !== tenantId) return false;
    return event.created_by_id === userId ||
      (event.assigned_user_id !== null && event.assigned_user_id === userId);
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
        try {
          this.chatGateway.emitCalendarUpdate(uid, {
            eventId,
            action: 'comment_added',
            title: event.title ?? '',
          });
        } catch {}
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

  async findByLegalCase(legalCaseId: string, type?: string, tenantId?: string) {
    return this.prisma.calendarEvent.findMany({
      where: {
        legal_case_id: legalCaseId,
        ...(type ? { type } : {}),
        ...(tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {}),
      },
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
      const creatorId = task.assigned_user_id || (await this.prisma.user.findFirst({ where: { roles: { has: 'ADMIN' } }, select: { id: true } }))?.id;
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

  // ─── Re-envio manual de notificação ──────────────────────────────────────────

  async notifyEvent(eventId: string): Promise<{ queued: boolean; message: string }> {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        lead: { select: { phone: true } },
      },
    });

    if (!event) {
      throw new NotFoundException(`Evento ${eventId} não encontrado`);
    }

    if (!['AUDIENCIA', 'PERICIA'].includes(event.type)) {
      throw new BadRequestException(
        `Notificação manual disponível apenas para Audiência e Perícia (tipo atual: ${event.type})`,
      );
    }

    if (!event.lead?.phone) {
      throw new BadRequestException(
        'Cliente vinculado ao evento não possui telefone cadastrado',
      );
    }

    if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
      throw new BadRequestException(
        `Evento está ${event.status} — notificação não enviada`,
      );
    }

    // Remove job pendente anterior para evitar duplicata
    try {
      const existing = await this.reminderQueue.getJob(`hearing-notify-${eventId}`);
      if (existing) await existing.remove();
    } catch {}

    // Enfileira sem delay (envio imediato)
    await this.reminderQueue.add(
      'notify-hearing-scheduled',
      { eventId },
      {
        jobId: `hearing-notify-manual-${eventId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );

    this.logger.log(`[NOTIFY] Re-envio manual enfileirado para evento ${eventId} (${event.type}: "${event.title}")`);
    return { queued: true, message: `Notificação de ${event.type === 'PERICIA' ? 'perícia' : 'audiência'} enfileirada com sucesso` };
  }
}
