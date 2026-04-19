import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmbeddingService } from './embedding.service';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { DailyMemoryBatchProcessor } from './daily-memory-batch.processor';
import { ProfileConsolidationProcessor } from './profile-consolidation.processor';
import { OrgProfileConsolidationProcessor } from './org-profile-consolidation.processor';
import { MemoryJobsProcessor } from './memory-jobs.processor';
import { MemoryDedupService } from './memory-dedup.service';
import { SettingsModule } from '../settings/settings.module';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 100 },
};

@Module({
  imports: [
    SettingsModule,
    BullModule.registerQueue({ name: 'memory-jobs', defaultJobOptions }),
  ],
  providers: [
    EmbeddingService,
    MemoryRetrievalService,
    // Services especializados — NAO sao @Processor, apenas @Injectable com
    // metodos chamados pelo MemoryJobsProcessor (o unico que escuta a fila).
    DailyMemoryBatchProcessor,
    ProfileConsolidationProcessor,
    OrgProfileConsolidationProcessor,
    // Dispatcher unico — previne corrida de workers na fila memory-jobs.
    MemoryJobsProcessor,
    MemoryDedupService,
  ],
  exports: [EmbeddingService, MemoryRetrievalService],
})
export class MemoryModule {}
