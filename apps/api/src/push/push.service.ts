import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import * as webpush from 'web-push';
import * as crypto from 'crypto';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private vapidConfigured = false;

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async onModuleInit() {
    await this.ensureVapidKeys();
  }

  /** Gera VAPID keys se não existem, armazena em GlobalSetting */
  private async ensureVapidKeys() {
    try {
      const existing = await this.settings.get('VAPID_PUBLIC_KEY');
      if (existing) {
        const privateKey = await this.settings.get('VAPID_PRIVATE_KEY');
        const subject = await this.settings.get('VAPID_SUBJECT') || 'mailto:contato@andrelustosaadvogados.com.br';
        if (privateKey) {
          webpush.setVapidDetails(subject, existing, privateKey);
          this.vapidConfigured = true;
          this.logger.log('[Push] VAPID keys carregadas do banco');
          return;
        }
      }

      // Gerar novas chaves
      const keys = webpush.generateVAPIDKeys();
      await this.settings.set('VAPID_PUBLIC_KEY', keys.publicKey);
      await this.settings.set('VAPID_PRIVATE_KEY', keys.privateKey);
      const subject = 'mailto:contato@andrelustosaadvogados.com.br';
      await this.settings.set('VAPID_SUBJECT', subject);
      webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
      this.vapidConfigured = true;
      this.logger.log('[Push] VAPID keys geradas e armazenadas');
    } catch (e: any) {
      this.logger.warn(`[Push] Falha ao configurar VAPID: ${e.message}`);
    }
  }

  /** Retorna a VAPID public key para o frontend */
  async getPublicKey(): Promise<string | null> {
    return this.settings.get('VAPID_PUBLIC_KEY');
  }

  /** Registra uma subscription de Web Push */
  async subscribe(userId: string, subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }, userAgent?: string) {
    return (this.prisma as any).pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        user_id: userId,
        endpoint: subscription.endpoint,
        keys_p256dh: subscription.keys.p256dh,
        keys_auth: subscription.keys.auth,
        user_agent: userAgent || null,
      },
      update: {
        user_id: userId,
        keys_p256dh: subscription.keys.p256dh,
        keys_auth: subscription.keys.auth,
        user_agent: userAgent || null,
      },
    });
  }

  /** Remove uma subscription */
  async unsubscribe(userId: string, endpoint: string) {
    return (this.prisma as any).pushSubscription.deleteMany({
      where: { user_id: userId, endpoint },
    });
  }

  /** Envia push notification para todas as subscriptions de um usuário */
  async sendToUser(userId: string, payload: {
    title: string;
    body: string;
    tag?: string;
    url?: string;
    data?: any;
  }) {
    if (!this.vapidConfigured) {
      this.logger.warn('[Push] VAPID não configurado — push não enviado');
      return;
    }

    const subscriptions = await (this.prisma as any).pushSubscription.findMany({
      where: { user_id: userId },
    });

    if (!subscriptions.length) return;

    const jsonPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      tag: payload.tag || `notif-${Date.now()}`,
      url: payload.url || '/atendimento',
      data: payload.data,
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
            },
            jsonPayload,
            { TTL: 3600 }, // 1 hora
          );
        } catch (err: any) {
          // Subscription expirada ou inválida — remove automaticamente
          if (err.statusCode === 404 || err.statusCode === 410) {
            this.logger.log(`[Push] Subscription expirada removida: ${sub.endpoint.slice(0, 50)}...`);
            await (this.prisma as any).pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            this.logger.warn(`[Push] Falha ao enviar push: ${err.statusCode || err.message}`);
          }
          throw err;
        }
      }),
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    if (sent > 0) {
      this.logger.log(`[Push] ${sent}/${subscriptions.length} push(es) enviados para user ${userId}`);
    }
  }
}
