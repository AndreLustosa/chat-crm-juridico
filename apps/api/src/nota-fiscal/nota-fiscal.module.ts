import { Module, forwardRef } from '@nestjs/common';
import { NotaFiscalService } from './nota-fiscal.service';
import { NotaFiscalController } from './nota-fiscal.controller';
import { SettingsModule } from '../settings/settings.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';

@Module({
  imports: [forwardRef(() => SettingsModule), forwardRef(() => FinanceiroModule)],
  controllers: [NotaFiscalController],
  providers: [NotaFiscalService],
  exports: [NotaFiscalService],
})
export class NotaFiscalModule {}
