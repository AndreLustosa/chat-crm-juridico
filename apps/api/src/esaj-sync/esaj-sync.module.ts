import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EsajSyncController } from './esaj-sync.controller';
import { EsajSyncService } from './esaj-sync.service';
import { SettingsModule } from '../settings/settings.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => WhatsappModule),
    // Fila memory-jobs para enfileirar re-consolidacao de LeadProfile
    // apos cron sync detectar movimentacoes novas (IA recebe contexto atualizado).
    BullModule.registerQueue({ name: 'memory-jobs' }),
  ],
  controllers: [EsajSyncController],
  providers: [EsajSyncService],
  exports: [EsajSyncService],
})
export class EsajSyncModule {}
