import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Inject, forwardRef, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { tenantOrDefault } from '../common/constants/tenant';

@Injectable()
export class LeadHonorariosService {
  private readonly logger = new Logger(LeadHonorariosService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => FinanceiroService)) private financeiroService: FinanceiroService,
  ) {}

  /**
   * Bug fix 2026-05-10 (Honorarios PR1 #5 — CRITICO):
   * Verifica ownership de LeadHonorario via tenant. Antes update/delete/
   * markPaid nao validavam — user do tenant A enumerava UUID e marcava
   * como PAGO na receita do tenant B.
   */
  private async assertHonorarioTenant(id: string, tenantId?: string): Promise<{ tenant_id: string | null; status: string; lead_id: string }> {
    const honorario = await this.prisma.leadHonorario.findUnique({
      where: { id },
      select: { id: true, tenant_id: true, status: true, lead_id: true },
    });
    if (!honorario) throw new NotFoundException('Honorário não encontrado');
    if (tenantId && honorario.tenant_id && honorario.tenant_id !== tenantId) {
      throw new ForbiddenException('Honorário pertence a outro tenant');
    }
    return honorario;
  }

  /** Verifica ownership de LeadHonorarioPayment (busca o honorario pai). */
  private async assertPaymentTenant(paymentId: string, tenantId?: string): Promise<any> {
    const payment = await this.prisma.leadHonorarioPayment.findUnique({
      where: { id: paymentId },
      include: {
        lead_honorario: {
          select: { id: true, tenant_id: true, status: true, lead: { select: { name: true } } },
        },
      },
    });
    if (!payment) throw new NotFoundException('Parcela não encontrada');
    if (tenantId && payment.lead_honorario.tenant_id && payment.lead_honorario.tenant_id !== tenantId) {
      throw new ForbiddenException('Parcela pertence a outro tenant');
    }
    return payment;
  }

  // ─── Queries ────────────────────────────────────────────

  async findByLead(leadId: string, tenantId?: string) {
    // Bug fix 2026-05-10 (PR1 #5): filtra por tenant — antes listava
    // honorarios de QUALQUER tenant pelo leadId (lead em si tem tenant,
    // mas nao validavamos antes).
    const where: any = { lead_id: leadId };
    if (tenantId) where.tenant_id = tenantId;
    return this.prisma.leadHonorario.findMany({
      where,
      include: {
        payments: { orderBy: { due_date: 'asc' } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findPendingPayments(tenantId?: string) {
    const where: any = {
      status: { in: ['PENDENTE', 'ATRASADO'] },
      lead_honorario: {
        status: { in: ['NEGOCIANDO', 'ACEITO'] },
      },
    };
    if (tenantId) {
      where.lead_honorario.tenant_id = tenantId;
    }

    return this.prisma.leadHonorarioPayment.findMany({
      where,
      include: {
        lead_honorario: {
          include: {
            lead: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { due_date: 'asc' },
    });
  }

  async getSummary(tenantId?: string) {
    const where: any = {
      status: { in: ['NEGOCIANDO', 'ACEITO'] },
    };
    if (tenantId) where.tenant_id = tenantId;

    const honorarios = await this.prisma.leadHonorario.findMany({
      where,
      include: {
        lead: { select: { id: true, name: true, phone: true } },
        payments: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return honorarios.map(h => {
      const payments = h.payments || [];
      const contracted = Number(h.total_value);
      const received = payments.filter(p => p.status === 'PAGO').reduce((s, p) => s + Number(p.amount), 0);
      const pending = payments.filter(p => p.status === 'PENDENTE').reduce((s, p) => s + Number(p.amount), 0);
      const overdue = payments.filter(p => p.status === 'ATRASADO').reduce((s, p) => s + Number(p.amount), 0);
      return {
        id: h.id,
        lead: h.lead,
        type: h.type,
        status: h.status,
        contracted,
        received,
        pending,
        overdue,
        installment_count: h.installment_count,
        created_at: h.created_at,
      };
    });
  }

  // ─── CRUD Honorário ─────────────────────────────────────

  async create(leadId: string, data: {
    type: string;
    total_value: number;
    notes?: string;
    payments: Array<{ amount: number; due_date?: string | null }>;
  }, tenantId?: string) {
    if (!data.total_value || data.total_value <= 0) {
      throw new BadRequestException('Valor total deve ser maior que zero');
    }

    const validTypes = ['CONTRATUAL', 'ENTRADA', 'ACORDO'];
    if (!validTypes.includes(data.type)) {
      throw new BadRequestException(`Tipo inválido. Use: ${validTypes.join(', ')}`);
    }

    if (!data.payments || data.payments.length === 0) {
      throw new BadRequestException('Informe pelo menos uma parcela');
    }

    // Validar soma das parcelas
    const paymentSum = data.payments.reduce((s, p) => s + p.amount, 0);
    const diff = Math.abs(paymentSum - data.total_value);
    if (diff > 0.02) {
      throw new BadRequestException(`Soma das parcelas (${paymentSum.toFixed(2)}) difere do valor total (${data.total_value.toFixed(2)})`);
    }

    const now = new Date();

    return this.prisma.leadHonorario.create({
      data: {
        lead_id: leadId,
        tenant_id: tenantOrDefault(tenantId),
        type: data.type,
        total_value: data.total_value,
        installment_count: data.payments.length,
        notes: data.notes || null,
        payments: {
          create: data.payments.map(p => {
            const dueDate = p.due_date ? new Date(p.due_date) : null;
            return {
              amount: p.amount,
              due_date: dueDate,
              status: dueDate && dueDate < now ? 'ATRASADO' : 'PENDENTE',
            };
          }),
        },
      },
      include: {
        payments: { orderBy: { due_date: 'asc' } },
      },
    });
  }

  async update(id: string, data: {
    type?: string;
    total_value?: number;
    notes?: string;
    status?: string;
  }, tenantId?: string) {
    // Bug fix 2026-05-10 (PR1 #5): valida ownership antes de atualizar
    const existing = await this.assertHonorarioTenant(id, tenantId);
    if (existing.status === 'CONVERTIDO') {
      throw new ForbiddenException('Honorário já convertido não pode ser alterado');
    }

    if (data.type) {
      const validTypes = ['CONTRATUAL', 'ENTRADA', 'ACORDO'];
      if (!validTypes.includes(data.type)) {
        throw new BadRequestException(`Tipo inválido. Use: ${validTypes.join(', ')}`);
      }
    }

    if (data.status) {
      const validStatuses = ['NEGOCIANDO', 'ACEITO', 'RECUSADO'];
      if (!validStatuses.includes(data.status)) {
        throw new BadRequestException(`Status inválido. Use: NEGOCIANDO, ACEITO, RECUSADO`);
      }
    }

    return this.prisma.leadHonorario.update({
      where: { id },
      data: {
        ...(data.type && { type: data.type }),
        ...(data.total_value !== undefined && { total_value: data.total_value }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status && { status: data.status }),
      },
      include: { payments: { orderBy: { due_date: 'asc' } } },
    });
  }

  async delete(id: string, tenantId?: string) {
    const existing = await this.assertHonorarioTenant(id, tenantId);
    if (existing.status === 'CONVERTIDO') {
      throw new ForbiddenException('Honorário já convertido não pode ser excluído');
    }

    await this.prisma.leadHonorario.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Parcelas (Payments) ────────────────────────────────

  async addPayment(leadHonorarioId: string, data: { amount: number; due_date: string }, tenantId?: string) {
    const hon = await this.assertHonorarioTenant(leadHonorarioId, tenantId);
    if (hon.status === 'CONVERTIDO') throw new ForbiddenException('Honorário já convertido');

    const dueDate = new Date(data.due_date);
    const payment = await this.prisma.leadHonorarioPayment.create({
      data: {
        lead_honorario_id: leadHonorarioId,
        amount: data.amount,
        due_date: dueDate,
        status: dueDate < new Date() ? 'ATRASADO' : 'PENDENTE',
      },
    });

    // Atualizar contagem de parcelas
    const count = await this.prisma.leadHonorarioPayment.count({ where: { lead_honorario_id: leadHonorarioId } });
    await this.prisma.leadHonorario.update({
      where: { id: leadHonorarioId },
      data: { installment_count: count },
    });

    return payment;
  }

  async deletePayment(paymentId: string, tenantId?: string) {
    const payment = await this.assertPaymentTenant(paymentId, tenantId);
    if (payment.status === 'PAGO') throw new ForbiddenException('Parcela já paga não pode ser excluída');

    await this.prisma.leadHonorarioPayment.delete({ where: { id: paymentId } });

    // Atualizar contagem
    const count = await this.prisma.leadHonorarioPayment.count({ where: { lead_honorario_id: payment.lead_honorario_id } });
    await this.prisma.leadHonorario.update({
      where: { id: payment.lead_honorario_id },
      data: { installment_count: count },
    });

    return { ok: true };
  }

  async markPaid(paymentId: string, data: { payment_method?: string }, tenantId?: string) {
    // Bug fix 2026-05-10 (PR1 #5 — CRITICO): valida ownership ANTES de
    // marcar como PAGO. Antes user enumerava UUID e marcava parcela de
    // outro tenant como PAGO — entrava na receita errada via
    // createFromLeadHonorarioPayment.
    const payment = await this.assertPaymentTenant(paymentId, tenantId);

    const updated = await this.prisma.leadHonorarioPayment.update({
      where: { id: paymentId },
      data: {
        status: 'PAGO',
        paid_at: new Date(),
        ...(data.payment_method && { payment_method: data.payment_method }),
      },
    });

    try {
      await this.financeiroService.createFromLeadHonorarioPayment(paymentId, payment.lead_honorario.tenant_id || undefined);
      this.logger.log(`[LEAD-HON] Transação financeira criada para pagamento ${paymentId}`);
    } catch (e: any) {
      this.logger.warn(`[LEAD-HON] Falha ao criar transação financeira: ${e.message}`);
    }

    return updated;
  }

  // ─── Atualizar vencidos ─────────────────────────────────

  async markOverduePayments() {
    const now = new Date();
    await this.prisma.leadHonorarioPayment.updateMany({
      where: {
        status: 'PENDENTE',
        due_date: { lt: now },
      },
      data: { status: 'ATRASADO' },
    });
  }
}
