import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class MediaEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaEventsService.name);
  private queueEvents: QueueEvents;

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  onModuleInit() {
    this.queueEvents = new QueueEvents('media-jobs', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    });

    this.queueEvents.on('completed', async ({ jobId, returnvalue }) => {
      try {
        if (!returnvalue) return;
        const { messageId, conversationId } = JSON.parse(returnvalue);
        if (!messageId || !conversationId) return;

        // Busca mensagem atualizada com mídia no banco
        const message = await this.prisma.message.findUnique({
          where: { id: messageId },
          include: { media: true },
        });

        if (!message) return;

        // Emite evento para o room da conversa
        this.chatGateway.server.to(conversationId).emit('mediaReady', message);
        this.logger.log(`[WS] mediaReady emitido: msg=${messageId} conv=${conversationId}`);
      } catch (e: any) {
        this.logger.error(`Erro no MediaEventsService: ${e.message}`);
      }
    });

    this.logger.log('Escutando eventos de conclusão de media-jobs via QueueEvents');
  }

  async onModuleDestroy() {
    await this.queueEvents?.close();
  }
}
