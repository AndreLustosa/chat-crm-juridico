import { Module } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { TaxService } from './tax.service';
import { FinanceiroController } from './financeiro.controller';
import { FinancialDashboardService } from './financial-dashboard.service';
import { FinancialDashboardController } from './financial-dashboard.controller';
import { MonthlyGoalsService } from './monthly-goals.service';
import { MonthlyGoalsController } from './monthly-goals.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  controllers: [
    FinanceiroController,
    FinancialDashboardController,
    MonthlyGoalsController,
  ],
  providers: [
    FinanceiroService,
    TaxService,
    FinancialDashboardService,
    MonthlyGoalsService,
  ],
  exports: [
    FinanceiroService,
    TaxService,
    FinancialDashboardService,
    MonthlyGoalsService,
  ],
})
export class FinanceiroModule {}
