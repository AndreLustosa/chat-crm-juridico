import { Module } from '@nestjs/common';
import { AdminBotService } from './admin-bot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { TasksModule } from '../tasks/tasks.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [PrismaModule, WhatsappModule, TasksModule, CalendarModule],
  providers: [AdminBotService],
  exports: [AdminBotService],
})
export class AdminBotModule {}
