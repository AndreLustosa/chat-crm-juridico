import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { TaxService } from './tax.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateTransactionDto,
  UpdateTransactionDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './financeiro.dto';

@UseGuards(JwtAuthGuard)
@Controller('financeiro')
export class FinanceiroController {
  constructor(
    private readonly service: FinanceiroService,
    private readonly taxService: TaxService,
  ) {}

  // ─── Transactions ──────────────────────────────────────

  @Get('transactions')
  findAllTransactions(
    @Query('type') type: string,
    @Query('category') category: string,
    @Query('status') status: string,
    @Query('legalCaseId') legalCaseId: string,
    @Query('leadId') leadId: string,
    @Query('lawyerId') lawyerId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Request() req: any,
  ) {
    // RBAC: apenas ADMIN pode consultar transacoes de outro advogado.
    // Demais usuarios veem so as proprias — query param lawyerId eh
    // IGNORADO pra prevenir vazamento de receitas/despesas.
    // Bug corrigido 2026-04-24.
    const isAdmin = req.user?.roles?.includes('ADMIN');
    const effectiveLawyerId = isAdmin ? lawyerId : req.user.id;
    return this.service.findAllTransactions({
      tenantId: req.user.tenant_id,
      type,
      category,
      status,
      legalCaseId,
      leadId,
      lawyerId: effectiveLawyerId,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('transactions')
  createTransaction(
    @Body() body: CreateTransactionDto,
    @Request() req: any,
  ) {
    return this.service.createTransaction({
      ...body,
      tenant_id: req.user.tenant_id,
      actor_id: req.user.id,
    });
  }

  @Patch('transactions/:id')
  updateTransaction(
    @Param('id') id: string,
    @Body() body: UpdateTransactionDto,
    @Request() req: any,
  ) {
    return this.service.updateTransaction(id, body, req.user.tenant_id, req.user.id);
  }

  @Delete('transactions/:id')
  deleteTransaction(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.deleteTransaction(id, req.user.tenant_id, req.user.id);
  }

  @Post('transactions/:id/partial-payment')
  partialPayment(
    @Param('id') id: string,
    @Body() body: { amount: number; payment_method?: string },
    @Request() req: any,
  ) {
    return this.service.partialPayment(id, body.amount, body.payment_method, req.user.tenant_id, req.user.id);
  }

  @Get('audit-log')
  getAuditLog(
    @Query('lawyerId') lawyerId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Request() req: any,
  ) {
    // RBAC: audit log eh extremamente sensivel (quem alterou o que e
    // quando). Apenas ADMIN pode ver audit log de qualquer advogado.
    // Demais usuarios veem so o proprio — forca lawyerId=req.user.id.
    // Bug corrigido 2026-04-24: antes qualquer autenticado podia
    // passar ?lawyerId=X e ler historico de alteracoes financeiras
    // de outro advogado.
    const isAdmin = req.user?.roles?.includes('ADMIN');
    const effectiveLawyerId = isAdmin ? lawyerId : req.user.id;
    // Bug fix 2026-05-10 (PR4 #27): tenantId obrigatorio
    return this.service.getAuditLog(
      effectiveLawyerId,
      startDate,
      endDate,
      parseInt(limit || '50'),
      parseInt(offset || '0'),
      req.user.tenant_id,
    );
  }

  // ─── Summary & Cash Flow ───────────────────────────────

  @Get('summary')
  getSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('lawyerId') lawyerId: string,
    @Request() req: any,
  ) {
    // RBAC: apenas ADMIN pode ver summary consolidado de outro advogado.
    // Demais usuarios veem o proprio. Bug corrigido 2026-04-24.
    const isAdmin = req.user?.roles?.includes('ADMIN');
    const effectiveLawyerId = isAdmin ? lawyerId : req.user.id;
    return this.service.getSummary(req.user.tenant_id, startDate, endDate, effectiveLawyerId);
  }

  @Get('cash-flow')
  getCashFlow(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month',
    @Request() req: any,
  ) {
    return this.service.getCashFlow(
      req.user.tenant_id,
      startDate,
      endDate,
      groupBy || 'month',
    );
  }

  // ─── Categories ────────────────────────────────────────

  @Get('categories')
  findAllCategories(@Request() req: any) {
    return this.service.findAllCategories(req.user.tenant_id);
  }

  @Post('categories')
  createCategory(
    @Body() body: CreateCategoryDto,
    @Request() req: any,
  ) {
    return this.service.createCategory(body, req.user.tenant_id);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
    @Request() req: any,
  ) {
    return this.service.updateCategory(id, body, req.user.tenant_id);
  }

  @Delete('categories/:id')
  deleteCategory(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.deleteCategory(id, req.user.tenant_id);
  }

  // ─── Tax / Impostos ────────────────────────────────────────
  //
  // Bug fix 2026-05-10 (Honorarios PR1 #4 — CRITICO):
  // Antes endpoints aceitavam `lawyerId` query/body sem checar role.
  // Estagiario podia passar lawyerId de socio e:
  //   - Ler DARF anual (faturamento individual confidencial)
  //   - Forcar recalculate em advogado errado
  //   - Marcar DARF de outro como pago → fraude fiscal direta
  // Agora helper resolveLawyerId garante que so ADMIN pode
  // sobrescrever — demais usam o proprio req.user.id.

  private resolveLawyerId(requestedLawyerId: string | undefined, req: any): string {
    const isAdmin = req.user?.roles?.includes('ADMIN');
    if (requestedLawyerId && requestedLawyerId !== req.user?.id && !isAdmin) {
      throw new ForbiddenException('Apenas ADMIN pode consultar/alterar dados fiscais de outro advogado');
    }
    return requestedLawyerId || req.user.id;
  }

  @Get('tax/annual')
  getAnnualTax(
    @Query('year') year: string,
    @Query('lawyerId') lawyerId: string | undefined,
    @Request() req: any,
  ) {
    const y = parseInt(year) || new Date().getUTCFullYear();
    const lid = this.resolveLawyerId(lawyerId, req);
    return this.taxService.getAnnualSummary(lid, y, req.user.tenant_id);
  }

  @Post('tax/recalculate')
  recalculateTax(
    @Body() body: { year?: number; lawyerId?: string },
    @Request() req: any,
  ) {
    const y = body.year || new Date().getUTCFullYear();
    const lid = this.resolveLawyerId(body.lawyerId, req);
    return this.taxService.recalculateYear(lid, y, req.user.tenant_id);
  }

  @Patch('tax/darf-paid')
  markDarfPaid(
    @Body() body: { year: number; month: number; lawyerId?: string },
    @Request() req: any,
  ) {
    const lid = this.resolveLawyerId(body.lawyerId, req);
    return this.taxService.markDarfPaid(lid, body.year, body.month, req.user.tenant_id);
  }

  @Get('tax/client-breakdown')
  getClientBreakdown(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('lawyerId') lawyerId: string | undefined,
    @Request() req: any,
  ) {
    const y = parseInt(year) || new Date().getUTCFullYear();
    const m = parseInt(month) || new Date().getUTCMonth() + 1;
    const lid = this.resolveLawyerId(lawyerId, req);
    return this.taxService.getClientBreakdown(lid, y, m, req.user.tenant_id);
  }
}
