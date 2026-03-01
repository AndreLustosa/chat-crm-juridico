import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { QueueEvents, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class MediaEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaEventsService.name);
  private queueEvents: QueueEvents;
  private queue: Queue;

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  onModuleInit() {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null as any,
      enableReadyCheck: false,
    };

    // Queue para buscar dados do job pelo ID
    this.queue = new Queue('media-jobs', { connection });
    this.queueEvents = new QueueEvents('media-jobs', { connection });

    this.queueEvents.on('completed', async ({ jobId }) => {
      try {
        // Busca o job pelo ID para obter message_id e conversation_id do data
        const job = await this.queue.getJob(jobId);
        if (!job) {
          this.logger.warn(`[WS] Job ${jobId} não encontrado`);
          return;
        }

        const messageId: string = job.data.message_id;
        const conversationId: string = job.data.conversation_id;

        if (!messageId || !conversationId) {
          this.logger.warn(`[WS] Job ${jobId} sem message_id ou conversation_id`);
          return;
        }

        // Busca mensagem atualizada com mídia no banco
        const message = await this.prisma.message.findUnique({
          where: { id: messageId },
          include: { media: true },
        });

        if (!message) {
          this.logger.warn(`[WS] Mensagem ${messageId} não encontrada`);
          return;
        }

        // Emite evento para o room da conversa
        this.chatGateway.server?.to(conversationId).emit('mediaReady', message);
        this.logger.log(`[WS] mediaReady emitido: msg=${messageId} conv=${conversationId}`);
      } catch (e: any) {
        this.logger.error(`Erro no MediaEventsService: ${e.message}`);
      }
    });

    this.queueEvents.on('error', (err) => {
      this.logger.error(`[QueueEvents] Erro de conexão: ${err.message}`);
    });

    this.logger.log('Escutando eventos de conclusão de media-jobs via QueueEvents');
  }

  async onModuleDestroy() {
    await this.queueEvents?.close();
    await this.queue?.close();
  }
}
