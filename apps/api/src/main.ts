import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatGateway } from './gateway/chat.gateway';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as express from 'express';

// Carregar .env da raiz do projeto antes de qualquer coisa
const possiblePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
];

const bootstrapLogger = new Logger('Bootstrap');
for (const envPath of possiblePaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    bootstrapLogger.log(`Configuração carregada de: ${envPath}`);
    break;
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ?? 3005;
  const dbUrl = process.env.DATABASE_URL;

  logger.log('Iniciando Bootstrap...');
  logger.log(`DATABASE_URL carregada: ${dbUrl ? 'SIM (inicia com ' + dbUrl.substring(0, 20) + '...)' : 'NAO'}`);

  // Desabilitar body parser padrão para configurar limite manualmente
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Body parser com limite de 50MB (webhooks da Evolution enviam mídia em base64)
  // Também captura rawBody para verificação HMAC do Clicksign
  app.use(
    express.json({
      limit: '50mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Validacao global de DTOs via class-validator
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  // Catch-all exception filter — retorna JSON padronizado
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS: se ALLOWED_ORIGINS definido, restringe; senão fallback '*' (dev)
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : null;

  if (isProduction && !allowedOrigins) {
    throw new Error(
      '[Bootstrap] ALLOWED_ORIGINS não está definido em ambiente de produção. ' +
      'Configure com as origens permitidas (ex: ALLOWED_ORIGINS=https://seu-dominio.com). ' +
      'Em desenvolvimento, defina NODE_ENV=development para ignorar esta verificação.',
    );
  }

  if (!isProduction && !allowedOrigins) {
    logger.warn('[Bootstrap] ALLOWED_ORIGINS não definido — CORS aberto para todas as origens (*). Defina ALLOWED_ORIGINS em produção.');
  }

  app.enableCors({
    origin: allowedOrigins || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: !!allowedOrigins,  // credentials só com origins explícitas
  });

  await app.listen(port, '0.0.0.0');
  logger.log(`API rodando em http://localhost:${port}`);

  // Manually attach Socket.IO to the HTTP server
  // (NestJS IoAdapter was not properly attaching it)
  const httpServer = app.getHttpServer();
  const chatGateway = app.get(ChatGateway);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: allowedOrigins || (isProduction ? false : '*') },
    path: '/socket.io',
    addTrailingSlash: false,
    transports: ['polling', 'websocket'],
    maxHttpBufferSize: 1e6,  // 1MB max payload — previne abuse
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

  // Limpeza periodica: remove timestamps expirados a cada 5 minutos
  // Previne memory leak em conexoes de longa duracao
  setInterval(() => {
    const now = Date.now();
    for (const [socketId, events] of socketRateLimits) {
      for (const [event, timestamps] of events) {
        const recent = timestamps.filter(t => now - t < 60000);
        if (recent.length === 0) {
          events.delete(event);
        } else {
          events.set(event, recent);
        }
      }
      if (events.size === 0) {
        socketRateLimits.delete(socketId);
      }
    }
  }, 5 * 60 * 1000);

  io.on('connection', (socket) => {
    chatGateway.handleConnection(socket);

    // Auto-join tenant room for scoped broadcasts
    const socketUser = (socket as any).user;
    if (socketUser?.tenant_id) {
      socket.join(`tenant:${socketUser.tenant_id}`);
    }

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
    socket.on('typing', (data: { conversationId: string; isTyping: boolean }) => {
      if (!checkSocketRateLimit(socket.id, 'typing', 30)) return;
      const user = (socket as any).user;
      if (!user?.sub || !data?.conversationId) return;
      chatGateway.emitTypingIndicator(data.conversationId, {
        userId: user.sub,
        userName: user.name || 'Operador',
        isTyping: data.isTyping,
      });
    });
  });

  logger.log(`[SOCKET] Socket.IO attached to HTTP server on port ${port}, path /socket.io`);
}
void bootstrap();
