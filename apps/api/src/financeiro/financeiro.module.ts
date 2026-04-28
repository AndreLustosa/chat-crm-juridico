import { Module } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { TaxService } from './tax.service';
import { FinanceiroController } from './financeiro.controller';
import { FinancialDashboardService } from './financial-dashboard.service';
import { FinancialDashboardController } from './financial-dashboard.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  controllers: [FinanceiroController, FinancialDashboardController],
  providers: [FinanceiroService, TaxService, FinancialDashboardService],
  exports: [FinanceiroService, TaxService, FinancialDashboardService],
})
export class FinanceiroModule {}
