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

      // 4. Dedup 60min por conversa/lead — INDEPENDENTE de read_at.
      //
      // Bug reportado 2026-04-26 (Gianny): cada mensagem nova do cliente
      // gerava 1 WhatsApp se a Notification anterior tivesse read_at
      // preenchido (advogado tinha aberto o app no meio). Spam.
      //
      // Fix: dedup baseado em whatsapp_sent_at — se ja mandei WhatsApp pra
      // essa conversa nas ultimas 60min, NAO mando de novo (mesmo que
      // tenha mensagens novas). Janela ampla porque advogado nao precisa
      // de aviso a cada 5min — uma vez por hora cobre o caso de "voltei
      // depois e tem mensagem".
      const dedupKey = notification.data?.conversationId || notification.data?.leadId;
      const DEDUP_WINDOW_MS = 60 * 60 * 1000;
      if (dedupKey) {
        const path = notification.data?.conversationId ? 'conversationId' : 'leadId';
        const recentWhatsappSent = await (this.prisma as any).notification.findFirst({
          where: {
            user_id: userId,
            notification_type: notification.notification_type,
            data: { path: [path], equals: dedupKey },
            whatsapp_sent_at: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
            id: { not: notificationId },
          },
          orderBy: { whatsapp_sent_at: 'desc' },
          select: { id: true, whatsapp_sent_at: true },
        });
        if (recentWhatsappSent) {
          this.logger.log(
            `[NotifWA] Dedup ativo: WhatsApp ja enviado pra ${path}=${dedupKey} ` +
            `as ${recentWhatsappSent.whatsapp_sent_at?.toISOString()} — skip`,
          );
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

      // ─── Resumo das mensagens recentes do cliente ───────────────────
      //
      // Antes (Gianny, 2026-04-26): notificacao mostrava so "Nova mensagem
      // recebida" — generica. Agora mostra preview das ultimas mensagens
      // do cliente pra advogado decidir se eh urgente sem precisar abrir
      // o app.
      //
      // Estrategia: pega ate 5 mensagens INBOUND da conversa criadas desde
      // o ultimo whatsapp_sent_at deste user (ou ultimos 60min), trunca
      // cada uma em ~120 chars.
      let messagesPreview = '';
      let messagesCount = 0;
      if (notification.notification_type === 'incoming_message' && notification.data?.conversationId) {
        const conversationId = notification.data.conversationId;

        // Janela: desde o ultimo WhatsApp enviado a este user pra esta
        // conversa (pra cobrir TODAS as mensagens nao avisadas), com
        // teto de 60min pra nao incluir conteudo muito antigo.
        const lastSentToUser = await (this.prisma as any).notification.findFirst({
          where: {
            user_id: userId,
            notification_type: 'incoming_message',
            data: { path: ['conversationId'], equals: conversationId },
            whatsapp_sent_at: { not: null },
            id: { not: notificationId },
          },
          orderBy: { whatsapp_sent_at: 'desc' },
          select: { whatsapp_sent_at: true },
        });
        const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000);
        const since = lastSentToUser?.whatsapp_sent_at && lastSentToUser.whatsapp_sent_at > sixtyMinAgo
          ? lastSentToUser.whatsapp_sent_at
          : sixtyMinAgo;

        const messages = await this.prisma.message.findMany({
          where: {
            conversation_id: conversationId,
            direction: 'in',
            text: { not: null },
            created_at: { gte: since },
          },
          orderBy: { created_at: 'asc' },
          select: { text: true, created_at: true },
          take: 10, // pega no max 10, mostra 5
        });

        messagesCount = messages.length;
        if (messagesCount > 0) {
          const previewLines = messages.slice(0, 5).map(m => {
            const t = (m.text || '').replace(/\s+/g, ' ').trim();
            return `▸ ${t.length > 120 ? t.slice(0, 117) + '...' : t}`;
          });
          if (messagesCount > 5) {
            previewLines.push(`_+${messagesCount - 5} mensagem(ns)_`);
          }
          messagesPreview = previewLines.join('\n');
        }
      }

      // Monta o texto final
      const lines: string[] = [];
      lines.push(`🔔 *${notification.title}*`);
      if (messagesPreview) {
        lines.push('');
        lines.push(messagesPreview);
      } else if (notification.body) {
        // Fallback pra notif que nao seja incoming_message (transfer_request, etc)
        lines.push(notification.body);
      }
      lines.push('');
      lines.push(`Abrir o chat: ${deepLink}`);
      const text = lines.join('\n');

      await axios.post(
        `${apiUrl}/message/sendText/${instanceName}`,
        { number: user.phone, text },
        { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 },
      );

      // Marca whatsapp_sent_at — usado pelo dedup das proximas notificacoes
      // da mesma conversa (60min de janela).
      await (this.prisma as any).notification.update({
        where: { id: notificationId },
        data: { whatsapp_sent_at: new Date() },
      }).catch(() => {});

      this.logger.log(`[NotifWA] WhatsApp enviado para ${user.phone}: "${notification.title}"`);
    } catch (e: any) {
      this.logger.error(`[NotifWA] Falha ao processar job: ${e.message}`);
    }
  }
}
