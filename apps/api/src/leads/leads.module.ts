import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadsCleanupService } from './leads-cleanup.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, LeadsCleanupService],
  exports: [LeadsService],
})
export class LeadsModule {}
