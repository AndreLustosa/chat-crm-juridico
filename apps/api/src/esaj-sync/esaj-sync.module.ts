import { Module, forwardRef } from '@nestjs/common';
import { EsajSyncController } from './esaj-sync.controller';
import { EsajSyncService } from './esaj-sync.service';
import { EsajRehydrateCronService } from './esaj-rehydrate-cron.service';
import { SettingsModule } from '../settings/settings.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => WhatsappModule),
  ],
  controllers: [EsajSyncController],
  providers: [EsajSyncService, EsajRehydrateCronService],
  exports: [EsajSyncService, EsajRehydrateCronService],
})
export class EsajSyncModule {}
