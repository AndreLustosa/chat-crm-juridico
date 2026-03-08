import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadsCleanupService } from './leads-cleanup.service';
import { LeadNotesService } from './lead-notes.service';
import { LeadNotesController } from './lead-notes.controller';
import { LegalCasesModule } from '../legal-cases/legal-cases.module';

@Module({
  imports: [LegalCasesModule],
  controllers: [LeadsController, LeadNotesController],
  providers: [LeadsService, LeadsCleanupService, LeadNotesService],
  exports: [LeadsService],
})
export class LeadsModule {}
