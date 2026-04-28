import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { FinanceiroModule } from '../financeiro/financeiro.module';

/**
 * Modulo de geracao de relatorios em PDF.
 *
 * Reaproveita FinancialDashboardService e MonthlyGoalsService pra coletar
 * dados — nao duplica logica de agregacao.
 *
 * Templates ficam em ./templates/ — um arquivo por relatorio.
 */
@Module({
  imports: [FinanceiroModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
