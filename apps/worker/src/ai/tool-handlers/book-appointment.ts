import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { ToolHandler, ToolContext } from '../tool-executor';
import { tenantOrDefault } from '../../common/constants/tenant';

/**
 * Agenda uma reunião/consulta para o lead.
 *
 * Efeitos:
 *  1. Cria CalendarEvent (type=CONSULTA, created_by_ai=true) para o advogado atribuído.
 *  2. Cria EventReminders de 30min (lembrete principal), 60min e 1440min (antecedência).
 *  3. Enfileira jobs na fila 'calendar-reminders' (canal WHATSAPP) para todos os lembretes.
 *  4. Dispara notificação IMEDIATA ao advogado via WhatsApp ("Novo agendamento pela IA").
 *
 * Os lembretes viajam pelo ReminderProcessor existente, que já sabe enviar para
 * event.lead.phone (cliente) e event.assigned_user.phone (advogado).
 */
export class BookAppointmentHandler implements ToolHandler {
  name = 'book_appointment';
  private readonly logger = new Logger(BookAppointmentHandler.name);

  async execute(
    params: {
      date: string;       // YYYY-MM-DD
      time: string;       // HH:MM
      modality?: 'LIGACAO' | 'VIDEO' | 'PRESENCIAL';
      title?: string;
      description?: string;
      duration_minutes?: number;
    },
    context: ToolContext,
  ): Promise<any> {
    const prisma = context.prisma;

    if (!params.date || !params.time) {
      return { success: false, error: 'date e time são obrigatórios (YYYY-MM-DD e HH:MM)' };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      return { success: false, error: `Data inválida: "${params.date}". Use YYYY-MM-DD.` };
    }
    if (!/^\d{2}:\d{2}$/.test(params.time)) {
      return { success: false, error: `Hora inválida: "${params.time}". Use HH:MM (24h).` };
    }

    // Resolve assigned lawyer + tenant
    const convo = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { assigned_lawyer_id: true, assigned_user_id: true, tenant_id: true },
    });

    const assignedUserId = convo?.assigned_lawyer_id || convo?.assigned_user_id;
    if (!assignedUserId) {
      return {
        success: false,
        error: 'Nenhum advogado atribuído a esta conversa. Use escalate_to_human antes de agendar.',
      };
    }

    // Modalidade obrigatoria — sem default. A IA tem que perguntar antes
    // de chamar a tool. Default LIGACAO causava IA prometer ligacao ate
    // pra cliente que pediu presencial (bug 2026-05-08).
    if (!params.modality) {
      return {
        success: false,
        error: 'Modalidade obrigatoria. Pergunte ao cliente: ligacao, video ou presencial. Depois chame book_appointment com modality definido.',
      };
    }
    const modality = params.modality;
    const modalityCfg = {
      LIGACAO: { minutes: 15, label: 'Ligação telefônica', emoji: '📞' },
      VIDEO: { minutes: 30, label: 'Videochamada', emoji: '💻' },
      PRESENCIAL: { minutes: 30, label: 'Atendimento presencial', emoji: '📍' },
    }[modality];
    if (!modalityCfg) {
      return {
        success: false,
        error: `Modalidade invalida: "${modality}". Use LIGACAO, VIDEO ou PRESENCIAL.`,
      };
    }
    const durationMinutes = params.duration_minutes ?? modalityCfg.minutes;

    // UTC naive: datas são gravadas com os componentes locais como se fossem UTC.
    // Constrói direto via Date.UTC para não sofrer conversão pelo fuso da VPS.
    const [y, mo, d] = params.date.split('-').map(Number);
    const [h, mi] = params.time.split(':').map(Number);
    const startAt = new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    if (startAt.getTime() <= Date.now()) {
      return { success: false, error: 'Data/hora já passou. Ofereça outro horário.' };
    }

    // ─── DEDUP por lead ────────────────────────────────────────────
    // Se o lead JA tem CONSULTA futura agendada (qualquer data/hora ainda
    // por vir), nao criar outra. Isso bloqueia o caso onde a IA dispara
    // book_appointment varias vezes na mesma conversa (race de jobs
    // duplicados, IA confusa com retry, etc.) e o lead acaba com 4
    // consultas. Idempotencia por lead — fix do bug 2026-05-08 (Jhennify).
    if (context.leadId) {
      const existingForLead = await prisma.calendarEvent.findFirst({
        where: {
          lead_id: context.leadId,
          type: 'CONSULTA',
          status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
          start_at: { gt: new Date() },
        },
        select: { id: true, title: true, start_at: true },
        orderBy: { start_at: 'asc' },
      });
      if (existingForLead) {
        // Mesmo dia + mesmo horario → idempotencia (retorna o existente)
        const isSameSlot =
          existingForLead.start_at.getTime() === startAt.getTime();
        if (isSameSlot) {
          this.logger.log(
            `[book_appointment] Lead ${context.leadId} ja tem evento ${existingForLead.id} no mesmo horario — retornando existente (idempotente)`,
          );
          return {
            success: true,
            eventId: existingForLead.id,
            date: params.date,
            time: params.time,
            duration_minutes: durationMinutes,
            already_exists: true,
            message: `Reunião já estava agendada para ${params.date} às ${params.time}.`,
          };
        }
        // Horario diferente → bloqueia (lead nao pode ter 2 consultas
        // simultaneas; se quiser remarcar, precisa cancelar a anterior)
        const existingDate = existingForLead.start_at.toISOString().slice(0, 10);
        const existingTime = existingForLead.start_at.toISOString().slice(11, 16);
        return {
          success: false,
          error: `Lead ja tem reuniao agendada em ${existingDate} as ${existingTime} ("${existingForLead.title}"). Cancele a anterior antes de marcar nova, ou confirme com o cliente se ele quer remarcar.`,
          existing_event_id: existingForLead.id,
        };
      }
    }

    // Conflito com evento existente do advogado
    const conflict = await prisma.calendarEvent.findFirst({
      where: {
        assigned_user_id: assignedUserId,
        status: { notIn: ['CANCELADO', 'CONCLUIDO'] },
        start_at: { lt: endAt },
        OR: [
          { end_at: { gt: startAt } },
          { end_at: null, start_at: { gte: startAt } },
        ],
      },
      select: { id: true, title: true, start_at: true },
    });

    if (conflict) {
      return {
        success: false,
        error: `Horário indisponível — já existe "${conflict.title}" nesse horário.`,
      };
    }

    // Local conforme modalidade
    const location =
      modality === 'LIGACAO' ? `📞 Ligação telefônica para ${context.leadPhone}` :
      modality === 'VIDEO' ? '💻 Videochamada (link enviado pelo advogado antes da reunião)' :
      '📍 Escritório — Rua Francisco Rodrigues Viana, 244, Baixa Grande, Arapiraca - AL';

    // Cria o CalendarEvent + reminders em uma só chamada
    const event = await prisma.calendarEvent.create({
      data: {
        type: 'CONSULTA',
        title: params.title || `${modalityCfg.emoji} ${modalityCfg.label}`,
        description: [
          `🤖 Agendada pela Sophia (IA) via WhatsApp.`,
          ``,
          `Modalidade: ${modalityCfg.label} (${durationMinutes} min)`,
          params.description ? `\nMotivo: ${params.description}` : '',
        ].filter(Boolean).join('\n'),
        location,
        start_at: startAt,
        end_at: endAt,
        status: 'AGENDADO',
        priority: 'NORMAL',
        assigned_user_id: assignedUserId,
        lead_id: context.leadId,
        conversation_id: context.conversationId,
        created_by_id: assignedUserId,
        created_by_ai: true,
        tenant_id: tenantOrDefault(convo.tenant_id),
        reminders: {
          create: [
            { minutes_before: 30, channel: 'WHATSAPP' },
            { minutes_before: 60, channel: 'WHATSAPP' },
            { minutes_before: 1440, channel: 'WHATSAPP' },
          ],
        },
      },
      include: {
        reminders: true,
        assigned_user: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, name: true, phone: true } },
      },
    });

    // Enfileira cada lembrete com delay correspondente
    if (context.reminderQueue) {
      for (const r of event.reminders) {
        const fireAt = new Date(event.start_at.getTime() - r.minutes_before * 60 * 1000);
        const delay = fireAt.getTime() - Date.now();
        if (delay <= 0) continue; // não tem tempo para disparar antes
        try {
          await context.reminderQueue.add(
            'send-reminder',
            { reminderId: r.id, eventId: event.id, channel: r.channel },
            {
              delay,
              jobId: `reminder-${r.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: 50,
            },
          );
        } catch (e: any) {
          this.logger.warn(`[book_appointment] Falha ao enfileirar lembrete ${r.id}: ${e.message}`);
        }
      }
    } else {
      this.logger.warn('[book_appointment] reminderQueue indisponível — lembretes NÃO foram enfileirados');
    }

    // Notificação imediata ao advogado via WhatsApp
    try {
      await this.notifyLawyer(event, prisma);
    } catch (e: any) {
      this.logger.warn(`[book_appointment] Falha ao notificar advogado: ${e.message}`);
    }

    return {
      success: true,
      eventId: event.id,
      date: params.date,
      time: params.time,
      duration_minutes: durationMinutes,
      lawyer_notified: !!event.assigned_user?.phone,
      message: `Reunião agendada para ${params.date} às ${params.time} com duração de ${durationMinutes}min. O advogado foi notificado.`,
    };
  }

  // ─── Notificação imediata ao advogado responsável ────────────────────
  private async notifyLawyer(event: any, prisma: any): Promise<void> {
    if (!event.assigned_user?.phone) {
      this.logger.warn(`[book_appointment] Advogado ${event.assigned_user_id} sem telefone — notificação pulada`);
      return;
    }

    const apiUrlRow = await prisma.globalSetting.findUnique({ where: { key: 'EVOLUTION_API_URL' } });
    const apiKeyRow = await prisma.globalSetting.findUnique({ where: { key: 'EVOLUTION_GLOBAL_APIKEY' } });

    let apiUrl = apiUrlRow?.value || process.env.EVOLUTION_API_URL || '';
    const apiKey = apiKeyRow?.value || process.env.EVOLUTION_GLOBAL_APIKEY || '';
    if (!apiUrl) {
      this.logger.warn('[book_appointment] EVOLUTION_API_URL ausente — notificação ao advogado pulada');
      return;
    }
    if (!/^https?:\/\//i.test(apiUrl)) apiUrl = `https://${apiUrl}`;
    apiUrl = apiUrl.replace(/\/+$/, '');

    const instance = process.env.EVOLUTION_INSTANCE_NAME || '';
    const dateStr = this.formatDate(event.start_at);
    const timeStr = this.formatTime(event.start_at);
    const endTimeStr = event.end_at ? this.formatTime(event.end_at) : null;

    const lines = [
      `📅 *Novo agendamento pela IA*`,
      ``,
      `*Cliente:* ${event.lead?.name || 'Não identificado'}`,
      `*Telefone:* ${event.lead?.phone || 'N/A'}`,
      `*Data:* ${dateStr}`,
      `*Horário:* ${timeStr}${endTimeStr ? ` - ${endTimeStr}` : ''}`,
      `*Assunto:* ${event.title}`,
    ];
    if (event.description) lines.push(`*Obs:* ${event.description}`);
    lines.push('', '_Agendado automaticamente pela assistente virtual._');

    await axios.post(
      `${apiUrl}/message/sendText/${instance}`,
      { number: event.assigned_user.phone, text: lines.join('\n') },
      { headers: { apikey: apiKey }, timeout: 15000 },
    );

    this.logger.log(
      `[book_appointment] Notificação enviada ao advogado ${event.assigned_user.name} (${event.assigned_user.phone})`,
    );
  }

  private formatDate(d: Date): string {
    return d.toLocaleDateString('pt-BR', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  private formatTime(d: Date): string {
    return d.toLocaleTimeString('pt-BR', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
