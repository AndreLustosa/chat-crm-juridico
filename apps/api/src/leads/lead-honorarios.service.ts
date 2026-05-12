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
   * Verifica ownership de LeadHonorario via tenant. Defense-in-depth.
   *
   * Bug fix 2026-05-12 (Leads PR2 #A1 — STRICTER):
   * Antes: o check `if (tenantId && honorario.tenant_id && ...)` pulava
   * a validacao se qualquer dos lados fosse null/undefined → cross-tenant
   * em registros legados com tenant_id=null. Agora: tenant_id strict
   * required (NotFound se nao bater — nao revela existencia).
   */
  private async assertHonorarioTenant(id: string, tenantId: string): Promise<{ tenant_id: string | null; status: string; lead_id: string; type: string; installment_count: number }> {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio');
    }
    const honorario = await this.prisma.leadHonorario.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true, tenant_id: true, status: true, lead_id: true, type: true, installment_count: true },
    });
    if (!honorario) {
      throw new NotFoundException('Honorário não encontrado');
    }
    return honorario;
  }

  /** Verifica ownership de LeadHonorarioPayment (busca o honorario pai). */
  private async assertPaymentTenant(paymentId: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio');
    }
    const payment = await this.prisma.leadHonorarioPayment.findFirst({
      where: {
        id: paymentId,
        lead_honorario: { tenant_id: tenantId },
      },
      include: {
        lead_honorario: {
          select: { id: true, tenant_id: true, status: true, lead: { select: { name: true } } },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException('Parcela não encontrada');
    }
    return payment;
  }

  // ─── Queries ────────────────────────────────────────────

  async findByLead(leadId: string, tenantId: string) {
    // PR2 #A1: tenant obrigatorio + filtra EXCLUIDO (soft delete)
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em findByLead');
    }
    return this.prisma.leadHonorario.findMany({
      where: {
        lead_id: leadId,
        tenant_id: tenantId,
        status: { not: 'EXCLUIDO' }, // PR2 #A3: oculta soft-deleted
      },
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
  }, tenantId: string, actorUserId?: string) {
    // Bug fix 2026-05-12 (Leads PR2 #A1): tenant obrigatorio
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em create honorario');
    }
    // Bug fix 2026-05-12 (Leads PR2 #A4):
    // Validacao anti-NaN/Infinity em valores monetarios.
    // Antes: total_value <= 0 NAO pegava NaN (NaN <= 0 eh false → passava).
    // 1e308 passava em @IsNumber/@Min mas estoura Math.round depois.
    if (!Number.isFinite(data.total_value) || data.total_value <= 0 || data.total_value > 100_000_000) {
      throw new BadRequestException('Valor total invalido. Deve ser numero finito entre 0.01 e 100 milhoes.');
    }

    const validTypes = ['CONTRATUAL', 'ENTRADA', 'ACORDO'];
    if (!validTypes.includes(data.type)) {
      throw new BadRequestException(`Tipo inválido. Use: ${validTypes.join(', ')}`);
    }

    if (!data.payments || data.payments.length === 0) {
      throw new BadRequestException('Informe pelo menos uma parcela');
    }

    // PR2 #A4: cap em quantidade de parcelas (anti-abuse + sanity)
    if (data.payments.length > 120) {
      throw new BadRequestException('Maximo 120 parcelas por honorario');
    }

    // PR2 #A4: validacao individual de cada amount
    for (const p of data.payments) {
      if (!Number.isFinite(p.amount) || p.amount <= 0 || p.amount > 100_000_000) {
        throw new BadRequestException(`Valor da parcela invalido: ${p.amount}. Cada parcela deve ser finita entre 0.01 e 100 milhoes.`);
      }
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

    // PR2 #A1: usa tenantId direto (sem fallback DEFAULT_TENANT)
    const created = await this.prisma.leadHonorario.create({
      data: {
        lead_id: leadId,
        tenant_id: tenantId,
        type: data.type,
        total_value: data.total_value,
        installment_count: data.payments.length,
        notes: data.notes?.slice(0, 2000) || null,
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

    // PR2 #A6: audit log obrigatorio em criacao financeira
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'honorario_create',
        entity: 'LeadHonorario',
        entity_id: created.id,
        meta_json: {
          tenant_id: tenantId,
          lead_id: leadId,
          type: data.type,
          installment_count: data.payments.length,
          // NAO logar total_value (LGPD)
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return created;
  }

  async update(id: string, data: {
    type?: string;
    total_value?: number;
    notes?: string;
    status?: string;
  }, tenantId: string, actorUserId?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em update honorario');
    }
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

    // PR2 #A4: valida total_value se fornecido
    if (data.total_value !== undefined) {
      if (!Number.isFinite(data.total_value) || data.total_value <= 0 || data.total_value > 100_000_000) {
        throw new BadRequestException('Valor total invalido (numero finito entre 0.01 e 100 milhoes)');
      }
    }

    const updated = await this.prisma.leadHonorario.update({
      where: { id },
      data: {
        ...(data.type && { type: data.type }),
        ...(data.total_value !== undefined && { total_value: data.total_value }),
        ...(data.notes !== undefined && { notes: String(data.notes).slice(0, 2000) }),
        ...(data.status && { status: data.status }),
      },
      include: { payments: { orderBy: { due_date: 'asc' } } },
    });

    // PR2 #A6: audit log
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'honorario_update',
        entity: 'LeadHonorario',
        entity_id: id,
        meta_json: {
          tenant_id: tenantId,
          changed_fields: Object.keys(data),
          old_status: existing.status,
          new_status: data.status || existing.status,
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return updated;
  }

  /**
   * Bug fix 2026-05-12 (Leads PR2 #A3 — CRITICO LGPD/contabil):
   * Soft delete em vez de hard delete. Honorarios sao registros financeiros —
   * Receita Federal exige guarda de 5 anos + LGPD exige rastreabilidade.
   * Hard delete em produc¸ao quebrava esses requisitos.
   *
   * Strategy: usa status='EXCLUIDO' como marker (campo deleted_at nao existe
   * no schema, evita migration). Queries de listagem ja filtram por status
   * com whitelist NEGOCIANDO/ACEITO/RECUSADO/CONVERTIDO — EXCLUIDO some
   * naturalmente das listas. Audit log obrigatorio.
   */
  async delete(id: string, tenantId: string, actorUserId?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em delete honorario');
    }
    const existing = await this.assertHonorarioTenant(id, tenantId);
    if (existing.status === 'CONVERTIDO') {
      throw new ForbiddenException('Honorário já convertido não pode ser excluído');
    }

    // Soft delete (status='EXCLUIDO') em vez de hard delete
    await this.prisma.leadHonorario.update({
      where: { id },
      data: { status: 'EXCLUIDO' },
    });

    // Audit log obrigatorio (LGPD + contabil)
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'honorario_delete',
        entity: 'LeadHonorario',
        entity_id: id,
        meta_json: {
          tenant_id: tenantId,
          previous_status: existing.status,
          type: existing.type,
          installment_count: existing.installment_count,
          note: 'Soft delete via status=EXCLUIDO. Recuperavel via UPDATE manual no banco.',
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return { ok: true };
  }

  // ─── Parcelas (Payments) ────────────────────────────────

  async addPayment(leadHonorarioId: string, data: { amount: number; due_date: string }, tenantId: string, actorUserId?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em addPayment');
    }
    // PR2 #A4: valida amount
    if (!Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 100_000_000) {
      throw new BadRequestException('Valor da parcela invalido (numero finito entre 0.01 e 100 milhoes)');
    }
    const hon = await this.assertHonorarioTenant(leadHonorarioId, tenantId);
    if (hon.status === 'CONVERTIDO') throw new ForbiddenException('Honorário já convertido');
    if (hon.status === 'EXCLUIDO') throw new ForbiddenException('Honorário excluido nao aceita parcelas');

    const dueDate = new Date(data.due_date);
    if (isNaN(dueDate.getTime())) {
      throw new BadRequestException('Data de vencimento invalida');
    }

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

    // PR2 #A6: audit log
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'honorario_payment_add',
        entity: 'LeadHonorarioPayment',
        entity_id: payment.id,
        meta_json: {
          tenant_id: tenantId,
          honorario_id: leadHonorarioId,
          due_date: dueDate.toISOString(),
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return payment;
  }

  async deletePayment(paymentId: string, tenantId: string, actorUserId?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio em deletePayment');
    }
    const payment = await this.assertPaymentTenant(paymentId, tenantId);
    if (payment.status === 'PAGO') throw new ForbiddenException('Parcela já paga não pode ser excluída');

    await this.prisma.leadHonorarioPayment.delete({ where: { id: paymentId } });

    // Atualizar contagem
    const count = await this.prisma.leadHonorarioPayment.count({ where: { lead_honorario_id: payment.lead_honorario_id } });
    await this.prisma.leadHonorario.update({
      where: { id: payment.lead_honorario_id },
      data: { installment_count: count },
    });

    // PR2 #A6: audit log (delete de parcela financeira)
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'honorario_payment_delete',
        entity: 'LeadHonorarioPayment',
        entity_id: paymentId,
        meta_json: {
          tenant_id: tenantId,
          honorario_id: payment.lead_honorario_id,
          previous_status: payment.status,
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return { ok: true };
  }

  async markPaid(paymentId: string, data: { payment_method?: string }, tenantId: string, actorUserId?: string) {
    // Bug fix 2026-05-10 (PR1 #5): valida ownership ANTES de marcar como PAGO.
    const payment = await this.assertPaymentTenant(paymentId, tenantId);

    // Bug fix 2026-05-12 (Leads PR2 #A2 — CRITICO):
    // Race condition em double-click. Antes: dois cliques simultaneos disparavam
    // 2 updates (idempotente) MAS 2 chamadas a createFromLeadHonorarioPayment →
    // receita duplicada no livro caixa.
    // Agora: updateMany com WHERE status != 'PAGO' + check count=0 (claim) +
    // dispara financeiro SO se foi o claimer.
    const claim = await this.prisma.leadHonorarioPayment.updateMany({
      where: { id: paymentId, status: { not: 'PAGO' } },
      data: {
        status: 'PAGO',
        paid_at: new Date(),
        ...(data.payment_method && { payment_method: data.payment_method }),
      },
    });

    if (claim.count === 0) {
      // Outro request ja marcou como PAGO. Retorna o estado atual sem
      // disparar novamente o financeiro (idempotente).
      this.logger.log(`[LEAD-HON] Pagamento ${paymentId} ja estava PAGO — request idempotente`);
      const existing = await this.prisma.leadHonorarioPayment.findUnique({
        where: { id: paymentId },
      });
      return existing;
    }

    // Audit log do pagamento (LGPD + contabil)
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'honorario_payment_paid',
        entity: 'LeadHonorarioPayment',
        entity_id: paymentId,
        meta_json: {
          tenant_id: tenantId,
          honorario_id: payment.lead_honorario_id,
          payment_method: data.payment_method || null,
          // NAO logar amount (LGPD — info financeira)
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    try {
      await this.financeiroService.createFromLeadHonorarioPayment(paymentId, payment.lead_honorario.tenant_id || undefined);
      this.logger.log(`[LEAD-HON] Transação financeira criada para pagamento ${paymentId}`);
    } catch (e: any) {
      this.logger.error(
        `[LEAD-HON] CRITICO: Pagamento ${paymentId} marcado PAGO mas createFromLeadHonorarioPayment FALHOU. ` +
        `Livro caixa pode estar inconsistente. Erro: ${e.message}`,
        e?.stack,
      );
    }

    return this.prisma.leadHonorarioPayment.findUnique({ where: { id: paymentId } });
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
