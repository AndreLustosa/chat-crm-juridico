import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { CalendarModule } from '../calendar/calendar.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [CalendarModule, GatewayModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService]
})
export class TasksModule {}
