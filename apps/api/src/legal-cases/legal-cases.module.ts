import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LegalCasesController } from './legal-cases.controller';
import { LegalCasesService } from './legal-cases.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    forwardRef(() => WhatsappModule),
    CalendarModule,
    // Fila memory-jobs usada para enfileirar re-consolidacao do LeadProfile
    // apos sincronizar movimentacoes do TJAL (endpoint resync-movements).
    BullModule.registerQueue({ name: 'memory-jobs' }),
  ],
  controllers: [LegalCasesController],
  providers: [LegalCasesService],
  exports: [LegalCasesService],
})
export class LegalCasesModule {}
