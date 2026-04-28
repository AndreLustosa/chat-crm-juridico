import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto, UpdateTransactionDto, CreateCategoryDto, UpdateCategoryDto } from './financeiro.dto';
import { cashRegimeWhere, effectiveTransactionDate } from '../common/utils/cash-regime.util';

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

  // ─── Audit Log ──────────────────────────────────────────

  async logAction(userId: string | null, action: string, entityId: string, meta: Record<string, any>) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor_user_id: userId,
          action,
          entity: 'FINANCEIRO',
          entity_id: entityId,
          meta_json: meta,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[AUDIT] Falha ao registrar log: ${e.message}`);
    }
  }

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
    if (query.status) {
      where.status = query.status;
    } else {
      // Por padrão, não mostrar CANCELADO
      where.status = { not: 'CANCELADO' };
    }
    if (query.legalCaseId) where.legal_case_id = query.legalCaseId;
    if (query.leadId) where.lead_id = query.leadId;
    if (query.lawyerId) {
      // Advogado vê: suas transações + despesas gerais visíveis (receitas só dele)
      if (query.type === 'RECEITA') {
        where.lawyer_id = query.lawyerId;
      } else {
        where.OR = [
          { lawyer_id: query.lawyerId },
          { lawyer_id: null, visible_to_lawyer: true },
        ];
      }
    }

    if (query.startDate || query.endDate) {
      const dateFilter: any = {};
      if (query.startDate) dateFilter.gte = new Date(query.startDate);
      if (query.endDate) dateFilter.lte = new Date(query.endDate);

      // Transações do período + vencidas de meses ANTERIORES (não do mesmo mês)
      const existingOr = where.OR || [];
      delete where.OR;
      where.AND = [
        ...(where.AND || []),
        ...(existingOr.length > 0 ? [{ OR: existingOr }] : []),
        { OR: [
          { date: dateFilter },
          // Dívidas de meses anteriores: date ANTES do período + still PENDENTE
          ...(query.startDate ? [{
            status: 'PENDENTE',
            date: { lt: new Date(query.startDate) },
          }] : []),
        ]},
      ];
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
          honorario_payment: {
            select: {
              id: true,
              honorario: {
                select: { type: true, notes: true, sentence_value: true, success_percentage: true },
              },
            },
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

  async createTransaction(data: CreateTransactionDto & { tenant_id?: string; actor_id?: string }) {
    const tx = await this.prisma.financialTransaction.create({
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
        visible_to_lawyer: data.visible_to_lawyer ?? true,
        is_recurring: data.is_recurring ?? false,
        recurrence_pattern: data.is_recurring ? data.recurrence_pattern : null,
        recurrence_day: data.is_recurring ? data.recurrence_day : null,
        recurrence_end_date: data.is_recurring && data.recurrence_end_date ? new Date(data.recurrence_end_date) : null,
      },
      include: {
        lead: { select: { id: true, name: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true } },
        lawyer: { select: { id: true, name: true } },
      },
    });

    const actionType = data.type === 'DESPESA' ? 'DESPESA_CRIADA' : 'RECEITA_CRIADA';
    await this.logAction(data.actor_id || null, actionType, tx.id, {
      tipo: data.type, categoria: data.category, descricao: data.description,
      valor: data.amount, status: data.status || 'PENDENTE',
      processo: tx.legal_case?.case_number, cliente: tx.lead?.name,
      lawyer_id: data.lawyer_id,
    });

    return tx;
  }

  async updateTransaction(id: string, data: UpdateTransactionDto, tenantId?: string, actorId?: string) {
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

    const updated = await this.prisma.financialTransaction.update({
      where: { id },
      data: updateData,
      include: {
        lead: { select: { id: true, name: true } },
        legal_case: { select: { id: true, case_number: true, legal_area: true } },
        lawyer: { select: { id: true, name: true } },
      },
    });

    // Determinar tipo de ação para log
    const isPago = data.status === 'PAGO';
    const isDespesa = updated.type === 'DESPESA';
    let actionType = isDespesa ? 'DESPESA_EDITADA' : 'RECEITA_EDITADA';
    if (isPago) actionType = isDespesa ? 'DESPESA_PAGA' : 'PAGAMENTO_RECEBIDO';
    await this.logAction(actorId || null, actionType, id, {
      campos: Object.keys(updateData), valor: updated.amount ? Number(updated.amount) : undefined,
      descricao: updated.description, status: updated.status,
      metodo: updated.payment_method, lawyer_id: updated.lawyer_id,
    });

    return updated;
  }

  /**
   * Recebimento parcial: cria transação PAGO com o valor recebido e reduz o original.
   */
  async partialPayment(id: string, amount: number, paymentMethod?: string, tenantId?: string, actorId?: string) {
    const original = await this.verifyTransactionAccess(id, tenantId);

    if (original.status === 'PAGO') {
      throw new ConflictException('Transação já está paga');
    }
    if (original.status === 'CANCELADO') {
      throw new ConflictException('Transação está cancelada');
    }

    const originalAmount = Number(original.amount);
    if (amount <= 0 || amount > originalAmount) {
      throw new ConflictException(`Valor deve ser entre R$ 0,01 e R$ ${originalAmount.toFixed(2)}`);
    }

    const remaining = Math.round((originalAmount - amount) * 100) / 100;

    // Criar transação do pagamento parcial recebido
    const partialTx = await this.prisma.financialTransaction.create({
      data: {
        tenant_id: original.tenant_id,
        type: original.type,
        category: original.category,
        description: `${original.description} (parcial)`,
        amount: amount,
        date: new Date(),
        due_date: original.due_date,
        paid_at: new Date(),
        payment_method: paymentMethod || original.payment_method,
        status: 'PAGO',
        legal_case_id: original.legal_case_id,
        lead_id: original.lead_id,
        lawyer_id: original.lawyer_id,
        notes: `Recebimento parcial de R$ ${amount.toFixed(2)}`,
      },
    });

    // Atualizar original: reduzir valor ou marcar como pago se zerou
    if (remaining <= 0) {
      await this.prisma.financialTransaction.update({
        where: { id },
        data: { status: 'PAGO', paid_at: new Date(), amount: 0 },
      });
    } else {
      await this.prisma.financialTransaction.update({
        where: { id },
        data: { amount: remaining },
      });
    }

    await this.logAction(actorId || null, 'PAGAMENTO_PARCIAL', id, {
      valor_recebido: amount, saldo_restante: remaining,
      metodo: paymentMethod, descricao: original.description,
      lawyer_id: original.lawyer_id,
    });

    return { partial: partialTx, remaining };
  }

  async deleteTransaction(id: string, tenantId?: string, actorId?: string) {
    const tx = await this.verifyTransactionAccess(id, tenantId);

    const actionType = tx.type === 'DESPESA' ? 'DESPESA_EXCLUIDA' : 'RECEITA_EXCLUIDA';
    await this.logAction(actorId || null, actionType, id, {
      descricao: tx.description, valor: Number(tx.amount),
      tipo: tx.type, categoria: tx.category, lawyer_id: tx.lawyer_id,
    });

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

    const honorario = (payment as any).honorario;
    const legalCase = honorario?.legal_case;
    const status = payment.status === 'PAGO' ? 'PAGO' : 'PENDENTE';

    // Label do tipo de honorário
    const typeLabels: Record<string, string> = {
      CONTRATUAL: 'Contratuais', SUCUMBENCIA: 'Sucumbência', ENTRADA: 'Entrada', ACORDO: 'Acordo',
      FIXO: 'Fixo', EXITO: 'Êxito', MISTO: 'Misto',
    };
    const typeLabel = typeLabels[honorario?.type] || honorario?.type || '';

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
        description: `Honorário ${typeLabel} - ${legalCase?.case_number || 'Processo'} ${legalCase?.legal_area ? `(${legalCase.legal_area})` : ''}`.trim(),
        amount: payment.amount,
        date: payment.paid_at || payment.due_date || new Date(),
        paid_at: payment.paid_at,
        due_date: payment.due_date,
        payment_method: payment.payment_method,
        status,
        legal_case_id: legalCase?.id || null,
        lead_id: legalCase?.lead_id || null,
        lawyer_id: legalCase?.lawyer_id || null,
        honorario_payment_id: paymentId,
        notes: honorario?.notes || payment.notes || null,
      },
    });
  }

  async createFromLeadHonorarioPayment(paymentId: string, tenantId?: string) {
    const payment = await this.prisma.leadHonorarioPayment.findUnique({
      where: { id: paymentId },
      include: {
        lead_honorario: {
          include: {
            lead: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Pagamento de honorário negociado não encontrado');

    const honorario = (payment as any).lead_honorario;
    const lead = honorario?.lead;
    const status = payment.status === 'PAGO' ? 'PAGO' : 'PENDENTE';

    const typeLabels: Record<string, string> = {
      CONTRATUAL: 'Contratuais', ENTRADA: 'Entrada', ACORDO: 'Acordo',
    };
    const typeLabel = typeLabels[honorario?.type] || honorario?.type || '';

    const existing = await this.prisma.financialTransaction.findUnique({
      where: { lead_honorario_payment_id: paymentId },
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
        tenant_id: tenantId || honorario?.tenant_id || null,
        type: 'RECEITA',
        category: 'HONORARIO',
        description: `Honorário ${typeLabel} - Lead ${lead?.name || 'Sem nome'}`.trim(),
        amount: payment.amount,
        date: payment.paid_at || payment.due_date || new Date(),
        paid_at: payment.paid_at,
        due_date: payment.due_date,
        payment_method: payment.payment_method,
        status,
        lead_id: lead?.id || null,
        lead_honorario_payment_id: paymentId,
        notes: honorario?.notes || payment.notes || null,
      },
    });
  }

  // ─── Audit Log ─────────────────────────────────────────

  async getAuditLog(lawyerId?: string, startDate?: string, endDate?: string, limit = 50, offset = 0) {
    const where: any = { entity: 'FINANCEIRO' };

    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at.gte = new Date(startDate);
      if (endDate) where.created_at.lte = new Date(endDate);
    }

    // Filtrar por advogado via meta_json (PostgreSQL JSONB)
    if (lawyerId) {
      where.meta_json = { path: ['lawyer_id'], equals: lawyerId };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }

  // ─── Summary & Analytics ───────────────────────────────

  async getSummary(tenantId?: string, startDate?: string, endDate?: string, lawyerId?: string) {
    const where: any = {};
    if (tenantId) where.tenant_id = tenantId;
    // Exclude cancelled from aggregation
    where.status = { not: 'CANCELADO' };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    // Filtro de honorários por advogado
    const honorarioWhere: any = {
      status: { in: ['PENDENTE', 'ATRASADO'] },
    };
    if (lawyerId) {
      honorarioWhere.honorario = { legal_case: { lawyer_id: lawyerId } };
    }
    if (tenantId) {
      honorarioWhere.honorario = { ...honorarioWhere.honorario, tenant_id: tenantId };
    }

    // Filtros específicos por tipo para advogado
    const receitaWhere = lawyerId ? { ...where, lawyer_id: lawyerId } : where;
    const despesaWhere = lawyerId
      ? { ...where, OR: [{ lawyer_id: lawyerId }, { lawyer_id: null, visible_to_lawyer: true }] }
      : where;

    // Where para parcelas de lead honorários negociados
    const leadHonWhere: any = {
      status: { in: ['PENDENTE', 'ATRASADO'] },
      lead_honorario: { status: { in: ['NEGOCIANDO', 'ACEITO'] } },
    };
    if (tenantId) {
      leadHonWhere.lead_honorario.tenant_id = tenantId;
    }

    // Pra PAGO em regime de caixa, usa paid_at quando preenchido (helper).
    // Pra PENDENTE, mantemos date (nao houve pagamento ainda).
    const startD = startDate ? new Date(startDate) : null;
    const endD = endDate ? new Date(endDate) : null;

    // Where base sem o filtro de date (cashRegimeWhere substitui)
    const { date: _ignoredDate, ...whereWithoutDate } = where;

    // Receita PAGO: tenant + status not cancelado + (cashRegime com OR) + lawyer
    const receitaPagoWhere: any = { ...whereWithoutDate };
    if (lawyerId) receitaPagoWhere.lawyer_id = lawyerId;
    if (startD && endD) Object.assign(receitaPagoWhere, cashRegimeWhere(startD, endD));

    // Despesa PAGO: combina 2 ORs (lawyer + cashRegime) via AND
    const despesaPagoWhere: any = { ...whereWithoutDate };
    const despesaAnds: any[] = [];
    if (lawyerId) {
      despesaAnds.push({
        OR: [{ lawyer_id: lawyerId }, { lawyer_id: null, visible_to_lawyer: true }],
      });
    }
    if (startD && endD) {
      despesaAnds.push(cashRegimeWhere(startD, endD));
    }
    if (despesaAnds.length === 1) {
      // So 1 condicao — espalha direto (mais simples pro Prisma)
      Object.assign(despesaPagoWhere, despesaAnds[0]);
    } else if (despesaAnds.length > 1) {
      despesaPagoWhere.AND = despesaAnds;
    }

    const [
      totalRevenue,
      totalExpenses,
      totalPayable,
      totalReceivable,
      totalOverdue,
      leadReceivable,
      leadOverdue,
      awaitingAlvaraAgg,
      awaitingAlvaraLeadAgg,
    ] = await Promise.all([
      // Receita efetiva (regime de caixa: paid_at quando preenchido, fallback date)
      this.prisma.financialTransaction.aggregate({
        where: { ...receitaPagoWhere, type: 'RECEITA', status: 'PAGO' },
        _sum: { amount: true },
      }),
      // Despesas pagas (regime de caixa) — advogado vê dele + gerais visíveis
      this.prisma.financialTransaction.aggregate({
        where: { ...despesaPagoWhere, type: 'DESPESA', status: 'PAGO' },
        _sum: { amount: true },
      }),
      // Contas a pagar (despesas PENDENTE)
      this.prisma.financialTransaction.aggregate({
        where: { ...despesaWhere, type: 'DESPESA', status: 'PENDENTE' },
        _sum: { amount: true },
      }),
      // A receber: parcelas de honorários de casos pendentes COM data de vencimento
      // Sem due_date = aguardando alvará/sucumbência → NÃO é "a receber" previsível.
      this.prisma.honorarioPayment.aggregate({
        where: { ...honorarioWhere, status: { in: ['PENDENTE', 'ATRASADO'] }, due_date: { not: null } },
        _sum: { amount: true },
      }),
      // Atrasado: parcelas de casos com due_date vencida
      this.prisma.honorarioPayment.aggregate({
        where: { ...honorarioWhere, status: 'ATRASADO', due_date: { not: null } },
        _sum: { amount: true },
      }),
      // A receber: parcelas de honorários negociados (leads) COM data
      this.prisma.leadHonorarioPayment.aggregate({
        where: { ...leadHonWhere, status: { in: ['PENDENTE', 'ATRASADO'] }, due_date: { not: null } },
        _sum: { amount: true },
      }),
      // Atrasado: parcelas de leads vencidas
      this.prisma.leadHonorarioPayment.aggregate({
        where: { ...leadHonWhere, status: 'ATRASADO', due_date: { not: null } },
        _sum: { amount: true },
      }),
      // Aguardando alvará/sucumbência: parcelas SEM due_date (case)
      this.prisma.honorarioPayment.aggregate({
        where: { ...honorarioWhere, status: { in: ['PENDENTE', 'ATRASADO'] }, due_date: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Aguardando alvará: leads sem due_date
      this.prisma.leadHonorarioPayment.aggregate({
        where: { ...leadHonWhere, status: { in: ['PENDENTE', 'ATRASADO'] }, due_date: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const revenue = Number(totalRevenue._sum.amount || 0);
    const expenses = Number(totalExpenses._sum.amount || 0);
    const payable = Number(totalPayable._sum.amount || 0);
    const receivable = Number(totalReceivable._sum.amount || 0) + Number(leadReceivable._sum.amount || 0);
    const overdue = Number(totalOverdue._sum.amount || 0) + Number(leadOverdue._sum.amount || 0);
    const awaitingAlvaraTotal =
      Number(awaitingAlvaraAgg._sum.amount || 0) + Number(awaitingAlvaraLeadAgg._sum.amount || 0);
    const awaitingAlvaraCount =
      (awaitingAlvaraAgg._count?._all || 0) + (awaitingAlvaraLeadAgg._count?._all || 0);

    return {
      totalRevenue: revenue,
      totalExpenses: expenses,
      totalPayable: payable,
      totalReceivable: receivable,
      totalOverdue: overdue,
      balance: revenue - expenses,
      // Novos campos: parcelas sem previsão (alvará/sucumbência) — não entram em "a receber"
      awaitingAlvara: {
        total: awaitingAlvaraTotal,
        count: awaitingAlvaraCount,
      },
    };
  }

  async getCashFlow(
    tenantId?: string,
    startDate?: string,
    endDate?: string,
    groupBy: 'day' | 'week' | 'month' = 'month',
  ) {
    // Cash flow = regime de caixa: agrupa pela data efetiva (paid_at quando
    // preenchido, fallback date). Inclui transacoes PAGAS dentro do range
    // pelo paid_at, e PENDENTES pelo date (forecast).
    const startD = startDate ? new Date(startDate) : null;
    const endD = endDate ? new Date(endDate) : null;

    const where: any = { status: { not: 'CANCELADO' } };
    if (tenantId) where.tenant_id = tenantId;

    if (startD && endD) {
      // Filtra: PAGAS no range (paid_at) OU PENDENTES no range (date)
      where.OR = [
        { status: 'PAGO', paid_at: { gte: startD, lte: endD } },
        { status: 'PAGO', paid_at: null, date: { gte: startD, lte: endD } },
        { status: 'PENDENTE', date: { gte: startD, lte: endD } },
      ];
    }

    const transactions = await this.prisma.financialTransaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
        date: true,
        paid_at: true,
        status: true,
      },
      orderBy: { date: 'asc' },
    });

    // Group by period
    const groupedMap = new Map<string, { entries: number; exits: number; balance: number }>();

    for (const tx of transactions) {
      // Data efetiva pra agrupamento: paid_at se preenchido + status=PAGO,
      // senao date (cobre PENDENTES e PAGOS legados)
      const date = effectiveTransactionDate(tx as any);
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
