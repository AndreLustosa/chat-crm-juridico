import { Injectable, Logger, Inject, forwardRef, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('notification-whatsapp') private whatsappQueue: Queue,
    private cronRunner: CronRunnerService,
    // forwardRef: ChatGateway tambem injeta NotificationsService (ciclo).
    // NestJS resolve isso em runtime atraves do forwardRef.
    @Inject(forwardRef(() => ChatGateway))
    private chatGateway: ChatGateway,
  ) {}

  /** Cria uma notificação persistente (fire-and-forget, chamado pelo ChatGateway).
   *  Enfileira WhatsApp fallback com delay de 5min — se a notificação for lida
   *  via socket/push antes do delay, o WhatsApp não é enviado. */
  async create(params: {
    userId: string;
    tenantId?: string | null;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, any>;
  }) {
    try {
      const notification = await (this.prisma as any).notification.create({
        data: {
          user_id: params.userId,
          tenant_id: params.tenantId || null,
          notification_type: params.type,
          title: params.title,
          body: params.body || null,
          data: params.data || null,
        },
      });

      // Enfileira WhatsApp fallback com delay de 5 minutos
      // O processor checa: já lida? WhatsApp habilitado? Usuário tem phone? Dedup 30min?
      this.whatsappQueue.add(
        'send-notification-whatsapp',
        { notificationId: notification.id, userId: params.userId },
        { delay: 5 * 60 * 1000, removeOnComplete: true, removeOnFail: 10 },
      ).catch(() => {});

      // Emite socket event para o frontend atualizar o badge em tempo real
      // (substitui polling de 60s no NotificationCenter). Best-effort:
      // falha aqui nao quebra create — frontend tem fallback de 5min.
      try {
        this.chatGateway.server?.to(`user:${params.userId}`).emit('notification_created', {
          id: notification.id,
          notification_type: params.type,
          title: params.title,
        });
      } catch (e: any) {
        this.logger.warn(`[Notifications] Falha ao emitir socket: ${e.message}`);
      }

      return notification;
    } catch (e: any) {
      this.logger.warn(`[Notifications] Falha ao criar: ${e.message}`);
      return null;
    }
  }

  /**
   * Bug fix 2026-05-10 (NotifService PR1 #1 — CRITICO defesa em profundidade):
   * helper que rejeita userId vazio/null/undefined ANTES de chegar no Prisma.
   * Sem isso, `where: { user_id: undefined }` no Prisma vira "filtro nao
   * aplicado" — vazava TODAS as notifs. Mesmo que o controller ja valide,
   * isso garante que callers internos (ChatGateway, TasksService) nunca
   * cheguem a vazar por bug futuro.
   */
  private requireUserId(userId: string | null | undefined, op: string): string {
    if (!userId || typeof userId !== 'string') {
      throw new Error(`[Notifications] ${op}: userId obrigatorio (recebeu ${userId})`);
    }
    return userId;
  }

  /**
   * Lista notificações do usuário com paginação.
   *
   * Bug fix 2026-05-10 (NotifService PR2 #6): tenantId opcional pra
   * defesa em profundidade. Ja temos PR1 #1 protegendo contra userId
   * undefined, mas se algum dia 2 tenants tiverem o mesmo user_id por
   * bug futuro (UUID collision, restore parcial de backup, sync ID
   * compartilhado), filtro adicional protege.
   */
  async findByUser(userId: string, opts?: { type?: string; unreadOnly?: boolean; page?: number; limit?: number; tenantId?: string }) {
    const safeUserId = this.requireUserId(userId, 'findByUser');
    const page = opts?.page || 1;
    const limit = Math.min(opts?.limit || 50, 100);
    const skip = (page - 1) * limit;

    const where: any = { user_id: safeUserId };
    if (opts?.tenantId) where.tenant_id = opts.tenantId;
    if (opts?.type) where.notification_type = opts.type;
    if (opts?.unreadOnly) where.read_at = null;

    const [data, total] = await Promise.all([
      (this.prisma as any).notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      (this.prisma as any).notification.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  /** Contagem de não-lidas */
  async unreadCount(userId: string, tenantId?: string): Promise<number> {
    const safeUserId = this.requireUserId(userId, 'unreadCount');
    const where: any = { user_id: safeUserId, read_at: null };
    if (tenantId) where.tenant_id = tenantId;
    return (this.prisma as any).notification.count({ where });
  }

  /** Marca uma notificação como lida */
  async markRead(userId: string, notificationId: string, tenantId?: string) {
    const safeUserId = this.requireUserId(userId, 'markRead');
    if (!notificationId) throw new Error('[Notifications] markRead: notificationId obrigatorio');
    const where: any = { id: notificationId, user_id: safeUserId };
    if (tenantId) where.tenant_id = tenantId;
    return (this.prisma as any).notification.updateMany({
      where,
      data: { read_at: new Date() },
    });
  }

  /** Marca todas como lidas */
  async markAllRead(userId: string, tenantId?: string) {
    const safeUserId = this.requireUserId(userId, 'markAllRead');
    const where: any = { user_id: safeUserId, read_at: null };
    if (tenantId) where.tenant_id = tenantId;
    return (this.prisma as any).notification.updateMany({
      where,
      data: { read_at: new Date() },
    });
  }

  /** Marca notificacoes de mensagens relacionadas a uma conversa como lidas.
   *  Chamado quando o operador abre a conversa (via ConversationsService.markAsRead)
   *  para zerar o badge do sino em sincronia com o desaparecimento do badge
   *  da sidebar — antes o sino ficava desacoplado e so decrescia ao clicar
   *  diretamente nos itens do NotificationCenter. */
  async markByConversation(userId: string, conversationId: string) {
    return (this.prisma as any).notification.updateMany({
      where: {
        user_id: userId,
        read_at: null,
        notification_type: 'incoming_message',
        data: { path: ['conversationId'], equals: conversationId },
      },
      data: { read_at: new Date() },
    });
  }

  /** Retenção: remove notificações com mais de X dias (cron diário às 3h) */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCleanupCron() {
    await this.cronRunner.run(
      'notifications-cleanup',
      15 * 60,
      async () => { await this.cleanup(); },
      { description: 'Remove notificacoes > 90 dias do banco', schedule: '0 3 * * *' },
    );
  }

  async cleanup(retentionDays = 90) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    // Bug fix 2026-05-10 (NotifService PR2 #8): preservar notifs com
    // whatsapp_sent_at recente (ultimos 2h) — sao usadas pelo dedup do
    // worker. Se cleanup deletar uma notif que serviu de "anchor" de
    // dedup ha menos de 1h, proxima notif da mesma conversa pode
    // disparar WhatsApp duplicado. Janela 2h cobre a window de dedup
    // (60min) com folga.
    const dedupSafeguard = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const result = await (this.prisma as any).notification.deleteMany({
      where: {
        created_at: { lt: cutoff },
        OR: [
          { whatsapp_sent_at: null },
          { whatsapp_sent_at: { lt: dedupSafeguard } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(`[Notifications] Cleanup: ${result.count} notificações removidas (> ${retentionDays} dias, preservando dedup-anchors recentes)`);
    }
    return result;
  }

  // ─── ConversationMute ──────────────────────────────────────────

  /**
   * Bug fix 2026-05-10 (NotifService PR2 #7): valida ownership da
   * Conversation antes de mute/unmute. Antes user podia mutar
   * conversa de outro tenant (via API direta com conversationId
   * conhecido) — nao tinha impacto direto, so polui o banco com
   * registros zumbis. Agora rejeita com 404/403.
   */
  private async assertConversationAccess(conversationId: string, tenantId?: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, tenant_id: true },
    });
    if (!conversation) throw new NotFoundException('Conversa nao encontrada');
    if (tenantId && conversation.tenant_id && conversation.tenant_id !== tenantId) {
      throw new ForbiddenException('Conversa de outro tenant');
    }
  }

  /** Muta uma conversa para um usuário */
  async muteConversation(userId: string, conversationId: string, until?: string, tenantId?: string) {
    const safeUserId = this.requireUserId(userId, 'muteConversation');
    if (!conversationId) throw new Error('[Notifications] muteConversation: conversationId obrigatorio');
    await this.assertConversationAccess(conversationId, tenantId);
    return (this.prisma as any).conversationMute.upsert({
      where: { user_id_conversation_id: { user_id: safeUserId, conversation_id: conversationId } },
      create: {
        user_id: safeUserId,
        conversation_id: conversationId,
        muted_until: until ? new Date(until) : null,
      },
      update: {
        muted_until: until ? new Date(until) : null,
      },
    });
  }

  /** Desmuta uma conversa */
  async unmuteConversation(userId: string, conversationId: string, tenantId?: string) {
    const safeUserId = this.requireUserId(userId, 'unmuteConversation');
    if (!conversationId) throw new Error('[Notifications] unmuteConversation: conversationId obrigatorio');
    await this.assertConversationAccess(conversationId, tenantId);
    return (this.prisma as any).conversationMute.deleteMany({
      where: { user_id: safeUserId, conversation_id: conversationId },
    });
  }

  /** Verifica se uma conversa está mutada para um usuário */
  async isConversationMuted(userId: string, conversationId: string): Promise<boolean> {
    if (!userId || !conversationId) return false;
    const mute = await (this.prisma as any).conversationMute.findUnique({
      where: { user_id_conversation_id: { user_id: userId, conversation_id: conversationId } },
    });
    if (!mute) return false;
    // Se muted_until é null = mudo indefinidamente
    if (!mute.muted_until) return true;
    // Se muted_until já passou = não está mais mudo
    return new Date(mute.muted_until) > new Date();
  }

  /** Retorna conversas mutadas do usuário */
  async getMutedConversations(userId: string): Promise<string[]> {
    const safeUserId = this.requireUserId(userId, 'getMutedConversations');
    const mutes = await (this.prisma as any).conversationMute.findMany({
      where: { user_id: safeUserId },
      select: { conversation_id: true, muted_until: true },
    });
    const now = new Date();
    return mutes
      .filter((m: any) => !m.muted_until || new Date(m.muted_until) > now)
      .map((m: any) => m.conversation_id);
  }
}
