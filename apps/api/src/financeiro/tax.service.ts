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

    // Despesas dedutíveis do mês
    const expenses = await this.prisma.financialTransaction.findMany({
      where: {
        lawyer_id: lawyerId,
        type: 'DESPESA',
        status: 'PAGO',
        paid_at: { gte: startDate, lte: endDate },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      select: { amount: true },
    });

    const totalRevenue = revenues.reduce((s, r) => s + Number(r.amount), 0);
    const totalDeductions = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const taxableIncome = Math.max(0, totalRevenue - totalDeductions);
    const taxDue = Math.round(this.calculateTax(taxableIncome) * 100) / 100;

    // DARF vence no último dia útil do mês seguinte
    const nextMonth = month === 12 ? new Date(year + 1, 0, 28) : new Date(year, month, 28);
    // Simplificação: dia 28 (sempre dia útil na prática)
    const darfDueDate = nextMonth.toISOString().slice(0, 10);

    return { totalRevenue, totalDeductions, taxableIncome, taxDue, darfDueDate };
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
   */
  async getAnnualSummary(lawyerId: string, year: number, tenantId?: string) {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const record = await this.prisma.taxRecord.findUnique({
        where: {
          tenant_id_lawyer_id_year_month: {
            tenant_id: tenantOrDefault(tenantId),
            lawyer_id: lawyerId,
            year,
            month: m,
          },
        },
      });
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
