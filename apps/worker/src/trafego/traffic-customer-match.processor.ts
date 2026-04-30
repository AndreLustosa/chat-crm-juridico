import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TrafficCustomerMatchService } from './traffic-customer-match.service';

/**
 * Processor da fila `trafego-customer-match`.
 *
 * Job names:
 *   - 'rebuild' → payload { userListId } — recompute members do CRM
 *   - 'sync'    → payload { userListId } — push pendentes pro Google Ads
 *
 * concurrency:1 evita race em rebuild/sync simultâneos da mesma lista.
 */
@Injectable()
@Processor('trafego-customer-match', { concurrency: 1 })
export class TrafficCustomerMatchProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafficCustomerMatchProcessor.name);

  constructor(private cm: TrafficCustomerMatchService) {
    super();
  }

  async process(job: Job<{ userListId: string }>): Promise<unknown> {
    const { userListId } = job.data;
    this.logger.log(
      `[customer-match-processor] job=${job.name} list=${userListId}`,
    );
    switch (job.name) {
      case 'rebuild':
        return this.cm.rebuildFromCRM(userListId);
      case 'sync':
        return this.cm.syncToGoogle(userListId);
      default:
        this.logger.warn(`[customer-match-processor] job desconhecido: ${job.name}`);
        return { ignored: true };
    }
  }
}
