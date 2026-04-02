import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';
import * as nodemailer from 'nodemailer';

// App usa UTC "naive" — horários salvos no banco como UTC = horário local de Maceió.
// Por isso exibimos em UTC puro (sem conversão de fuso) para não subtrair 3h.
function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  });
}

const TYPE_LABEL: Record<string, string> = {
  AUDIENCIA: 'Audiência', PERICIA: 'Perícia', PRAZO: 'Prazo',
  TAREFA: 'Tarefa', CONSULTA: 'Consulta', OUTRO: 'Evento',
};
const TYPE_EMOJI: Record<string, string> = {
  AUDIENCIA: '⚖️', PERICIA: '🔬', PRAZO: '⏰',
  TAREFA: '✅', CONSULTA: '🟣', OUTRO: '📅',
};

@Processor('calendar-reminders')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {
    super();
    this.logger.log('✅ ReminderProcessor registrado na fila calendar-reminders (Worker container)');
  }

  async process(job: Job<any>): Promise<any> {
    this.logger.log(`[WORKER] Processando job ${job.name} (id: ${job.id})`);
    // ── Notificações imediatas de audiência/perícia agendada ──────────────
    if (job.name === 'notify-hearing-scheduled') {
      return this.processHearingNotification(job.data.eventId, false);
    }
    if (job.name === 'notify-hearing-rescheduled') {
      return this.processHearingNotification(job.data.eventId, true);
    }

    // ── Lembretes padrão de evento ────────────────────────────────────────────
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

      if (['CANCELADO', 'CONCLUIDO', 'ADIADO'].includes(event.status)) {
        this.logger.log(`Evento ${event.id} esta ${event.status} — ignorando lembrete`);
        await this.prisma.eventReminder.update({
          where: { id: reminder.id },
          data: { sent_at: new Date() },
        });
        return;
      }

      let sent = false;
      if (reminder.channel === 'WHATSAPP') {
        sent = await this.sendWhatsAppReminder(event, reminder);
      } else if (reminder.channel === 'EMAIL') {
        sent = await this.sendEmailReminder(event, reminder);
      }

      if (sent) {
        await this.prisma.eventReminder.update({
          where: { id: reminder.id },
          data: { sent_at: new Date() },
        });
        this.logger.log(`Lembrete ${reminder.id} enviado com sucesso (${reminder.channel})`);
      } else {
        this.logger.warn(`Lembrete ${reminder.id} nao enviado (sem destinatario ou config ausente) — nao marcado como sent`);
      }
    } catch (error: any) {
      this.logger.error(`Erro ao processar lembrete ${job.data.reminderId}: ${error.message}`);
      throw error;
    }
  }

  private async sendWhatsAppReminder(event: any, _reminder: any): Promise<boolean> {
    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) {
      this.logger.warn('EVOLUTION_API_URL nao configurada — lembrete WhatsApp ignorado');
      return false;
    }

    const instance = process.env.EVOLUTION_INSTANCE_NAME || '';
    const typeEmoji = TYPE_EMOJI[event.type] || '📅';

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
      return false;
    }

    const label = TYPE_LABEL[event.type] || 'Evento';

    let anySent = false;
    for (const recipient of recipients) {
      const msg = [
        `${typeEmoji} *Lembrete de ${label}*`,
        '',
        `📋 *${event.title}*`,
        `📆 ${formatDate(event.start_at)}`,
        `⏰ ${formatTime(event.start_at)}`,
        event.location ? `📍 ${event.location}` : '',
        '',
        `Olá ${recipient.name}, este é um lembrete do seu compromisso agendado.`,
      ].filter(Boolean).join('\n');

      try {
        await axios.post(
          `${apiUrl}/message/sendText/${instance}`,
          { number: recipient.phone, text: msg },
          { headers: { apikey: apiKey } },
        );
        this.logger.log(`WhatsApp lembrete enviado para ${recipient.phone} (${recipient.name})`);
        anySent = true;
      } catch (err: any) {
        this.logger.error(`Falha ao enviar WhatsApp para ${recipient.phone}: ${err.message}`);
      }
    }
    return anySent;
  }

  // ─── Notificação imediata de audiência/perícia agendada ou remarcada ─────

  private async processHearingNotification(eventId: string, isRescheduled: boolean): Promise<void> {
    const eventType = isRescheduled ? 'remarcação' : 'agendamento';
    this.logger.log(`[HEARING-NOTIFY] Processando notificação de ${eventType}: ${eventId}`);

    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      include: {
        assigned_user: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true } },
      },
    });

    if (!event) {
      this.logger.warn(`[HEARING-NOTIFY] Evento ${eventId} não encontrado — ignorado`);
      return;
    }
    if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
      this.logger.log(`[HEARING-NOTIFY] Evento ${eventId} está ${event.status} — ignorado`);
      return;
    }
    if (!event.lead?.phone) {
      this.logger.log(`[HEARING-NOTIFY] Evento ${eventId} sem telefone do cliente — ignorado`);
      return;
    }

    const firstName = (event.lead.name || 'Cliente').split(' ')[0];
    const dateStr = formatDateTime(event.start_at);
    const isPericia = event.type === 'PERICIA';
    const label = isPericia ? 'Perícia' : (TYPE_LABEL[event.type] || 'Audiência');
    const emoji = isPericia ? '🔬' : (TYPE_EMOJI[event.type] || '⚖️');

    let msg: string;
    if (isRescheduled) {
      msg =
        `${emoji} *${label} Remarcada*\n\n` +
        `Olá, ${firstName}!\n\n` +
        `Sua ${label.toLowerCase()} foi *remarcada* para uma nova data:\n\n` +
        `📅 *Nova Data/Hora:* ${dateStr}\n` +
        (event.location ? `📍 *Local:* ${event.location}\n` : '') +
        (isPericia
          ? `\nLembre-se de levar documentos pessoais e laudos médicos, se houver.\n`
          : `\nPor favor, anote a nova data. Chegue com *30 minutos de antecedência*.\n`) +
        `Qualquer dúvida, é só responder esta mensagem.\n\n` +
        `_André Lustosa Advogados_`;
    } else {
      msg =
        `${emoji} *${label} Agendada*\n\n` +
        `Olá, ${firstName}!\n\n` +
        `Sua ${label.toLowerCase()} foi agendada:\n\n` +
        `📅 *Data/Hora:* ${dateStr}\n` +
        (event.location ? `📍 *Local:* ${event.location}\n` : '') +
        (isPericia
          ? `\nLembre-se de levar documentos pessoais e laudos médicos, se houver. Chegue com *15 minutos de antecedência* e coopere plenamente com o perito.\n`
          : `\nRecomendamos chegar com *30 minutos de antecedência*.\n`) +
        `Qualquer dúvida, estamos à disposição.\n\n` +
        `_André Lustosa Advogados_`;
    }

    const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
    if (!apiUrl) {
      this.logger.warn('[HEARING-NOTIFY] EVOLUTION_API_URL não configurada — abortado');
      return;
    }

    // Busca conversa ativa para obter a instance correta e salvar a mensagem
    const lastConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: event.lead.id, status: { not: 'ENCERRADO' } },
      orderBy: { last_message_at: 'desc' },
      select: { id: true, instance_name: true },
    }).catch(() => null);

    const instance = lastConvo?.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';
    const clientPhone = event.lead.phone.replace(/\D/g, '');

    let sentMsgId: string | null = null;
    try {
      const res = await axios.post(
        `${apiUrl}/message/sendText/${instance}`,
        { number: clientPhone, text: msg },
        { headers: { apikey: apiKey } },
      );
      sentMsgId = res.data?.key?.id || null;
      this.logger.log(`[HEARING-NOTIFY] WhatsApp enviado para ${clientPhone}`);
    } catch (err: any) {
      this.logger.error(`[HEARING-NOTIFY] Falha ao enviar WhatsApp para ${clientPhone}: ${err.message}`);
      return;
    }

    // Salva mensagem na conversa e reativa a IA
    if (lastConvo) {
      try {
        const evolutionMsgId = sentMsgId || `sys_hearing_${Date.now()}`;
        await this.prisma.message.create({
          data: {
            conversation_id: lastConvo.id,
            direction: 'out',
            type: 'text',
            text: msg,
            external_message_id: evolutionMsgId,
            status: 'enviado',
          },
        });
        await this.prisma.conversation.update({
          where: { id: lastConvo.id },
          data: {
            last_message_at: new Date(),
            ai_mode: true,
            reminder_context: {
              type: isPericia ? 'PERICIA_AGENDADA' : 'AUDIENCIA_AGENDADA',
              event_title: event.title,
              event_date: dateStr,
              event_date_iso: event.start_at.toISOString(),
              location: event.location || null,
              message_sent: msg.slice(0, 800),
              sent_at: new Date().toISOString(),
            },
          },
        });
        this.logger.log(`[HEARING-NOTIFY] Mensagem salva e IA reativada na conversa ${lastConvo.id}`);
      } catch (e: any) {
        this.logger.warn(`[HEARING-NOTIFY] Falha ao salvar mensagem: ${e.message}`);
      }
    }
  }

  private async sendEmailReminder(event: any, _reminder: any): Promise<boolean> {
    const recipients: { email: string; name: string }[] = [];
    if (event.lead?.email) {
      recipients.push({ email: event.lead.email, name: event.lead.name || event.lead.email });
    }
    if (event.assigned_user?.email) {
      recipients.push({ email: event.assigned_user.email, name: event.assigned_user.name });
    }

    if (recipients.length === 0) {
      this.logger.warn(`Evento ${event.id} nao tem email de destino — lembrete email ignorado`);
      return false;
    }

    const smtp = await this.settings.getSmtpConfig();
    if (!smtp.host) {
      this.logger.warn('SMTP nao configurado — lembrete email ignorado');
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });

    const typeEmoji = TYPE_EMOJI[event.type] || '📅';
    const label = TYPE_LABEL[event.type] || 'Evento';
    const dateStr = formatDate(event.start_at);
    const timeStr = formatTime(event.start_at);

    let anySent = false;
    for (const recipient of recipients) {
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <div style="background: #1a1a2e; border-radius: 16px; padding: 24px; color: #e0e0e0;">
            <h2 style="margin: 0 0 16px; color: #fff; font-size: 18px;">
              ${typeEmoji} Lembrete de ${label}
            </h2>
            <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
              <p style="margin: 0 0 8px; font-weight: bold; font-size: 16px; color: #fff;">${event.title}</p>
              <p style="margin: 0 0 4px; color: #a0a0b0;">📆 ${dateStr}</p>
              <p style="margin: 0 0 4px; color: #a0a0b0;">⏰ ${timeStr}</p>
              ${event.location ? `<p style="margin: 0; color: #a0a0b0;">📍 ${event.location}</p>` : ''}
            </div>
            <p style="margin: 0; color: #a0a0b0; font-size: 13px;">
              Olá ${recipient.name}, este é um lembrete do seu compromisso agendado.
            </p>
          </div>
          <p style="text-align: center; color: #888; font-size: 11px; margin-top: 16px;">
            Enviado automaticamente pelo LexCRM
          </p>
        </div>
      `;

      try {
        await transporter.sendMail({
          from: smtp.from || smtp.user,
          to: recipient.email,
          subject: `${typeEmoji} Lembrete: ${event.title} — ${dateStr} ${timeStr}`,
          html,
        });
        this.logger.log(`Email lembrete enviado para ${recipient.email} (${recipient.name})`);
        anySent = true;
      } catch (err: any) {
        this.logger.error(`Falha ao enviar email para ${recipient.email}: ${err.message}`);
      }
    }
    return anySent;
  }
}
