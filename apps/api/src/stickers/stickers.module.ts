import { Module, forwardRef } from '@nestjs/common';
import { StickersController } from './stickers.controller';
import { StickersService } from './stickers.service';
import { MediaModule } from '../media/media.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { GatewayModule } from '../gateway/gateway.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * Biblioteca compartilhada de figurinhas (stickers) do escritorio.
 * Importa MediaModule (FileStorage), WhatsappModule (Evolution sendSticker)
 * e GatewayModule (emitir nova mensagem ao enviar sticker da biblioteca).
 */
@Module({
  imports: [
    MediaModule,
    WhatsappModule,
    forwardRef(() => GatewayModule),
    SettingsModule,
  ],
  controllers: [StickersController],
  providers: [StickersService],
})
export class StickersModule {}
