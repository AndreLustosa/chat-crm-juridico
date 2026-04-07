import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto, UpdateTransactionDto, CreateCategoryDto, UpdateCategoryDto } from './financeiro.dto';

const DEFAULT_CATEGORIES = [
  { type: 'RECEITA', name: 'Honorarios', icon: 'scale' },
  { type: 'RECEITA', name: 'Consultas', icon: 'stethoscope' },
  { type: 'RECEITA', name: 'Acordos Extrajudiciais', icon: 'handshake' },
  { type: 'DESPESA', name: 'Custas Judiciais', icon: 'gavel' },
  { type: 'DESPESA', name: 'Pericias', icon: 'clipboard-check' },
  { type: 'DESPESA', name: 'Deslocamento', icon: 'car' },
  { type: 'DESPESA', name: 'Material de Escritorio', icon: 'pencil' },
  { type: 'DESPESA', name: 'Cartorio', icon: 'stamp' },
  { type: 'DESPESA', name: 'Correios', icon: 'mail' },
  { type: 'DESPESA', name: 'Outros', icon: 'ellipsis' },
];

@Injectable()
export class FinanceiroService {
  private readonly logger = new Logger(FinanceiroService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Helpers ────────────────────────────────────────────

  private async verifyTransactionAccess(id: string, tenantId?: string) {
    const record = await this.prisma.financialTransaction.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('Transacao nao encontrada');
    if (tenantId && record.tenant_id && record.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return record;
  }

  private async verifyCategoryAccess(id: string, tenantId?: string) {
    const record = await this.prisma.financialCategory.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('Categoria nao encontrada');
    if (tenantId && record.tenant_id && record.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return record;
  }

  // ─── Transactions CRUD ─────────────────────────────────

  async findAllTransactions(query: {
    tenantId?: string;
    type?: string;
    category?: string;
    status?: string;
    legalCaseId?: string;
    leadId?: string;
    lawyerId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (query.tenantId) where.tenant_id = query.tenantId;
    if (query.type) where.type = query.type;
    if (query.category) where.category = query.category;
    if (query.status) where.status = query.status;
    if (query.legalCaseId) where.legal_case_id = query.legalCaseId;
    if (query.leadId) where.lead_id = query.leadId;
    if (query.lawyerId) where.lawyer_id = query.lawyerId;

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where,
        include: {
          lead: {
            select: { id: true, name: true, phone: true },
          },
          legal_case: {
            select: { id: true, case_number: true, legal_area: true },
          },
          lawyer: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { date: 'desc' },
        take: query.limit || 50,
        skip: query.offset || 0,
      }),
      this.prisma.financialTransaction.count({ where }),
    ]);

    // Enriquecer transações PENDENTE/ATRASADO de honorários com juros legais
    const enriched = await this.enrichWithInterest(data);

    return { data: enriched, total };
  }

  /**
   * Calcula juros legais (1% a.m. padrão) para transações de honorários vencidas.
   * Cálculo em tempo de leitura — não altera dados no banco.
   */
  private async enrichWithInterest(transactions: any[]) {
    const now = new Date();

    return Promise.all(
      transactions.map(async (tx) => {
        // Só calcular juros para receitas de honorário pendentes/vencidas com due_date
        if (
          tx.type !== 'RECEITA' ||
          tx.category !== 'HONORARIO' ||
          tx.status === 'PAGO' ||
          tx.status === 'CANCELADO' ||
          !tx.due_date ||
          !tx.honorario_payment_id
        ) {
          return { ...tx, interest_amount: 0, total_with_interest: Number(tx.amount) };
        }

        const dueDate = new Date(tx.due_date);
        if (dueDate >= now) {
          return { ...tx, interest_amount: 0, total_with_interest: Number(tx.amount) };
        }

        // Buscar taxa de juros do honorário
        let monthlyRate = 1.0; // padrão: 1% ao mês (juros legais art. 406 CC)
        try {
          const payment = await this.prisma.honorarioPayment.findUnique({
            where: { id: tx.honorario_payment_id },
            select: { honorario: { select: { interest_rate: true } } },
          });
          if (payment?.honorario?.interest_rate) {
            monthlyRate = Number(payment.honorario.interest_rate);
          }
        } catch {}

        // Calcular meses de atraso
        const msPerMonth = 30.44 * 24 * 60 * 60 * 1000;
        const monthsOverdue = Math.max(0, (now.getTime() - dueDate.getTime()) / msPerMonth);
        const amount = Number(tx.amount);
        const interestAmount = Math.round(amount * (monthlyRate / 100) * monthsOverdue * 100) / 100;

        return {
          ...tx,
          interest_amount: interestAmount,
          total_with_interest: Math.round((amount + interestAmount) * 100) / 100,
        };
      }),
    );
  }

  async createTransaction(data: CreateTransactionDto & { tenant_id?: string }) {
    return this.prisma.financialTransaction.create({
      data: {
        tenant_id: data.tenant_id,
        type: data.type,
        category: data.category,
        description: data.description,
        amount: data.amount,
        date: data.date ? new Date(data.date) : new Date(),
        due_date: data.due_date ? new Date(data.due_date) : null,
        paid_at: data.paid_at ? new Date(data.paid_at) : null,
        payment_method: data.payment_method,
        status: data.status || 'PENDENTE',
        legal_case_id: data.legal_case_id,
        lead_id: data.lead_id,
        lawyer_id: data.lawyer_id,
        honorario_payment_id: data.honorario_payment_id,
        reference_id: data.reference_id,
        notes: data.notes,
      },
      include: {
        lead: { select: { id: true, name: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true } },
        lawyer: { select: { id: true, name: true } },
      },
    });
  }

  async updateTransaction(id: string, data: UpdateTransactionDto, tenantId?: string) {
    await this.verifyTransactionAccess(id, tenantId);

    const updateData: any = {};

    if (data.type !== undefined) updateData.type = data.type;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.date !== undefined) updateData.date = data.date ? new Date(data.date) : new Date();
    if (data.due_date !== undefined) updateData.due_date = data.due_date ? new Date(data.due_date) : null;
    if (data.paid_at !== undefined) updateData.paid_at = data.paid_at ? new Date(data.paid_at) : null;
    if (data.payment_method !== undefined) updateData.payment_method = data.payment_method;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.legal_case_id !== undefined) updateData.legal_case_id = data.legal_case_id;
    if (data.lead_id !== undefined) updateData.lead_id = data.lead_id;
    if (data.lawyer_id !== undefined) updateData.lawyer_id = data.lawyer_id;
    if (data.honorario_payment_id !== undefined) updateData.honorario_payment_id = data.honorario_payment_id;
    if (data.reference_id !== undefined) updateData.reference_id = data.reference_id;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return this.prisma.financialTransaction.update({
      where: { id },
      data: updateData,
      include: {
        lead: { select: { id: true, name: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true } },
        lawyer: { select: { id: true, name: true } },
      },
    });
  }

  async deleteTransaction(id: string, tenantId?: string) {
    await this.verifyTransactionAccess(id, tenantId);

    return this.prisma.financialTransaction.update({
      where: { id },
      data: { status: 'CANCELADO' },
    });
  }

  // ─── Create from Honorario Payment ─────────────────────

  async createFromHonorarioPayment(paymentId: string, tenantId?: string) {
    const payment = await this.prisma.honorarioPayment.findUnique({
      where: { id: paymentId },
      include: {
        honorario: {
          include: {
            legal_case: {
              select: { id: true, case_number: true, legal_area: true, lead_id: true, tenant_id: true, lawyer_id: true },
            },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Pagamento de honorario nao encontrado');

    const legalCase = (payment as any).honorario?.legal_case;
    const status = payment.status === 'PAGO' ? 'PAGO' : 'PENDENTE';

    // Se já existe transação para este pagamento, atualizar status/valor
    const existing = await this.prisma.financialTransaction.findUnique({
      where: { honorario_payment_id: paymentId },
    });
    if (existing) {
      return this.prisma.financialTransaction.update({
        where: { id: existing.id },
        data: {
          status,
          amount: payment.amount,
          paid_at: payment.paid_at,
          payment_method: payment.payment_method || existing.payment_method,
          date: payment.paid_at || existing.date,
        },
      });
    }

    return this.prisma.financialTransaction.create({
      data: {
        tenant_id: tenantId || legalCase?.tenant_id || null,
        type: 'RECEITA',
        category: 'HONORARIO',
        description: `Honorário - ${legalCase?.case_number || 'Processo'} ${legalCase?.legal_area ? `(${legalCase.legal_area})` : ''}`.trim(),
        amount: payment.amount,
        date: payment.paid_at || payment.due_date || new Date(),
        paid_at: payment.paid_at,
        due_date: payment.due_date,
        payment_method: payment.payment_method,
        status,
        legal_case_id: legalCase?.id || null,
        lead_id: legalCase?.lead_id || null,
        honorario_payment_id: paymentId,
      },
    });
  }

  // ─── Summary & Analytics ───────────────────────────────

  async getSummary(tenantId?: string, startDate?: string, endDate?: string) {
    const where: any = {};
    if (tenantId) where.tenant_id = tenantId;
    // Exclude cancelled from aggregation
    where.status = { not: 'CANCELADO' };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [totalRevenue, totalExpenses, totalReceivable, totalOverdue] = await Promise.all([
      // Total revenue (RECEITA + PAGO)
      this.prisma.financialTransaction.aggregate({
        where: { ...where, type: 'RECEITA', status: 'PAGO' },
        _sum: { amount: true },
      }),
      // Total expenses (DESPESA + PAGO)
      this.prisma.financialTransaction.aggregate({
        where: { ...where, type: 'DESPESA', status: 'PAGO' },
        _sum: { amount: true },
      }),
      // Total receivable (RECEITA + PENDENTE)
      this.prisma.financialTransaction.aggregate({
        where: { ...where, type: 'RECEITA', status: 'PENDENTE' },
        _sum: { amount: true },
      }),
      // Total overdue (RECEITA + PENDENTE + due_date < now)
      this.prisma.financialTransaction.aggregate({
        where: {
          ...where,
          type: 'RECEITA',
          status: 'PENDENTE',
          due_date: { lt: new Date() },
        },
        _sum: { amount: true },
      }),
    ]);

    const revenue = Number(totalRevenue._sum.amount || 0);
    const expenses = Number(totalExpenses._sum.amount || 0);
    const receivable = Number(totalReceivable._sum.amount || 0);
    const overdue = Number(totalOverdue._sum.amount || 0);

    return {
      totalRevenue: revenue,
      totalExpenses: expenses,
      totalReceivable: receivable,
      totalOverdue: overdue,
      balance: revenue - expenses,
    };
  }

  async getCashFlow(
    tenantId?: string,
    startDate?: string,
    endDate?: string,
    groupBy: 'day' | 'week' | 'month' = 'month',
  ) {
    const where: any = { status: { not: 'CANCELADO' } };
    if (tenantId) where.tenant_id = tenantId;

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const transactions = await this.prisma.financialTransaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
        date: true,
        status: true,
      },
      orderBy: { date: 'asc' },
    });

    // Group by period
    const groupedMap = new Map<string, { entries: number; exits: number; balance: number }>();

    for (const tx of transactions) {
      const date = new Date(tx.date);
      let key: string;

      if (groupBy === 'day') {
        key = date.toISOString().slice(0, 10); // YYYY-MM-DD
      } else if (groupBy === 'week') {
        // ISO week start (Monday)
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(date);
        weekStart.setDate(diff);
        key = weekStart.toISOString().slice(0, 10);
      } else {
        key = date.toISOString().slice(0, 7); // YYYY-MM
      }

      if (!groupedMap.has(key)) {
        groupedMap.set(key, { entries: 0, exits: 0, balance: 0 });
      }

      const group = groupedMap.get(key)!;
      const amount = Number(tx.amount);

      if (tx.type === 'RECEITA') {
        group.entries += amount;
      } else {
        group.exits += amount;
      }
      group.balance = group.entries - group.exits;
    }

    // Convert to array sorted by period
    const periods = Array.from(groupedMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, values]) => ({
        period,
        entries: Math.round(values.entries * 100) / 100,
        exits: Math.round(values.exits * 100) / 100,
        balance: Math.round(values.balance * 100) / 100,
      }));

    return { periods, groupBy };
  }

  // ─── Categories CRUD ───────────────────────────────────

  async findAllCategories(tenantId?: string) {
    const where: any = { active: true };
    if (tenantId) where.tenant_id = tenantId;

    return this.prisma.financialCategory.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(data: CreateCategoryDto, tenantId?: string) {
    return this.prisma.financialCategory.create({
      data: {
        tenant_id: tenantId,
        type: data.type,
        name: data.name,
        icon: data.icon,
      },
    });
  }

  async updateCategory(id: string, data: UpdateCategoryDto, tenantId?: string) {
    await this.verifyCategoryAccess(id, tenantId);

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.active !== undefined) updateData.active = data.active;

    return this.prisma.financialCategory.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteCategory(id: string, tenantId?: string) {
    await this.verifyCategoryAccess(id, tenantId);

    return this.prisma.financialCategory.delete({
      where: { id },
    });
  }

  async seedDefaultCategories(tenantId: string) {
    const existing = await this.prisma.financialCategory.count({
      where: { tenant_id: tenantId },
    });

    if (existing > 0) {
      this.logger.log(`Tenant ${tenantId} ja possui ${existing} categorias, pulando seed`);
      return;
    }

    this.logger.log(`Criando categorias padrao para tenant ${tenantId}`);

    await this.prisma.financialCategory.createMany({
      data: DEFAULT_CATEGORIES.map((cat) => ({
        tenant_id: tenantId,
        type: cat.type,
        name: cat.name,
        icon: cat.icon,
        is_default: true,
      })),
    });

    return this.findAllCategories(tenantId);
  }
}
