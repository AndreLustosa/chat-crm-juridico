import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cashRegimeWhere } from '../common/utils/cash-regime.util';

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
      // Regime de caixa: paid_at quando preenchido (fluxo correto do Asaas),
      // fallback pra date (dados legados). Helper compartilhado com KPI,
      // summary, cash-flow, sparkline — todos usam mesma definicao agora.
      const where: any = {
        type: 'RECEITA',
        status: 'PAGO',
        ...cashRegimeWhere(monthStart, monthEnd),
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

    // Busca meta + nome do advogado em paralelo (nome usado no subtitulo do card)
    const [goal, lawyer, realized, officeFallback] = await Promise.all([
      this.prisma.monthlyGoal.findFirst({
        where: {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          lawyer_id: lawyerId,
          year, month, kind,
          deleted_at: null,
        },
      }),
      lawyerId
        ? this.prisma.user.findUnique({ where: { id: lawyerId }, select: { id: true, name: true } })
        : Promise.resolve(null),
      this.computeRealizedValue({ tenantId, year, month, lawyerId, kind }),
      // Fallback OFFICE: quando filtro=advogado e ele nao tem meta individual,
      // a UI pode mostrar a meta do escritorio. Pra escopo OFFICE, isso e null.
      lawyerId
        ? this.prisma.monthlyGoal.findFirst({
            where: {
              ...(tenantId ? { tenant_id: tenantId } : {}),
              lawyer_id: null,
              year, month, kind,
              deleted_at: null,
            },
          })
        : Promise.resolve(null),
    ]);

    const dayOfMonth = now.getUTCDate();
    const daysInMo = this.daysInMonth(year, month);

    if (!goal) {
      return {
        hasGoal: false,
        scope: lawyerId ? 'LAWYER' : 'OFFICE',
        lawyerId,
        lawyerName: lawyer?.name || null,
        kind,
        year,
        month,
        target: null,
        realized,
        progressPct: null,
        projection: null,
        status: null,
        // Fallback meta do escritorio quando lawyer nao tem propria
        officeFallback: officeFallback
          ? { goalId: officeFallback.id, target: Number(officeFallback.value) }
          : null,
      };
    }

    const target = Number(goal.value);
    const progressPct = target > 0 ? (realized / target) * 100 : 0;
    const projection = dayOfMonth >= 1 ? (realized / dayOfMonth) * daysInMo : null;
    const status = this.computeStatus(progressPct, year, month);

    return {
      hasGoal: true,
      goalId: goal.id,
      scope: lawyerId ? 'LAWYER' : 'OFFICE',
      lawyerId,
      lawyerName: lawyer?.name || null,
      kind,
      year,
      month,
      target,
      realized,
      progressPct,
      projection,
      status,
      officeFallback: null,
    };
  }

  // ─── Cadastro / Edicao ────────────────────────────────

  /**
   * Calcula meses afetados em qualquer dos 4 modos (single, yearly, replicate,
   * custom). Pra confirmar overwrite antes de gravar.
   *
   * Modo 'custom' aceita um array `monthlyValues` com {year, month, value}
   * arbitrarios — cobre yearly-weighted (12 meses com valores diferentes),
   * meses esparsos (ex: so trimestre Q4), ou import CSV.
   */
  computeMonthsAffected(input: {
    mode: 'single' | 'yearly' | 'replicate' | 'custom';
    year: number;
    month?: number;
    monthsToReplicate?: number;
    monthlyValues?: Array<{ year: number; month: number; value: number }>;
  }): Array<{ year: number; month: number }> {
    if (input.mode === 'single') {
      if (!input.month) throw new BadRequestException('month obrigatorio em mode=single');
      return [{ year: input.year, month: input.month }];
    }
    if (input.mode === 'yearly') {
      return Array.from({ length: 12 }, (_, i) => ({ year: input.year, month: i + 1 }));
    }
    if (input.mode === 'custom') {
      if (!input.monthlyValues || input.monthlyValues.length === 0) {
        throw new BadRequestException('monthlyValues obrigatorio em mode=custom');
      }
      // Valida cada item
      for (const mv of input.monthlyValues) {
        if (!mv.year || !mv.month || mv.month < 1 || mv.month > 12) {
          throw new BadRequestException(`Mes/ano invalido em custom: ${JSON.stringify(mv)}`);
        }
        if (mv.value == null || mv.value < 0) {
          throw new BadRequestException(`Valor invalido em custom: ${JSON.stringify(mv)}`);
        }
      }
      return input.monthlyValues.map((mv) => ({ year: mv.year, month: mv.month }));
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
    mode: 'single' | 'yearly' | 'replicate' | 'custom';
    year: number;
    month?: number;
    monthsToReplicate?: number;
    /** Custom mode: 12 (ou N) valores por mes — yearly-weighted, presets,
     *  importacao CSV, etc. */
    monthlyValues?: Array<{ year: number; month: number; value: number }>;
    /** Confirmacao explicita pra sobrescrever metas existentes */
    overwriteConfirmed?: boolean;
  }) {
    const {
      tenantId, actorId, scope, kind, value, mode, year, month, monthsToReplicate,
      monthlyValues, overwriteConfirmed,
    } = params;

    if (mode !== 'custom' && value < 0) {
      throw new BadRequestException('value deve ser >= 0');
    }

    const lawyerId = this.resolveLawyerId(scope);
    const months = this.computeMonthsAffected({ mode, year, month, monthsToReplicate, monthlyValues });
    const kinds: GoalKind[] = kind === 'BOTH' ? ['REALIZED', 'CONTRACTED'] : [kind];

    // Mode 'yearly' divide o valor total por 12; outros modos (exceto custom)
    // usam o mesmo valor por mes. Custom usa o valor especifico de cada mes.
    const valuePerMonth = mode === 'yearly' ? +(value / 12).toFixed(2) : value;
    const valueByMonthKey = mode === 'custom' && monthlyValues
      ? new Map(monthlyValues.map((mv) => [`${mv.year}-${mv.month}`, mv.value]))
      : null;

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
        // Em mode=custom, cada mes pode ter valor diferente
        const monthValue = valueByMonthKey
          ? valueByMonthKey.get(`${m.year}-${m.month}`) ?? valuePerMonth
          : valuePerMonth;
        for (const k of kinds) {
          await tx.monthlyGoal.create({
            data: {
              tenant_id: tenantId || null,
              lawyer_id: lawyerId,
              year: m.year,
              month: m.month,
              kind: k,
              value: monthValue,
              created_by_id: actorId,
            },
          });
        }
      }
    });

    this.logger.log(
      `[GOALS] ${actorId} criou ${months.length}x${kinds.length} metas | scope=${scope} | mode=${mode}`,
    );

    return {
      requiresConfirmation: false,
      created: months.length * kinds.length,
      replaced: conflicts.length,
    };
  }

  // ─── Import CSV (commit F) ───────────────────────────────

  /**
   * Importa metas a partir de CSV. Formato esperado (header obrigatorio):
   *   year,month,kind,scope,value
   *   2026,1,REALIZED,OFFICE,60000
   *   2026,1,REALIZED,<lawyerId>,15000
   *   2026,2,CONTRACTED,OFFICE,80000
   *
   * - 'kind' aceita REALIZED ou CONTRACTED (BOTH nao — separe em 2 linhas)
   * - 'scope' aceita 'OFFICE' (case-insensitive) ou UUID de advogado valido
   * - Linhas em branco e com '#' ignoradas
   *
   * @param dryRun se true, NAO grava — so retorna preview de conflitos.
   */
  async importFromCsv(params: {
    tenantId?: string;
    actorId: string;
    csvContent: string;
    dryRun?: boolean;
    overwriteConfirmed?: boolean;
  }) {
    const { tenantId, actorId, csvContent, dryRun = false, overwriteConfirmed = false } = params;

    const parsed = this.parseGoalsCsv(csvContent);
    if (parsed.errors.length > 0) {
      return {
        success: false,
        errors: parsed.errors,
        rowsProcessed: 0,
      };
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException('CSV sem linhas validas');
    }

    // Valida advogados informados (UUIDs precisam existir no tenant)
    const lawyerIds = new Set<string>();
    for (const row of parsed.rows) {
      if (row.scope !== 'OFFICE') lawyerIds.add(row.scope);
    }
    if (lawyerIds.size > 0) {
      const valid = await this.prisma.user.findMany({
        where: {
          id: { in: Array.from(lawyerIds) },
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
        select: { id: true },
      });
      const validIds = new Set(valid.map((u) => u.id));
      const invalid = Array.from(lawyerIds).filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return {
          success: false,
          errors: [`Advogados nao encontrados: ${invalid.join(', ')}`],
          rowsProcessed: 0,
        };
      }
    }

    // Agrupa por (scope, kind) e processa via upsert mode=custom
    const grouped = new Map<string, Array<typeof parsed.rows[0]>>();
    for (const row of parsed.rows) {
      const key = `${row.scope}|${row.kind}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    let totalCreated = 0;
    let totalReplaced = 0;
    const groupConflicts: any[] = [];

    for (const [key, rows] of grouped.entries()) {
      const [scope, kind] = key.split('|');
      const monthlyValues = rows.map((r) => ({ year: r.year, month: r.month, value: r.value }));

      if (dryRun) {
        // Conta conflitos sem gravar
        const conflicts = await this.findConflicts({
          tenantId,
          scope: scope as GoalScope,
          kinds: [kind as GoalKind],
          months: monthlyValues.map((mv) => ({ year: mv.year, month: mv.month })),
        });
        groupConflicts.push({ scope, kind, conflicts: conflicts.length, rows: rows.length });
        totalCreated += rows.length;
        totalReplaced += conflicts.length;
        continue;
      }

      const result = await this.upsert({
        tenantId,
        actorId,
        scope: scope as GoalScope,
        kind: kind as GoalKind,
        value: 0, // ignored em mode=custom
        mode: 'custom',
        year: monthlyValues[0].year,
        monthlyValues,
        overwriteConfirmed,
      });
      if (result.requiresConfirmation) {
        return {
          success: false,
          requiresConfirmation: true,
          conflicts: result.conflicts,
          message: `${result.conflicts!.length} meta(s) seriam sobrescritas em ${scope}/${kind}. Confirme via overwriteConfirmed=true.`,
        };
      }
      totalCreated += result.created!;
      totalReplaced += result.replaced!;
    }

    this.logger.log(
      `[GOALS/CSV] ${actorId} importou ${totalCreated} meta(s)${dryRun ? ' (dry run)' : ''}`,
    );

    return {
      success: true,
      dryRun,
      rowsProcessed: parsed.rows.length,
      created: totalCreated,
      replaced: totalReplaced,
      groups: groupConflicts.length > 0 ? groupConflicts : undefined,
    };
  }

  /**
   * Parser de CSV simples (separador virgula, header na primeira linha).
   * Pula linhas em branco/comentadas. Coleta erros sem abortar.
   */
  private parseGoalsCsv(content: string) {
    const errors: string[] = [];
    const rows: Array<{ year: number; month: number; kind: GoalKind; scope: string; value: number }> = [];
    const lines = content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));

    if (lines.length < 2) {
      errors.push('CSV vazio ou sem linhas de dados');
      return { rows, errors };
    }

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idxYear = header.indexOf('year');
    const idxMonth = header.indexOf('month');
    const idxKind = header.indexOf('kind');
    const idxScope = header.indexOf('scope');
    const idxValue = header.indexOf('value');

    if ([idxYear, idxMonth, idxKind, idxScope, idxValue].some((i) => i === -1)) {
      errors.push('Header CSV deve ter colunas: year,month,kind,scope,value');
      return { rows, errors };
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const year = parseInt(cols[idxYear], 10);
      const month = parseInt(cols[idxMonth], 10);
      const kind = cols[idxKind].toUpperCase();
      const scope = cols[idxScope].toUpperCase() === 'OFFICE' ? 'OFFICE' : cols[idxScope];
      const value = parseFloat(cols[idxValue]);

      if (!Number.isInteger(year) || year < 2024 || year > 2099) {
        errors.push(`Linha ${i + 1}: ano invalido (${cols[idxYear]})`); continue;
      }
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        errors.push(`Linha ${i + 1}: mes invalido (${cols[idxMonth]})`); continue;
      }
      if (kind !== 'REALIZED' && kind !== 'CONTRACTED') {
        errors.push(`Linha ${i + 1}: kind deve ser REALIZED ou CONTRACTED (foi: ${cols[idxKind]})`); continue;
      }
      if (isNaN(value) || value < 0) {
        errors.push(`Linha ${i + 1}: valor invalido (${cols[idxValue]})`); continue;
      }

      rows.push({ year, month, kind: kind as GoalKind, scope, value });
    }

    return { rows, errors };
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

  // ─── Historico de overwrites (versoes soft-deleted) ──────

  /**
   * Lista todas as versoes (incluindo soft-deleted) de uma meta especifica.
   * Util pra auditoria: ver quais valores foram cadastrados antes pra
   * mesma combinacao (tenant, lawyer, year, month, kind).
   */
  async getHistory(params: {
    tenantId?: string;
    scope: GoalScope;
    kind: GoalKind;
    year: number;
    month: number;
    visibleScopes?: Array<string | null>;
  }) {
    const { tenantId, scope, kind, year, month, visibleScopes } = params;
    const lawyerId = this.resolveLawyerId(scope);

    // ASSOCIADO: bloqueia leitura de scope fora dos visiveis
    if (visibleScopes !== undefined) {
      const allowed: Array<string | null> = [];
      if (visibleScopes.includes(null)) allowed.push(null);
      visibleScopes.forEach((s) => { if (s) allowed.push(s); });
      if (!allowed.includes(lawyerId)) {
        throw new ForbiddenException('Sem permissao para ver historico desta meta');
      }
    }

    const versions = await this.prisma.monthlyGoal.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        lawyer_id: lawyerId,
        year, month, kind,
      },
      include: {
        created_by: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return versions.map((v) => ({
      id: v.id,
      value: Number(v.value),
      isActive: v.deleted_at === null,
      createdAt: v.created_at.toISOString(),
      updatedAt: v.updated_at.toISOString(),
      deletedAt: v.deleted_at?.toISOString() || null,
      createdBy: v.created_by ? { id: v.created_by.id, name: v.created_by.name } : null,
    }));
  }

  // ─── Comparacao Year-over-Year (YoY) ─────────────────────

  /**
   * Compara metas + atingimento do ano alvo com o ano anterior, mes a mes.
   * Retorna 12 linhas com targetThis/targetPrev/realizedThis/realizedPrev
   * + delta YoY %. Util pra tela de gestao mostrar evolucao anual.
   */
  async getYearOverYear(params: {
    tenantId?: string;
    scope: GoalScope;
    kind: GoalKind;
    year: number;
    visibleScopes?: Array<string | null>;
  }) {
    const { tenantId, scope, kind, year, visibleScopes } = params;
    const lawyerId = this.resolveLawyerId(scope);

    if (visibleScopes !== undefined) {
      const allowed: Array<string | null> = [];
      if (visibleScopes.includes(null)) allowed.push(null);
      visibleScopes.forEach((s) => { if (s) allowed.push(s); });
      if (!allowed.includes(lawyerId)) {
        throw new ForbiddenException('Sem permissao para comparacao YoY desta meta');
      }
    }

    const previousYear = year - 1;

    // Busca metas dos 2 anos em paralelo
    const [thisYearGoals, prevYearGoals] = await Promise.all([
      this.prisma.monthlyGoal.findMany({
        where: {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          lawyer_id: lawyerId,
          year, kind,
          deleted_at: null,
        },
        select: { month: true, value: true },
      }),
      this.prisma.monthlyGoal.findMany({
        where: {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          lawyer_id: lawyerId,
          year: previousYear, kind,
          deleted_at: null,
        },
        select: { month: true, value: true },
      }),
    ]);

    // Indexa por mes
    const thisByMonth = new Map(thisYearGoals.map((g) => [g.month, Number(g.value)]));
    const prevByMonth = new Map(prevYearGoals.map((g) => [g.month, Number(g.value)]));

    // Calcula realized de cada mes em paralelo (24 chamadas: 12 meses × 2 anos)
    const realizedThisPromises = Array.from({ length: 12 }, (_, i) =>
      this.computeRealizedValue({ tenantId, year, month: i + 1, lawyerId, kind }),
    );
    const realizedPrevPromises = Array.from({ length: 12 }, (_, i) =>
      this.computeRealizedValue({ tenantId, year: previousYear, month: i + 1, lawyerId, kind }),
    );
    const [realizedThis, realizedPrev] = await Promise.all([
      Promise.all(realizedThisPromises),
      Promise.all(realizedPrevPromises),
    ]);

    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const targetThis = thisByMonth.get(month) || null;
      const targetPrev = prevByMonth.get(month) || null;
      const rThis = realizedThis[i];
      const rPrev = realizedPrev[i];
      // Delta YoY do realizado (mais util que do target)
      let realizedDeltaPct: number | null = null;
      if (rPrev > 0) realizedDeltaPct = ((rThis - rPrev) / rPrev) * 100;
      else if (rThis > 0) realizedDeltaPct = null; // sem base

      return {
        month,
        targetThis,
        targetPrev,
        realizedThis: rThis,
        realizedPrev: rPrev,
        realizedDeltaPct,
      };
    });
  }

  // ─── Acumulado (trimestre + ano) ─────────────────────────

  /**
   * Soma metas + realizado por trimestre (Q1-Q4) e ano inteiro.
   * Permite ver progresso em horizontes maiores que o mes.
   */
  async getCumulative(params: {
    tenantId?: string;
    scope: GoalScope;
    kind: GoalKind;
    year: number;
    visibleScopes?: Array<string | null>;
  }) {
    const { tenantId, scope, kind, year, visibleScopes } = params;
    const lawyerId = this.resolveLawyerId(scope);

    if (visibleScopes !== undefined) {
      const allowed: Array<string | null> = [];
      if (visibleScopes.includes(null)) allowed.push(null);
      visibleScopes.forEach((s) => { if (s) allowed.push(s); });
      if (!allowed.includes(lawyerId)) {
        throw new ForbiddenException('Sem permissao para acumulado desta meta');
      }
    }

    const goals = await this.prisma.monthlyGoal.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        lawyer_id: lawyerId,
        year, kind,
        deleted_at: null,
      },
      select: { month: true, value: true },
    });

    const targetByMonth = new Map(goals.map((g) => [g.month, Number(g.value)]));

    const realizedAll = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        this.computeRealizedValue({ tenantId, year, month: i + 1, lawyerId, kind }),
      ),
    );

    const sumRange = (months: number[]) => {
      let target = 0, realized = 0;
      for (const m of months) {
        const t = targetByMonth.get(m);
        if (t) target += t;
        realized += realizedAll[m - 1];
      }
      return { target, realized, progressPct: target > 0 ? (realized / target) * 100 : null };
    };

    return {
      year,
      quarters: [
        { key: 'Q1', months: [1, 2, 3], ...sumRange([1, 2, 3]) },
        { key: 'Q2', months: [4, 5, 6], ...sumRange([4, 5, 6]) },
        { key: 'Q3', months: [7, 8, 9], ...sumRange([7, 8, 9]) },
        { key: 'Q4', months: [10, 11, 12], ...sumRange([10, 11, 12]) },
      ],
      annual: sumRange([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    };
  }
}
