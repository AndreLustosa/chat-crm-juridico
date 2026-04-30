import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  ForecastParams,
  TrafficReachPlannerService,
} from './traffic-reach-planner.service';

/**
 * Processor da fila `trafego-reach-planner`.
 *
 * Job names:
 *   - 'generate' → payload { accountId, params, createdBy }
 *
 * concurrency:1 evita rate-limit no Reach Planner Service do Google.
 */
@Injectable()
@Processor('trafego-reach-planner', { concurrency: 1 })
export class TrafficReachPlannerProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafficReachPlannerProcessor.name);

  constructor(private planner: TrafficReachPlannerService) {
    super();
  }

  async process(
    job: Job<{
      accountId: string;
      params: ForecastParams;
      createdBy: string;
    }>,
  ): Promise<unknown> {
    if (job.name !== 'generate') {
      this.logger.warn(`[reach-planner-processor] job desconhecido: ${job.name}`);
      return { ignored: true };
    }
    const { accountId, params, createdBy } = job.data;
    return this.planner.generateForecast(accountId, params, createdBy);
  }
}
