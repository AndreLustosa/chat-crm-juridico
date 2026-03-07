import { Module } from '@nestjs/common';
import { FollowupCronService } from './followup-cron.service';

@Module({
  providers: [FollowupCronService],
})
export class FollowupModule {}
