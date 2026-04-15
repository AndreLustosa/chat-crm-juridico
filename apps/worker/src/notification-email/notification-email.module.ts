import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationEmailProcessor } from './notification-email.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notification-email' }),
  ],
  providers: [NotificationEmailProcessor],
})
export class NotificationEmailModule {}
