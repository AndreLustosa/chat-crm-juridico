import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarCronService } from './calendar-cron.service';
import { CalendarReminderWorker } from './calendar-reminder.worker';
import { GatewayModule } from '../gateway/gateway.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    GatewayModule,
    forwardRef(() => WhatsappModule),
    forwardRef(() => SettingsModule),
    BullModule.registerQueue({ name: 'calendar-reminders' }),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarCronService, CalendarReminderWorker],
  exports: [CalendarService],
})
export class CalendarModule {}
