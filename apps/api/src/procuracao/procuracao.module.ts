import { Module } from '@nestjs/common';
import { ProcuracaoController } from './procuracao.controller';
import { ProcuracaoService } from './procuracao.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  controllers: [ProcuracaoController],
  providers: [ProcuracaoService],
  exports: [ProcuracaoService],
})
export class ProcuracaoModule {}
