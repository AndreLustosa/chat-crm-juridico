import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceiroService } from '../financeiro/financeiro.service';

const HONORARIO_TYPES = ['CONTRATUAL', 'SUCUMBENCIA', 'ENTRADA', 'ACORDO'] as const;
const PAYMENT_STATUSES = ['PENDENTE', 'PAGO', 'ATRASADO'] as const;

@Injectable()
export class HonorariosService {
  private readonly logger = new Logger(HonorariosService.name);

  constructor(
    private prisma: PrismaService,
    private financeiroService: FinanceiroService,
  ) {}

  // ─── Helpers ────────────────────────────────────────────

  private async verifyCaseAccess(caseId: string, tenantId?: string) {
    const lc = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { id: true, tenant_id: true },
    });
    if (!lc) throw new NotFoundException('Caso não encontrado');
    if (tenantId && lc.tenant_id && lc.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return lc;
  }

  private async verifyHonorarioAccess(honorarioId: string, tenantId?: string) {
    const h = await this.prisma.caseHonorario.findUnique({
      where: { id: honorarioId },
      select: { id: true, tenant_id: true, legal_case_id: true },
    });
    if (!h) throw new NotFoundException('Honorário não encontrado');
    if (tenantId && h.tenant_id && h.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return h;
  }

  /**
   * Atualiza parcelas vencidas para status ATRASADO em tempo de leitura.
   */
  private async markOverduePayments(honorarioIds: string[]) {
    if (honorarioIds.length === 0) return;
    await this.prisma.honorarioPayment.updateMany({
      where: {
        honorario_id: { in: honorarioIds },
        status: 'PENDENTE',
        due_date: { lt: new Date(), not: null },
      },
      data: { status: 'ATRASADO' },
    });
  }

  // ─── Parcelas pendentes (para tab Receitas / A Receber) ──

  async findPendingPayments(tenantId?: string, lawyerId?: string) {
    const where: any = {
      status: { in: ['PENDENTE', 'ATRASADO'] },
    };
    if (tenantId) {
      where.honorario = { tenant_id: tenantId };
    }
    if (lawyerId) {
      where.honorario = { ...where.honorario, legal_case: { lawyer_id: lawyerId } };
    }

    return this.prisma.honorarioPayment.findMany({
      where,
      include: {
        honorario: {
          include: {
            legal_case: {
              select: {
                id: true,
                case_number: true,
                legal_area: true,
                lawyer_id: true,
                lawyer: { select: { id: true, name: true } },
                lead: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
      },
      orderBy: { due_date: 'asc' },
    });
  }

  // ─── CRUD ──────────────────────────────────────────────

  async findByCaseId(caseId: string, tenantId?: string) {
    await this.verifyCaseAccess(caseId, tenantId);

    const honorarioIds = await this.prisma.caseHonorario.findMany({
      where: { legal_case_id: caseId },
      select: { id: true },
    });

    await this.markOverduePayments(honorarioIds.map(h => h.id));

    return this.prisma.caseHonorario.findMany({
      where: { legal_case_id: caseId },
      include: {
        payments: {
          orderBy: { due_date: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async create(
    caseId: string,
    data: {
      type: string;
      total_value?: number;
      success_percentage?: number;
      sentence_value?: number;
      installment_count?: number;
      contract_date?: string;
      interest_rate?: number;
      notes?: string;
      /** Se true, marca todas as parcelas como PAGO no ato da criacao (pagamento retroativo). */
      already_paid?: boolean;
      /** Metodo usado, obrigatorio se already_paid=true. */
      payment_method?: string;
    },
    tenantId?: string,
    actorId?: string,
  ) {
    const lc = await this.verifyCaseAccess(caseId, tenantId);

    // ─── Cálculo de valor por tipo ───
    let totalValue: number;
    let sentenceValue: number | null = null;

    if (data.type === 'SUCUMBENCIA') {
      if (!data.sentence_value || !data.success_percentage) {
        throw new BadRequestException('Sucumbência requer valor da condenação e porcentagem');
      }
      sentenceValue = data.sentence_value;
      totalValue = Math.round(data.sentence_value * data.success_percentage) / 100;
    } else {
      if (!data.total_value || data.total_value <= 0) {
        throw new BadRequestException('Valor total é obrigatório');
      }
      totalValue = data.total_value;
    }

    // ─── Gerar parcelas ───
    const installmentCount = data.installment_count || 1;
    const baseAmount = Math.floor((totalValue * 100) / installmentCount) / 100;
    const lastAmount = Math.round((totalValue - baseAmount * (installmentCount - 1)) * 100) / 100;

    const startDate = data.contract_date ? new Date(data.contract_date) : null;
    // Só gera vencimento se data foi informada E não é sucumbência
    const hasDueDate = data.type !== 'SUCUMBENCIA' && !!startDate;

    const payments: Array<{
      amount: number;
      due_date: Date | null;
      status: string;
    }> = [];

    for (let i = 0; i < installmentCount; i++) {
      let dueDate: Date | null = null;
      let status = 'PENDENTE';

      if (hasDueDate && startDate) {
        dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        if (dueDate < new Date()) status = 'ATRASADO';
      }

      payments.push({
        amount: i === installmentCount - 1 ? lastAmount : baseAmount,
        due_date: dueDate,
        status,
      });
    }

    const honorario = await this.prisma.caseHonorario.create({
      data: {
        legal_case_id: caseId,
        tenant_id: lc.tenant_id,
        type: data.type,
        total_value: totalValue,
        sentence_value: sentenceValue,
        success_percentage: data.success_percentage ?? null,
        calculated_value: data.type === 'SUCUMBENCIA' ? totalValue : null,
        interest_rate: data.interest_rate ?? 1.0, // 1% ao mês (juros legais)
        base_date: data.contract_date ? new Date(data.contract_date) : null,
        installment_count: installmentCount,
        contract_date: data.contract_date ? new Date(data.contract_date) : null,
        notes: data.notes,
        payments: {
          create: payments,
        },
      },
      include: {
        payments: {
          orderBy: { due_date: 'asc' },
        },
      },
    });

    this.logger.log(
      `Honorário criado: ${honorario.id} (${data.type}, R$ ${totalValue}, ${installmentCount} parcelas${data.success_percentage ? `, ${data.success_percentage}%` : ''})`,
    );

    // Log de auditoria
    const caseData = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { case_number: true, legal_area: true, lawyer_id: true, lead: { select: { name: true } } },
    });
    await this.financeiroService.logAction(actorId || null, 'HONORARIO_CRIADO', honorario.id, {
      tipo: data.type, valor: totalValue, parcelas: installmentCount,
      processo: caseData?.case_number, area: caseData?.legal_area,
      cliente: caseData?.lead?.name, lawyer_id: caseData?.lawyer_id,
      sucumbencia_condenacao: sentenceValue, sucumbencia_pct: data.success_percentage,
    });

    // ── Pagamento retroativo: marcar TODAS as parcelas como PAGAS ────────
    // Usado quando o advogado cadastra um contrato que ja foi pago
    // (ex: entrada recebida antes do sistema ser usado).
    // Cada markPaid cria FinancialTransaction + log de auditoria proprio.
    if (data.already_paid) {
      for (const payment of honorario.payments) {
        try {
          await this.markPaid(
            payment.id,
            { payment_method: data.payment_method },
            tenantId,
            actorId,
          );
        } catch (e: any) {
          this.logger.warn(
            `[HONORARIO] Falha ao marcar parcela ${payment.id} como paga (retroativo): ${e.message}`,
          );
        }
      }
      // Retorna estado atualizado com pagamentos marcados
      return this.prisma.caseHonorario.findUnique({
        where: { id: honorario.id },
        include: { payments: { orderBy: { due_date: 'asc' } } },
      });
    }

    // Regime de caixa: NÃO cria FinancialTransaction ao cadastrar honorário.
    // Receita só é registrada quando o pagamento é efetivamente recebido (markPaid).

    return honorario;
  }

  async update(
    id: string,
    data: {
      type?: string;
      total_value?: number;
      notes?: string;
      contract_date?: string;
      interest_rate?: number;
    },
    tenantId?: string,
  ) {
    await this.verifyHonorarioAccess(id, tenantId);

    return this.prisma.caseHonorario.update({
      where: { id },
      data: {
        ...(data.type && { type: data.type }),
        ...(data.total_value !== undefined && { total_value: data.total_value }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.interest_rate !== undefined && { interest_rate: data.interest_rate }),
        ...(data.contract_date !== undefined && {
          contract_date: data.contract_date ? new Date(data.contract_date) : null,
        }),
      },
      include: {
        payments: {
          orderBy: { due_date: 'asc' },
        },
      },
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.verifyHonorarioAccess(id, tenantId);
    return this.prisma.caseHonorario.delete({ where: { id } });
  }

  // ─── Payments ──────────────────────────────────────────

  async addPayment(
    honorarioId: string,
    data: {
      amount: number;
      due_date?: string;
      payment_method?: string;
      notes?: string;
    },
    tenantId?: string,
  ) {
    await this.verifyHonorarioAccess(honorarioId, tenantId);

    const dueDate = data.due_date ? new Date(data.due_date) : null;

    return this.prisma.honorarioPayment.create({
      data: {
        honorario_id: honorarioId,
        amount: data.amount,
        due_date: dueDate,
        payment_method: data.payment_method,
        notes: data.notes,
        status: dueDate && dueDate < new Date() ? 'ATRASADO' : 'PENDENTE',
      },
    });
  }

  async markPaid(
    paymentId: string,
    data: { payment_method?: string },
    tenantId?: string,
    actorId?: string,
  ) {
    const payment = await this.prisma.honorarioPayment.findUnique({
      where: { id: paymentId },
      include: {
        honorario: {
          select: { tenant_id: true, type: true, legal_case: { select: { case_number: true, lawyer_id: true, lead: { select: { name: true } } } } },
        },
      },
    });
    if (!payment) throw new NotFoundException('Parcela não encontrada');
    if (tenantId && payment.honorario.tenant_id && payment.honorario.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    const updated = await this.prisma.honorarioPayment.update({
      where: { id: paymentId },
      data: {
        status: 'PAGO',
        paid_at: new Date(),
        ...(data.payment_method && { payment_method: data.payment_method }),
      },
    });

    try {
      await this.financeiroService.createFromHonorarioPayment(paymentId, tenantId);
      this.logger.log(`[HONORARIO] Transação financeira atualizada para pagamento ${paymentId}`);
    } catch (e: any) {
      this.logger.warn(`[HONORARIO] Falha ao atualizar transação financeira: ${e.message}`);
    }

    const lc = (payment as any).honorario?.legal_case;
    await this.financeiroService.logAction(actorId || null, 'PAGAMENTO_RECEBIDO', paymentId, {
      valor: Number(payment.amount), metodo: data.payment_method,
      tipo_honorario: (payment as any).honorario?.type,
      processo: lc?.case_number, cliente: lc?.lead?.name,
      lawyer_id: lc?.lawyer_id,
    });

    return updated;
  }

  // ─── Recalcular honorários de sucumbência ──────────────

  /**
   * Recalcula o valor dos honorários de sucumbência quando o valor da condenação é atualizado.
   * Chamado quando o caso muda para EXECUCAO com sentence_value.
   * Mantém compatibilidade com tipos antigos (EXITO, MISTO).
   */
  async recalculateExito(caseId: string) {
    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { sentence_value: true },
    });
    if (!legalCase?.sentence_value) return;

    const sentenceValue = Number(legalCase.sentence_value);

    // Busca honorários de sucumbência/êxito com percentual definido
    const honorarios = await this.prisma.caseHonorario.findMany({
      where: {
        legal_case_id: caseId,
        type: { in: ['SUCUMBENCIA', 'EXITO', 'MISTO'] },
        success_percentage: { not: null },
        status: 'ATIVO',
      },
    });

    for (const h of honorarios) {
      const percentage = Number(h.success_percentage);
      const calculatedValue = Math.round(sentenceValue * percentage) / 100;

      await this.prisma.caseHonorario.update({
        where: { id: h.id },
        data: {
          calculated_value: calculatedValue,
          sentence_value: sentenceValue,
        },
      });

      this.logger.log(
        `[HONORARIO] Sucumbência recalculada: ${h.id} | ${percentage}% de R$ ${sentenceValue} = R$ ${calculatedValue}`,
      );
    }
  }

  async deletePayment(paymentId: string, tenantId?: string) {
    const payment = await this.prisma.honorarioPayment.findUnique({
      where: { id: paymentId },
      include: { honorario: { select: { tenant_id: true } } },
    });
    if (!payment) throw new NotFoundException('Parcela não encontrada');
    if (tenantId && payment.honorario.tenant_id && payment.honorario.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    return this.prisma.honorarioPayment.delete({ where: { id: paymentId } });
  }
}
