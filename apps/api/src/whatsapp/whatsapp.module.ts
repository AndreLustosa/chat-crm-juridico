import { Module, forwardRef } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { MeWhatsappController } from './me-whatsapp.controller';
import { MeWhatsappService } from './me-whatsapp.service';
import { SettingsModule } from '../settings/settings.module';
import { LeadsModule } from '../leads/leads.module';

@Module({
  imports: [forwardRef(() => SettingsModule), forwardRef(() => LeadsModule)],
  controllers: [WhatsappController, MeWhatsappController],
  providers: [WhatsappService, MeWhatsappService],
  exports: [WhatsappService]
})
export class WhatsappModule {}
