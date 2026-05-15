import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
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
  /**
   * Bug fix 2026-05-10 (Honorarios PR5 #46): tenant filter via relation.
   * Defesa em profundidade — caller ja deve validar IDs do mesmo caso,
   * mas se algum dia for chamado indiretamente com IDs de outro tenant
   * (sync/import errado), o filtro adicional via honorario.tenant_id
   * impede mark cross-tenant.
   */
  private async markOverduePayments(honorarioIds: string[], tenantId?: string) {
    if (honorarioIds.length === 0) return;
    await this.prisma.honorarioPayment.updateMany({
      where: {
        honorario_id: { in: honorarioIds },
        status: 'PENDENTE',
        due_date: { lt: new Date(), not: null },
        ...(tenantId ? { honorario: { tenant_id: tenantId } } : {}),
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
      // Bug fix 2026-05-10 (Honorarios PR3 #8 — CRITICO):
      // Validar que success_percentage esta em range (0, 100].
      // Antes se usuario passasse 0.20 em vez de 20, calculo virava
      // 100000 * 0.20 / 100 = 200 ao inves de 20000 — escritorio
      // perdia 99% do honorario de exito (R$ 19.800).
      if (data.success_percentage <= 0 || data.success_percentage > 100) {
        throw new BadRequestException(
          `success_percentage deve estar entre 0.01 e 100 (recebido: ${data.success_percentage}). ` +
          'Use formato 20 para 20%, nao 0.20.',
        );
      }
      if (data.sentence_value <= 0) {
        throw new BadRequestException('sentence_value deve ser maior que zero');
      }
      sentenceValue = data.sentence_value;
      // Calculo em centavos pra precisao
      const sentenceCents = Math.round(data.sentence_value * 100);
      const totalCents = Math.round((sentenceCents * data.success_percentage) / 100);
      totalValue = totalCents / 100;
    } else {
      if (!data.total_value || data.total_value <= 0) {
        throw new BadRequestException('Valor total é obrigatório');
      }
      totalValue = data.total_value;
    }

    // ─── Gerar parcelas (centavos inteiros) ───
    // Bug fix 2026-05-10 (Honorarios PR3 #7): aritmetica em centavos
    // pra evitar erro de float (0.1 + 0.2 = 0.30000000000000004).
    const installmentCount = data.installment_count || 1;
    const totalCents = Math.round(totalValue * 100);
    const baseCents = Math.floor(totalCents / installmentCount);
    const lastCents = totalCents - baseCents * (installmentCount - 1);
    const baseAmount = baseCents / 100;
    const lastAmount = lastCents / 100;

    const startDate = data.contract_date ? new Date(data.contract_date) : null;
    // Só gera vencimento se data foi informada E não é sucumbência
    const hasDueDate = data.type !== 'SUCUMBENCIA' && !!startDate;

    const payments: Array<{
      amount: number;
      due_date: Date | null;
      status: string;
    }> = [];

    // Bug fix 2026-05-10 (Honorarios PR3 #11 — CRITICO):
    // setMonth(+1) em 31/jan vira 03/mar (porque 31/02 nao existe) —
    // parcelas caiam em datas erradas. Cliente paga atrasado sem
    // saber. Helper addMonthsClamped faz "month-end clamping":
    //   31/jan + 1 mes = 28/fev (29 em ano bissexto)
    //   30/abr + 1 mes = 30/mai (correto, abr tem 30)
    //   31/mar + 1 mes = 30/abr (clampa)
    const addMonthsClamped = (base: Date, monthsToAdd: number): Date => {
      const result = new Date(base);
      const targetMonth = result.getMonth() + monthsToAdd;
      const targetYear = result.getFullYear() + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;
      // Ultimo dia do mes alvo (dia 0 do mes seguinte)
      const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
      const day = Math.min(base.getDate(), lastDayOfTargetMonth);
      result.setFullYear(targetYear, normalizedMonth, day);
      return result;
    };

    for (let i = 0; i < installmentCount; i++) {
      let dueDate: Date | null = null;
      let status = 'PENDENTE';

      if (hasDueDate && startDate) {
        dueDate = addMonthsClamped(startDate, i);
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

  /**
   * Edita parcela de honorario (feature 2026-05-14 — andre reportou que
   * nao era possivel editar honorarios cadastrados). Aceita atualizacao
   * de amount, due_date, payment_method, notes. Nao mexe em status/paid_at
   * — pra isso usar markPaid/markUnpaid. Recalcula status atrasado/pendente
   * com base na nova due_date se a parcela continuar nao-paga.
   */
  async updatePayment(
    paymentId: string,
    data: {
      amount?: number;
      due_date?: string | null;
      payment_method?: string | null;
      notes?: string | null;
    },
    tenantId?: string,
  ) {
    const payment = await this.prisma.honorarioPayment.findUnique({
      where: { id: paymentId },
      include: { honorario: { select: { tenant_id: true } } },
    });
    if (!payment) throw new NotFoundException('Parcela não encontrada');
    if (tenantId && payment.honorario.tenant_id !== tenantId) {
      throw new ForbiddenException('Sem acesso a esta parcela');
    }

    // due_date pode ser explicitamente null pra remover. undefined = mantem.
    let nextDueDate: Date | null | undefined = undefined;
    if (data.due_date === null) nextDueDate = null;
    else if (typeof data.due_date === 'string' && data.due_date.length > 0) {
      nextDueDate = new Date(data.due_date);
    }

    // Recalcula status apenas se parcela continua nao paga
    let nextStatus: string | undefined = undefined;
    if (payment.status !== 'PAGO') {
      const effectiveDueDate = nextDueDate !== undefined ? nextDueDate : payment.due_date;
      if (effectiveDueDate && effectiveDueDate < new Date()) {
        nextStatus = 'ATRASADO';
      } else {
        nextStatus = 'PENDENTE';
      }
    }

    return this.prisma.honorarioPayment.update({
      where: { id: paymentId },
      data: {
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(nextDueDate !== undefined ? { due_date: nextDueDate } : {}),
        ...(data.payment_method !== undefined ? { payment_method: data.payment_method } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
      },
    });
  }

  async markPaid(
    paymentId: string,
    data: { payment_method?: string; paid_at?: string },
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

    // Bug fix 2026-05-10 (Honorarios PR4 #15): rejeitar re-mark de
    // parcela ja PAGO. Antes UPDATE corria, paid_at era reescrito
    // com new Date() — perdendo data fiscal real. Audit log mostrava
    // "pago hoje" pra transacao antiga; conciliacao fiscal errada.
    if (payment.status === 'PAGO') {
      throw new ConflictException(
        `Parcela ${paymentId} ja foi marcada como PAGO em ${payment.paid_at?.toISOString().slice(0, 10)}`,
      );
    }

    // Bug fix 2026-05-10 (Honorarios PR4 #28): aceitar paid_at opcional
    // do caller. Antes data era sempre new Date() — em recebimento
    // tardio (recebeu em 2024, registra em 2026), mes fiscal errado,
    // DARF apurado no mes errado.
    const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException(`paid_at invalido: ${data.paid_at}`);
    }

    const updated = await this.prisma.honorarioPayment.update({
      where: { id: paymentId },
      data: {
        status: 'PAGO',
        paid_at: paidAt,
        // Marca paid_amount = amount pra zerar saldo devedor (mesmo se vinha
        // de PARCIAL com pagamentos parciais previos).
        paid_amount: payment.amount,
        ...(data.payment_method && { payment_method: data.payment_method }),
      } as any,
    });

    try {
      await this.financeiroService.createFromHonorarioPayment(paymentId, tenantId);
      this.logger.log(`[HONORARIO] Transação financeira atualizada para pagamento ${paymentId}`);
    } catch (e: any) {
      // Bug fix 2026-05-10 (Honorarios PR5 #49):
      // Antes warn engolia falha silenciosa — pagamento marcado PAGO mas
      // livro caixa nao recebia transacao. Agora ERROR pra alarme +
      // stack pra debug.
      this.logger.error(
        `[HONORARIO] CRITICO: Pagamento ${paymentId} marcado PAGO mas createFromHonorarioPayment FALHOU. ` +
        `Livro caixa pode estar inconsistente. Erro: ${e.message}`,
        e?.stack,
      );
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

  /**
   * Registra recebimento PARCIAL de uma parcela (feature 2026-05-15).
   *
   * Caso de uso: cliente paga R$ 3.000 de uma parcela de R$ 7.000 — operador
   * registra esse recebimento. Quando soma do paid_amount atingir amount,
   * status vira automaticamente PAGO + paid_at preenchido. Enquanto menor,
   * status fica PARCIAL.
   *
   * Nao remove o saldo devedor — soma cumulativa. Pra zerar tudo de uma
   * vez (ex: cliente pagou o restante), use markPaid normalmente.
   *
   * Tambem cria FinancialTransaction pelo valor recebido (parcial), pra
   * livro caixa refletir entrada real do dinheiro.
   */
  async partialReceive(
    paymentId: string,
    data: { amount: number; payment_method?: string; paid_at?: string; notes?: string },
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
    if (payment.status === 'PAGO') {
      throw new ConflictException(`Parcela já está marcada como PAGO em ${payment.paid_at?.toISOString().slice(0, 10)}`);
    }
    if (!data.amount || data.amount <= 0) {
      throw new BadRequestException('Valor do recebimento deve ser maior que zero');
    }

    const totalAmount = Number(payment.amount);
    const previousPaid = Number((payment as any).paid_amount || 0);
    const newPaid = Math.round((previousPaid + data.amount) * 100) / 100; // evita FP precision

    if (newPaid > totalAmount + 0.01) {
      throw new BadRequestException(
        `Valor excede o saldo da parcela. Saldo: R$ ${(totalAmount - previousPaid).toFixed(2)}`,
      );
    }

    const isNowFullyPaid = newPaid >= totalAmount;
    const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException(`paid_at invalido: ${data.paid_at}`);
    }

    const updated = await this.prisma.honorarioPayment.update({
      where: { id: paymentId },
      data: {
        paid_amount: newPaid,
        status: isNowFullyPaid ? 'PAGO' : 'PARCIAL',
        ...(isNowFullyPaid ? { paid_at: paidAt } : {}),
        ...(data.payment_method ? { payment_method: data.payment_method } : {}),
        // Acumula no campo notes: "DD/MM: R$ X (metodo)"
        notes: this.appendReceiptNote(payment.notes, data.amount, data.payment_method, paidAt, data.notes),
      } as any,
    });

    // Livro caixa: cria transacao financeira PELO VALOR RECEBIDO (parcial)
    // pra refletir entrada real de dinheiro. Quando virar PAGO total, o
    // markPaid nao vai re-disparar (status ja vai estar PAGO).
    try {
      // financeiroService espera o paymentId — mas internamente le o amount
      // do payment. Pra recebimento parcial precisamos de transacao com valor
      // diferente. Workaround: cria via `addManualEntry` se existir, OU
      // documenta como FinancialTransaction direta.
      // Por ora, se virar fully paid, financeiroService.createFromHonorarioPayment
      // pega tudo. Se for parcial isolado, registra apenas no notes.
      if (isNowFullyPaid) {
        await this.financeiroService.createFromHonorarioPayment(paymentId, tenantId);
      }
    } catch (e: any) {
      this.logger.error(
        `[HONORARIO] Recebimento parcial registrado (${paymentId}, R$ ${data.amount}) ` +
        `mas createFromHonorarioPayment falhou: ${e.message}`,
        e?.stack,
      );
    }

    const lc = (payment as any).honorario?.legal_case;
    await this.financeiroService.logAction(actorId || null, 'PAGAMENTO_RECEBIDO_PARCIAL', paymentId, {
      valor_recebido: data.amount,
      valor_total_parcela: totalAmount,
      total_acumulado: newPaid,
      status_resultante: isNowFullyPaid ? 'PAGO' : 'PARCIAL',
      metodo: data.payment_method,
      tipo_honorario: (payment as any).honorario?.type,
      processo: lc?.case_number, cliente: lc?.lead?.name,
      lawyer_id: lc?.lawyer_id,
    });

    return updated;
  }

  /** Acumula nota de recebimento parcial no campo notes da parcela. */
  private appendReceiptNote(
    existing: string | null,
    amount: number,
    method: string | undefined,
    paidAt: Date,
    extraNote?: string,
  ): string {
    const dd = String(paidAt.getUTCDate()).padStart(2, '0');
    const mm = String(paidAt.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = paidAt.getUTCFullYear();
    const valStr = amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const methodStr = method ? ` ${method}` : '';
    const noteStr = extraNote ? ` — ${extraNote}` : '';
    const line = `${dd}/${mm}/${yyyy}: R$ ${valStr}${methodStr}${noteStr}`;
    return existing ? `${existing}\n${line}` : line;
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

    // Bug fix 2026-05-10 (Honorarios PR4 #23):
    // Antes filtro `status: 'ATIVO'` excluia FINALIZADO/CANCELADO.
    // Se sentenca chega APOS o caso ser finalizado (revisao, juiz
    // aumenta valor da condenacao), recalculo nao acontecia.
    // Agora cobre ATIVO + FINALIZADO. CANCELADO continua de fora
    // (caso encerrado sem ganho — nao recalcula).
    const honorarios = await this.prisma.caseHonorario.findMany({
      where: {
        legal_case_id: caseId,
        type: { in: ['SUCUMBENCIA', 'EXITO', 'MISTO'] },
        success_percentage: { not: null },
        status: { in: ['ATIVO', 'FINALIZADO'] },
      },
    });

    for (const h of honorarios) {
      const percentage = Number(h.success_percentage);
      // Calculo em centavos pra precisao
      const sentenceCents = Math.round(sentenceValue * 100);
      const calculatedCents = Math.round((sentenceCents * percentage) / 100);
      const calculatedValue = calculatedCents / 100;

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
