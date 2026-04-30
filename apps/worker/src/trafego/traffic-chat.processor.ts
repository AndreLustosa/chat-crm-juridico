import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TrafficChatService } from './traffic-chat.service';
import { TrafficChatApplyService } from './traffic-chat-apply.service';

/**
 * Processor da fila `trafego-chat` (Sprint H.5).
 *
 * Jobs:
 *   - 'send'  → { tenantId, sessionId, userId, text } — chama LLM + tools
 *   - 'apply' → { tenantId, messageId, userId } — executa proposed_action
 *   - 'reject'→ { tenantId, messageId, userId, note } — marca REJECTED
 *
 * concurrency:2 pra permitir 2 chats em paralelo sem virar fila lenta.
 * (1 user fazendo 2 conversas em sessions diferentes é OK; mais de 2 vai
 * formar fila — ainda OK pra escala atual.)
 */
@Injectable()
@Processor('trafego-chat', { concurrency: 2 })
export class TrafficChatProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafficChatProcessor.name);

  constructor(
    private chat: TrafficChatService,
    private apply: TrafficChatApplyService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<unknown> {
    switch (job.name) {
      case 'send':
        return this.chat.sendMessage(
          job.data.tenantId,
          job.data.sessionId,
          job.data.userId,
          job.data.text,
        );
      case 'apply':
        return this.apply.apply(
          job.data.tenantId,
          job.data.messageId,
          job.data.userId,
        );
      case 'reject':
        return this.apply.reject(
          job.data.tenantId,
          job.data.messageId,
          job.data.userId,
          job.data.note,
        );
      default:
        this.logger.warn(`[chat-processor] job desconhecido: ${job.name}`);
        return { ignored: true };
    }
  }
}
