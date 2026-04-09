import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiProcessor } from './ai.processor';
import { AiReactivationCronService } from './ai-reactivation-cron.service';

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
  ],
  providers: [AiProcessor, AiReactivationCronService],
})
export class AiModule {}
