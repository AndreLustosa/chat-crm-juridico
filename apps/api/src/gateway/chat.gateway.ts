import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  path: '/api/socket.io',
  cors: {
    origin: '*',
  },
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
    this.logger.log(`Client ${client.id} joined conversation ${conversationId}`);
  }
  
  // Method to be called by other modules (e.g. MessagesService/EvolutionService) 
  // to emit new messages to connected UI clients
  emitNewMessage(conversationId: string, message: any) {
    this.server.to(conversationId).emit('newMessage', message);
  }

  emitConversationsUpdate(tenantId: string | null) {
    // TBD: use tenant-based rooms for inbox updates
    this.server.emit('inboxUpdate'); 
  }
}
