import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LegalCasesController } from './legal-cases.controller';
import { LegalCasesService } from './legal-cases.service';
import { LegalCaseEnrichmentCronService } from './legal-case-enrichment.cron';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CalendarModule } from '../calendar/calendar.module';
import { TrafegoModule } from '../trafego/trafego.module';
import { CourtScraperModule } from '../court-scraper/court-scraper.module';

@Module({
  imports: [
    forwardRef(() => WhatsappModule),
    CalendarModule,
    TrafegoModule,
    CourtScraperModule,
    BullModule.registerQueue({ name: 'followup-jobs' }),
  ],
  controllers: [LegalCasesController],
  providers: [LegalCasesService, LegalCaseEnrichmentCronService],
  exports: [LegalCasesService],
})
export class LegalCasesModule {}
