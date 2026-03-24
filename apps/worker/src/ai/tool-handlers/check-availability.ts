import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * Verifica horários disponíveis de um advogado para agendamento.
 * Consulta UserSchedule, Holidays e CalendarEvents existentes.
 */
export class CheckAvailabilityHandler implements ToolHandler {
  name = 'check_availability';

  async execute(
    params: { date?: string; days_ahead?: number; duration_minutes?: number },
    context: ToolContext,
  ): Promise<any> {
    const prisma = context.prisma;
    const durationMinutes = params.duration_minutes || 60;

    // Discover assigned lawyer
    const convo = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { assigned_lawyer_id: true },
    });

    if (!convo?.assigned_lawyer_id) {
      return { available: false, message: 'Nenhum advogado atribuído a esta conversa.' };
    }

    const lawyerId = convo.assigned_lawyer_id;
    const daysToCheck = params.days_ahead ?? 7;
    const startDate = params.date ? new Date(params.date) : new Date();
    if (!params.date) startDate.setDate(startDate.getDate() + 1); // start tomorrow

    const slots: { date: string; times: string[] }[] = [];

    for (let i = 0; i < daysToCheck && slots.length < 5; i++) {
      const day = new Date(startDate);
      day.setDate(day.getDate() + i);

      // Skip weekends
      if (day.getDay() === 0 || day.getDay() === 6) continue;

      const dateStr = day.toISOString().split('T')[0];
      const daySlots = await this.getSlots(prisma, lawyerId, dateStr, durationMinutes);
      if (daySlots.length > 0) {
        slots.push({ date: dateStr, times: daySlots.slice(0, 6) });
      }
    }

    if (slots.length === 0) {
      return { available: false, message: 'Nenhum horário disponível nos próximos dias.' };
    }

    return { available: true, slots };
  }

  private async getSlots(
    prisma: any,
    userId: string,
    dateStr: string,
    durationMinutes: number,
  ): Promise<string[]> {
    const date = new Date(dateStr);

    // Check holiday
    const holiday = await prisma.holiday.count({
      where: {
        OR: [
          { date: new Date(dateStr) },
          { date: { gte: new Date(dateStr + 'T00:00:00'), lte: new Date(dateStr + 'T23:59:59') } },
        ],
      },
    });
    if (holiday > 0) return [];

    // Get work schedule for this day of week
    const schedule = await prisma.userSchedule.findUnique({
      where: { user_id_day_of_week: { user_id: userId, day_of_week: date.getDay() } },
    });
    if (!schedule || !schedule.is_active) return [];

    // Get existing events for that day
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dateStr + 'T23:59:59');
    const events = await prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        start_at: { gte: dayStart, lte: dayEnd },
        status: { not: 'CANCELADO' },
      },
      select: { start_at: true, end_at: true },
    });

    // Build available slots from work hours
    const [startH, startM] = (schedule.start_time || '08:00').split(':').map(Number);
    const [endH, endM] = (schedule.end_time || '18:00').split(':').map(Number);
    const workStart = startH * 60 + startM;
    const workEnd = endH * 60 + endM;

    const busyMinutes = new Set<number>();
    for (const ev of events) {
      const evStart = ev.start_at.getHours() * 60 + ev.start_at.getMinutes();
      const evEnd = ev.end_at ? ev.end_at.getHours() * 60 + ev.end_at.getMinutes() : evStart + 60;
      for (let m = evStart; m < evEnd; m++) busyMinutes.add(m);
    }

    const available: string[] = [];
    for (let m = workStart; m + durationMinutes <= workEnd; m += 30) {
      let free = true;
      for (let d = 0; d < durationMinutes; d++) {
        if (busyMinutes.has(m + d)) { free = false; break; }
      }
      if (free) {
        const h = Math.floor(m / 60).toString().padStart(2, '0');
        const min = (m % 60).toString().padStart(2, '0');
        available.push(`${h}:${min}`);
      }
    }

    return available;
  }
}
