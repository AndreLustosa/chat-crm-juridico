import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskAlertCronService } from './task-alert-cron.service';
import { CalendarModule } from '../calendar/calendar.module';
import { GatewayModule } from '../gateway/gateway.module';
import { MediaModule } from '../media/media.module';

// NotificationsModule eh @Global, nao precisa importar aqui — o
// NotificationsService injeta automaticamente via DI.
// MediaModule precisa import explicito porque exporta MediaS3Service
// usado pelos metodos de attachments.

@Module({
  imports: [CalendarModule, GatewayModule, MediaModule],
  controllers: [TasksController],
  providers: [TasksService, TaskAlertCronService],
  exports: [TasksService]
})
export class TasksModule {}
