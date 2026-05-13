import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FollowupCronService } from './followup-cron.service';
import { FollowupProcessor } from './followup.processor';
import { FollowupService } from './followup.service';
import { FollowupAnalyzerService } from './followup-analyzer.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    // Espelha defaultJobOptions do api/followup.module.ts — anti-ban WhatsApp.
    BullModule.registerQueue({
      name: 'followup-jobs',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    }),
  ],
  providers: [
    FollowupCronService,
    FollowupProcessor,
    FollowupService,
    FollowupAnalyzerService,
  ],
})
export class FollowupModule {}
