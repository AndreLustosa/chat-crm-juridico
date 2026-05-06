import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { QueueEvents, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';

/**
 * Escuta a conclusão dos ai-jobs e emite WebSocket em tempo real.
 * Isso garante que a resposta da Sophia apareça no chat imediatamente,
 * sem esperar o echo do webhook da Evolution API.
 */
@Injectable()
export class AiEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiEventsService.name);
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

    const prefix = process.env.BULL_PREFIX || 'bull';
    this.queue = new Queue('ai-jobs', { connection, prefix });
    this.queueEvents = new QueueEvents('ai-jobs', { connection, prefix });

    // O worker retorna { conversationId, messageId } ao concluir com sucesso
    this.queueEvents.on('completed', async ({ jobId, returnvalue }) => {
      try {
        // returnvalue vem como string JSON serializado pelo BullMQ
        let result: any;
        try {
          result = typeof returnvalue === 'string'
            ? JSON.parse(returnvalue)
            : returnvalue;
        } catch {
          return; // job completou sem retorno (cooldown/skip)
        }

        const { conversationId, messageId } = result ?? {};
        if (!conversationId || !messageId) return;

        // Busca a mensagem salva com dados completos + tenantId via conversation
        const message = await this.prisma.message.findUnique({
          where: { id: messageId },
          include: {
            media: true,
            skill: { select: { id: true, name: true, area: true } },
            conversation: { select: { tenant_id: true } },
          },
        });

        if (!message) {
          this.logger.warn(`[WS-AI] Mensagem ${messageId} não encontrada`);
          return;
        }

        // Emite para todos os clientes conectados na sala da conversa.
        // emitNewMessage: adiciona mensagem se ainda não está no estado.
        // emitMessageUpdate: atualiza a mensagem caso o echo da Evolution já a
        //   tenha adicionado sem skill (race condition), garantindo que o badge apareça.
        this.chatGateway.emitNewMessage(conversationId, message);
        this.chatGateway.emitMessageUpdate(conversationId, message);
        this.chatGateway.emitConversationsUpdate((message as any).conversation?.tenant_id ?? null);
        this.logger.log(
          `[WS-AI] newMessage+messageUpdate emitidos: msg=${messageId} conv=${conversationId} skill=${(message as any).skill?.name || 'null'}`,
        );
      } catch (e: any) {
        this.logger.error(`Erro no AiEventsService: ${e.message}`);
      }
    });

    this.queueEvents.on('error', (err) => {
      this.logger.error(`[QueueEvents AI] Erro de conexão: ${err.message}`);
    });

    this.logger.log('Escutando eventos de conclusão de ai-jobs via QueueEvents');
  }

  async onModuleDestroy() {
    await this.queueEvents?.close();
    await this.queue?.close();
  }
}
