import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationWhatsappProcessor } from './notification-whatsapp.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notification-whatsapp' }),
  ],
  providers: [NotificationWhatsappProcessor],
})
export class NotificationWhatsappModule {}
