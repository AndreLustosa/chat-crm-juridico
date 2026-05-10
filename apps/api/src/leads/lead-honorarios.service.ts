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
      // Bug fix 2026-05-10 (Honorarios PR3 #7): soma em centavos
      const contracted = Number(h.total_value);
      const sumCents = (status: string) => payments
        .filter(p => p.status === status)
        .reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
      const received = sumCents('PAGO') / 100;
      const pending = sumCents('PENDENTE') / 100;
      const overdue = sumCents('ATRASADO') / 100;
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

    // Bug fix 2026-05-10 (Honorarios PR3 #7): validar em centavos
    // (precisao exata) em vez de tolerar 2 centavos de diff. Antes
    // R$ 0,02 tolerados por contrato, em volume de 100 contratos
    // soma R$ 2 perdidos silenciosamente.
    const totalCents = Math.round(data.total_value * 100);
    const paymentSumCents = data.payments.reduce((s, p) => s + Math.round(p.amount * 100), 0);
    const diffCents = Math.abs(paymentSumCents - totalCents);
    if (diffCents > 1) { // toleramos so 1 centavo (residuo de divisao normal)
      throw new BadRequestException(
        `Soma das parcelas (${(paymentSumCents / 100).toFixed(2)}) difere do valor total (${(totalCents / 100).toFixed(2)})`,
      );
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
      // Bug fix 2026-05-10 (Honorarios PR5 #49):
      // ERROR em vez de warn — pagamento marcado PAGO sem transacao
      // financeira eh inconsistencia critica.
      this.logger.error(
        `[LEAD-HON] CRITICO: Pagamento ${paymentId} marcado PAGO mas createFromLeadHonorarioPayment FALHOU. ` +
        `Livro caixa pode estar inconsistente. Erro: ${e.message}`,
        e?.stack,
      );
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
