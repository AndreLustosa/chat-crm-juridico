import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Service de Metas Mensais — 3 dimensoes:
 *  - escopo: escritorio (lawyer_id=null) ou advogado especifico
 *  - tipo: REALIZED (caixa) ou CONTRACTED (vendido)
 *  - mes/ano + tenant_id (multi-tenant)
 *
 * Calculo de atingimento:
 *  - REALIZED: soma FinancialTransaction com type=RECEITA, status=PAGO,
 *    paid_at no mes. Quando lawyer_id, filtra por lawyer_id da transaction.
 *  - CONTRACTED: soma CaseHonorario.total_value + LeadHonorario.total_value
 *    cuja data de contratacao (contract_date || created_at) cai no mes.
 *    Quando lawyer_id, filtra por lawyer_id do legal_case (lead-honorarios
 *    nao tem advogado, so entram no escopo escritorio).
 *
 * Permissoes (validadas no controller):
 *  - ADMIN/FINANCEIRO: tudo
 *  - ASSOCIADO/ADVOGADO: GET so do proprio + escritorio; sem write
 *  - ESTAGIARIO: nada
 */

export type GoalKind = 'REALIZED' | 'CONTRACTED';
export type GoalScope = 'OFFICE' | string; // 'OFFICE' = escritorio, UUID = lawyer_id

@Injectable()
export class MonthlyGoalsService {
  private readonly logger = new Logger(MonthlyGoalsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────

  private startOfMonth(year: number, month: number): Date {
    return new Date(Date.UTC(year, month - 1, 1));
  }

  private endOfMonth(year: number, month: number): Date {
    return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  }

  /** Resolve lawyer_id a partir do scope ('OFFICE' | UUID). */
  private resolveLawyerId(scope?: string | null): string | null {
    if (!scope || scope === 'OFFICE') return null;
    return scope;
  }

  /** Numero de dias no mes (28-31). */
  private daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  // ─── Listagem ─────────────────────────────────────────

  /**
   * Lista metas com calculo de atingimento e projecao.
   *
   * @param scope 'OFFICE' | lawyer_id | undefined (todos)
   *              ASSOCIADO sempre forca scope a 'OFFICE' OU req.user.id no controller.
   */
  async list(params: {
    tenantId?: string;
    year?: number;
    scope?: GoalScope;
    kind?: GoalKind;
    /** Para ASSOCIADO: limita visibilidade a OFFICE + proprio */
    visibleScopes?: Array<string | null>;
  }) {
    const { tenantId, year, scope, kind, visibleScopes } = params;
    const targetYear = year || new Date().getUTCFullYear();

    const where: any = {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      year: targetYear,
      deleted_at: null,
    };

    if (scope !== undefined) {
      where.lawyer_id = this.resolveLawyerId(scope);
    }
    if (kind) where.kind = kind;

    // ASSOCIADO: limita a OFFICE + proprio. visibleScopes = [null, userId]
    if (visibleScopes !== undefined) {
      const allowed: any[] = [];
      if (visibleScopes.includes(null)) allowed.push({ lawyer_id: null });
      const ids = visibleScopes.filter((s): s is string => !!s);
      if (ids.length) allowed.push({ lawyer_id: { in: ids } });
      if (allowed.length === 0) return [];
      where.OR = allowed;
    }

    const goals = await this.prisma.monthlyGoal.findMany({
      where,
      include: {
        lawyer: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
      },
      orderBy: [{ month: 'asc' }, { kind: 'asc' }, { lawyer_id: 'asc' }],
    });

    // Enriquece cada meta com atingimento real + projecao
    const enriched = await Promise.all(
      goals.map(async (g) => {
        const realized = await this.computeRealizedValue({
          tenantId,
          year: g.year,
          month: g.month,
          lawyerId: g.lawyer_id,
          kind: g.kind as GoalKind,
        });
        const target = Number(g.value);
        const progressPct = target > 0 ? (realized / target) * 100 : 0;

        // Projecao: so faz sentido pra mes corrente
        const today = new Date();
        const isCurrentMonth =
          today.getUTCFullYear() === g.year && today.getUTCMonth() + 1 === g.month;

        let projection: number | null = null;
        if (isCurrentMonth) {
          const dayOfMonth = today.getUTCDate();
          const daysInMo = this.daysInMonth(g.year, g.month);
          if (dayOfMonth >= 1) {
            projection = (realized / dayOfMonth) * daysInMo;
          }
        }

        // Cor da barra com ressalva temporal (regra do spec)
        const status = this.computeStatus(progressPct, g.year, g.month);

        return {
          id: g.id,
          year: g.year,
          month: g.month,
          kind: g.kind as GoalKind,
          scope: g.lawyer_id ? 'LAWYER' : 'OFFICE',
          lawyerId: g.lawyer_id,
          lawyerName: g.lawyer?.name || null,
          target,
          realized,
          progressPct,
          projection,
          status,
          createdBy: g.created_by ? { id: g.created_by.id, name: g.created_by.name } : null,
          createdAt: g.created_at.toISOString(),
          updatedAt: g.updated_at.toISOString(),
        };
      }),
    );

    return enriched;
  }

  /**
   * Cor da barra de progresso considerando ressalva temporal.
   *
   * Regra: vermelho so dispara se % do mes decorrido > % atingido + 20pp.
   * Exemplo: dia 5 de um mes com 30 dias = 16% decorrido. Se a meta esta
   * em 20%, nao alerta vermelho. Se esta em 0%, ainda nao alerta (16-0 < 20).
   * Mas no dia 25 (83% decorrido) com 20% atingido, ALERTA (83-20 = 63pp).
   */
  private computeStatus(progressPct: number, year: number, month: number): 'on_track' | 'warning' | 'behind' | 'achieved' {
    if (progressPct >= 100) return 'achieved';
    if (progressPct >= 80) return 'on_track';

    // Pra meses ja fechados, regra simples (sem ressalva temporal)
    const today = new Date();
    const isPastMonth = year < today.getUTCFullYear() ||
      (year === today.getUTCFullYear() && month < today.getUTCMonth() + 1);
    if (isPastMonth) {
      if (progressPct >= 50) return 'warning';
      return 'behind';
    }

    // Mes futuro: sempre on_track (ainda nem comecou ou comecou hoje)
    const isFutureMonth = year > today.getUTCFullYear() ||
      (year === today.getUTCFullYear() && month > today.getUTCMonth() + 1);
    if (isFutureMonth) return 'on_track';

    // Mes corrente: aplica ressalva
    const dayOfMonth = today.getUTCDate();
    const daysInMo = this.daysInMonth(year, month);
    const elapsedPct = (dayOfMonth / daysInMo) * 100;

    // 'behind' = % decorrido > % atingido + 20pp (ritmo claramente abaixo)
    if (elapsedPct > progressPct + 20) return 'behind';
    // 'warning' = % decorrido > % atingido (atrasado mas nao critico)
    if (elapsedPct > progressPct) return 'warning';
    return 'on_track';
  }

  /**
   * Calcula o valor realizado/contratado pra um mes especifico.
   *
   * REALIZED:
   *   FinancialTransaction { type: 'RECEITA', status: 'PAGO', paid_at IN [monthStart, monthEnd] }
   *   + filtro lawyer_id se escopo individual
   *
   * CONTRACTED:
   *   CaseHonorario.total_value onde COALESCE(contract_date, created_at) IN [monthStart, monthEnd]
   *   + LeadHonorario.total_value onde created_at IN [monthStart, monthEnd]
   *   + filtro lawyer_id (so case-honorarios) se escopo individual.
   *
   * Lead-honorarios so somam no escopo OFFICE (nao tem advogado vinculado).
   */
  async computeRealizedValue(params: {
    tenantId?: string;
    year: number;
    month: number;
    lawyerId: string | null;
    kind: GoalKind;
  }): Promise<number> {
    const { tenantId, year, month, lawyerId, kind } = params;
    const monthStart = this.startOfMonth(year, month);
    const monthEnd = this.endOfMonth(year, month);

    if (kind === 'REALIZED') {
      const where: any = {
        type: 'RECEITA',
        status: 'PAGO',
        paid_at: { gte: monthStart, lte: monthEnd },
      };
      if (tenantId) where.tenant_id = tenantId;
      if (lawyerId) where.lawyer_id = lawyerId;
      const agg = await this.prisma.financialTransaction.aggregate({
        where,
        _sum: { amount: true },
      });
      return Number(agg._sum.amount || 0);
    }

    // CONTRACTED — soma case + lead
    const caseWhere: any = {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      OR: [
        { contract_date: { gte: monthStart, lte: monthEnd } },
        // Quando contract_date e null, usa created_at como fallback
        { contract_date: null, created_at: { gte: monthStart, lte: monthEnd } },
      ],
    };
    if (lawyerId) caseWhere.legal_case = { lawyer_id: lawyerId };

    const caseAgg = await this.prisma.caseHonorario.aggregate({
      where: caseWhere,
      _sum: { total_value: true },
    });

    let leadTotal = 0;
    if (!lawyerId) {
      // Lead-honorarios so somam no escopo OFFICE
      const leadWhere: any = {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        created_at: { gte: monthStart, lte: monthEnd },
      };
      const leadAgg = await this.prisma.leadHonorario.aggregate({
        where: leadWhere,
        _sum: { total_value: true },
      });
      leadTotal = Number(leadAgg._sum.total_value || 0);
    }

    return Number(caseAgg._sum.total_value || 0) + leadTotal;
  }

  // ─── Resumo do mes corrente (pra card do dashboard) ───

  async getCurrentMonthSummary(params: {
    tenantId?: string;
    scope?: GoalScope;
    kind?: GoalKind;
  }) {
    const { tenantId, scope = 'OFFICE', kind = 'REALIZED' } = params;
    const lawyerId = this.resolveLawyerId(scope);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const goal = await this.prisma.monthlyGoal.findFirst({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        lawyer_id: lawyerId,
        year,
        month,
        kind,
        deleted_at: null,
      },
    });

    const realized = await this.computeRealizedValue({
      tenantId,
      year,
      month,
      lawyerId,
      kind,
    });

    if (!goal) {
      return {
        hasGoal: false,
        scope: lawyerId ? 'LAWYER' : 'OFFICE',
        lawyerId,
        kind,
        year,
        month,
        target: null,
        realized,
        progressPct: null,
        projection: null,
        status: null,
      };
    }

    const target = Number(goal.value);
    const progressPct = target > 0 ? (realized / target) * 100 : 0;
    const dayOfMonth = now.getUTCDate();
    const daysInMo = this.daysInMonth(year, month);
    const projection = dayOfMonth >= 1 ? (realized / dayOfMonth) * daysInMo : null;
    const status = this.computeStatus(progressPct, year, month);

    return {
      hasGoal: true,
      goalId: goal.id,
      scope: lawyerId ? 'LAWYER' : 'OFFICE',
      lawyerId,
      kind,
      year,
      month,
      target,
      realized,
      progressPct,
      projection,
      status,
    };
  }

  // ─── Cadastro / Edicao ────────────────────────────────

  /**
   * Calcula meses afetados em qualquer dos 3 modos (single, yearly, replicate)
   * pra confirmar overwrite antes de gravar.
   */
  computeMonthsAffected(input: {
    mode: 'single' | 'yearly' | 'replicate';
    year: number;
    month?: number;
    monthsToReplicate?: number;
  }): Array<{ year: number; month: number }> {
    if (input.mode === 'single') {
      if (!input.month) throw new BadRequestException('month obrigatorio em mode=single');
      return [{ year: input.year, month: input.month }];
    }
    if (input.mode === 'yearly') {
      return Array.from({ length: 12 }, (_, i) => ({ year: input.year, month: i + 1 }));
    }
    // replicate
    if (!input.month || !input.monthsToReplicate || input.monthsToReplicate < 1) {
      throw new BadRequestException('month + monthsToReplicate obrigatorios em mode=replicate');
    }
    const months: Array<{ year: number; month: number }> = [];
    let y = input.year;
    let m = input.month;
    for (let i = 0; i < input.monthsToReplicate; i++) {
      months.push({ year: y, month: m });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return months;
  }

  /**
   * Detecta conflitos (metas existentes que serao sobrescritas).
   * Usado pra dialog de confirmacao no frontend.
   */
  async findConflicts(params: {
    tenantId?: string;
    scope: GoalScope;
    kinds: GoalKind[];
    months: Array<{ year: number; month: number }>;
  }) {
    const { tenantId, scope, kinds, months } = params;
    const lawyerId = this.resolveLawyerId(scope);

    const conflicts = await this.prisma.monthlyGoal.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        lawyer_id: lawyerId,
        kind: { in: kinds },
        deleted_at: null,
        OR: months.map(({ year, month }) => ({ year, month })),
      },
      select: { id: true, year: true, month: true, kind: true, value: true },
    });

    return conflicts.map((c) => ({
      id: c.id,
      year: c.year,
      month: c.month,
      kind: c.kind as GoalKind,
      currentValue: Number(c.value),
    }));
  }

  /**
   * Cria/atualiza metas em batch nos 3 modos. Idempotente: chamada repetida
   * com mesmos parametros produz mesmo resultado.
   *
   * @param kinds 'REALIZED' | 'CONTRACTED' | 'BOTH' — quando 'BOTH', cria
   *              um registro de cada tipo com o mesmo valor.
   */
  async upsert(params: {
    tenantId?: string;
    actorId: string;
    scope: GoalScope;
    kind: 'REALIZED' | 'CONTRACTED' | 'BOTH';
    value: number;
    mode: 'single' | 'yearly' | 'replicate';
    year: number;
    month?: number;
    monthsToReplicate?: number;
    /** Confirmacao explicita pra sobrescrever metas existentes */
    overwriteConfirmed?: boolean;
  }) {
    const {
      tenantId, actorId, scope, kind, value, mode, year, month, monthsToReplicate,
      overwriteConfirmed,
    } = params;

    if (value < 0) throw new BadRequestException('value deve ser >= 0');

    const lawyerId = this.resolveLawyerId(scope);
    const months = this.computeMonthsAffected({ mode, year, month, monthsToReplicate });
    const kinds: GoalKind[] = kind === 'BOTH' ? ['REALIZED', 'CONTRACTED'] : [kind];

    // Mode 'yearly' divide o valor total por 12 — exceto em 'single'/'replicate' onde
    // o valor e por mes.
    const valuePerMonth = mode === 'yearly' ? +(value / 12).toFixed(2) : value;

    // Detecta conflitos
    const conflicts = await this.findConflicts({ tenantId, scope, kinds, months });
    if (conflicts.length > 0 && !overwriteConfirmed) {
      return {
        requiresConfirmation: true,
        conflicts,
        wouldAffect: months.length * kinds.length,
      };
    }

    // Soft-delete metas em conflito (preserva historico) e cria as novas
    // dentro de uma transacao pra garantir atomicidade.
    await this.prisma.$transaction(async (tx) => {
      if (conflicts.length > 0) {
        await tx.monthlyGoal.updateMany({
          where: { id: { in: conflicts.map((c) => c.id) } },
          data: { deleted_at: new Date() },
        });
      }
      for (const m of months) {
        for (const k of kinds) {
          await tx.monthlyGoal.create({
            data: {
              tenant_id: tenantId || null,
              lawyer_id: lawyerId,
              year: m.year,
              month: m.month,
              kind: k,
              value: valuePerMonth,
              created_by_id: actorId,
            },
          });
        }
      }
    });

    this.logger.log(
      `[GOALS] ${actorId} criou ${months.length}x${kinds.length} metas | scope=${scope} | mode=${mode} | valor=${valuePerMonth}/mes`,
    );

    return {
      requiresConfirmation: false,
      created: months.length * kinds.length,
      replaced: conflicts.length,
    };
  }

  /**
   * Edita o valor de uma meta especifica. Mantem o id (atualiza in-place).
   */
  async updateValue(params: {
    tenantId?: string;
    actorId: string;
    goalId: string;
    value: number;
  }) {
    const { tenantId, goalId, value, actorId } = params;
    if (value < 0) throw new BadRequestException('value deve ser >= 0');

    const goal = await this.prisma.monthlyGoal.findFirst({
      where: {
        id: goalId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        deleted_at: null,
      },
    });
    if (!goal) throw new NotFoundException('Meta não encontrada');

    const updated = await this.prisma.monthlyGoal.update({
      where: { id: goalId },
      data: { value, updated_at: new Date() },
    });

    this.logger.log(`[GOALS] ${actorId} editou meta ${goalId}: ${goal.value} -> ${value}`);
    return updated;
  }

  /**
   * Soft delete da meta. Preserva historico.
   */
  async softDelete(params: { tenantId?: string; actorId: string; goalId: string }) {
    const { tenantId, goalId, actorId } = params;

    const goal = await this.prisma.monthlyGoal.findFirst({
      where: {
        id: goalId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        deleted_at: null,
      },
    });
    if (!goal) throw new NotFoundException('Meta não encontrada');

    await this.prisma.monthlyGoal.update({
      where: { id: goalId },
      data: { deleted_at: new Date() },
    });

    this.logger.log(`[GOALS] ${actorId} deletou meta ${goalId} (soft delete)`);
    return { deleted: true };
  }
}
