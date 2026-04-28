import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cashRegimeWhere, effectiveTransactionDate } from '../common/utils/cash-regime.util';

/**
 * Tipos de filtro suportados pela tabela operacional (Layer 4).
 *
 * Adicionados em B3 (refinamento visual com tabs+contadores):
 *  - no_cpf: leads sem cpf_cnpj com cobranca pendente
 *  - to_send: PENDENTE com lead com CPF mas sem gateway_charge ainda
 *  - due_today: due_date == hoje (acionavel)
 */
export type ChargeFilter =
  | 'all'
  | 'overdue'
  | 'pending'
  | 'paid'
  | 'awaiting_alvara'
  | 'no_cpf'
  | 'to_send'
  | 'due_today';

/**
 * Service novo do dashboard financeiro (cockpit).
 *
 * Coexiste com FinanceiroService (legado) — endpoints antigos continuam
 * funcionando. Este service alimenta a nova UI em /financeiro:
 *  - Banner de ações urgentes
 *  - KPIs com sparkline + comparação MoM
 *  - Análises (por advogado, aging, por área, forecast)
 *  - Tabela operacional de cobranças
 *
 * Convenções:
 *  - Multi-tenant: tenantId sempre filtra; null = single-tenant.
 *  - "A receber" só inclui parcelas com due_date ≠ null (alvará/sucumbência
 *    sem data NÃO entra em previsão — vai pro card "aguardando alvará").
 *  - Aggregator usa regime de caixa (paid_at) pra receita realizada.
 *  - Lawyer isolation: passe lawyerId pra restringir a um único usuário.
 */
@Injectable()
export class FinancialDashboardService {
  private readonly logger = new Logger(FinancialDashboardService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private addDays(d: Date, n: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  private firstOfMonth(year: number, monthIdx0: number): Date {
    return new Date(Date.UTC(year, monthIdx0, 1));
  }

  private lastOfMonth(year: number, monthIdx0: number): Date {
    return new Date(Date.UTC(year, monthIdx0 + 1, 0, 23, 59, 59, 999));
  }

  /** Constrói where comum pra parcelas case (com filtro de lawyer e tenant). */
  private buildCaseHonorarioWhere(tenantId?: string, lawyerId?: string) {
    const where: any = {};
    if (lawyerId || tenantId) {
      where.honorario = {};
      if (tenantId) where.honorario.tenant_id = tenantId;
      if (lawyerId) where.honorario.legal_case = { lawyer_id: lawyerId };
    }
    return where;
  }

  /** Constrói where comum pra parcelas lead (negociadas). */
  private buildLeadHonorarioWhere(tenantId?: string) {
    const where: any = {
      lead_honorario: { status: { in: ['NEGOCIANDO', 'ACEITO'] } },
    };
    if (tenantId) where.lead_honorario.tenant_id = tenantId;
    return where;
  }

  // ─── Layer 1: Urgent Actions Banner ───────────────────────

  /**
   * Retorna ações urgentes (não-acionável → não aparece).
   * Categorias:
   *  - overdue7d: parcelas com due_date < hoje-7d (alta prioridade)
   *  - overdueToday: vencendo hoje sem cobrança gerada
   *  - awaitingAlvara: parcelas sem due_date (sucumbência/alvará)
   *  - withoutCpf: leads com cobranças mas sem CPF cadastrado
   */
  async getUrgentActions(tenantId?: string, lawyerId?: string) {
    const today = this.startOfDay(new Date());

    const caseWhere = this.buildCaseHonorarioWhere(tenantId, lawyerId);
    const leadWhere = this.buildLeadHonorarioWhere(tenantId);

    // A1 — Conciliação: "atrasado" agora = TUDO com due_date < hoje e nao pago.
    // Antes era so "7+ dias" o que fazia banner divergir do aging. Agora bate.
    const [overdueAllCase, overdueAllLead, overdueTodayCase, overdueTodayLead, awaitingCase, awaitingLead] =
      await Promise.all([
        // Atrasadas TOTAIS (case) — todas as faixas vencidas
        this.prisma.honorarioPayment.aggregate({
          where: {
            ...caseWhere,
            status: { in: ['PENDENTE', 'ATRASADO'] },
            due_date: { not: null, lt: today },
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        // Atrasadas TOTAIS (lead)
        this.prisma.leadHonorarioPayment.aggregate({
          where: {
            ...leadWhere,
            status: { in: ['PENDENTE', 'ATRASADO'] },
            due_date: { not: null, lt: today },
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        // Vencendo hoje (case)
        this.prisma.honorarioPayment.aggregate({
          where: {
            ...caseWhere,
            status: 'PENDENTE',
            due_date: { gte: today, lt: this.addDays(today, 1) },
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        // Vencendo hoje (lead)
        this.prisma.leadHonorarioPayment.aggregate({
          where: {
            ...leadWhere,
            status: 'PENDENTE',
            due_date: { gte: today, lt: this.addDays(today, 1) },
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        // Aguardando alvará (case)
        this.prisma.honorarioPayment.aggregate({
          where: {
            ...caseWhere,
            status: { in: ['PENDENTE', 'ATRASADO'] },
            due_date: null,
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        // Aguardando alvará (lead)
        this.prisma.leadHonorarioPayment.aggregate({
          where: {
            ...leadWhere,
            status: { in: ['PENDENTE', 'ATRASADO'] },
            due_date: null,
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);

    // Leads com cobranças sem CPF — usa PaymentGatewayCustomer por leadId
    // mas o problema real é Lead.cpf_cnpj null que impede emissão.
    // Pega leads que têm gateway charges PENDING e Lead.cpf_cnpj NULL.
    const leadsWithoutCpf = await this.prisma.lead.count({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        cpf_cnpj: null,
        OR: [
          {
            legal_cases: {
              some: {
                ...(lawyerId ? { lawyer_id: lawyerId } : {}),
                gateway_charges: {
                  some: { status: { in: ['PENDING', 'OVERDUE'] } },
                },
              },
            },
          },
          {
            lead_honorarios: {
              some: {
                payments: {
                  some: { gateway_charge: { is: { status: { in: ['PENDING', 'OVERDUE'] } } } },
                },
              },
            },
          },
        ],
      },
    });

    const overdue = {
      count: (overdueAllCase._count?._all || 0) + (overdueAllLead._count?._all || 0),
      total:
        Number(overdueAllCase._sum.amount || 0) + Number(overdueAllLead._sum.amount || 0),
    };
    const overdueToday = {
      count: (overdueTodayCase._count?._all || 0) + (overdueTodayLead._count?._all || 0),
      total:
        Number(overdueTodayCase._sum.amount || 0) + Number(overdueTodayLead._sum.amount || 0),
    };
    const awaitingAlvara = {
      count: (awaitingCase._count?._all || 0) + (awaitingLead._count?._all || 0),
      total: Number(awaitingCase._sum.amount || 0) + Number(awaitingLead._sum.amount || 0),
    };

    return {
      // overdue7d removido — usar apenas overdue (todas faixas) pra bater
      // com aging e KPI breakdown. Mantido legacy `overdue7d` apontando pro
      // mesmo objeto pra UI antiga em transicao nao quebrar.
      overdue,
      overdue7d: overdue,
      overdueToday,
      awaitingAlvara,
      withoutCpf: { count: leadsWithoutCpf },
      // Quantidade total de itens acionáveis — útil pra mostrar/esconder banner.
      totalActionable:
        overdue.count + overdueToday.count + awaitingAlvara.count + leadsWithoutCpf,
    };
  }

  // ─── Layer 2: KPIs ────────────────────────────────────────

  /**
   * KPIs principais com comparação MoM e sparkline.
   *
   * @param compare 'previous-month' | 'previous-year' (default previous-month)
   */
  async getKpis(
    tenantId?: string,
    from?: string,
    to?: string,
    compare: 'previous-month' | 'previous-year' = 'previous-month',
    lawyerId?: string,
  ) {
    const now = new Date();
    const fromDate = from
      ? new Date(from)
      : this.firstOfMonth(now.getUTCFullYear(), now.getUTCMonth());
    const toDate = to
      ? new Date(to)
      : this.lastOfMonth(now.getUTCFullYear(), now.getUTCMonth());

    // Período de comparação
    let compFrom: Date, compTo: Date;
    if (compare === 'previous-year') {
      compFrom = new Date(fromDate);
      compFrom.setUTCFullYear(compFrom.getUTCFullYear() - 1);
      compTo = new Date(toDate);
      compTo.setUTCFullYear(compTo.getUTCFullYear() - 1);
    } else {
      // mês anterior — mesmo intervalo do mês passado
      compFrom = new Date(fromDate);
      compFrom.setUTCMonth(compFrom.getUTCMonth() - 1);
      compTo = new Date(toDate);
      compTo.setUTCMonth(compTo.getUTCMonth() - 1);
    }

    // Receita realizada (regime de caixa: paid_at na janela)
    const [revCurrent, revPrevious] = await Promise.all([
      this.aggregateRealizedRevenue(tenantId, fromDate, toDate, lawyerId),
      this.aggregateRealizedRevenue(tenantId, compFrom, compTo, lawyerId),
    ]);

    // A receber (com due_date) — snapshot do momento atual, sem janela
    const [receivable, receivablePrev, receivableDue, receivableOverdue] = await Promise.all([
      this.aggregateReceivable(tenantId, lawyerId, false),
      this.aggregateReceivable(tenantId, lawyerId, true), // "previous" mas só pra MoM diff aproximado
      // A1 — breakdown: a vencer (due_date >= today)
      this.aggregateReceivableByDueStatus(tenantId, lawyerId, 'due'),
      // A1 — breakdown: vencido (due_date < today)
      this.aggregateReceivableByDueStatus(tenantId, lawyerId, 'overdue'),
    ]);

    // Atrasado snapshot
    const overdue = await this.aggregateOverdue(tenantId, lawyerId);

    // Despesas no período
    const [expCurrent, expPrevious] = await Promise.all([
      this.aggregateExpenses(tenantId, fromDate, toDate, lawyerId),
      this.aggregateExpenses(tenantId, compFrom, compTo, lawyerId),
    ]);

    // Sparkline 7 dias (receita realizada por dia)
    const sparkline = await this.buildRevenueSparkline(tenantId, lawyerId, 7);

    // Meta do mês — só considera quando from/to é mês corrente fechado
    const monthlyGoal = await this.getCurrentMonthGoal(tenantId, fromDate, lawyerId);

    return {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        comparedTo: { from: compFrom.toISOString(), to: compTo.toISOString(), kind: compare },
      },
      revenue: {
        value: revCurrent,
        previous: revPrevious,
        deltaPct: this.deltaPct(revCurrent, revPrevious),
      },
      expenses: {
        value: expCurrent,
        previous: expPrevious,
        deltaPct: this.deltaPct(expCurrent, expPrevious),
      },
      balance: {
        value: revCurrent - expCurrent,
        previous: revPrevious - expPrevious,
      },
      receivable: {
        value: receivable,
        previous: receivablePrev,
        deltaPct: this.deltaPct(receivable, receivablePrev),
        // A1 — breakdown: separa "a vencer" do "vencido" pra UI mostrar
        // ambos abaixo do valor total. Soma dueValue+overdueValue == value.
        dueValue: receivableDue,
        overdueValue: receivableOverdue,
      },
      overdue: { value: overdue },
      sparkline,
      monthlyGoal,
    };
  }

  private async aggregateRealizedRevenue(
    tenantId?: string,
    from?: Date,
    to?: Date,
    lawyerId?: string,
  ): Promise<number> {
    // Regime de caixa: usa paid_at quando preenchido, fallback pra date.
    const where: any = {
      type: 'RECEITA',
      status: 'PAGO',
      ...(from && to ? cashRegimeWhere(from, to) : {}),
    };
    if (tenantId) where.tenant_id = tenantId;
    if (lawyerId) where.lawyer_id = lawyerId;

    const agg = await this.prisma.financialTransaction.aggregate({
      where,
      _sum: { amount: true },
    });
    return Number(agg._sum.amount || 0);
  }

  private async aggregateExpenses(
    tenantId?: string,
    from?: Date,
    to?: Date,
    lawyerId?: string,
  ): Promise<number> {
    // Despesas: regime de caixa (paid_at preenchido = data de saida real,
    // senao fallback pra date). Combina com filtro de lawyer via AND.
    const where: any = {
      type: 'DESPESA',
      status: 'PAGO',
    };
    if (tenantId) where.tenant_id = tenantId;

    const ands: any[] = [];
    if (lawyerId) {
      ands.push({
        OR: [{ lawyer_id: lawyerId }, { lawyer_id: null, visible_to_lawyer: true }],
      });
    }
    if (from && to) {
      ands.push(cashRegimeWhere(from, to));
    }
    if (ands.length > 0) where.AND = ands;

    const agg = await this.prisma.financialTransaction.aggregate({
      where,
      _sum: { amount: true },
    });
    return Number(agg._sum.amount || 0);
  }

  /**
   * A receber (snapshot atual) — só parcelas com due_date.
   *
   * @param previous se true, retorna snapshot 30 dias atrás (aproximado por
   *                 paid_at < hoje-30d → soma do que estava em aberto naquele
   *                 momento). Por simplicidade, usa hoje-30d como cutoff.
   */
  private async aggregateReceivable(
    tenantId?: string,
    lawyerId?: string,
    previous = false,
  ): Promise<number> {
    const cutoff = previous ? this.addDays(new Date(), -30) : new Date();

    const caseWhere = this.buildCaseHonorarioWhere(tenantId, lawyerId);
    const leadWhere = this.buildLeadHonorarioWhere(tenantId);

    const baseFilter: any = {
      status: { in: ['PENDENTE', 'ATRASADO'] },
      due_date: { not: null },
    };
    if (previous) {
      baseFilter.created_at = { lt: cutoff };
    }

    const [c, l] = await Promise.all([
      this.prisma.honorarioPayment.aggregate({
        where: { ...caseWhere, ...baseFilter },
        _sum: { amount: true },
      }),
      this.prisma.leadHonorarioPayment.aggregate({
        where: { ...leadWhere, ...baseFilter },
        _sum: { amount: true },
      }),
    ]);

    return Number(c._sum.amount || 0) + Number(l._sum.amount || 0);
  }

  /**
   * A1 — breakdown do "A receber" por status de vencimento.
   *  - 'due': due_date >= today (a vencer)
   *  - 'overdue': due_date < today (vencido)
   *
   * Soma 'due' + 'overdue' deve bater com aggregateReceivable().
   */
  private async aggregateReceivableByDueStatus(
    tenantId: string | undefined,
    lawyerId: string | undefined,
    kind: 'due' | 'overdue',
  ): Promise<number> {
    const today = this.startOfDay(new Date());
    const caseWhere = this.buildCaseHonorarioWhere(tenantId, lawyerId);
    const leadWhere = this.buildLeadHonorarioWhere(tenantId);

    const dueDate = kind === 'overdue' ? { not: null, lt: today } : { not: null, gte: today };

    const [c, l] = await Promise.all([
      this.prisma.honorarioPayment.aggregate({
        where: {
          ...caseWhere,
          status: { in: ['PENDENTE', 'ATRASADO'] },
          due_date: dueDate,
        },
        _sum: { amount: true },
      }),
      this.prisma.leadHonorarioPayment.aggregate({
        where: {
          ...leadWhere,
          status: { in: ['PENDENTE', 'ATRASADO'] },
          due_date: dueDate,
        },
        _sum: { amount: true },
      }),
    ]);

    return Number(c._sum.amount || 0) + Number(l._sum.amount || 0);
  }

  private async aggregateOverdue(tenantId?: string, lawyerId?: string): Promise<number> {
    const today = this.startOfDay(new Date());
    const caseWhere = this.buildCaseHonorarioWhere(tenantId, lawyerId);
    const leadWhere = this.buildLeadHonorarioWhere(tenantId);

    const [c, l] = await Promise.all([
      this.prisma.honorarioPayment.aggregate({
        where: {
          ...caseWhere,
          status: { in: ['PENDENTE', 'ATRASADO'] },
          due_date: { not: null, lt: today },
        },
        _sum: { amount: true },
      }),
      this.prisma.leadHonorarioPayment.aggregate({
        where: {
          ...leadWhere,
          status: { in: ['PENDENTE', 'ATRASADO'] },
          due_date: { not: null, lt: today },
        },
        _sum: { amount: true },
      }),
    ]);

    return Number(c._sum.amount || 0) + Number(l._sum.amount || 0);
  }

  /** Sparkline diária dos últimos N dias (receita realizada). */
  private async buildRevenueSparkline(
    tenantId?: string,
    lawyerId?: string,
    days = 7,
  ): Promise<Array<{ date: string; value: number }>> {
    const today = this.startOfDay(new Date());
    const start = this.addDays(today, -(days - 1));
    const end = this.addDays(today, 1);

    // Regime de caixa: filtra por paid_at quando preenchido, fallback date.
    const where: any = {
      type: 'RECEITA',
      status: 'PAGO',
      ...cashRegimeWhere(start, end),
    };
    if (tenantId) where.tenant_id = tenantId;
    if (lawyerId) where.lawyer_id = lawyerId;

    const txs = await this.prisma.financialTransaction.findMany({
      where,
      select: { date: true, amount: true, paid_at: true, status: true },
    });

    const map = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = this.addDays(start, i);
      map.set(d.toISOString().slice(0, 10), 0);
    }
    // Agrupa pela data efetiva (paid_at se preenchido, senao date)
    for (const tx of txs) {
      const refDate = effectiveTransactionDate(tx);
      const key = refDate.toISOString().slice(0, 10);
      if (map.has(key)) map.set(key, (map.get(key) || 0) + Number(tx.amount));
    }

    return Array.from(map.entries()).map(([date, value]) => ({ date, value }));
  }

  private deltaPct(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null; // null = "sem base"
    return ((current - previous) / previous) * 100;
  }

  // ─── Meta do mês (KPI Card — usa schema novo extendido) ───
  // Mantido aqui apenas pra alimentar o KPI grid do dashboard. O CRUD
  // completo migrou pra MonthlyGoalsService (3 dimensoes: escopo, tipo, modo).

  private async getCurrentMonthGoal(tenantId?: string, refDate?: Date, lawyerId?: string) {
    const ref = refDate || new Date();
    const year = ref.getUTCFullYear();
    const month = ref.getUTCMonth() + 1;

    // KPI card mostra meta REALIZED (caixa). Escopo: usuario filtrou advogado
    // -> meta dele; senao meta do escritorio (lawyer_id null).
    const goal = await this.prisma.monthlyGoal.findFirst({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : { tenant_id: null }),
        lawyer_id: lawyerId || null,
        year,
        month,
        kind: 'REALIZED',
        deleted_at: null,
      },
    });

    if (!goal) return null;

    // Receita realizada do mês inteiro
    const monthStart = this.firstOfMonth(year, month - 1);
    const monthEnd = this.lastOfMonth(year, month - 1);
    const realized = await this.aggregateRealizedRevenue(tenantId, monthStart, monthEnd, lawyerId);
    const target = Number(goal.value);
    const progressPct = target > 0 ? (realized / target) * 100 : 0;

    return {
      year,
      month,
      target,
      realized,
      progressPct,
    };
  }

  // ─── Layer 3: Análises ────────────────────────────────────

  /** Receita realizada por advogado no período (para gráfico de barras). */
  async getRevenueByLawyer(tenantId?: string, from?: string, to?: string) {
    const fromDate = from ? new Date(from) : this.firstOfMonth(new Date().getUTCFullYear(), new Date().getUTCMonth());
    const toDate = to ? new Date(to) : new Date();

    const where: any = {
      type: 'RECEITA',
      status: 'PAGO',
      date: { gte: fromDate, lte: toDate },
      lawyer_id: { not: null },
    };
    if (tenantId) where.tenant_id = tenantId;

    const grouped = await this.prisma.financialTransaction.groupBy({
      by: ['lawyer_id'],
      where,
      _sum: { amount: true },
    });

    // Buscar nomes dos advogados
    const lawyerIds = grouped.map((g) => g.lawyer_id).filter((x): x is string => !!x);
    const lawyers = await this.prisma.user.findMany({
      where: { id: { in: lawyerIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(lawyers.map((u) => [u.id, u.name]));

    return grouped
      .map((g) => ({
        lawyerId: g.lawyer_id!,
        lawyerName: nameMap.get(g.lawyer_id!) || 'Sem nome',
        revenue: Number(g._sum.amount || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  /** Aging buckets (parcelas em aberto agrupadas por idade da dívida). */
  async getAging(tenantId?: string, lawyerId?: string) {
    const today = this.startOfDay(new Date());

    const buckets = [
      { key: 'current', label: 'A vencer', from: today, to: null as Date | null },
      { key: 'overdue1to7', label: '1–7 dias', from: this.addDays(today, -7), to: today },
      { key: 'overdue8to30', label: '8–30 dias', from: this.addDays(today, -30), to: this.addDays(today, -8) },
      { key: 'overdue31to60', label: '31–60 dias', from: this.addDays(today, -60), to: this.addDays(today, -31) },
      { key: 'overdue60plus', label: '60+ dias', from: null as Date | null, to: this.addDays(today, -61) },
    ];

    const caseWhere = this.buildCaseHonorarioWhere(tenantId, lawyerId);
    const leadWhere = this.buildLeadHonorarioWhere(tenantId);

    // SEQUENCIAL — Promise.all de 5 buckets x 2 queries = 10 paralelas
    // saturava pool quando combinado com outros metodos do dashboard.
    // Sequencial gasta ~500ms a mais mas nao derruba a API.
    const results: Array<{ key: string; label: string; total: number; count: number }> = [];
    for (const b of buckets) {
      const dateFilter: any = {};
      if (b.from && b.to) {
        dateFilter.gte = b.from;
        dateFilter.lt = b.to;
      } else if (b.from && !b.to) {
        dateFilter.gte = b.from;
      } else if (!b.from && b.to) {
        dateFilter.lte = b.to;
      }
      // Se key=current, "a vencer" significa due_date >= today
      const dueDate = b.key === 'current' ? { gte: today } : { not: null, ...dateFilter };

      const c = await this.prisma.honorarioPayment.aggregate({
        where: { ...caseWhere, status: { in: ['PENDENTE', 'ATRASADO'] }, due_date: dueDate },
        _sum: { amount: true },
        _count: { _all: true },
      });
      const l = await this.prisma.leadHonorarioPayment.aggregate({
        where: { ...leadWhere, status: { in: ['PENDENTE', 'ATRASADO'] }, due_date: dueDate },
        _sum: { amount: true },
        _count: { _all: true },
      });

      results.push({
        key: b.key,
        label: b.label,
        total: Number(c._sum.amount || 0) + Number(l._sum.amount || 0),
        count: (c._count?._all || 0) + (l._count?._all || 0),
      });
    }

    return results;
  }

  /**
   * Receita por área jurídica (donut).
   *
   * @param type 'realized' = receita paga; 'contracted' = honorários totais
   *             (CaseHonorario.total_value) por área.
   */
  async getByArea(
    tenantId?: string,
    from?: string,
    to?: string,
    type: 'realized' | 'contracted' = 'realized',
  ) {
    if (type === 'contracted') {
      // Soma CaseHonorario.total_value agrupado por LegalCase.legal_area
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;

      const honorarios = await this.prisma.caseHonorario.findMany({
        where: {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          ...(fromDate || toDate
            ? {
                contract_date: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {}),
                },
              }
            : {}),
        },
        select: { total_value: true, legal_case: { select: { legal_area: true } } },
      });

      const map = new Map<string, number>();
      for (const h of honorarios) {
        const area = h.legal_case?.legal_area || 'Não classificada';
        map.set(area, (map.get(area) || 0) + Number(h.total_value));
      }
      return Array.from(map.entries())
        .map(([area, total]) => ({ area, total }))
        .sort((a, b) => b.total - a.total);
    }

    // realized — agrupa FinancialTransaction RECEITA paga por área via legal_case
    // Regime de caixa: paid_at quando preenchido, fallback pra date.
    const fromDate = from ? new Date(from) : this.firstOfMonth(new Date().getUTCFullYear(), new Date().getUTCMonth());
    const toDate = to ? new Date(to) : new Date();

    const txs = await this.prisma.financialTransaction.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        type: 'RECEITA',
        status: 'PAGO',
        ...cashRegimeWhere(fromDate, toDate),
      },
      select: {
        amount: true,
        legal_case: { select: { legal_area: true } },
      },
    });

    const map = new Map<string, number>();
    for (const tx of txs) {
      const area = tx.legal_case?.legal_area || 'Não classificada';
      map.set(area, (map.get(area) || 0) + Number(tx.amount));
    }
    return Array.from(map.entries())
      .map(([area, total]) => ({ area, total }))
      .sort((a, b) => b.total - a.total);
  }

  /**
   * Forecast de receita pros próximos N dias.
   *
   * Cenários:
   *  - optimistic: 100% das parcelas a vencer pagam na data
   *  - realistic:  85% das parcelas pagam (taxa histórica aproximada)
   *  - pessimistic: 60% das parcelas pagam
   */
  async getForecast(
    tenantId?: string,
    days = 90,
    scenario: 'optimistic' | 'realistic' | 'pessimistic' = 'realistic',
    lawyerId?: string,
  ) {
    const today = this.startOfDay(new Date());
    const end = this.addDays(today, days);

    const caseWhere = this.buildCaseHonorarioWhere(tenantId, lawyerId);
    const leadWhere = this.buildLeadHonorarioWhere(tenantId);

    const [casePayments, leadPayments] = await Promise.all([
      this.prisma.honorarioPayment.findMany({
        where: {
          ...caseWhere,
          status: 'PENDENTE',
          due_date: { gte: today, lte: end },
        },
        select: { amount: true, due_date: true },
        orderBy: { due_date: 'asc' },
      }),
      this.prisma.leadHonorarioPayment.findMany({
        where: {
          ...leadWhere,
          status: 'PENDENTE',
          due_date: { gte: today, lte: end },
        },
        select: { amount: true, due_date: true },
        orderBy: { due_date: 'asc' },
      }),
    ]);

    const factor = scenario === 'optimistic' ? 1 : scenario === 'realistic' ? 0.85 : 0.6;

    // Agrupa por semana (cada bucket = 7 dias)
    const buckets: Array<{ from: string; to: string; expected: number; raw: number }> = [];
    for (let offset = 0; offset < days; offset += 7) {
      const fromD = this.addDays(today, offset);
      const toD = this.addDays(today, Math.min(offset + 7, days));
      const inRange = (p: { due_date: Date | null }) =>
        p.due_date && p.due_date >= fromD && p.due_date < toD;
      const sumCase = casePayments
        .filter(inRange)
        .reduce((acc, p) => acc + Number(p.amount), 0);
      const sumLead = leadPayments
        .filter(inRange)
        .reduce((acc, p) => acc + Number(p.amount), 0);
      const raw = sumCase + sumLead;
      buckets.push({
        from: fromD.toISOString().slice(0, 10),
        to: toD.toISOString().slice(0, 10),
        expected: raw * factor,
        raw,
      });
    }

    const totalRaw = buckets.reduce((acc, b) => acc + b.raw, 0);
    const totalExpected = buckets.reduce((acc, b) => acc + b.expected, 0);

    return {
      scenario,
      days,
      buckets,
      summary: { raw: totalRaw, expected: totalExpected, factor },
    };
  }

  // ─── Layer 4: Tabela operacional ──────────────────────────

  /**
   * Lista cobranças/parcelas pra tabela operacional.
   *
   * Filtros: status (overdue, pending, paid, awaiting_alvara), search (nome/CPF),
   * lawyer, paginação.
   */
  /** Expoe o helper de buildChargeWhere pra outros services (Reports) */
  public buildChargeWhereExternal(filter: ChargeFilter, tenantId?: string, lawyerId?: string) {
    return this.buildChargeWhere(filter, tenantId, lawyerId);
  }

  /**
   * Tipo dos filtros suportados na tabela operacional.
   *
   * Adicionados em B3 (refinamento visual):
   *  - no_cpf: leads sem cpf_cnpj E status nao pago
   *  - to_send: pendente sem gateway charge (ainda precisa gerar)
   *  - due_today: due_date = hoje (acionavel hoje)
   */
  private buildChargeWhere(
    filter: ChargeFilter,
    tenantId?: string,
    lawyerId?: string,
  ): any {
    const today = this.startOfDay(new Date());
    const tomorrow = this.addDays(today, 1);

    const caseWhere: any = { honorario: {} };
    if (tenantId) caseWhere.honorario.tenant_id = tenantId;
    if (lawyerId) caseWhere.honorario.legal_case = { lawyer_id: lawyerId };

    if (filter === 'overdue') {
      caseWhere.status = { in: ['PENDENTE', 'ATRASADO'] };
      caseWhere.due_date = { not: null, lt: today };
    } else if (filter === 'pending') {
      caseWhere.status = 'PENDENTE';
      caseWhere.due_date = { not: null, gte: today };
    } else if (filter === 'paid') {
      caseWhere.status = 'PAGO';
    } else if (filter === 'awaiting_alvara') {
      caseWhere.status = { in: ['PENDENTE', 'ATRASADO'] };
      caseWhere.due_date = null;
    } else if (filter === 'no_cpf') {
      caseWhere.status = { in: ['PENDENTE', 'ATRASADO'] };
      caseWhere.honorario.legal_case = {
        ...(caseWhere.honorario.legal_case || {}),
        lead: { cpf_cnpj: null },
      };
    } else if (filter === 'to_send') {
      caseWhere.status = 'PENDENTE';
      caseWhere.gateway_charge = { is: null };
      // tem que ter lead com cpf (senao seria 'no_cpf')
      caseWhere.honorario.legal_case = {
        ...(caseWhere.honorario.legal_case || {}),
        lead: { cpf_cnpj: { not: null } },
      };
    } else if (filter === 'due_today') {
      caseWhere.status = 'PENDENTE';
      caseWhere.due_date = { gte: today, lt: tomorrow };
    } else {
      caseWhere.status = { in: ['PENDENTE', 'ATRASADO', 'PAGO'] };
    }
    return caseWhere;
  }

  /**
   * Espelho do buildChargeWhere para LeadHonorarioPayment.
   *
   * LeadHonorario nao tem legal_case nem lawyer — sao parcelas geradas na
   * fase de NEGOCIACAO (antes do contrato/processo). Por isso o filtro
   * lawyerId nao se aplica aqui (lead pertence ao tenant inteiro).
   *
   * Importante: leadHonorario.status precisa estar in (NEGOCIANDO, ACEITO)
   * pra parcela contar — proposta recusada/cancelada nao deve aparecer.
   */
  private buildLeadChargeWhere(
    filter: ChargeFilter,
    tenantId?: string,
    lawyerId?: string,
  ): any {
    const today = this.startOfDay(new Date());
    const tomorrow = this.addDays(today, 1);

    // Lead-charges nao tem advogado vinculado. Quando o filtro de advogado
    // esta ativo, retorna where impossivel pra excluir lead-charges do
    // resultado (mantem isolamento por advogado).
    if (lawyerId) {
      return { id: '__nope__' };
    }

    const leadWhere: any = {
      lead_honorario: { status: { in: ['NEGOCIANDO', 'ACEITO'] } },
    };
    if (tenantId) leadWhere.lead_honorario.tenant_id = tenantId;

    if (filter === 'overdue') {
      leadWhere.status = { in: ['PENDENTE', 'ATRASADO'] };
      leadWhere.due_date = { not: null, lt: today };
    } else if (filter === 'pending') {
      leadWhere.status = 'PENDENTE';
      leadWhere.due_date = { not: null, gte: today };
    } else if (filter === 'paid') {
      leadWhere.status = 'PAGO';
    } else if (filter === 'awaiting_alvara') {
      leadWhere.status = { in: ['PENDENTE', 'ATRASADO'] };
      leadWhere.due_date = null;
    } else if (filter === 'no_cpf') {
      leadWhere.status = { in: ['PENDENTE', 'ATRASADO'] };
      leadWhere.lead_honorario = {
        ...(leadWhere.lead_honorario || {}),
        lead: { cpf_cnpj: null },
      };
    } else if (filter === 'to_send') {
      leadWhere.status = 'PENDENTE';
      leadWhere.gateway_charge = { is: null };
      leadWhere.lead_honorario = {
        ...(leadWhere.lead_honorario || {}),
        lead: { cpf_cnpj: { not: null } },
      };
    } else if (filter === 'due_today') {
      leadWhere.status = 'PENDENTE';
      leadWhere.due_date = { gte: today, lt: tomorrow };
    } else {
      leadWhere.status = { in: ['PENDENTE', 'ATRASADO', 'PAGO'] };
    }
    return leadWhere;
  }

  /**
   * Conta itens por filtro pra tabs com contadores.
   * Cada filtro = 2 counts em paralelo (case + lead) somados.
   * Total: 8 filtros × 2 tabelas = 16 counts paralelos. Rapido em prod.
   */
  async getChargesCounts(params: { tenantId?: string; lawyerId?: string; search?: string }) {
    const { tenantId, lawyerId, search } = params;

    const filters: ChargeFilter[] = ['all', 'overdue', 'pending', 'paid', 'awaiting_alvara', 'no_cpf', 'to_send', 'due_today'];

    const counts = await Promise.all(
      filters.map(async (f) => {
        // Where do CASE
        let caseWhere: any = this.buildChargeWhere(f, tenantId, lawyerId);
        if (search) {
          const cleanCpfDigits = search.replace(/\D/g, '');
          const orFilters: any[] = [
            { honorario: { legal_case: { lead: { name: { contains: search, mode: 'insensitive' } } } } },
          ];
          if (cleanCpfDigits.length >= 3) {
            orFilters.push({
              honorario: { legal_case: { lead: { cpf_cnpj: { contains: cleanCpfDigits } } } },
            });
          }
          caseWhere = { AND: [caseWhere, { OR: orFilters }] };
        }

        // Where do LEAD
        let leadWhere: any = this.buildLeadChargeWhere(f, tenantId, lawyerId);
        if (search) {
          const cleanCpfDigits = search.replace(/\D/g, '');
          const orFilters: any[] = [
            { lead_honorario: { lead: { name: { contains: search, mode: 'insensitive' } } } },
          ];
          if (cleanCpfDigits.length >= 3) {
            orFilters.push({
              lead_honorario: { lead: { cpf_cnpj: { contains: cleanCpfDigits } } },
            });
          }
          leadWhere = { AND: [leadWhere, { OR: orFilters }] };
        }

        const [caseCount, leadCount] = await Promise.all([
          this.prisma.honorarioPayment.count({ where: caseWhere }),
          this.prisma.leadHonorarioPayment.count({ where: leadWhere }),
        ]);
        return [f, caseCount + leadCount] as const;
      }),
    );

    return Object.fromEntries(counts) as Record<ChargeFilter, number>;
  }

  async getOperationalCharges(params: {
    tenantId?: string;
    lawyerId?: string;
    filter?: ChargeFilter;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const {
      tenantId,
      lawyerId,
      filter = 'all',
      search,
      page = 1,
      pageSize = 20,
    } = params;

    const skip = Math.max(0, (page - 1) * pageSize);

    // Where do CASE
    const caseBaseWhere = this.buildChargeWhere(filter, tenantId, lawyerId);
    let caseFinalWhere: any = caseBaseWhere;
    if (search) {
      const cleanCpf = search.replace(/\D/g, '');
      const or: any[] = [
        { honorario: { legal_case: { lead: { name: { contains: search, mode: 'insensitive' } } } } },
      ];
      if (cleanCpf.length >= 3) {
        or.push({ honorario: { legal_case: { lead: { cpf_cnpj: { contains: cleanCpf } } } } });
      }
      caseFinalWhere = { AND: [caseBaseWhere, { OR: or }] };
    }

    // Where do LEAD
    const leadBaseWhere = this.buildLeadChargeWhere(filter, tenantId, lawyerId);
    let leadFinalWhere: any = leadBaseWhere;
    if (search) {
      const cleanCpf = search.replace(/\D/g, '');
      const or: any[] = [
        { lead_honorario: { lead: { name: { contains: search, mode: 'insensitive' } } } },
      ];
      if (cleanCpf.length >= 3) {
        or.push({ lead_honorario: { lead: { cpf_cnpj: { contains: cleanCpf } } } });
      }
      leadFinalWhere = { AND: [leadBaseWhere, { OR: or }] };
    }

    // Pra paginacao combinada (case + lead), trazemos ate (skip+pageSize)*2 de
    // cada lado, mesclamos, ordenamos por due_date e cortamos. Total real vem
    // de count separado pra mostrar "Pagina X de Y" correto.
    const fetchCap = (skip + pageSize) * 2;

    const [caseItems, leadItems, caseTotal, leadTotal] = await Promise.all([
      this.prisma.honorarioPayment.findMany({
        where: caseFinalWhere,
        include: {
          honorario: {
            include: {
              legal_case: {
                select: {
                  id: true,
                  case_number: true,
                  legal_area: true,
                  lead: { select: { id: true, name: true, phone: true, cpf_cnpj: true } },
                  lawyer: { select: { id: true, name: true } },
                },
              },
            },
          },
          gateway_charge: {
            select: {
              id: true, external_id: true, status: true, billing_type: true,
              invoice_url: true, boleto_url: true, pix_qr_code: true, pix_copy_paste: true,
              reminder_count: true, last_reminder_sent_at: true,
            },
          },
        },
        orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }],
        take: fetchCap,
      }),
      this.prisma.leadHonorarioPayment.findMany({
        where: leadFinalWhere,
        include: {
          lead_honorario: {
            select: {
              id: true,
              type: true,
              tenant_id: true,
              lead: { select: { id: true, name: true, phone: true, cpf_cnpj: true } },
            },
          },
          gateway_charge: {
            select: {
              id: true, external_id: true, status: true, billing_type: true,
              invoice_url: true, boleto_url: true, pix_qr_code: true, pix_copy_paste: true,
              reminder_count: true, last_reminder_sent_at: true,
            },
          },
        },
        orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }],
        take: fetchCap,
      }),
      this.prisma.honorarioPayment.count({ where: caseFinalWhere }),
      this.prisma.leadHonorarioPayment.count({ where: leadFinalWhere }),
    ]);

    // Normaliza ambos pro mesmo formato (kind discrimina origem)
    type Unified = {
      id: string;
      kind: 'case' | 'lead';
      amount: number;
      dueDate: string | null;
      status: string;
      paidAt: string | null;
      leadId: string | null;
      leadName: string | null;
      leadCpf: string | null;
      leadPhone: string | null;
      legalCaseId: string | null;
      caseNumber: string | null;
      legalArea: string | null;
      lawyerId: string | null;
      lawyerName: string | null;
      leadHonorarioType: string | null;
      gatewayCharge: any;
      _sortKey: number; // timestamp pra ordenacao em memoria
    };

    const caseNormalized: Unified[] = caseItems.map((p) => ({
      id: p.id,
      kind: 'case' as const,
      amount: Number(p.amount),
      dueDate: p.due_date?.toISOString() || null,
      status: p.status,
      paidAt: p.paid_at?.toISOString() || null,
      leadId: p.honorario?.legal_case?.lead?.id || null,
      leadName: p.honorario?.legal_case?.lead?.name || null,
      leadCpf: p.honorario?.legal_case?.lead?.cpf_cnpj || null,
      leadPhone: p.honorario?.legal_case?.lead?.phone || null,
      legalCaseId: p.honorario?.legal_case?.id || null,
      caseNumber: p.honorario?.legal_case?.case_number || null,
      legalArea: p.honorario?.legal_case?.legal_area || null,
      lawyerId: p.honorario?.legal_case?.lawyer?.id || null,
      lawyerName: p.honorario?.legal_case?.lawyer?.name || null,
      leadHonorarioType: null,
      gatewayCharge: p.gateway_charge || null,
      _sortKey: p.due_date ? p.due_date.getTime() : Number.MAX_SAFE_INTEGER,
    }));

    const leadNormalized: Unified[] = leadItems.map((p) => ({
      id: p.id,
      kind: 'lead' as const,
      amount: Number(p.amount),
      dueDate: p.due_date?.toISOString() || null,
      status: p.status,
      paidAt: p.paid_at?.toISOString() || null,
      leadId: p.lead_honorario?.lead?.id || null,
      leadName: p.lead_honorario?.lead?.name || null,
      leadCpf: p.lead_honorario?.lead?.cpf_cnpj || null,
      leadPhone: p.lead_honorario?.lead?.phone || null,
      legalCaseId: null,
      caseNumber: null,
      legalArea: null,
      lawyerId: null,
      lawyerName: null,
      leadHonorarioType: p.lead_honorario?.type || null,
      gatewayCharge: p.gateway_charge || null,
      _sortKey: p.due_date ? p.due_date.getTime() : Number.MAX_SAFE_INTEGER,
    }));

    // Mescla, ordena por due_date asc (nulls no fim), aplica skip+take em memoria
    const merged = [...caseNormalized, ...leadNormalized].sort(
      (a, b) => a._sortKey - b._sortKey,
    );
    const total = caseTotal + leadTotal;
    const pageItems = merged.slice(skip, skip + pageSize);

    // Remove o _sortKey do payload externo
    const items = pageItems.map(({ _sortKey, ...rest }) => rest);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ─── Inline CPF (atomic com rollback manual) ──────────────

  /**
   * Atualiza CPF do lead e tenta criar customer Asaas + cobrança.
   * Se Asaas falhar, faz rollback do Lead.cpf_cnpj.
   *
   * Por que não $transaction: criar customer Asaas é I/O externo, não
   * encaixa em transação Prisma (timeout, idempotência, etc).
   */
  async inlineCpf(params: {
    tenantId?: string;
    leadId: string;
    cpfCnpj: string;
    actorId: string;
  }) {
    const { tenantId, leadId, cpfCnpj, actorId } = params;
    const cleanCpf = (cpfCnpj || '').replace(/\D/g, '');

    if (!cleanCpf || (cleanCpf.length !== 11 && cleanCpf.length !== 14)) {
      throw new BadRequestException('CPF/CNPJ inválido');
    }

    // 1) Snapshot atual pra rollback
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...(tenantId ? { tenant_id: tenantId } : {}) },
      select: { id: true, cpf_cnpj: true, name: true, tenant_id: true },
    });
    if (!lead) throw new BadRequestException('Lead não encontrado');

    const previousCpf = lead.cpf_cnpj;

    // 2) Atualiza Lead.cpf_cnpj
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { cpf_cnpj: cleanCpf },
    });

    this.logger.log(`[INLINE_CPF] Lead ${leadId} CPF atualizado por ${actorId}`);

    // 3) Endpoint só atualiza o CPF — criação de customer/cobrança fica
    //    a cargo do PaymentGatewayService (chamado depois pela UI quando o
    //    usuário clicar em "Gerar Cobrança"). Isso evita acoplamento com
    //    AsaasClient aqui dentro do dashboard service.
    //
    //    Se quisermos rollback automático no futuro, basta chamar
    //    paymentGateway.ensureCustomer() aqui dentro de try/catch e reverter
    //    o cpf_cnpj em catch.

    return {
      success: true,
      leadId,
      cpfCnpj: cleanCpf,
      previousCpf,
    };
  }
}
