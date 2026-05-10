import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tenantOrDefault } from '../common/constants/tenant';

/**
 * Tabela progressiva do IRRF 2026 (Carnê-Leão)
 * Fonte: Receita Federal — valores atualizados anualmente
 */
const TAX_BRACKETS = [
  { min: 0,       max: 2259.20,   rate: 0,     deduction: 0 },
  { min: 2259.21, max: 2826.65,   rate: 7.5,   deduction: 169.44 },
  { min: 2826.66, max: 3751.05,   rate: 15,    deduction: 381.44 },
  { min: 3751.06, max: 4664.68,   rate: 22.5,  deduction: 662.77 },
  { min: 4664.69, max: Infinity,  rate: 27.5,  deduction: 896.00 },
];

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Calcula imposto mensal usando tabela progressiva brasileira
   */
  calculateTax(taxableIncome: number): number {
    if (taxableIncome <= 0) return 0;
    const bracket = TAX_BRACKETS.find(b => taxableIncome >= b.min && taxableIncome <= b.max)
      || TAX_BRACKETS[TAX_BRACKETS.length - 1];
    return Math.max(0, (taxableIncome * bracket.rate / 100) - bracket.deduction);
  }

  /**
   * Calcula o imposto de um mês para um advogado
   */
  async calculateMonthlyTax(lawyerId: string, year: number, month: number, tenantId?: string): Promise<{
    totalRevenue: number;
    totalDeductions: number;
    taxableIncome: number;
    taxDue: number;
    darfDueDate: string;
  }> {
    // Receitas do mês (transações RECEITA PAGAS)
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const revenues = await this.prisma.financialTransaction.findMany({
      where: {
        lawyer_id: lawyerId,
        type: 'RECEITA',
        status: 'PAGO',
        paid_at: { gte: startDate, lte: endDate },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      select: { amount: true },
    });

    // Bug fix 2026-05-10 (Honorarios PR4 #19):
    // Carne-Leao so aceita despesas vinculadas a ATIVIDADE PROFISSIONAL
    // (livro caixa). Antes somava TODAS as despesas PAGAS — incluindo
    // categorias como "Custas Judiciais" que sao REPASSADAS ao cliente
    // (nao sao despesa do advogado). Resultado: imposto subdimensionado
    // → debito tributario acumulado, multa de 75% + Selic na autuacao.
    //
    // Lista DEDUCTIBLE_CATEGORIES = categorias profissionais aceitas pela
    // Receita pra livro caixa. Custas/cartorio/correios sao repasse —
    // ficam fora.
    //
    // TODO: idealmente Lead/Tenant configura quais categorias sao
    // dedutiveis (FinancialCategory.is_deductible). Por enquanto
    // hardcoded — conservador (rejeita por default em duvida).
    const DEDUCTIBLE_CATEGORIES = [
      'ESCRITORIO',     // aluguel, energia, agua, internet
      'SOFTWARE',       // assinaturas (CRM, OAB, jurisprudencia)
      'CONTABIL',       // contador, escrita
      'MARKETING',      // ads, site
      'HONORARIOS_TERCEIROS', // co-advogado, perito
      'EDUCACAO',       // OAB anuidade, cursos, congressos
      'TRANSPORTE',     // combustivel/uber para audiencias
      'TELEFONE',
      'MATERIAL_ESCRITORIO',
    ];

    const expenses = await this.prisma.financialTransaction.findMany({
      where: {
        lawyer_id: lawyerId,
        type: 'DESPESA',
        status: 'PAGO',
        paid_at: { gte: startDate, lte: endDate },
        category: { in: DEDUCTIBLE_CATEGORIES },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      select: { amount: true },
    });

    // Bug fix 2026-05-10 (Honorarios PR3 #7): soma em centavos pra
    // evitar erro de float em volume agregado. Antes 100 parcelas
    // de R$ 1.499,99 acumulavam erro tipo R$ 17.999,879999999998 →
    // exibido como R$ 17.999,88. Em base mensal de mil leads, soma
    // ~R$ 1-10 sumindo silenciosamente do DARF.
    const totalRevenueCents = revenues.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    const totalDeductionsCents = expenses.reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0);
    const totalRevenue = totalRevenueCents / 100;
    const totalDeductions = totalDeductionsCents / 100;
    const taxableIncomeCents = Math.max(0, totalRevenueCents - totalDeductionsCents);
    const taxableIncome = taxableIncomeCents / 100;
    const taxDue = Math.round(this.calculateTax(taxableIncome) * 100) / 100;

    // Bug fix 2026-05-10 (Honorarios PR4 #20):
    // DARF Carne-Leao vence ULTIMO DIA UTIL do mes seguinte (regra
    // da Receita). Antes hardcoded dia 28 — comentario dizia "sempre
    // dia util na pratica" mas eh falso. Ex: 28/abr/2024 = domingo.
    // Sistema mostrava DARF vencendo dia 28, real era dia 30 (ou
    // anterior). Advogado pagava com 1-2 dias de atraso, multa de
    // mora 0.33%/dia. Helper calcula ultimo dia util considerando
    // sab/dom (feriados nacionais ficam pra v2 — backfill iria
    // requerer FeriadosNacionais do BusinessDaysCalc).
    const darfDueDate = this.computeDarfDueDate(year, month).toISOString().slice(0, 10);

    return { totalRevenue, totalDeductions, taxableIncome, taxDue, darfDueDate };
  }

  /** Ultimo dia util do mes seguinte ao mes de apuracao. */
  private computeDarfDueDate(year: number, month: number): Date {
    // Mes seguinte (month=12 vai pra ano+1, mes=1)
    const targetYear = month === 12 ? year + 1 : year;
    const targetMonth = month === 12 ? 0 : month; // 0-indexed
    // Ultimo dia do mes alvo
    const lastDay = new Date(targetYear, targetMonth + 1, 0);
    // Volta enquanto cair em sab (6) ou dom (0)
    while (lastDay.getDay() === 0 || lastDay.getDay() === 6) {
      lastDay.setDate(lastDay.getDate() - 1);
    }
    return lastDay;
  }

  /**
   * Gera/atualiza o TaxRecord de um mês
   */
  async upsertMonthlyRecord(lawyerId: string, year: number, month: number, tenantId?: string) {
    const calc = await this.calculateMonthlyTax(lawyerId, year, month, tenantId);

    return this.prisma.taxRecord.upsert({
      where: {
        tenant_id_lawyer_id_year_month: {
          tenant_id: tenantOrDefault(tenantId),
          lawyer_id: lawyerId,
          year,
          month,
        },
      },
      create: {
        tenant_id: tenantOrDefault(tenantId),
        lawyer_id: lawyerId,
        year,
        month,
        total_revenue: calc.totalRevenue,
        total_deductions: calc.totalDeductions,
        taxable_income: calc.taxableIncome,
        tax_due: calc.taxDue,
        darf_due_date: new Date(calc.darfDueDate),
      },
      update: {
        total_revenue: calc.totalRevenue,
        total_deductions: calc.totalDeductions,
        taxable_income: calc.taxableIncome,
        tax_due: calc.taxDue,
        darf_due_date: new Date(calc.darfDueDate),
      },
    });
  }

  /**
   * Resumo anual — 12 meses
   *
   * Bug fix 2026-05-10 (Honorarios PR4 #32):
   * Antes 12 queries sequenciais (1 por mes) — 12x latencia DB =
   * ~1.2s por chamada do dashboard fiscal. Agora single findMany
   * com OR/where complexo ou groupBy. Com index existente em
   * (tenant_id, lawyer_id, year, month) eh quase instantaneo.
   */
  async getAnnualSummary(lawyerId: string, year: number, tenantId?: string) {
    const records = await this.prisma.taxRecord.findMany({
      where: {
        tenant_id: tenantOrDefault(tenantId),
        lawyer_id: lawyerId,
        year,
      },
      orderBy: { month: 'asc' },
    });
    const recordByMonth = new Map(records.map(r => [r.month, r]));

    const months: any[] = [];
    for (let m = 1; m <= 12; m++) {
      const record = recordByMonth.get(m);
      if (record) {
        months.push({
          month: m,
          revenue: Number(record.total_revenue),
          deductions: Number(record.total_deductions),
          taxableIncome: Number(record.taxable_income),
          taxDue: Number(record.tax_due),
          darfPaid: record.darf_paid,
          darfDueDate: record.darf_due_date?.toISOString().slice(0, 10),
        });
      } else {
        months.push({ month: m, revenue: 0, deductions: 0, taxableIncome: 0, taxDue: 0, darfPaid: false, darfDueDate: null });
      }
    }

    const totals = months.reduce(
      (acc, m) => ({
        revenue: acc.revenue + m.revenue,
        deductions: acc.deductions + m.deductions,
        taxDue: acc.taxDue + m.taxDue,
        paid: acc.paid + (m.darfPaid ? m.taxDue : 0),
      }),
      { revenue: 0, deductions: 0, taxDue: 0, paid: 0 },
    );

    return { year, lawyerId, months, totals };
  }

  /**
   * Recalcula todos os meses do ano
   */
  async recalculateYear(lawyerId: string, year: number, tenantId?: string) {
    const currentMonth = new Date().getUTCMonth() + 1;
    const maxMonth = year === new Date().getUTCFullYear() ? currentMonth : 12;

    for (let m = 1; m <= maxMonth; m++) {
      await this.upsertMonthlyRecord(lawyerId, year, m, tenantId);
    }
    this.logger.log(`[TAX] Recalculado ${maxMonth} meses de ${year} para advogado ${lawyerId}`);
  }

  /**
   * Marca DARF como pago
   */
  async markDarfPaid(lawyerId: string, year: number, month: number, tenantId?: string) {
    return this.prisma.taxRecord.update({
      where: {
        tenant_id_lawyer_id_year_month: {
          tenant_id: tenantOrDefault(tenantId),
          lawyer_id: lawyerId,
          year,
          month,
        },
      },
      data: { darf_paid: true, darf_paid_at: new Date() },
    });
  }

  /**
   * Breakdown por cliente para Carnê-Leão
   */
  async getClientBreakdown(lawyerId: string, year: number, month: number, tenantId?: string) {
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const txs = await this.prisma.financialTransaction.findMany({
      where: {
        lawyer_id: lawyerId,
        type: 'RECEITA',
        status: 'PAGO',
        paid_at: { gte: startDate, lte: endDate },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { paid_at: 'asc' },
    });

    // Agrupar por lead
    const byLead = new Map<string, { name: string; phone: string; total: number; transactions: number }>();
    for (const tx of txs) {
      const leadId = tx.lead_id || 'sem_cliente';
      const existing = byLead.get(leadId);
      if (existing) {
        existing.total += Number(tx.amount);
        existing.transactions++;
      } else {
        byLead.set(leadId, {
          name: (tx as any).lead?.name || 'Sem cliente vinculado',
          phone: (tx as any).lead?.phone || '',
          total: Number(tx.amount),
          transactions: 1,
        });
      }
    }

    return Array.from(byLead.entries()).map(([leadId, data]) => ({
      leadId,
      ...data,
    })).sort((a, b) => b.total - a.total);
  }
}
