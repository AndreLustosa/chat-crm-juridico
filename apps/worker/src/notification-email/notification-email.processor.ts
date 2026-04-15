import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import * as nodemailer from 'nodemailer';

/**
 * Processa jobs de email de notificação.
 * Cada job é enfileirado com delay de 5min após uma Notification ser criada.
 * Se a notificação já foi lida (push/socket), o email NÃO é enviado.
 */
@Processor('notification-email')
export class NotificationEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationEmailProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<{ notificationId: string; userId: string }>) {
    const { notificationId, userId } = job.data;

    try {
      // 1. Buscar notificação — já foi lida?
      const notification = await (this.prisma as any).notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        this.logger.log(`[NotifEmail] Notificação ${notificationId} não encontrada — skip`);
        return;
      }

      if (notification.read_at) {
        this.logger.log(`[NotifEmail] Notificação ${notificationId} já lida — email não enviado`);
        return;
      }

      // 2. Buscar email do usuário
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });

      if (!user?.email) {
        this.logger.warn(`[NotifEmail] Usuário ${userId} sem email — skip`);
        return;
      }

      // 3. Checar preferências do usuário — email habilitado para este tipo?
      const settings = await (this.prisma as any).notificationSetting.findUnique({
        where: { user_id: userId },
      });

      if (settings?.preferences) {
        const prefs = settings.preferences as any;
        const typePrefs = prefs[notification.notification_type];
        if (typePrefs && typePrefs.email === false) {
          this.logger.log(`[NotifEmail] Email desabilitado para tipo "${notification.notification_type}" — skip`);
          return;
        }
      }

      // 4. Dedup: não enviar se já enviou email para esta conversa nos últimos 30min
      if (notification.data?.conversationId) {
        const recent = await (this.prisma as any).notification.findFirst({
          where: {
            user_id: userId,
            notification_type: notification.notification_type,
            data: { path: ['conversationId'], equals: notification.data.conversationId },
            created_at: { gte: new Date(Date.now() - 30 * 60 * 1000) },
            id: { not: notificationId },
            read_at: null,
          },
          orderBy: { created_at: 'desc' },
        });
        // Se existe outra notificação do mesmo tipo + conversa nos últimos 30min
        // e foi criada ANTES desta, pula (já mandou email para a anterior)
        if (recent && new Date(recent.created_at) < new Date(notification.created_at)) {
          this.logger.log(`[NotifEmail] Dedup: email recente já enviado para conversa — skip`);
          return;
        }
      }

      // 5. Enviar email
      const smtp = await this.settings.getSmtpConfig();
      if (!smtp.host || !smtp.user) {
        this.logger.warn('[NotifEmail] SMTP não configurado — skip');
        return;
      }

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      });

      const appUrl = process.env.APP_URL || 'https://crm.andrelustosaadvogados.com.br';
      const convoUrl = notification.data?.conversationId
        ? `${appUrl}/atendimento`
        : appUrl;

      await transporter.sendMail({
        from: smtp.from || `"LexCRM" <${smtp.user}>`,
        to: user.email,
        subject: `[LexCRM] ${notification.title}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="background: #1a1a2e; color: #e0e0e0; padding: 20px; border-radius: 12px;">
              <h2 style="margin: 0 0 8px; font-size: 16px; color: #c4a35a;">
                ${notification.title}
              </h2>
              ${notification.body ? `<p style="margin: 0 0 16px; font-size: 14px; color: #a0a0a0;">${notification.body}</p>` : ''}
              <a href="${convoUrl}" style="display: inline-block; background: #c4a35a; color: #1a1a2e; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                Abrir no LexCRM
              </a>
            </div>
            <p style="margin-top: 16px; font-size: 11px; color: #888; text-align: center;">
              André Lustosa Advogados — LexCRM
            </p>
          </div>
        `,
      });

      this.logger.log(`[NotifEmail] Email enviado para ${user.email}: "${notification.title}"`);
    } catch (e: any) {
      this.logger.error(`[NotifEmail] Falha ao processar job: ${e.message}`);
    }
  }
}
