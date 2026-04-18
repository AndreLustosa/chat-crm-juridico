import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Processa jobs de notificação por WhatsApp.
 * Cada job é enfileirado com delay de 5min após uma Notification ser criada.
 * Se a notificação já foi lida (push/socket), o WhatsApp NÃO é enviado.
 */
@Processor('notification-whatsapp')
export class NotificationWhatsappProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationWhatsappProcessor.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<{ notificationId: string; userId: string }>) {
    const { notificationId, userId } = job.data;

    try {
      // 1. Notificação já foi lida? (socket/push dentro dos 5min)
      const notification = await (this.prisma as any).notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        this.logger.log(`[NotifWA] Notificação ${notificationId} não encontrada — skip`);
        return;
      }

      if (notification.read_at) {
        this.logger.log(`[NotifWA] Notificação ${notificationId} já lida — WhatsApp não enviado`);
        return;
      }

      // 2. Usuário tem telefone cadastrado?
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true, name: true },
      });

      if (!user?.phone) {
        this.logger.warn(`[NotifWA] Usuário ${userId} sem telefone cadastrado — skip`);
        return;
      }

      // 3. Preferência do usuário — WhatsApp habilitado para este tipo?
      const settings = await (this.prisma as any).notificationSetting.findUnique({
        where: { user_id: userId },
      });

      if (settings?.preferences) {
        const prefs = settings.preferences as any;
        const typePrefs = prefs[notification.notification_type];
        if (typePrefs && typePrefs.whatsapp === false) {
          this.logger.log(`[NotifWA] WhatsApp desabilitado para tipo "${notification.notification_type}" — skip`);
          return;
        }
      }

      // 4. Dedup 30min por conversa/lead — não floodar o operador
      const dedupKey = notification.data?.conversationId || notification.data?.leadId;
      if (dedupKey) {
        const path = notification.data?.conversationId ? 'conversationId' : 'leadId';
        const recent = await (this.prisma as any).notification.findFirst({
          where: {
            user_id: userId,
            notification_type: notification.notification_type,
            data: { path: [path], equals: dedupKey },
            created_at: { gte: new Date(Date.now() - 30 * 60 * 1000) },
            id: { not: notificationId },
            read_at: null,
          },
          orderBy: { created_at: 'desc' },
        });
        if (recent && new Date(recent.created_at) < new Date(notification.created_at)) {
          this.logger.log(`[NotifWA] Dedup: WhatsApp recente já enviado — skip`);
          return;
        }
      }

      // 5. Envia via Evolution API
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl || !apiKey) {
        this.logger.warn('[NotifWA] Evolution API não configurada — skip');
        return;
      }

      const instanceName = process.env.EVOLUTION_INSTANCE_NAME || '';
      if (!instanceName) {
        this.logger.warn('[NotifWA] EVOLUTION_INSTANCE_NAME não configurado — skip');
        return;
      }

      const appUrl = process.env.APP_URL || 'https://crm.andrelustosaadvogados.com.br';
      const deepLink = notification.data?.conversationId
        ? `${appUrl}/atendimento`
        : notification.data?.leadId
          ? `${appUrl}/atendimento/crm`
          : appUrl;

      const text = [
        `🔔 *${notification.title}*`,
        notification.body || '',
        '',
        `Abrir no LexCRM: ${deepLink}`,
      ].filter(Boolean).join('\n');

      await axios.post(
        `${apiUrl}/message/sendText/${instanceName}`,
        { number: user.phone, text },
        { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 },
      );

      this.logger.log(`[NotifWA] WhatsApp enviado para ${user.phone}: "${notification.title}"`);
    } catch (e: any) {
      this.logger.error(`[NotifWA] Falha ao processar job: ${e.message}`);
    }
  }
}
