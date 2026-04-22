import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { CalendarModule } from '../calendar/calendar.module';
import { TasksModule } from '../tasks/tasks.module';
import { CaseDeadlinesModule } from '../case-deadlines/case-deadlines.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Events: facade que unifica cumprimento/cancelamento/adiamento dos 3
 * modelos (CalendarEvent, Task, CaseDeadline) em um unico endpoint.
 *
 * Depende de CalendarModule, TasksModule e CaseDeadlinesModule — todos
 * ja exportam seus services respectivos.
 */
@Module({
  imports: [CalendarModule, TasksModule, CaseDeadlinesModule, PrismaModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
