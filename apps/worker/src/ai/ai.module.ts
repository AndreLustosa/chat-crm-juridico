import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiProcessor } from './ai.processor';
import { AiReactivationCronService } from './ai-reactivation-cron.service';
import { AudioRetranscribeCronService } from './audio-retranscribe-cron.service';
import { MemoryModule } from '../memory/memory.module';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 200 },
};

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ai-jobs', defaultJobOptions }),
    BullModule.registerQueue({ name: 'calendar-reminders', defaultJobOptions }),
    BullModule.registerQueue({ name: 'memory-jobs', defaultJobOptions }),
    MemoryModule,
  ],
  providers: [AiProcessor, AiReactivationCronService, AudioRetranscribeCronService],
})
export class AiModule {}
