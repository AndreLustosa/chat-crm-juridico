import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskAlertCronService } from './task-alert-cron.service';
import { CalendarModule } from '../calendar/calendar.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [CalendarModule, GatewayModule],
  controllers: [TasksController],
  providers: [TasksService, TaskAlertCronService],
  exports: [TasksService]
})
export class TasksModule {}
