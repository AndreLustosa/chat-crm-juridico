import {
  Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post,
  Query, Request, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MonthlyGoalsService, GoalKind, GoalScope } from './monthly-goals.service';

/**
 * Controller de Metas Mensais.
 *
 * Endpoints sob /financeiro/goals:
 *  GET    /financeiro/goals                     — lista (filtros: year, scope, kind)
 *  GET    /financeiro/goals/current-month       — resumo do mes corrente (card do dashboard)
 *  POST   /financeiro/goals                     — upsert (3 modos: single/yearly/replicate)
 *  POST   /financeiro/goals/check-conflicts     — preview de quais metas seriam sobrescritas
 *  PATCH  /financeiro/goals/:id                 — edita valor
 *  DELETE /financeiro/goals/:id                 — soft delete
 *
 * Permissoes:
 *  - GET   : ADMIN/FINANCEIRO veem tudo. ASSOCIADO/ADVOGADO ve so OFFICE + proprio.
 *            ESTAGIARIO bloqueado (403).
 *  - WRITE : apenas ADMIN/FINANCEIRO.
 */
@UseGuards(JwtAuthGuard)
@Controller('financeiro/goals')
export class MonthlyGoalsController {
  constructor(private readonly service: MonthlyGoalsService) {}

  // ─── Helpers de permissao ──────────────────────────────

  private isAdminOrFinanceiro(req: any): boolean {
    const roles: string[] = req.user?.roles || [];
    return roles.includes('ADMIN') || roles.includes('FINANCEIRO');
  }

  private isReadAllowed(req: any): boolean {
    const roles: string[] = req.user?.roles || [];
    return roles.some((r) => ['ADMIN', 'FINANCEIRO', 'ADVOGADO', 'ASSOCIADO', 'OPERADOR'].includes(r));
  }

  /**
   * Pra ASSOCIADO/ADVOGADO/OPERADOR, retorna [null, userId] limitando
   * visibilidade a OFFICE + propria meta. ADMIN/FINANCEIRO recebe undefined
   * (ve tudo).
   */
  private computeVisibleScopes(req: any): Array<string | null> | undefined {
    if (this.isAdminOrFinanceiro(req)) return undefined;
    return [null, req.user.id];
  }

  // ─── Listagem ──────────────────────────────────────────

  @Get()
  async list(
    @Query('year') year: string,
    @Query('scope') scope: string,
    @Query('kind') kind: string,
    @Request() req: any,
  ) {
    if (!this.isReadAllowed(req)) {
      throw new ForbiddenException('Sem permissao para visualizar metas');
    }
    const visibleScopes = this.computeVisibleScopes(req);

    // Se ASSOCIADO passar scope=outro_usuario, force OFFICE
    let effectiveScope: GoalScope | undefined = scope as GoalScope | undefined;
    if (visibleScopes !== undefined && effectiveScope && effectiveScope !== 'OFFICE') {
      const allowedIds = visibleScopes.filter((s): s is string => !!s);
      if (!allowedIds.includes(effectiveScope)) {
        throw new ForbiddenException('Sem permissao para visualizar metas de outro advogado');
      }
    }

    return this.service.list({
      tenantId: req.user.tenant_id,
      year: year ? parseInt(year, 10) : undefined,
      scope: effectiveScope,
      kind: kind as GoalKind | undefined,
      visibleScopes,
    });
  }

  @Get('current-month')
  async currentMonth(
    @Query('scope') scope: string,
    @Query('kind') kind: string,
    @Request() req: any,
  ) {
    if (!this.isReadAllowed(req)) {
      throw new ForbiddenException('Sem permissao para visualizar metas');
    }
    const visibleScopes = this.computeVisibleScopes(req);
    let effectiveScope: GoalScope = (scope as GoalScope) || 'OFFICE';

    // ASSOCIADO so pode ver OFFICE ou propria
    if (visibleScopes !== undefined && effectiveScope !== 'OFFICE') {
      const allowedIds = visibleScopes.filter((s): s is string => !!s);
      if (!allowedIds.includes(effectiveScope)) {
        throw new ForbiddenException('Sem permissao para visualizar metas de outro advogado');
      }
    }

    return this.service.getCurrentMonthSummary({
      tenantId: req.user.tenant_id,
      scope: effectiveScope,
      kind: (kind as GoalKind) || 'REALIZED',
    });
  }

  // ─── Cadastro/edicao ───────────────────────────────────

  @Post('check-conflicts')
  async checkConflicts(
    @Body() body: {
      scope: string;
      kind: 'REALIZED' | 'CONTRACTED' | 'BOTH';
      mode: 'single' | 'yearly' | 'replicate';
      year: number;
      month?: number;
      monthsToReplicate?: number;
    },
    @Request() req: any,
  ) {
    if (!this.isAdminOrFinanceiro(req)) {
      throw new ForbiddenException('Apenas ADMIN ou FINANCEIRO podem cadastrar metas');
    }
    const months = this.service.computeMonthsAffected(body);
    const kinds: GoalKind[] = body.kind === 'BOTH' ? ['REALIZED', 'CONTRACTED'] : [body.kind];

    return this.service.findConflicts({
      tenantId: req.user.tenant_id,
      scope: body.scope as GoalScope,
      kinds,
      months,
    });
  }

  @Post()
  async upsert(
    @Body() body: {
      scope: string;
      kind: 'REALIZED' | 'CONTRACTED' | 'BOTH';
      value: number;
      mode: 'single' | 'yearly' | 'replicate';
      year: number;
      month?: number;
      monthsToReplicate?: number;
      overwriteConfirmed?: boolean;
    },
    @Request() req: any,
  ) {
    if (!this.isAdminOrFinanceiro(req)) {
      throw new ForbiddenException('Apenas ADMIN ou FINANCEIRO podem cadastrar metas');
    }
    return this.service.upsert({
      tenantId: req.user.tenant_id,
      actorId: req.user.id,
      ...body,
      scope: body.scope as GoalScope,
    });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { value: number },
    @Request() req: any,
  ) {
    if (!this.isAdminOrFinanceiro(req)) {
      throw new ForbiddenException('Apenas ADMIN ou FINANCEIRO podem editar metas');
    }
    return this.service.updateValue({
      tenantId: req.user.tenant_id,
      actorId: req.user.id,
      goalId: id,
      value: body.value,
    });
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    if (!this.isAdminOrFinanceiro(req)) {
      throw new ForbiddenException('Apenas ADMIN ou FINANCEIRO podem apagar metas');
    }
    return this.service.softDelete({
      tenantId: req.user.tenant_id,
      actorId: req.user.id,
      goalId: id,
    });
  }

  // ─── Extensoes (commit E) ──────────────────────────────

  /** Historico de overwrites — versoes ativas e soft-deletadas. */
  @Get('history/:scope/:kind/:year/:month')
  async history(
    @Param('scope') scope: string,
    @Param('kind') kind: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Request() req: any,
  ) {
    if (!this.isReadAllowed(req)) {
      throw new ForbiddenException('Sem permissao para visualizar metas');
    }
    return this.service.getHistory({
      tenantId: req.user.tenant_id,
      scope: scope as GoalScope,
      kind: kind as GoalKind,
      year: parseInt(year, 10),
      month: parseInt(month, 10),
      visibleScopes: this.computeVisibleScopes(req),
    });
  }

  /** Comparacao Year-over-Year mes a mes. */
  @Get('yoy')
  async yoy(
    @Query('year') year: string,
    @Query('scope') scope: string,
    @Query('kind') kind: string,
    @Request() req: any,
  ) {
    if (!this.isReadAllowed(req)) {
      throw new ForbiddenException('Sem permissao para visualizar metas');
    }
    const y = year ? parseInt(year, 10) : new Date().getUTCFullYear();
    return this.service.getYearOverYear({
      tenantId: req.user.tenant_id,
      scope: (scope as GoalScope) || 'OFFICE',
      kind: (kind as GoalKind) || 'REALIZED',
      year: y,
      visibleScopes: this.computeVisibleScopes(req),
    });
  }

  // ─── Import CSV (commit F) ──────────────────────────────

  /**
   * Importa metas via CSV. Body:
   *   { csvContent: string, dryRun?: bool, overwriteConfirmed?: bool }
   *
   * Header do CSV: year,month,kind,scope,value
   *
   * dryRun=true retorna preview de quantas linhas seriam criadas/sobrescritas
   * sem gravar. dryRun=false grava (precisa overwriteConfirmed=true se ha
   * conflitos).
   */
  @Post('import-csv')
  async importCsv(
    @Body() body: { csvContent: string; dryRun?: boolean; overwriteConfirmed?: boolean },
    @Request() req: any,
  ) {
    if (!this.isAdminOrFinanceiro(req)) {
      throw new ForbiddenException('Apenas ADMIN ou FINANCEIRO podem importar metas via CSV');
    }
    return this.service.importFromCsv({
      tenantId: req.user.tenant_id,
      actorId: req.user.id,
      csvContent: body.csvContent,
      dryRun: body.dryRun,
      overwriteConfirmed: body.overwriteConfirmed,
    });
  }

  /** Acumulado por trimestre + ano. */
  @Get('cumulative')
  async cumulative(
    @Query('year') year: string,
    @Query('scope') scope: string,
    @Query('kind') kind: string,
    @Request() req: any,
  ) {
    if (!this.isReadAllowed(req)) {
      throw new ForbiddenException('Sem permissao para visualizar metas');
    }
    const y = year ? parseInt(year, 10) : new Date().getUTCFullYear();
    return this.service.getCumulative({
      tenantId: req.user.tenant_id,
      scope: (scope as GoalScope) || 'OFFICE',
      kind: (kind as GoalKind) || 'REALIZED',
      year: y,
      visibleScopes: this.computeVisibleScopes(req),
    });
  }
}
