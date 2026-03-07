import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarCronService } from './calendar-cron.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    GatewayModule,
    BullModule.registerQueue({ name: 'calendar-reminders' }),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarCronService],
  exports: [CalendarService],
})
export class CalendarModule {}
