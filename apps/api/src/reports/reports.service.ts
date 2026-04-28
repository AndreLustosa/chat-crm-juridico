import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialDashboardService } from '../financeiro/financial-dashboard.service';
import { MonthlyGoalsService } from '../financeiro/monthly-goals.service';
import {
  buildDashboardSnapshotPdf,
  DashboardSnapshotData,
} from './templates/dashboard-snapshot';
import { buildStatementPdf, StatementData, StatementRow } from './templates/transactions-statement';
import { buildChargesListPdf, ChargesListData } from './templates/charges-list';

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

  // ─── Extrato de Receitas ou Despesas ─────────────────────

  async generateTransactionsStatement(params: {
    tenantId?: string;
    actorName: string;
    type: 'RECEITA' | 'DESPESA';
    from: string;
    to: string;
    lawyerId?: string;
    lawyerName?: string;
    observations?: string;
    summaryOnly?: boolean;
    orientation?: 'portrait' | 'landscape';
  }): Promise<Buffer> {
    const { tenantId, type, from, to, lawyerId, lawyerName } = params;
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Where com filtro de lawyer (mantem mesma logica do financeiro.service)
    const where: any = {
      type,
      status: { not: 'CANCELADO' },
      date: { gte: fromDate, lte: toDate },
    };
    if (tenantId) where.tenant_id = tenantId;
    if (lawyerId && type === 'RECEITA') where.lawyer_id = lawyerId;
    if (lawyerId && type === 'DESPESA') {
      where.OR = [{ lawyer_id: lawyerId }, { lawyer_id: null, visible_to_lawyer: true }];
    }

    const txs = await this.prisma.financialTransaction.findMany({
      where,
      include: {
        lead: { select: { name: true } },
        legal_case: { select: { case_number: true, lead: { select: { name: true } } } },
      },
      orderBy: { date: 'asc' },
      take: 1000, // limite de seguranca
    });

    const rows: StatementRow[] = txs.map((t: any) => ({
      date: t.date.toISOString(),
      category: t.category || '—',
      description: t.description || '',
      counterpart:
        t.lead?.name ||
        t.legal_case?.lead?.name ||
        (type === 'DESPESA' ? '—' : '—'),
      status: t.status,
      amount: Number(t.amount),
      paidAt: t.paid_at?.toISOString() || null,
      dueDate: t.due_date?.toISOString() || null,
    }));

    // Totalizadores
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const totals = rows.reduce(
      (acc, r) => {
        acc.gross += r.amount;
        if (r.status === 'PAGO') acc.paid += r.amount;
        if (r.status === 'PENDENTE') {
          acc.pending += r.amount;
          if (r.dueDate) {
            const dd = new Date(r.dueDate); dd.setHours(0, 0, 0, 0);
            if (dd < today) acc.overdue += r.amount;
          }
        }
        return acc;
      },
      { gross: 0, paid: 0, pending: 0, overdue: 0 },
    );

    const data: StatementData = {
      type,
      period: { from, to, label: formatPeriodLabel(fromDate, toDate) },
      scopeLabel: lawyerId ? `Advogado: ${lawyerName || lawyerId}` : 'Todos os advogados',
      generatedBy: params.actorName,
      rows,
      totals,
      observations: params.observations,
      summaryOnly: params.summaryOnly,
      orientation: params.orientation,
    };
    return buildStatementPdf(data);
  }

  // ─── Lista de Cobrancas ─────────────────────────────────

  async generateChargesList(params: {
    tenantId?: string;
    actorName: string;
    filter: 'all' | 'overdue' | 'pending' | 'paid' | 'awaiting_alvara' | 'no_cpf' | 'to_send' | 'due_today';
    lawyerId?: string;
    lawyerName?: string;
    observations?: string;
  }): Promise<Buffer> {
    const { tenantId, filter, lawyerId, lawyerName } = params;

    // Pega ate 200 cobrancas pra o relatorio
    const chargesPage = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter, page: 1, pageSize: 200,
    });

    // Counts agregados (mesma chamada do dashboard)
    const counts = await this.dashboardService.getChargesCounts({ tenantId, lawyerId });

    // Soma totais por status (sub-amostragem dos primeiros 500 - pra tela executiva)
    const allOverdue = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter: 'overdue', page: 1, pageSize: 500,
    });
    const allPending = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter: 'pending', page: 1, pageSize: 500,
    });
    const allPaid = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter: 'paid', page: 1, pageSize: 500,
    });

    const totalsByStatus = {
      overdue: allOverdue.items.reduce((s, c) => s + c.amount, 0),
      pending: allPending.items.reduce((s, c) => s + c.amount, 0),
      paid: allPaid.items.reduce((s, c) => s + c.amount, 0),
    };

    const filterLabels: Record<string, string> = {
      all: 'Todas as cobranças',
      overdue: 'Atrasadas',
      pending: 'A vencer',
      paid: 'Pagas',
      awaiting_alvara: 'Aguardando alvará',
      no_cpf: 'Sem CPF cadastrado',
      to_send: 'A enviar',
      due_today: 'Vencendo hoje',
    };

    const data: ChargesListData = {
      filterLabel: filterLabels[filter] || filter,
      scopeLabel: lawyerId ? `Advogado: ${lawyerName || lawyerId}` : 'Todos os advogados',
      generatedBy: params.actorName,
      rows: chargesPage.items.map((c) => ({
        leadName: c.leadName || '—',
        leadCpf: c.leadCpf,
        caseNumber: c.caseNumber,
        legalArea: c.legalArea,
        dueDate: c.dueDate,
        amount: c.amount,
        paymentStatus: paymentStatusLabel(c.status, c.dueDate),
        asaasStatus: asaasStatusLabel(c.gatewayCharge?.status),
        lawyerName: c.lawyerName,
      })),
      counts: {
        overdue: counts.overdue || 0,
        pending: counts.pending || 0,
        awaitingAlvara: counts.awaiting_alvara || 0,
        paid: counts.paid || 0,
      },
      totals: totalsByStatus,
      observations: params.observations,
    };

    return buildChargesListPdf(data);
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

function paymentStatusLabel(status: string, dueDate: string | null): string {
  if (status === 'PAGO') return 'Pago';
  if (status === 'CANCELADO') return 'Cancelado';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dueDate) {
    const dt = new Date(dueDate); dt.setHours(0, 0, 0, 0);
    if (dt < today) return 'Atrasado';
    if (dt.getTime() === today.getTime()) return 'Vence hoje';
  }
  return 'A vencer';
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
