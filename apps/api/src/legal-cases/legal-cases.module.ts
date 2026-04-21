import { Module, forwardRef } from '@nestjs/common';
import { LegalCasesController } from './legal-cases.controller';
import { LegalCasesService } from './legal-cases.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [forwardRef(() => WhatsappModule), CalendarModule],
  controllers: [LegalCasesController],
  providers: [LegalCasesService],
  exports: [LegalCasesService],
})
export class LegalCasesModule {}
