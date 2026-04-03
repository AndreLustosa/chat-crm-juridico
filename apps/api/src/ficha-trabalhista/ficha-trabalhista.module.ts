import { Module, forwardRef } from '@nestjs/common';
import { FichaTrabalhistaController } from './ficha-trabalhista.controller';
import { FichaTrabalhistaService } from './ficha-trabalhista.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => WhatsappModule), SettingsModule],
  controllers: [FichaTrabalhistaController],
  providers: [FichaTrabalhistaService],
  exports: [FichaTrabalhistaService],
})
export class FichaTrabalhistaModule {}
