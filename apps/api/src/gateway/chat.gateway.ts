import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatGateway {
  server: Server;

  private logger = new Logger('ChatGateway');

  constructor(private prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`[SOCKET] Client connected: ${client.id} (transport: ${client.conn?.transport?.name})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  async handleJoinConversation(conversationId: string, client: Socket) {
    const socketUser = (client as any).user;
    if (!socketUser?.sub) {
      this.logger.warn(`[SOCKET] BLOQUEADO: join_conversation sem user no socket`);
      return;
    }

    // Admin pode entrar em qualquer sala
    if (socketUser.role === 'ADMIN') {
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

  emitTransferReturned(toUserId: string, data: any) {
    this.logger.log(`[SOCKET] Emitting transfer_returned to user:${toUserId}`);
    this.server.to(`user:${toUserId}`).emit('transfer_returned', data);
  }

  emitNewMessage(conversationId: string, message: any) {
    this.logger.log(`[SOCKET] Emitting newMessage to room ${conversationId}`);
    this.server.to(conversationId).emit('newMessage', message);
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

  /** Broadcast incoming message notification to all clients; each client filters by assignedUserId */
  emitIncomingMessageNotification(assignedUserId: string | null, data: { conversationId: string; contactName?: string }) {
    this.logger.log(`[SOCKET] Emitting incoming_message_notification (assignedUserId: ${assignedUserId ?? 'none'})`);
    this.server.emit('incoming_message_notification', { ...data, assignedUserId });
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
}
