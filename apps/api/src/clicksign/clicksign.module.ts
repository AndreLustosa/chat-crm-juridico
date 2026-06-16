import { Module } from '@nestjs/common';
import { ClicksignController, ClicksignWebhookController, ProcuracaoSignatureController } from './clicksign.controller';
import { ClicksignService } from './clicksign.service';
import { MediaModule } from '../media/media.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { GatewayModule } from '../gateway/gateway.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ProcuracaoModule } from '../procuracao/procuracao.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [MediaModule, WhatsappModule, GatewayModule, ContractsModule, ProcuracaoModule, SettingsModule],
  controllers: [ClicksignController, ClicksignWebhookController, ProcuracaoSignatureController],
  providers: [ClicksignService],
  exports: [ClicksignService],
})
export class ClicksignModule {}
