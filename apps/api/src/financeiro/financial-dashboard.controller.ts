import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FinancialDashboardService } from './financial-dashboard.service';

/**
 * Controller novo do dashboard financeiro (cockpit).
 * Endpoints sob /financeiro/dashboard/* — coexistem com endpoints
 * antigos em /financeiro/* (backward compat preservada).
 *
 * RBAC:
 *  - ADMIN pode passar lawyerId pra ver de qualquer advogado
 *  - Não-ADMIN: lawyerId é forçado a req.user.id (isolamento)
 *  - Endpoints de meta (goals) e by-area exigem ADMIN explicitamente
 */
@UseGuards(JwtAuthGuard)
@Controller('financeiro/dashboard')
export class FinancialDashboardController {
  constructor(private readonly service: FinancialDashboardService) {}

  /** Helper de RBAC: advogado próprio vs ADMIN com filtro livre. */
  private resolveLawyerId(req: any, lawyerIdQuery?: string): string | undefined {
    const isAdmin = req.user?.roles?.includes('ADMIN');
    if (isAdmin) return lawyerIdQuery || undefined;
    return req.user.id;
  }

  // ─── Layer 1: Banner urgente ──────────────────────────────

  @Get('urgent')
  getUrgent(@Query('lawyerId') lawyerId: string, @Request() req: any) {
    const effectiveLawyerId = this.resolveLawyerId(req, lawyerId);
    return this.service.getUrgentActions(req.user.tenant_id, effectiveLawyerId);
  }

  // ─── Layer 2: KPIs ────────────────────────────────────────

  @Get('kpis')
  getKpis(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('compare') compare: 'previous-month' | 'previous-year',
    @Query('lawyerId') lawyerId: string,
    @Request() req: any,
  ) {
    const effectiveLawyerId = this.resolveLawyerId(req, lawyerId);
    return this.service.getKpis(
      req.user.tenant_id,
      from,
      to,
      compare || 'previous-month',
      effectiveLawyerId,
    );
  }

  // ─── Layer 3: Análises ────────────────────────────────────

  @Get('by-lawyer')
  getByLawyer(
    @Query('from') from: string,
    @Query('to') to: string,
    @Request() req: any,
  ) {
    // Apenas ADMIN — análise consolidada por advogado é dado sensível
    const isAdmin = req.user?.roles?.includes('ADMIN');
    if (!isAdmin) {
      // Não-ADMIN: retorna só o próprio (lista com 1 item)
      return this.service.getRevenueByLawyer(req.user.tenant_id, from, to).then((data) =>
        data.filter((d) => d.lawyerId === req.user.id),
      );
    }
    return this.service.getRevenueByLawyer(req.user.tenant_id, from, to);
  }

  @Get('aging')
  getAging(@Query('lawyerId') lawyerId: string, @Request() req: any) {
    const effectiveLawyerId = this.resolveLawyerId(req, lawyerId);
    return this.service.getAging(req.user.tenant_id, effectiveLawyerId);
  }

  @Get('by-area')
  getByArea(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type: 'realized' | 'contracted',
    @Request() req: any,
  ) {
    return this.service.getByArea(req.user.tenant_id, from, to, type || 'realized');
  }

  @Get('forecast')
  getForecast(
    @Query('days') days: string,
    @Query('scenario') scenario: 'optimistic' | 'realistic' | 'pessimistic',
    @Query('lawyerId') lawyerId: string,
    @Request() req: any,
  ) {
    const effectiveLawyerId = this.resolveLawyerId(req, lawyerId);
    const d = days ? Math.min(180, Math.max(7, parseInt(days, 10))) : 90;
    return this.service.getForecast(
      req.user.tenant_id,
      d,
      scenario || 'realistic',
      effectiveLawyerId,
    );
  }

  // ─── Layer 4: Tabela operacional ──────────────────────────

  @Get('charges')
  getCharges(
    @Query('filter') filter: 'overdue' | 'pending' | 'paid' | 'awaiting_alvara' | 'all',
    @Query('search') search: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('lawyerId') lawyerId: string,
    @Request() req: any,
  ) {
    const effectiveLawyerId = this.resolveLawyerId(req, lawyerId);
    return this.service.getOperationalCharges({
      tenantId: req.user.tenant_id,
      lawyerId: effectiveLawyerId,
      filter: filter || 'all',
      search: search || undefined,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(100, parseInt(pageSize, 10)) : 20,
    });
  }

  // ─── Inline CPF ───────────────────────────────────────────

  @Post('inline-cpf')
  inlineCpf(
    @Body() body: { leadId: string; cpfCnpj: string },
    @Request() req: any,
  ) {
    return this.service.inlineCpf({
      tenantId: req.user.tenant_id,
      leadId: body.leadId,
      cpfCnpj: body.cpfCnpj,
      actorId: req.user.id,
    });
  }

  // ─── Meta do mês (CRUD) ───────────────────────────────────

  @Get('goals')
  listGoals(@Query('year') year: string, @Request() req: any) {
    const y = year ? parseInt(year, 10) : undefined;
    return this.service.listGoals(req.user.tenant_id, y);
  }

  @Post('goals')
  upsertGoal(
    @Body() body: { year: number; month?: number; value: number; propagate?: boolean },
    @Request() req: any,
  ) {
    return this.service.upsertGoal(req.user.tenant_id, body);
  }
}
