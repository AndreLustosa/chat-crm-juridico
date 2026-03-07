import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

@Processor('calendar-reminders')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<{ reminderId: string; eventId: string; channel: string }>): Promise<any> {
    this.logger.log(`Processando lembrete: ${job.id} (canal: ${job.data.channel})`);

    try {
      // 1. Buscar reminder + event + lead
      const reminder = await this.prisma.eventReminder.findUnique({
        where: { id: job.data.reminderId },
        include: {
          event: {
            include: {
              assigned_user: { select: { id: true, name: true } },
              lead: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      });

      if (!reminder) {
        this.logger.warn(`Lembrete ${job.data.reminderId} nao encontrado — ignorando`);
        return;
      }

      if (reminder.sent_at) {
        this.logger.log(`Lembrete ${job.data.reminderId} ja foi enviado — ignorando`);
        return;
      }

      const event = reminder.event;

      // Skip if event was cancelled or concluded
      if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
        this.logger.log(`Evento ${event.id} esta ${event.status} — ignorando lembrete`);
        await this.prisma.eventReminder.update({
          where: { id: reminder.id },
          data: { sent_at: new Date() },
        });
        return;
      }

      // 2. Send via channel
      if (reminder.channel === 'WHATSAPP') {
        await this.sendWhatsAppReminder(event, reminder);
      }
      // PUSH channel is handled by the API cron (emits via socket directly)

      // 3. Mark as sent
      await this.prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sent_at: new Date() },
      });

      this.logger.log(`Lembrete ${reminder.id} enviado com sucesso (${reminder.channel})`);
    } catch (error: any) {
      this.logger.error(`Erro ao processar lembrete ${job.data.reminderId}: ${error.message}`);
      throw error; // BullMQ will retry
    }
  }

  private async sendWhatsAppReminder(event: any, reminder: any) {
    const phone = event.lead?.phone;
    if (!phone) {
      this.logger.warn(`Evento ${event.id} nao tem lead com telefone — lembrete WhatsApp ignorado`);
      return;
    }

    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) {
      this.logger.warn('EVOLUTION_API_URL nao configurada — lembrete WhatsApp ignorado');
      return;
    }

    const instance = process.env.EVOLUTION_INSTANCE_NAME || '';
    const leadName = event.lead?.name || phone;
    const typeEmoji = event.type === 'CONSULTA' ? '🟣' : event.type === 'AUDIENCIA' ? '🔴' : event.type === 'PRAZO' ? '🟠' : '📅';

    const msg = [
      `${typeEmoji} *Lembrete de Evento*`,
      '',
      `📋 *${event.title}*`,
      `📆 ${formatDate(event.start_at)}`,
      `⏰ ${formatTime(event.start_at)}`,
      event.location ? `📍 ${event.location}` : '',
      '',
      `Ola ${leadName}, este e um lembrete do seu compromisso agendado.`,
    ].filter(Boolean).join('\n');

    await axios.post(
      `${apiUrl}/message/sendText/${instance}`,
      { number: phone, text: msg },
      { headers: { apikey: apiKey } },
    );

    this.logger.log(`WhatsApp lembrete enviado para ${phone}`);
  }
}
