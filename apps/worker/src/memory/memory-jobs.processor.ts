import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DailyMemoryBatchProcessor } from './daily-memory-batch.processor';
import { ProfileConsolidationProcessor } from './profile-consolidation.processor';
import { OrgProfileConsolidationProcessor } from './org-profile-consolidation.processor';

/**
 * MemoryJobsProcessor — ponto UNICO de consumo da fila `memory-jobs`.
 *
 * Por que um so: BullMQ distribui cada job para UM worker da fila. Se tivermos
 * multiplos @Processor('memory-jobs'), eles competem — o que "vencer" e nao
 * reconhecer o job.name vai marca-lo como completo silenciosamente (com return
 * null). Resultado: jobs sendo descartados aleatoriamente conforme o workload.
 *
 * Fix: um unico processor escuta a fila e roteia por `job.name` para os
 * services especializados (DailyMemoryBatch, ProfileConsolidation,
 * OrgProfileConsolidation).
 *
 * Jobs suportados:
 *   - daily-batch-extract / manual-extract     → DailyMemoryBatchProcessor
 *   - consolidate-profiles-after-batch         → ProfileConsolidationProcessor
 *   - consolidate-profile                      → ProfileConsolidationProcessor
 *   - consolidate-org-profile                  → OrgProfileConsolidationProcessor
 */
@Injectable()
@Processor('memory-jobs')
export class MemoryJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryJobsProcessor.name);

  constructor(
    private readonly batch: DailyMemoryBatchProcessor,
    private readonly profile: ProfileConsolidationProcessor,
    private readonly orgProfile: OrgProfileConsolidationProcessor,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'daily-batch-extract':
      case 'manual-extract':
        return this.batch.processTenantBatch(job);

      case 'consolidate-profiles-after-batch':
        return this.profile.consolidateAfterBatch(job);

      case 'consolidate-profile':
        return this.profile.consolidateSingle(job);

      case 'consolidate-org-profile':
        return this.orgProfile.consolidateSingle(job);

      default:
        this.logger.warn(`[MemoryJobs] Job desconhecido: ${job.name}`);
        return null;
    }
  }
}
