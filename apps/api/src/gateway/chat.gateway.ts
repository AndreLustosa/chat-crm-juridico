import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@Injectable()
export class ChatGateway {
  server: Server;

  private logger = new Logger('ChatGateway');

  handleConnection(client: Socket) {
    this.logger.log(`[SOCKET] Client connected: ${client.id} (transport: ${client.conn?.transport?.name})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  handleJoinConversation(conversationId: string, client: Socket) {
    client.join(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} joined room: ${conversationId}`);
    this.server.to(client.id).emit('joined_room', { room: conversationId });
  }

  handleLeaveConversation(conversationId: string, client: Socket) {
    client.leave(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} left room: ${conversationId}`);
  }

  handleJoinUser(userId: string, client: Socket) {
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
    this.logger.log(`[SOCKET] Emitting inboxUpdate to all clients`);
    this.server.emit('inboxUpdate');
  }

  /** Broadcast incoming message notification to all clients; each client filters by assignedUserId */
  emitIncomingMessageNotification(assignedUserId: string | null, data: { conversationId: string; contactName?: string }) {
    this.logger.log(`[SOCKET] Emitting incoming_message_notification (assignedUserId: ${assignedUserId ?? 'none'})`);
    this.server.emit('incoming_message_notification', { ...data, assignedUserId });
  }
}
