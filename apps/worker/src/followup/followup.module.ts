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
    BullModule.registerQueue({ name: 'followup-jobs' }),
  ],
  providers: [
    FollowupCronService,
    FollowupProcessor,
    FollowupService,
    FollowupAnalyzerService,
  ],
})
export class FollowupModule {}
