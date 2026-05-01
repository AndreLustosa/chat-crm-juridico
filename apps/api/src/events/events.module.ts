import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { CalendarModule } from '../calendar/calendar.module';
import { TasksModule } from '../tasks/tasks.module';
import { CaseDeadlinesModule } from '../case-deadlines/case-deadlines.module';
import { HonorariosModule } from '../honorarios/honorarios.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [CalendarModule, TasksModule, CaseDeadlinesModule, HonorariosModule, PrismaModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
