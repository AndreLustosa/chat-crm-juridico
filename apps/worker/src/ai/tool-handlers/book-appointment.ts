import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * Agenda uma reunião/consulta para o lead.
 * Cria CalendarEvent e enfileira lembretes WhatsApp (via reminderQueue se disponível).
 */
export class BookAppointmentHandler implements ToolHandler {
  name = 'book_appointment';

  async execute(
    params: {
      date: string;       // YYYY-MM-DD
      time: string;       // HH:MM
      title?: string;
      duration_minutes?: number;
    },
    context: ToolContext,
  ): Promise<any> {
    const prisma = context.prisma;

    if (!params.date || !params.time) {
      return { success: false, error: 'date e time são obrigatórios (YYYY-MM-DD e HH:MM)' };
    }

    // Resolve assigned lawyer
    const convo = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { assigned_lawyer_id: true },
    });

    if (!convo?.assigned_lawyer_id) {
      return { success: false, error: 'Nenhum advogado atribuído a esta conversa.' };
    }

    const lawyerId = convo.assigned_lawyer_id;
    const durationMinutes = params.duration_minutes ?? 60;

    const [h, m] = params.time.split(':').map(Number);
    const startAt = new Date(`${params.date}T00:00:00`);
    startAt.setHours(h, m, 0, 0);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    const event = await prisma.calendarEvent.create({
      data: {
        type: 'CONSULTA',
        title: params.title || 'Consulta',
        description: 'Reunião agendada automaticamente pela IA',
        start_at: startAt,
        end_at: endAt,
        status: 'AGENDADO',
        priority: 'NORMAL',
        assigned_user_id: lawyerId,
        lead_id: context.leadId,
        conversation_id: context.conversationId,
        created_by_id: lawyerId,
        reminders: {
          create: [
            { minutes_before: 60, channel: 'WHATSAPP' },
            { minutes_before: 1440, channel: 'WHATSAPP' },
          ],
        },
      },
      include: { reminders: true },
    });

    // Enqueue WhatsApp reminders if queue is available
    if (context.reminderQueue) {
      for (const r of event.reminders) {
        const fireAt = new Date(event.start_at.getTime() - r.minutes_before * 60 * 1000);
        if (fireAt > new Date()) {
          await context.reminderQueue.add(
            'send-reminder',
            { reminderId: r.id, eventId: event.id, channel: r.channel },
            { delay: fireAt.getTime() - Date.now() },
          );
        }
      }
    }

    return {
      success: true,
      eventId: event.id,
      date: params.date,
      time: params.time,
      message: `Consulta agendada para ${params.date} às ${params.time}`,
    };
  }
}
