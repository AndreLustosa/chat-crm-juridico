import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { InboxesService } from '../inboxes/inboxes.service';
import { NotificationSettingsService, type NotifEventType } from '../notification-settings/notification-settings.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ChatGateway {
  server: Server;

  private logger = new Logger('ChatGateway');

  // ─── Presença de usuários online ─────────────────────────────────
  // Map<userId, Set<socketId>> — um usuário pode ter múltiplas abas
  private onlineUsers = new Map<string, Set<string>>();

  // ─── Debounce para inboxUpdate ───────────────────────────────────
  // Evita flood de emissões quando muitos contacts.update chegam em sequência
  private inboxUpdateTimers = new Map<string, NodeJS.Timeout>();
  private readonly INBOX_UPDATE_DEBOUNCE_MS = 2000; // 2 segundos

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => InboxesService))
    private inboxesService: InboxesService,
    private notifSettings: NotificationSettingsService,
    private notificationsService: NotificationsService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`[SOCKET] Client connected: ${client.id} (transport: ${client.conn?.transport?.name})`);
    const socketUser = (client as any).user;
    if (socketUser?.sub) {
      this.trackUserOnline(socketUser.sub, client.id);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const socketUser = (client as any).user;
    if (socketUser?.sub) {
      this.trackUserOffline(socketUser.sub, client.id);
    }
  }

  private trackUserOnline(userId: string, socketId: string) {
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    const wasOffline = this.onlineUsers.get(userId)!.size === 0;
    this.onlineUsers.get(userId)!.add(socketId);
    if (wasOffline) {
      // Broadcast: usuário ficou online
      this.server?.emit('user_presence', { userId, online: true });
      this.logger.log(`[PRESENCE] User ${userId} ONLINE (${this.onlineUsers.get(userId)!.size} tab(s))`);
      // Atribuir conversas pendentes que a IA estava atendendo (fire-and-forget)
      this.assignPendingConversations(userId).catch(e =>
        this.logger.warn(`[PRESENCE] Falha ao atribuir pendentes para ${userId}: ${e.message}`),
      );
    }
  }

  /**
   * Quando um operador fica online, atribui conversas sem operador dos inboxes dele
   * usando round-robin entre TODOS os operadores online (não só o que acabou de entrar).
   */
  private async assignPendingConversations(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { inboxes: { select: { id: true } } },
    });
    if (!user?.inboxes?.length) return;

    const inboxIds = user.inboxes.map((i: any) => i.id);

    // Busca conversas sem operador nos inboxes desse user
    const pending = await this.prisma.conversation.findMany({
      where: {
        assigned_user_id: null,
        inbox_id: { in: inboxIds },
        status: { notIn: ['FECHADO'] },
        lead: { stage: { notIn: ['PERDIDO', 'FINALIZADO'] } },
      },
      select: { id: true, tenant_id: true, inbox_id: true },
      orderBy: { last_message_at: 'asc' }, // Mais antiga primeiro
    });

    if (pending.length === 0) return;

    this.logger.log(`[PRESENCE] User ${userId} online — distribuindo ${pending.length} conversa(s) pendente(s) via round-robin`);

    const onlineUserIds = this.getOnlineUserIds();

    for (const conv of pending) {
      // Round-robin por inbox — distribui entre todos os operadores online
      const assigneeId = conv.inbox_id
        ? await this.inboxesService.getNextAssignee(conv.inbox_id, onlineUserIds)
        : userId; // Sem inbox → atribui ao que entrou

      if (assigneeId) {
        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: { assigned_user_id: assigneeId },
        });
        this.logger.log(`[AUTO-ASSIGN] Conversa pendente ${conv.id} → operador online ${assigneeId}`);
      }
    }

    // Refresh sidebar de todos
    if (pending[0]?.tenant_id) {
      this.emitConversationsUpdate(pending[0].tenant_id);
    }
  }

  private trackUserOffline(userId: string, socketId: string) {
    const sockets = this.onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.onlineUsers.delete(userId);
        // Broadcast: usuário ficou offline
        this.server?.emit('user_presence', { userId, online: false });
        this.logger.log(`[PRESENCE] User ${userId} OFFLINE`);
      }
    }
  }

  /** Retorna lista de userIds online */
  getOnlineUserIds(): string[] {
    return Array.from(this.onlineUsers.keys());
  }

  /** Verifica se um usuário específico está online */
  isUserOnline(userId: string): boolean {
    return (this.onlineUsers.get(userId)?.size ?? 0) > 0;
  }

  async handleJoinConversation(conversationId: string, client: Socket) {
    const socketUser = (client as any).user;
    if (!socketUser?.sub) {
      this.logger.warn(`[SOCKET] BLOQUEADO: join_conversation sem user no socket`);
      return;
    }

    // Admin pode entrar em qualquer sala
    const userRoles = Array.isArray(socketUser.roles) ? socketUser.roles : (socketUser.role ? [socketUser.role] : []);
    if (userRoles.includes('ADMIN')) {
      client.join(conversationId);
      this.logger.log(`[SOCKET] Client ${client.id} (ADMIN) joined room: ${conversationId}`);
      this.server.to(client.id).emit('joined_room', { room: conversationId });
      return;
    }

    // Verificar se a conversa existe
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { inbox_id: true, assigned_user_id: true, assigned_lawyer_id: true },
    });

    if (!conversation) {
      this.logger.warn(`[SOCKET] BLOQUEADO: conversa ${conversationId} nao encontrada`);
      return;
    }

    // Verificar: usuario esta atribuido OU pertence ao inbox da conversa
    const user = await this.prisma.user.findUnique({
      where: { id: socketUser.sub },
      select: { inboxes: { select: { id: true } } },
    });

    const userInboxIds = (user?.inboxes || []).map((i: any) => i.id);
    const hasAccess =
      conversation.assigned_user_id === socketUser.sub ||
      conversation.assigned_lawyer_id === socketUser.sub ||
      ((conversation as any).inbox_id && userInboxIds.includes((conversation as any).inbox_id));

    if (!hasAccess) {
      this.logger.warn(`[SOCKET] BLOQUEADO: user ${socketUser.sub} sem acesso a conversa ${conversationId}`);
      return;
    }

    client.join(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} joined room: ${conversationId}`);
    this.server.to(client.id).emit('joined_room', { room: conversationId });
  }

  handleLeaveConversation(conversationId: string, client: Socket) {
    client.leave(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} left room: ${conversationId}`);
  }

  handleJoinUser(userId: string, client: Socket) {
    const socketUser = (client as any).user;
    // So permite entrar na propria sala
    if (socketUser?.sub !== userId) {
      this.logger.warn(`[SOCKET] BLOQUEADO: Client ${client.id} tentou entrar em user:${userId} (user real: ${socketUser?.sub})`);
      return;
    }
    client.join(`user:${userId}`);
    this.logger.log(`[SOCKET] Client ${client.id} joined user room: user:${userId}`);
  }

  async emitTransferRequest(toUserId: string, data: any) {
    const prefs = await this.notifSettings.getNotifFlags(toUserId, 'transfer_request').catch(() => ({ skipSound: false, skipDesktop: false }));
    this.logger.log(`[SOCKET] Emitting transfer_request to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_request', { ...data, _prefs: prefs });
  }

  emitTransferResponse(fromUserId: string, data: any) {
    this.logger.log(`[SOCKET] Emitting transfer_response to user:${fromUserId}`);
    this.server.to(`user:${fromUserId}`).emit('transfer_response', data);
  }

  emitTransferCancelled(toUserId: string, data: { conversationId: string }) {
    this.logger.log(`[SOCKET] Emitting transfer_cancelled to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_cancelled', data);
  }

  emitTransferReturned(toUserId: string, data: any) {
    this.logger.log(`[SOCKET] Emitting transfer_returned to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_returned', data);
  }

  emitNewMessage(conversationId: string, message: any) {
    this.logger.log(`[SOCKET] Emitting newMessage to room ${conversationId}`);
    this.server.to(conversationId).emit('newMessage', message);
  }

  emitNewNote(conversationId: string, note: any) {
    this.logger.log(`[SOCKET] Emitting newNote to room ${conversationId}`);
    this.server.to(conversationId).emit('newNote', note);
  }

  emitNoteUpdated(conversationId: string, note: any) {
    this.logger.log(`[SOCKET] Emitting noteUpdated to room ${conversationId}`);
    this.server.to(conversationId).emit('noteUpdated', note);
  }

  emitMessageUpdate(conversationId: string, message: any) {
    this.logger.log(`[SOCKET] Emitting messageUpdate to room ${conversationId}`);
    this.server.to(conversationId).emit('messageUpdate', message);
  }

  /**
   * Emite inboxUpdate com debounce para evitar flood.
   * Múltiplas chamadas dentro de 2s resultam em UMA única emissão.
   * Use immediate=true para emitir instantaneamente (ex: nova mensagem).
   */
  emitConversationsUpdate(tenantId: string | null, immediate = false) {
    const resolveAndEmit = (resolvedTenantId: string) => {
      if (immediate) {
        // Emissão imediata — mensagens novas não podem esperar
        this.logger.log(`[SOCKET] Emitting inboxUpdate to tenant:${resolvedTenantId}`);
        this.server.to(`tenant:${resolvedTenantId}`).emit('inboxUpdate');
        return;
      }

      // Debounce — múltiplas chamadas em sequência rápida consolidam em 1
      const key = resolvedTenantId;
      const existing = this.inboxUpdateTimers.get(key);
      if (existing) {
        clearTimeout(existing);
      }
      const timer = setTimeout(() => {
        this.inboxUpdateTimers.delete(key);
        this.logger.log(`[SOCKET] Emitting inboxUpdate (debounced) to tenant:${resolvedTenantId}`);
        this.server.to(`tenant:${resolvedTenantId}`).emit('inboxUpdate');
      }, this.INBOX_UPDATE_DEBOUNCE_MS);
      this.inboxUpdateTimers.set(key, timer);
    };

    if (tenantId) {
      resolveAndEmit(tenantId);
    } else {
      // SEGURANCA: sem tenantId, busca o tenant padrao em vez de broadcast global.
      this.logger.warn(`[SOCKET] inboxUpdate sem tenantId — resolvendo tenant padrao`);
      this.prisma.tenant.findFirst().then((t) => {
        if (t) resolveAndEmit(t.id);
      }).catch(() => {});
    }
  }

  /**
   * Emit incoming message notification.
   *
   * Regra de negócio:
   *  - Lead com operador atribuído   → notifica SOMENTE o operador (assigned_user_id)
   *  - Cliente com operador atribuído → notifica operador E advogado (assigned_lawyer_id), se distintos
   *  - Sem operador atribuído        → notifica todo o tenant para alguém assumir
   */
  async emitIncomingMessageNotification(
    tenantId: string | null,
    assignedUserId: string | null,
    data: { conversationId: string; contactName?: string },
    assignedLawyerId?: string | null,
    isClient?: boolean,
  ) {
    const basePayload = { ...data, assignedUserId };

    if (assignedUserId) {
      // Checa mute da conversa para o operador
      const isMuted = await this.notificationsService.isConversationMuted(assignedUserId, data.conversationId).catch(() => false);
      const prefs = isMuted
        ? { skipSound: true, skipDesktop: true }
        : await this.notifSettings.getNotifFlags(assignedUserId, 'incoming_message').catch(() => ({ skipSound: false, skipDesktop: false }));
      const payload = { ...basePayload, _prefs: prefs };

      this.logger.log(`[SOCKET] incoming_message_notification → user:${assignedUserId} (sound=${!prefs.skipSound}, desktop=${!prefs.skipDesktop}${isMuted ? ', MUTED' : ''})`);
      this.server.to(`user:${assignedUserId}`).emit('incoming_message_notification', payload);

      // Persiste no histórico de notificações (fire-and-forget)
      this.notificationsService.create({
        userId: assignedUserId,
        tenantId,
        type: 'incoming_message',
        title: data.contactName || 'Nova mensagem',
        body: 'Nova mensagem recebida',
        data: { conversationId: data.conversationId },
      }).catch(() => {});

      // Para clientes: notifica também o advogado responsável (se diferente do operador)
      if (isClient && assignedLawyerId && assignedLawyerId !== assignedUserId) {
        const lawyerMuted = await this.notificationsService.isConversationMuted(assignedLawyerId, data.conversationId).catch(() => false);
        const lawyerPrefs = lawyerMuted
          ? { skipSound: true, skipDesktop: true }
          : await this.notifSettings.getNotifFlags(assignedLawyerId, 'incoming_message').catch(() => ({ skipSound: false, skipDesktop: false }));
        const lawyerPayload = { ...basePayload, _prefs: lawyerPrefs };
        this.logger.log(`[SOCKET] incoming_message_notification → lawyer:${assignedLawyerId} (cliente)`);
        this.server.to(`user:${assignedLawyerId}`).emit('incoming_message_notification', lawyerPayload);

        this.notificationsService.create({
          userId: assignedLawyerId,
          tenantId,
          type: 'incoming_message',
          title: data.contactName || 'Nova mensagem',
          body: 'Nova mensagem de cliente',
          data: { conversationId: data.conversationId },
        }).catch(() => {});
      }
    } else if (tenantId) {
      // Sem operador: notifica todos do tenant (sem _prefs individuais — usa defaults no frontend)
      this.logger.log(`[SOCKET] incoming_message_notification → tenant:${tenantId} (sem atribuicao)`);
      this.server.to(`tenant:${tenantId}`).emit('incoming_message_notification', basePayload);
    } else {
      this.prisma.tenant.findFirst().then((t) => {
        if (t) {
          this.server.to(`tenant:${t.id}`).emit('incoming_message_notification', basePayload);
        }
      }).catch(() => {});
    }
  }

  // ─── Legal Cases ────────────────────────────────────────────────

  emitLegalCaseUpdate(lawyerId: string, data: { caseId: string; action: string; [key: string]: any }) {
    this.logger.log(`[SOCKET] Emitting legal_case_update to user:${lawyerId}`);
    this.server.to(`user:${lawyerId}`).emit('legal_case_update', data);
  }

  emitNewLegalCase(lawyerId: string, data: { caseId: string; leadName: string }) {
    this.logger.log(`[SOCKET] Emitting new_legal_case to user:${lawyerId}`);
    this.server.to(`user:${lawyerId}`).emit('new_legal_case', data);
  }

  emitTaskComment(userId: string, data: { taskId: string; text: string; fromUserName: string }) {
    this.logger.log(`[SOCKET] Emitting task_comment to user:${userId}`);
    this.server.to(`user:${userId}`).emit('task_comment', data);
  }

  // ─── Calendar ──────────────────────────────────────────────────

  emitCalendarUpdate(userId: string, data: { eventId: string; action: string; [key: string]: any }) {
    this.logger.log(`[SOCKET] Emitting calendar_update to user:${userId}`);
    this.server.to(`user:${userId}`).emit('calendar_update', data);
  }

  async emitCalendarReminder(userId: string, data: { eventId: string; title: string; type: string; start_at: string; minutesBefore: number }) {
    const prefs = await this.notifSettings.getNotifFlags(userId, 'calendar_reminder').catch(() => ({ skipSound: false, skipDesktop: false }));
    this.logger.log(`[SOCKET] Emitting calendar_reminder to user:${userId} — ${data.title} em ${data.minutesBefore}min`);
    this.server.to(`user:${userId}`).emit('calendar_reminder', { ...data, _prefs: prefs });
  }

  // ─── Reactions ──────────────────────────────────────────────

  emitMessageReaction(conversationId: string, data: { messageId: string; reactions: any[] }) {
    this.logger.log(`[SOCKET] Emitting messageReaction to room ${conversationId}`);
    this.server.to(conversationId).emit('messageReaction', data);
  }

  // ─── Typing Indicator ────────────────────────────────────────

  emitTypingIndicator(conversationId: string, data: { userId: string; userName: string; isTyping: boolean }) {
    this.server.to(conversationId).emit('typing_indicator', data);
  }

  // ─── Connection Status ──────────────────────────────────────

  emitConnectionStatusUpdate(data: { instanceName: string; state: string; statusReason?: number }) {
    this.logger.log(`[SOCKET] Emitting connection_status_update: ${data.instanceName} → ${data.state}`);
    this.server.emit('connection_status_update', data);
  }

  // ─── Contact Presence ──────────────────────────────────────

  emitContactPresence(conversationId: string, data: { presence: string; lastSeen?: string }) {
    this.server.to(conversationId).emit('contact_presence', data);
  }

  // ─── Messages Sync ────────────────────────────────────────
  // Emitido após importar mensagens perdidas do WhatsApp para a sala da conversa.
  // O frontend usa para saber que deve recarregar o histórico.
  emitMessagesSynced(conversationId: string, imported: number) {
    this.logger.log(`[SOCKET] Emitting messages_synced to room ${conversationId}: ${imported} imported`);
    this.server.to(conversationId).emit('messages_synced', { conversationId, imported });
  }

  // ─── Petitions ─────────────────────────────────────────────

  emitPetitionStatusChange(userId: string, data: {
    petitionId: string;
    title: string;
    status: string;
    previousStatus: string;
    action?: string;
    reviewNotes?: string;
    caseId?: string;
  }) {
    this.logger.log(`[SOCKET] Emitting petition_status_change to user:${userId} — ${data.title} → ${data.status}`);
    this.server.to(`user:${userId}`).emit('petition_status_change', data);
  }

  emitPetitionCreated(userId: string, data: {
    petitionId: string;
    title: string;
    type: string;
    caseId: string;
    createdBy: string;
  }) {
    this.logger.log(`[SOCKET] Emitting petition_created to user:${userId} — ${data.title}`);
    this.server.to(`user:${userId}`).emit('petition_created', data);
  }
}
