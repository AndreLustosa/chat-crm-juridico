import { Module } from '@nestjs/common';
import { AfterHoursService } from './after-hours.service';

@Module({
  providers: [AfterHoursService],
  exports: [AfterHoursService],
})
export class AfterHoursModule {}
