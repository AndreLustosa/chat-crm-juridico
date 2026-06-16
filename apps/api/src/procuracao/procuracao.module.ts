import { Module } from '@nestjs/common';
import { ProcuracaoController } from './procuracao.controller';
import { ProcuracaoService } from './procuracao.service';
import { MediaModule } from '../media/media.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [MediaModule, WhatsappModule, GatewayModule],
  controllers: [ProcuracaoController],
  providers: [ProcuracaoService],
  exports: [ProcuracaoService],
})
export class ProcuracaoModule {}
