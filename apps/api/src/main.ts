import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatGateway } from './gateway/chat.gateway';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Carregar .env da raiz do projeto antes de qualquer coisa
const possiblePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
];

for (const envPath of possiblePaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[Bootstrap] Configuração carregada de: ${envPath}`);
    break;
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ?? 3005;
  const dbUrl = process.env.DATABASE_URL;

  logger.log('Iniciando Bootstrap...');
  logger.log(`DATABASE_URL carregada: ${dbUrl ? 'SIM (inicia com ' + dbUrl.substring(0, 20) + '...)' : 'NAO'}`);

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');
  logger.log(`API rodando em http://localhost:${port}`);

  // Manually attach Socket.IO to the HTTP server
  // (NestJS IoAdapter was not properly attaching it)
  const httpServer = app.getHttpServer();
  const chatGateway = app.get(ChatGateway);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
    addTrailingSlash: false,
    transports: ['polling', 'websocket'],
  });

  chatGateway.server = io;

  // JWT authentication middleware for WebSocket connections
  const jwtService = app.get(JwtService);
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization as string)?.replace('Bearer ', '') ||
      '';
    if (!token) {
      logger.warn(`[SOCKET] Conexao rejeitada — sem token JWT`);
      return next(new Error('Authentication required'));
    }
    try {
      const payload = jwtService.verify(token);
      (socket as any).user = payload;
      next();
    } catch {
      logger.warn(`[SOCKET] Conexao rejeitada — token JWT invalido`);
      next(new Error('Invalid token'));
    }
  });

  // Rate limiting para eventos Socket.IO
  const socketRateLimits = new Map<string, Map<string, number[]>>();

  function checkSocketRateLimit(socketId: string, event: string, maxPerMinute: number): boolean {
    if (!socketRateLimits.has(socketId)) {
      socketRateLimits.set(socketId, new Map());
    }
    const events = socketRateLimits.get(socketId)!;
    const now = Date.now();
    const timestamps = events.get(event) || [];
    const recent = timestamps.filter(t => now - t < 60000);
    if (recent.length >= maxPerMinute) {
      return false;
    }
    recent.push(now);
    events.set(event, recent);
    return true;
  }

  io.on('connection', (socket) => {
    chatGateway.handleConnection(socket);
    socket.on('disconnect', () => {
      socketRateLimits.delete(socket.id);
      chatGateway.handleDisconnect(socket);
    });
    socket.on('join_conversation', (conversationId) => {
      if (!checkSocketRateLimit(socket.id, 'join_conversation', 30)) {
        logger.warn(`[SOCKET] Rate limited: join_conversation de ${socket.id}`);
        return;
      }
      chatGateway.handleJoinConversation(conversationId, socket);
    });
    socket.on('leave_conversation', (conversationId) => {
      if (!checkSocketRateLimit(socket.id, 'leave_conversation', 30)) {
        return;
      }
      chatGateway.handleLeaveConversation(conversationId, socket);
    });
    socket.on('join_user', (userId) => {
      if (!checkSocketRateLimit(socket.id, 'join_user', 10)) {
        logger.warn(`[SOCKET] Rate limited: join_user de ${socket.id}`);
        return;
      }
      chatGateway.handleJoinUser(userId, socket);
    });
  });

  logger.log(`[SOCKET] Socket.IO attached to HTTP server on port ${port}, path /socket.io`);
}
void bootstrap();
