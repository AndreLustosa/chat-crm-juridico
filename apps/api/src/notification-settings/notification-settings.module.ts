import { Module, Global } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationSettingsController } from './notification-settings.controller';

@Global()
@Module({
  providers: [NotificationSettingsService],
  controllers: [NotificationSettingsController],
  exports: [NotificationSettingsService],
})
export class NotificationSettingsModule {}
