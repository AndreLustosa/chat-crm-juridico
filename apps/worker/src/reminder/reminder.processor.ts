import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';
import * as nodemailer from 'nodemailer';

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
      const reminder = await this.prisma.eventReminder.findUnique({
        where: { id: job.data.reminderId },
        include: {
          event: {
            include: {
              assigned_user: { select: { id: true, name: true, email: true, phone: true } },
              lead: { select: { id: true, name: true, phone: true, email: true } },
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

      if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
        this.logger.log(`Evento ${event.id} esta ${event.status} — ignorando lembrete`);
        await this.prisma.eventReminder.update({
          where: { id: reminder.id },
          data: { sent_at: new Date() },
        });
        return;
      }

      if (reminder.channel === 'WHATSAPP') {
        await this.sendWhatsAppReminder(event, reminder);
      } else if (reminder.channel === 'EMAIL') {
        await this.sendEmailReminder(event, reminder);
      }

      await this.prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sent_at: new Date() },
      });

      this.logger.log(`Lembrete ${reminder.id} enviado com sucesso (${reminder.channel})`);
    } catch (error: any) {
      this.logger.error(`Erro ao processar lembrete ${job.data.reminderId}: ${error.message}`);
      throw error;
    }
  }

  private async sendWhatsAppReminder(event: any, reminder: any) {
    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) {
      this.logger.warn('EVOLUTION_API_URL nao configurada — lembrete WhatsApp ignorado');
      return;
    }

    const instance = process.env.EVOLUTION_INSTANCE_NAME || '';
    const typeEmoji = event.type === 'CONSULTA' ? '🟣' : event.type === 'AUDIENCIA' ? '🔴' : event.type === 'PRAZO' ? '🟠' : '📅';

    // Destinatarios: lead (cliente) e/ou advogado responsavel
    const recipients: { phone: string; name: string }[] = [];

    if (event.lead?.phone) {
      recipients.push({ phone: event.lead.phone, name: event.lead.name || event.lead.phone });
    }
    if (event.assigned_user?.phone) {
      recipients.push({ phone: event.assigned_user.phone, name: event.assigned_user.name });
    }

    if (recipients.length === 0) {
      this.logger.warn(`Evento ${event.id} nao tem telefone (lead ou advogado) — lembrete WhatsApp ignorado`);
      return;
    }

    for (const recipient of recipients) {
      const msg = [
        `${typeEmoji} *Lembrete de Evento*`,
        '',
        `📋 *${event.title}*`,
        `📆 ${formatDate(event.start_at)}`,
        `⏰ ${formatTime(event.start_at)}`,
        event.location ? `📍 ${event.location}` : '',
        '',
        `Ola ${recipient.name}, este e um lembrete do seu compromisso agendado.`,
      ].filter(Boolean).join('\n');

      try {
        await axios.post(
          `${apiUrl}/message/sendText/${instance}`,
          { number: recipient.phone, text: msg },
          { headers: { apikey: apiKey } },
        );
        this.logger.log(`WhatsApp lembrete enviado para ${recipient.phone} (${recipient.name})`);
      } catch (err: any) {
        this.logger.error(`Falha ao enviar WhatsApp para ${recipient.phone}: ${err.message}`);
      }
    }
  }

  private async sendEmailReminder(event: any, _reminder: any) {
    const recipientEmail = event.lead?.email || event.assigned_user?.email;
    if (!recipientEmail) {
      this.logger.warn(`Evento ${event.id} nao tem email de destino — lembrete email ignorado`);
      return;
    }

    const smtp = await this.settings.getSmtpConfig();
    if (!smtp.host) {
      this.logger.warn('SMTP nao configurado — lembrete email ignorado');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });

    const typeEmoji = event.type === 'CONSULTA' ? '🟣' : event.type === 'AUDIENCIA' ? '🔴' : event.type === 'PRAZO' ? '🟠' : '📅';
    const recipientName = event.lead?.name || event.assigned_user?.name || '';
    const dateStr = formatDate(event.start_at);
    const timeStr = formatTime(event.start_at);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background: #1a1a2e; border-radius: 16px; padding: 24px; color: #e0e0e0;">
          <h2 style="margin: 0 0 16px; color: #fff; font-size: 18px;">
            ${typeEmoji} Lembrete de Evento
          </h2>
          <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px; font-weight: bold; font-size: 16px; color: #fff;">${event.title}</p>
            <p style="margin: 0 0 4px; color: #a0a0b0;">📆 ${dateStr}</p>
            <p style="margin: 0 0 4px; color: #a0a0b0;">⏰ ${timeStr}</p>
            ${event.location ? `<p style="margin: 0; color: #a0a0b0;">📍 ${event.location}</p>` : ''}
          </div>
          <p style="margin: 0; color: #a0a0b0; font-size: 13px;">
            Olá ${recipientName}, este é um lembrete do seu compromisso agendado.
          </p>
        </div>
        <p style="text-align: center; color: #888; font-size: 11px; margin-top: 16px;">
          Enviado automaticamente pelo LexCRM
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: smtp.from || smtp.user,
      to: recipientEmail,
      subject: `${typeEmoji} Lembrete: ${event.title} — ${dateStr} ${timeStr}`,
      html,
    });

    this.logger.log(`Email lembrete enviado para ${recipientEmail}`);
  }
}
