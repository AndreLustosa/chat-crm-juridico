import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadsCleanupService } from './leads-cleanup.service';
import { LeadNotesService } from './lead-notes.service';
import { LeadNotesController } from './lead-notes.controller';
import { LeadHonorariosService } from './lead-honorarios.service';
import { LeadHonorariosController } from './lead-honorarios.controller';
import { LegalCasesModule } from '../legal-cases/legal-cases.module';
import { AutomationsModule } from '../automations/automations.module';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { TrafegoModule } from '../trafego/trafego.module';

@Module({
  imports: [LegalCasesModule, AutomationsModule, GoogleDriveModule, FinanceiroModule, TrafegoModule],
  controllers: [LeadsController, LeadNotesController, LeadHonorariosController],
  providers: [LeadsService, LeadsCleanupService, LeadNotesService, LeadHonorariosService],
  exports: [LeadsService],
})
export class LeadsModule {}
