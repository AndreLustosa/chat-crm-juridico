import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  // path: '/socket.io' is default
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('ChatGateway');

  handleConnection(client: Socket) {
    this.logger.log(`[SOCKET] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_conversation')
  handleJoinConversation(@MessageBody() conversationId: string, @ConnectedSocket() client: Socket) {
    client.join(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} joined room: ${conversationId}`);
    this.server.to(client.id).emit('joined_room', { room: conversationId });
  }

  @SubscribeMessage('leave_conversation')
  handleLeaveConversation(@MessageBody() conversationId: string, @ConnectedSocket() client: Socket) {
    client.leave(conversationId);
    this.logger.log(`[SOCKET] Client ${client.id} left room: ${conversationId}`);
  }
  
  // Method to be called by other modules (e.g. MessagesService/EvolutionService) 
  // to emit new messages to connected UI clients
  emitNewMessage(conversationId: string, message: any) {
    this.logger.log(`[SOCKET] Emitting newMessage to room ${conversationId}`);
    this.server.to(conversationId).emit('newMessage', message);
  }

  emitConversationsUpdate(tenantId: string | null) {
    this.logger.log(`[SOCKET] Emitting inboxUpdate to all clients`);
    this.server.emit('inboxUpdate'); 
  }
}
