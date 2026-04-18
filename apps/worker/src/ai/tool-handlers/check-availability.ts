import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * Verifica horários disponíveis de um advogado para agendamento.
 * Consulta UserSchedule, Holidays e CalendarEvents existentes.
 *
 * UTC naive: as datas são armazenadas com os componentes locais como se fossem
 * UTC. Portanto usamos getUTCHours()/getUTCDay() em todo lugar.
 */
export class CheckAvailabilityHandler implements ToolHandler {
  name = 'check_availability';

  async execute(
    params: { date?: string; days_ahead?: number; duration_minutes?: number },
    context: ToolContext,
  ): Promise<any> {
    const prisma = context.prisma;
    const durationMinutes = params.duration_minutes || 60;

    const convo = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { assigned_lawyer_id: true, assigned_user_id: true },
    });

    const userId = convo?.assigned_lawyer_id || convo?.assigned_user_id;
    if (!userId) {
      return { available: false, message: 'Nenhum advogado atribuído a esta conversa.' };
    }

    const daysToCheck = params.days_ahead ?? 7;
    const startDate = params.date ? new Date(`${params.date}T00:00:00Z`) : new Date();
    if (!params.date) {
      // Começa no próximo dia (UTC naive)
      startDate.setUTCDate(startDate.getUTCDate() + 1);
    }

    const slots: { date: string; times: string[] }[] = [];

    for (let i = 0; i < daysToCheck && slots.length < 5; i++) {
      const day = new Date(startDate.getTime());
      day.setUTCDate(day.getUTCDate() + i);

      // Pula fim de semana (UTC naive → getUTCDay)
      const dow = day.getUTCDay();
      if (dow === 0 || dow === 6) continue;

      const dateStr = day.toISOString().split('T')[0];
      const daySlots = await this.getSlots(prisma, userId, dateStr, durationMinutes);
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
    const dayStart = new Date(`${dateStr}T00:00:00Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59Z`);

    // Feriado (no dia)
    const holiday = await prisma.holiday.count({
      where: {
        date: { gte: dayStart, lte: dayEnd },
      },
    });
    if (holiday > 0) return [];

    // Agenda do advogado para o dia da semana
    const schedule = await prisma.userSchedule.findUnique({
      where: { user_id_day_of_week: { user_id: userId, day_of_week: dayStart.getUTCDay() } },
    });
    if (!schedule) return [];

    // Eventos existentes do advogado no dia
    const events = await prisma.calendarEvent.findMany({
      where: {
        assigned_user_id: userId,
        start_at: { gte: dayStart, lte: dayEnd },
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
      },
      select: { start_at: true, end_at: true },
    });

    const [startH, startM] = (schedule.start_time || '08:00').split(':').map(Number);
    const [endH, endM] = (schedule.end_time || '18:00').split(':').map(Number);
    const workStart = startH * 60 + startM;
    const workEnd = endH * 60 + endM;

    const busyMinutes = new Set<number>();
    for (const ev of events) {
      const evStart = ev.start_at.getUTCHours() * 60 + ev.start_at.getUTCMinutes();
      const evEnd = ev.end_at
        ? ev.end_at.getUTCHours() * 60 + ev.end_at.getUTCMinutes()
        : evStart + 60;
      for (let m = evStart; m < evEnd; m++) busyMinutes.add(m);
    }

    // Bloqueia horário de almoço se definido
    if (schedule.lunch_start && schedule.lunch_end) {
      const [lsH, lsM] = schedule.lunch_start.split(':').map(Number);
      const [leH, leM] = schedule.lunch_end.split(':').map(Number);
      const lunchStart = lsH * 60 + lsM;
      const lunchEnd = leH * 60 + leM;
      for (let m = lunchStart; m < lunchEnd; m++) busyMinutes.add(m);
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
