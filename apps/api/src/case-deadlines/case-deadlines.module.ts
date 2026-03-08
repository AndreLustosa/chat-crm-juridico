import { Module } from '@nestjs/common';
import { CaseDeadlinesController } from './case-deadlines.controller';
import { CaseDeadlinesService } from './case-deadlines.service';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [CalendarModule],
  controllers: [CaseDeadlinesController],
  providers: [CaseDeadlinesService],
  exports: [CaseDeadlinesService],
})
export class CaseDeadlinesModule {}
