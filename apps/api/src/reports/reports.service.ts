import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialDashboardService } from '../financeiro/financial-dashboard.service';
import { MonthlyGoalsService } from '../financeiro/monthly-goals.service';
import {
  buildDashboardSnapshotPdf,
  DashboardSnapshotData,
} from './templates/dashboard-snapshot';

/**
 * ReportsService — orquestra geração de PDFs.
 *
 * Cada método pública agrupa: (1) coleta de dados via services existentes
 * (FinancialDashboardService, MonthlyGoalsService, etc), (2) chamada ao
 * template correspondente, (3) retorno do Buffer pra o controller.
 *
 * Templates ficam em `templates/` — um arquivo por relatório, todos usando
 * o mesmo `base-template.ts` pra cabeçalho/rodapé/cards/tabelas.
 */

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private dashboardService: FinancialDashboardService,
    private goalsService: MonthlyGoalsService,
  ) {}

  // ─── Dashboard Snapshot ───────────────────────────────

  async generateDashboardSnapshot(params: {
    tenantId?: string;
    actorId: string;
    actorName: string;
    from: string;
    to: string;
    lawyerId?: string;
    lawyerName?: string;
    compare?: 'previous-month' | 'previous-year';
    includeCharts?: boolean;
    includeDetailTable?: boolean;
    observations?: string;
    orientation?: 'portrait' | 'landscape';
  }): Promise<Buffer> {
    const {
      tenantId, actorName, from, to, lawyerId, lawyerName,
      compare = 'previous-month',
      includeCharts, includeDetailTable, observations, orientation,
    } = params;

    // Coleta paralela: KPIs (que ja tem MoM), aging, by-lawyer, charges, goal
    const [kpis, aging, byLawyer, chargesPage, goalSummary] = await Promise.all([
      this.dashboardService.getKpis(tenantId, from, to, compare, lawyerId),
      this.dashboardService.getAging(tenantId, lawyerId),
      this.dashboardService.getRevenueByLawyer(tenantId, from, to),
      this.dashboardService.getOperationalCharges({
        tenantId, lawyerId, filter: 'overdue', pageSize: 100, page: 1,
      }),
      this.goalsService.getCurrentMonthSummary({
        tenantId,
        scope: lawyerId || 'OFFICE',
        kind: 'REALIZED',
      }),
    ]);

    // Período label
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const periodLabel = formatPeriodLabel(fromDate, toDate);
    const comparedLabel = formatPeriodLabel(
      new Date(kpis.period.comparedTo.from),
      new Date(kpis.period.comparedTo.to),
    );

    // Calcula MoM do balance manualmente (KPIs nao retorna deltaPct dele)
    const balanceCurrent = kpis.balance.value;
    const balancePrevious = kpis.balance.previous;
    const balanceDelta =
      balancePrevious !== 0
        ? ((balanceCurrent - balancePrevious) / Math.abs(balancePrevious)) * 100
        : balanceCurrent === 0 ? 0 : null;

    const data: DashboardSnapshotData = {
      period: { from, to, label: periodLabel },
      comparedTo: { label: comparedLabel },
      scopeLabel: lawyerId ? `Advogado: ${lawyerName || lawyerId}` : 'Todos os advogados',
      generatedBy: actorName,
      kpis: {
        revenue: { value: kpis.revenue.value, previous: kpis.revenue.previous, deltaPct: kpis.revenue.deltaPct },
        expenses: { value: kpis.expenses.value, previous: kpis.expenses.previous, deltaPct: kpis.expenses.deltaPct },
        balance: { value: balanceCurrent, previous: balancePrevious },
        receivable: {
          value: kpis.receivable.value,
          dueValue: kpis.receivable.dueValue,
          overdueValue: kpis.receivable.overdueValue,
        },
      },
      monthOverMonth: {
        revenue: { current: kpis.revenue.value, previous: kpis.revenue.previous, deltaPct: kpis.revenue.deltaPct },
        expenses: { current: kpis.expenses.value, previous: kpis.expenses.previous, deltaPct: kpis.expenses.deltaPct },
        balance: { current: balanceCurrent, previous: balancePrevious, deltaPct: balanceDelta },
      },
      aging: aging.map((b) => ({ label: b.label, total: b.total, count: b.count })),
      byLawyer: byLawyer.map((l) => ({ lawyerName: l.lawyerName, revenue: l.revenue })),
      pendingCharges: chargesPage.items.slice(0, 50).map((c) => ({
        leadName: c.leadName || '—',
        caseNumber: c.caseNumber,
        dueDate: c.dueDate,
        amount: c.amount,
        status: c.status,
        asaasStatus: asaasStatusLabel(c.gatewayCharge?.status),
      })),
      goalSummary:
        goalSummary && goalSummary.hasGoal && goalSummary.target != null
          ? {
              target: goalSummary.target,
              realized: goalSummary.realized,
              progressPct: goalSummary.progressPct || 0,
            }
          : null,
      includeCharts,
      includeDetailTable,
      observations,
      orientation,
    };

    return buildDashboardSnapshotPdf(data);
  }
}

// ─── Helpers ────────────────────────────────────────────

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function formatPeriodLabel(from: Date, to: Date): string {
  const sameMonth =
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCFullYear() === to.getUTCFullYear();
  if (sameMonth) {
    return `${MONTH_NAMES[from.getUTCMonth()]}/${from.getUTCFullYear()}`;
  }
  return `${String(from.getUTCDate()).padStart(2, '0')}/${String(from.getUTCMonth() + 1).padStart(2, '0')}/${from.getUTCFullYear()} a ${String(to.getUTCDate()).padStart(2, '0')}/${String(to.getUTCMonth() + 1).padStart(2, '0')}/${to.getUTCFullYear()}`;
}

function asaasStatusLabel(status?: string | null): string {
  if (!status) return 'Não gerada';
  const s = status.toUpperCase();
  if (s === 'RECEIVED' || s === 'CONFIRMED' || s === 'RECEIVED_IN_CASH') return 'Paga';
  if (s === 'OVERDUE') return 'Vencida';
  if (s === 'CANCELLED' || s === 'DELETED') return 'Cancelada';
  if (s === 'REFUNDED' || s === 'REFUND_REQUESTED' || s === 'REFUND_IN_PROGRESS') return 'Estornada';
  if (s === 'PENDING') return 'Pendente';
  return s;
}
