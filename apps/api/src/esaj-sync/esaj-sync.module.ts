import { Module, forwardRef } from '@nestjs/common';
import { EsajSyncController } from './esaj-sync.controller';
import { EsajSyncService } from './esaj-sync.service';
import { SettingsModule } from '../settings/settings.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => WhatsappModule),
  ],
  controllers: [EsajSyncController],
  providers: [EsajSyncService],
  exports: [EsajSyncService],
})
export class EsajSyncModule {}
