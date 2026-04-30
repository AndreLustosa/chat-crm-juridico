import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LoopKind, TrafficAIAgentService } from './traffic-ai-agent.service';

/**
 * Processor da fila `trafego-ai-agent`. Recebe trigger manual da API
 * (botão "Avaliar agora" na UI). concurrency:1 garante 1 loop por vez
 * por instância do worker — múltiplas instâncias paralelizam por sorteio
 * do BullMQ.
 *
 * Job names:
 *   - 'trafego-ai-run-loop'   → payload { accountId, loopKind }
 */
@Injectable()
@Processor('trafego-ai-agent', { concurrency: 1 })
export class TrafficAIAgentProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafficAIAgentProcessor.name);

  constructor(private agent: TrafficAIAgentService) {
    super();
  }

  async process(job: Job<RunLoopPayload>): Promise<unknown> {
    if (job.name !== 'trafego-ai-run-loop') {
      this.logger.warn(`[ai-agent-processor] job desconhecido: ${job.name}`);
      return { ignored: true };
    }
    const { accountId, loopKind } = job.data;
    this.logger.log(
      `[ai-agent-processor] run loop=${loopKind} account=${accountId} jobId=${job.id}`,
    );
    switch (loopKind) {
      case 'DAILY':
        return this.agent.runDailyLoop(accountId);
      case 'WEEKLY':
        return this.agent.runWeeklyLoop(accountId);
      case 'MONTHLY':
        return this.agent.runMonthlyLoop(accountId);
      case 'HOURLY':
        return this.agent.runHourlyLoop(accountId);
      case 'TRIGGERED':
      default:
        return this.agent.runTriggered(accountId);
    }
  }
}

export type RunLoopPayload = {
  accountId: string;
  loopKind: LoopKind;
};
