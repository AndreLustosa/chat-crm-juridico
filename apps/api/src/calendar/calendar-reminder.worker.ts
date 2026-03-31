import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SettingsService } from '../settings/settings.service';

// Formata data/hora em português brasileiro
function formatDateTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Maceio',
  });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Maceio',
  });
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutos`;
  if (minutes === 60) return '1 hora';
  if (minutes < 1440) return `${Math.round(minutes / 60)} horas`;
  if (minutes === 1440) return '1 dia';
  return `${Math.round(minutes / 1440)} dias`;
}

@Processor('calendar-reminders')
export class CalendarReminderWorker extends WorkerHost {
  private readonly logger = new Logger(CalendarReminderWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<{ reminderId: string; eventId: string; channel: string }>) {
    const { reminderId, eventId, channel } = job.data;

    if (channel !== 'WHATSAPP' && channel !== 'EMAIL') {
      this.logger.warn(`Worker: canal desconhecido "${channel}" para reminder ${reminderId}`);
      return;
    }

    const reminder = await this.prisma.eventReminder.findUnique({
      where: { id: reminderId },
      select: { id: true, sent_at: true, minutes_before: true },
    });

    if (!reminder) {
      this.logger.warn(`Reminder ${reminderId} não encontrado — pode ter sido deletado`);
      return;
    }
    if (reminder.sent_at) {
      this.logger.log(`Reminder ${reminderId} já enviado em ${reminder.sent_at.toISOString()} — ignorando`);
      return;
    }

    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      include: {
        assigned_user: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true } },
      },
    });

    if (!event) {
      this.logger.warn(`Evento ${eventId} não encontrado`);
      return;
    }

    if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
      this.logger.log(`Evento ${eventId} está ${event.status} — lembrete ignorado`);
      await this.prisma.eventReminder.update({ where: { id: reminderId }, data: { sent_at: new Date() } });
      return;
    }

    if (channel === 'WHATSAPP') {
      await this.sendWhatsAppReminders(event, reminder.minutes_before);
    }
    // EMAIL: reservado para implementação futura

    // Marcar como enviado
    await this.prisma.eventReminder.update({
      where: { id: reminderId },
      data: { sent_at: new Date() },
    });

    this.logger.log(`[REMINDER] ${channel} enviado para evento "${event.title}" (${eventId})`);
  }

  // ─── Envio WhatsApp ────────────────────────────────────────────────

  private async sendWhatsAppReminders(event: any, minutesBefore: number) {
    const tipo = event.type;
    const isAudiencia = tipo === 'AUDIENCIA';
    const isPrazo = tipo === 'PRAZO';
    const isTarefa = tipo === 'TAREFA';
    const dateStr = formatDateTime(event.start_at);
    const caseNum = event.legal_case?.case_number || null;
    const prazo = minutesLabel(minutesBefore);

    // ── Mensagem para o Advogado/Usuário responsável ───────────────
    if (event.assigned_user?.phone) {
      const advPhone = event.assigned_user.phone.replace(/\D/g, '');
      const advName = event.assigned_user.name || 'Advogado';
      let advMsg = '';

      if (isAudiencia) {
        advMsg =
          `⚖️ *Lembrete de Audiência — ${prazo} antes*\n\n` +
          `Olá, ${advName}!\n\n` +
          `Você tem uma audiência em *${prazo}*:\n\n` +
          `📋 *Processo:* ${caseNum || event.title}\n` +
          `📅 *Data/Hora:* ${dateStr}\n` +
          (event.location ? `📍 *Local:* ${event.location}\n` : '') +
          (event.lead?.name ? `👤 *Cliente:* ${event.lead.name}\n` : '') +
          `\n_Lembrete automático do CRM Jurídico_`;
      } else if (isPrazo) {
        advMsg =
          `⏰ *Lembrete de Prazo — ${prazo} restantes*\n\n` +
          `Olá, ${advName}!\n\n` +
          `📋 *Prazo:* ${event.title}\n` +
          `📅 *Vencimento:* ${dateStr}\n` +
          (caseNum ? `🔢 *Processo:* ${caseNum}\n` : '') +
          `\n_Lembrete automático do CRM Jurídico_`;
      } else if (isTarefa) {
        advMsg =
          `✅ *Lembrete de Tarefa — ${prazo} antes*\n\n` +
          `Olá, ${advName}!\n\n` +
          `📋 *Tarefa:* ${event.title}\n` +
          `📅 *Data:* ${dateStr}\n` +
          (caseNum ? `🔢 *Processo:* ${caseNum}\n` : '') +
          `\n_Lembrete automático do CRM Jurídico_`;
      } else {
        advMsg =
          `📅 *Lembrete — ${prazo} antes*\n\n` +
          `Olá, ${advName}!\n\n` +
          `*${event.title}*\n` +
          `📅 ${dateStr}\n` +
          `\n_Lembrete automático do CRM Jurídico_`;
      }

      try {
        await this.whatsapp.sendText(advPhone, advMsg);
        this.logger.log(`[REMINDER] WhatsApp enviado para advogado ${advPhone}`);
      } catch (e: any) {
        this.logger.warn(`[REMINDER] Erro ao enviar para advogado ${advPhone}: ${e.message}`);
      }
    }

    // ── Mensagem para o Cliente (Lead) — apenas audiências ─────────
    if (isAudiencia && event.lead?.phone) {
      const clientPhone = event.lead.phone.replace(/\D/g, '');
      const clientName = event.lead.name || 'Cliente';

      const clientMsg =
        `⚖️ *Lembrete de Audiência*\n\n` +
        `Olá, ${clientName}!\n\n` +
        `Sua audiência está marcada para *${prazo}*:\n\n` +
        `📅 *Data/Hora:* ${dateStr}\n` +
        (event.location ? `📍 *Local:* ${event.location}\n` : '') +
        `\n` +
        `Por favor, chegue com *30 minutos de antecedência*.\n` +
        `Em caso de dúvidas, entre em contato com o escritório.\n` +
        `\n_Aviso automático do escritório_`;

      try {
        await this.whatsapp.sendText(clientPhone, clientMsg);
        this.logger.log(`[REMINDER] WhatsApp enviado para cliente ${clientPhone}`);
      } catch (e: any) {
        this.logger.warn(`[REMINDER] Erro ao enviar para cliente ${clientPhone}: ${e.message}`);
      }
    }
  }
}
