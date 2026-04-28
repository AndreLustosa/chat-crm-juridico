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
import { buildDelinquencyPdf, DelinquencyData } from './templates/delinquency';
import { buildBillingByPeriodPdf, BillingByPeriodData } from './templates/billing-by-period';
import { buildLawyerPerformancePdf, LawyerPerformanceData } from './templates/lawyer-performance';

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

  // ─── Histórico de geração ─────────────────────────────

  /**
   * Registra um relatório gerado no histórico.
   * Não bloqueia o response — fire-and-forget é aceitável aqui.
   */
  async recordHistory(params: {
    tenantId?: string;
    userId: string;
    kind: string;
    displayName: string;
    payload: any;
  }) {
    try {
      await this.prisma.report.create({
        data: {
          tenant_id: params.tenantId || null,
          user_id: params.userId,
          kind: params.kind,
          display_name: params.displayName,
          params: params.payload,
        },
      });
    } catch (e) {
      this.logger.warn(`[REPORTS] historico falhou (silencioso): ${(e as Error).message}`);
    }
  }

  /** Lista histórico do tenant com paginação. */
  async listHistory(params: { tenantId?: string; userId?: string; limit?: number }) {
    const { tenantId, userId, limit = 50 } = params;
    return this.prisma.report.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        ...(userId ? { user_id: userId } : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { generated_at: 'desc' },
      take: limit,
    });
  }

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

    // Sequencial pra nao saturar o pool de conexoes
    const chargesPage = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter, page: 1, pageSize: 100,
    });

    const counts = await this.dashboardService.getChargesCounts({ tenantId, lawyerId });

    // Sub-amostragem reduzida pra totalizadores executivos
    const allOverdue = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter: 'overdue', page: 1, pageSize: 200,
    });
    const allPending = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter: 'pending', page: 1, pageSize: 200,
    });
    const allPaid = await this.dashboardService.getOperationalCharges({
      tenantId, lawyerId, filter: 'paid', page: 1, pageSize: 200,
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

  // ─── Inadimplencia detalhada (commit N) ───────────────

  async generateDelinquency(params: {
    tenantId?: string;
    actorName: string;
    lawyerId?: string;
    lawyerName?: string;
    observations?: string;
  }): Promise<Buffer> {
    const { tenantId, lawyerId, lawyerName } = params;

    // Aging via service existente
    const aging = await this.dashboardService.getAging(tenantId, lawyerId);

    // Top 10 inadimplentes — agrupa cobrancas vencidas por lead
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const overdueCharges = await this.prisma.honorarioPayment.findMany({
      where: {
        status: { in: ['PENDENTE', 'ATRASADO'] },
        due_date: { not: null, lt: today },
        ...(tenantId ? { honorario: { tenant_id: tenantId } } : {}),
        ...(lawyerId ? { honorario: { legal_case: { lawyer_id: lawyerId } } } : {}),
      },
      include: {
        honorario: {
          include: {
            legal_case: {
              select: {
                lead: { select: { id: true, name: true, cpf_cnpj: true } },
              },
            },
          },
        },
        gateway_charge: {
          select: { last_reminder_sent_at: true, last_reminder_kind: true },
        },
      },
      take: 300, // limite conservador — top 10 sai dessas 300
    });

    const byLead = new Map<string, {
      leadName: string; leadCpf: string | null; totalDue: number;
      oldestDue: Date | null; lastReminderAt: Date | null; lastReminderKind: string | null;
    }>();

    for (const p of overdueCharges) {
      const lead = (p as any).honorario?.legal_case?.lead;
      if (!lead) continue;
      const key = lead.id;
      const cur = byLead.get(key);
      const due = p.due_date!;
      const reminderAt = p.gateway_charge?.last_reminder_sent_at || null;
      const reminderKind = p.gateway_charge?.last_reminder_kind || null;
      if (cur) {
        cur.totalDue += Number(p.amount);
        if (!cur.oldestDue || due < cur.oldestDue) cur.oldestDue = due;
        if (reminderAt && (!cur.lastReminderAt || reminderAt > cur.lastReminderAt)) {
          cur.lastReminderAt = reminderAt;
          cur.lastReminderKind = reminderKind;
        }
      } else {
        byLead.set(key, {
          leadName: lead.name || '—',
          leadCpf: lead.cpf_cnpj,
          totalDue: Number(p.amount),
          oldestDue: due,
          lastReminderAt: reminderAt,
          lastReminderKind: reminderKind,
        });
      }
    }

    const topDelinquent = Array.from(byLead.values())
      .sort((a, b) => b.totalDue - a.totalDue)
      .slice(0, 10)
      .map((d) => ({
        leadName: d.leadName,
        leadCpf: d.leadCpf,
        totalDue: d.totalDue,
        oldestDueDate: d.oldestDue?.toISOString() || null,
        daysOverdue: d.oldestDue
          ? Math.max(0, Math.floor((today.getTime() - d.oldestDue.getTime()) / 86400000))
          : 0,
        lastReminderAt: d.lastReminderAt?.toISOString() || null,
        lastReminderKind: d.lastReminderKind,
      }));

    // Por status Asaas (agrupa via gateway_charge)
    const allCharges = await this.prisma.paymentGatewayCharge.groupBy({
      by: ['status'],
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      _count: { _all: true },
      _sum: { amount: true },
    });

    const byAsaasStatus = allCharges.map((g) => ({
      status: asaasStatusLabel(g.status),
      count: g._count._all,
      total: Number(g._sum.amount || 0),
    }));

    // Taxa de recuperacao: amostra cobrancas com due_date nos ultimos 12 meses
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const sample = await this.prisma.honorarioPayment.findMany({
      where: {
        due_date: { not: null, gte: yearAgo, lt: today },
        ...(tenantId ? { honorario: { tenant_id: tenantId } } : {}),
        ...(lawyerId ? { honorario: { legal_case: { lawyer_id: lawyerId } } } : {}),
      },
      select: { status: true, due_date: true, paid_at: true },
      take: 1000, // amostra reduzida — suficiente pra calcular taxa estatistica
    });

    let payed30 = 0, payed60 = 0, payed90 = 0;
    let totalSampleable = 0;
    for (const p of sample) {
      if (!p.due_date) continue;
      totalSampleable++;
      if (p.status === 'PAGO' && p.paid_at) {
        const daysLate = Math.max(0, Math.floor((p.paid_at.getTime() - p.due_date.getTime()) / 86400000));
        if (daysLate <= 30) payed30++;
        if (daysLate <= 60) payed60++;
        if (daysLate <= 90) payed90++;
      }
    }
    const recoveryRate = {
      payed30d: totalSampleable > 0 ? (payed30 / totalSampleable) * 100 : 0,
      payed60d: totalSampleable > 0 ? (payed60 / totalSampleable) * 100 : 0,
      payed90d: totalSampleable > 0 ? (payed90 / totalSampleable) * 100 : 0,
      sampleSize: totalSampleable,
    };

    const totalOverdueValue = aging
      .filter((b) => b.key && b.key !== 'current')
      .reduce((s, b) => s + b.total, 0);
    const totalPendingValue = aging.find((b) => b.key === 'current')?.total || 0;

    const data: DelinquencyData = {
      scopeLabel: lawyerId ? `Advogado: ${lawyerName || lawyerId}` : 'Todos os advogados',
      generatedBy: params.actorName,
      observations: params.observations,
      aging: aging.map((b) => ({ label: b.label, total: b.total, count: b.count })),
      topDelinquent,
      byAsaasStatus,
      recoveryRate,
      totals: { totalOverdue: totalOverdueValue, totalPending: totalPendingValue },
    };
    return buildDelinquencyPdf(data);
  }

  // ─── Faturamento por periodo ──────────────────────────

  async generateBillingByPeriod(params: {
    tenantId?: string;
    actorName: string;
    from: string;
    to: string;
    lawyerId?: string;
    lawyerName?: string;
    observations?: string;
  }): Promise<Buffer> {
    const { tenantId, lawyerId, lawyerName } = params;
    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);

    const where: any = {
      type: 'RECEITA',
      status: 'PAGO',
      ...(tenantId ? { tenant_id: tenantId } : {}),
    };
    if (lawyerId) where.lawyer_id = lawyerId;

    // Inclui cashRegimeWhere inline (para evitar import circular)
    where.OR = [
      { paid_at: { gte: fromDate, lte: toDate } },
      { AND: [{ paid_at: null }, { date: { gte: fromDate, lte: toDate } }] },
    ];

    const txs = await this.prisma.financialTransaction.findMany({
      where,
      select: { amount: true, date: true, paid_at: true, status: true },
      take: 2000, // limite conservador
    });

    const weekdayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const monthNames = MONTH_NAMES;

    const byWeekdayMap = new Map<number, { count: number; total: number }>();
    const byWeekMap = new Map<string, { count: number; total: number; weekStart: Date }>();
    const byMonthMap = new Map<string, { count: number; total: number; sortKey: string }>();
    const byQuarterMap = new Map<string, { count: number; total: number; sortKey: string }>();

    let totalGross = 0;
    for (const tx of txs) {
      const refDate = tx.status === 'PAGO' && tx.paid_at ? new Date(tx.paid_at) : new Date(tx.date);
      const amount = Number(tx.amount);
      totalGross += amount;

      // weekday
      const wd = refDate.getUTCDay();
      const wdEntry = byWeekdayMap.get(wd) || { count: 0, total: 0 };
      wdEntry.count++; wdEntry.total += amount;
      byWeekdayMap.set(wd, wdEntry);

      // week (Monday as start)
      const weekStart = startOfWeekISO(refDate);
      const weekKey = weekStart.toISOString().slice(0, 10);
      const wkEntry = byWeekMap.get(weekKey) || { count: 0, total: 0, weekStart };
      wkEntry.count++; wkEntry.total += amount;
      byWeekMap.set(weekKey, wkEntry);

      // month
      const monthKey = `${refDate.getUTCFullYear()}-${String(refDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const moEntry = byMonthMap.get(monthKey) || {
        count: 0,
        total: 0,
        sortKey: monthKey,
      };
      moEntry.count++; moEntry.total += amount;
      byMonthMap.set(monthKey, moEntry);

      // quarter
      const quarterIdx = Math.floor(refDate.getUTCMonth() / 3) + 1;
      const qKey = `${refDate.getUTCFullYear()}-Q${quarterIdx}`;
      const qEntry = byQuarterMap.get(qKey) || { count: 0, total: 0, sortKey: qKey };
      qEntry.count++; qEntry.total += amount;
      byQuarterMap.set(qKey, qEntry);
    }

    const data: BillingByPeriodData = {
      period: { from: params.from, to: params.to, label: formatPeriodLabel(fromDate, toDate) },
      scopeLabel: lawyerId ? `Advogado: ${lawyerName || lawyerId}` : 'Todos os advogados',
      generatedBy: params.actorName,
      observations: params.observations,
      byWeekday: Array.from(byWeekdayMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([wd, v]) => ({ weekday: weekdayNames[wd], count: v.count, total: v.total })),
      byWeek: Array.from(byWeekMap.values())
        .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
        .map((v) => ({ weekStart: v.weekStart.toISOString(), count: v.count, total: v.total })),
      byMonth: Array.from(byMonthMap.entries())
        .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
        .map(([k, v]) => {
          const [y, m] = k.split('-');
          return { month: `${monthNames[parseInt(m) - 1]}/${y}`, count: v.count, total: v.total };
        }),
      byQuarter: Array.from(byQuarterMap.values())
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map((v) => ({ quarter: v.sortKey, count: v.count, total: v.total })),
      totals: {
        gross: totalGross,
        transactionsCount: txs.length,
        avgTicket: txs.length > 0 ? totalGross / txs.length : 0,
      },
    };

    return buildBillingByPeriodPdf(data);
  }

  // ─── Performance por advogado ─────────────────────────

  async generateLawyerPerformance(params: {
    tenantId?: string;
    actorName: string;
    from: string;
    to: string;
    observations?: string;
  }): Promise<Buffer> {
    const { tenantId } = params;
    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);

    // Lista todos advogados do tenant
    const lawyers = await this.prisma.user.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        roles: { hasSome: ['ADVOGADO', 'ADMIN'] },
      },
      select: { id: true, name: true },
    });

    const today = new Date(); today.setHours(0, 0, 0, 0);

    // CRITICAL: SEQUENCIAL — Promise.all com N advogados × 4 queries
    // esgotava o pool de conexoes do Postgres (~10) e derrubava outras
    // requests (auth, conversas). Bug 2026-04-28: sistema desconectou.
    // Trade-off: mais lento (1-2s por advogado em vez de paralelo), mas
    // estavel. Pra 10 advogados, ~10s aceitavel pra um relatorio.
    const rows = [];
    for (const l of lawyers) {
      // Receita do periodo (regime de caixa, paid_at)
      const revenueAgg = await this.prisma.financialTransaction.aggregate({
        where: {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          lawyer_id: l.id,
          type: 'RECEITA',
          status: 'PAGO',
          OR: [
            { paid_at: { gte: fromDate, lte: toDate } },
            { AND: [{ paid_at: null }, { date: { gte: fromDate, lte: toDate } }] },
          ],
        },
        _sum: { amount: true },
      });

      // Casos (sequencial pra nao multiplicar por 2)
      const activeCases = await this.prisma.legalCase.count({
        where: { lawyer_id: l.id, archived: false, ...(tenantId ? { tenant_id: tenantId } : {}) },
      });
      const archivedCases = await this.prisma.legalCase.count({
        where: { lawyer_id: l.id, archived: true, ...(tenantId ? { tenant_id: tenantId } : {}) },
      });

      // Tempo medio de cobranca — amostra reduzida (50 em vez de 200)
      const paidCharges = await this.prisma.paymentGatewayCharge.findMany({
        where: {
          legal_case: { lawyer_id: l.id },
          status: { in: ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'] },
          paid_at: { not: null },
        },
        select: { created_at: true, paid_at: true },
        take: 50,
      });
      const avgPaymentDays = paidCharges.length > 0
        ? paidCharges.reduce((s, c) => {
            const days = Math.max(0, Math.floor(((c.paid_at as Date).getTime() - c.created_at.getTime()) / 86400000));
            return s + days;
          }, 0) / paidCharges.length
        : null;

      // Inadimplencia (sequencial)
      const overduePayments = await this.prisma.honorarioPayment.aggregate({
        where: {
          honorario: { legal_case: { lawyer_id: l.id }, ...(tenantId ? { tenant_id: tenantId } : {}) },
          status: { in: ['PENDENTE', 'ATRASADO'] },
          due_date: { not: null, lt: today },
        },
        _sum: { amount: true },
        _count: { _all: true },
      });
      const totalCarteira = await this.prisma.honorarioPayment.aggregate({
        where: {
          honorario: { legal_case: { lawyer_id: l.id }, ...(tenantId ? { tenant_id: tenantId } : {}) },
          status: { in: ['PENDENTE', 'ATRASADO', 'PAGO'] },
        },
        _sum: { amount: true },
      });
      const totalCarteiraValue = Number(totalCarteira._sum.amount || 0);
      const overdueValue = Number(overduePayments._sum.amount || 0);
      const delinquencyPct = totalCarteiraValue > 0 ? (overdueValue / totalCarteiraValue) * 100 : 0;

      const revenue = Number(revenueAgg._sum.amount || 0);

      rows.push({
        lawyerId: l.id,
        lawyerName: l.name,
        revenue,
        caseCount: activeCases,
        archivedCount: archivedCases,
        avgTicket: activeCases > 0 ? revenue / activeCases : 0,
        avgPaymentDays,
        delinquencyPct,
        delinquencyAmount: overdueValue,
      });
    }

    const sortedRows = rows
      .filter((r) => r.revenue > 0 || r.caseCount > 0) // pula advogados sem atividade
      .sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = sortedRows.reduce((s, r) => s + r.revenue, 0);
    const totalCases = sortedRows.reduce((s, r) => s + r.caseCount, 0);
    const overallAvgTicket = totalCases > 0 ? totalRevenue / totalCases : 0;

    const data: LawyerPerformanceData = {
      period: { from: params.from, to: params.to, label: formatPeriodLabel(fromDate, toDate) },
      generatedBy: params.actorName,
      observations: params.observations,
      rows: sortedRows,
      totals: { totalRevenue, totalCases, overallAvgTicket },
    };

    return buildLawyerPerformancePdf(data);
  }
}

// Helper local pra startOfWeek (segunda)
function startOfWeekISO(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // segunda
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + diff);
  r.setUTCHours(0, 0, 0, 0);
  return r;
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
