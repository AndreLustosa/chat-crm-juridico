import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatGateway {
  server: Server;

  private logger = new Logger('ChatGateway');

  // ─── Presença de usuários online ─────────────────────────────────
  // Map<userId, Set<socketId>> — um usuário pode ter múltiplas abas
  private onlineUsers = new Map<string, Set<string>>();

  constructor(private prisma: PrismaService) {}

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
      select: { inbox_id: true, assigned_user_id: true },
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

  emitTransferRequest(toUserId: string, data: any) {
    this.logger.log(`[SOCKET] Emitting transfer_request to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_request', data);
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

  emitConversationsUpdate(tenantId: string | null) {
    if (tenantId) {
      this.logger.log(`[SOCKET] Emitting inboxUpdate to tenant:${tenantId}`);
      this.server.to(`tenant:${tenantId}`).emit('inboxUpdate');
    } else {
      // SEGURANCA: sem tenantId, busca o tenant padrao em vez de broadcast global.
      // Isso evita vazamento de dados entre tenants em ambiente multi-tenant.
      this.logger.warn(`[SOCKET] inboxUpdate sem tenantId — resolvendo tenant padrao`);
      this.prisma.tenant.findFirst().then((t) => {
        if (t) {
          this.server.to(`tenant:${t.id}`).emit('inboxUpdate');
        }
      }).catch(() => {});
    }
  }

  /**
   * Emit incoming message notification.
   * Se a conversa tem operador atribuído → emite só para user:${assignedUserId}
   * Se não tem (conversa sem operador) → emite para o tenant inteiro
   */
  emitIncomingMessageNotification(tenantId: string | null, assignedUserId: string | null, data: { conversationId: string; contactName?: string }) {
    const payload = { ...data, assignedUserId };

    if (assignedUserId) {
      // Conversa atribuída: notifica SOMENTE o operador responsável
      this.logger.log(`[SOCKET] incoming_message_notification → user:${assignedUserId}`);
      this.server.to(`user:${assignedUserId}`).emit('incoming_message_notification', payload);
    } else if (tenantId) {
      // Sem operador: notifica todos do tenant para alguém assumir
      this.logger.log(`[SOCKET] incoming_message_notification → tenant:${tenantId} (sem atribuicao)`);
      this.server.to(`tenant:${tenantId}`).emit('incoming_message_notification', payload);
    } else {
      this.prisma.tenant.findFirst().then((t) => {
        if (t) {
          this.server.to(`tenant:${t.id}`).emit('incoming_message_notification', payload);
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

  emitCalendarReminder(userId: string, data: { eventId: string; title: string; type: string; start_at: string; minutesBefore: number }) {
    this.logger.log(`[SOCKET] Emitting calendar_reminder to user:${userId} — ${data.title} em ${data.minutesBefore}min`);
    this.server.to(`user:${userId}`).emit('calendar_reminder', data);
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
