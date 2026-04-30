import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LegalCasesController } from './legal-cases.controller';
import { LegalCasesService } from './legal-cases.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CalendarModule } from '../calendar/calendar.module';
import { TrafegoModule } from '../trafego/trafego.module';

@Module({
  imports: [
    forwardRef(() => WhatsappModule),
    CalendarModule,
    TrafegoModule,
    BullModule.registerQueue({ name: 'followup-jobs' }),
  ],
  controllers: [LegalCasesController],
  providers: [LegalCasesService],
  exports: [LegalCasesService],
})
export class LegalCasesModule {}
