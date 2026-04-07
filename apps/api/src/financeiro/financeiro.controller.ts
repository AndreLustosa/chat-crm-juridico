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
    return this.service.findAllTransactions({
      tenantId: req.user.tenant_id,
      type,
      category,
      status,
      legalCaseId,
      leadId,
      lawyerId,
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
    });
  }

  @Patch('transactions/:id')
  updateTransaction(
    @Param('id') id: string,
    @Body() body: UpdateTransactionDto,
    @Request() req: any,
  ) {
    return this.service.updateTransaction(id, body, req.user.tenant_id);
  }

  @Delete('transactions/:id')
  deleteTransaction(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.deleteTransaction(id, req.user.tenant_id);
  }

  @Post('transactions/:id/partial-payment')
  partialPayment(
    @Param('id') id: string,
    @Body() body: { amount: number; payment_method?: string },
    @Request() req: any,
  ) {
    return this.service.partialPayment(id, body.amount, body.payment_method, req.user.tenant_id);
  }

  // ─── Summary & Cash Flow ───────────────────────────────

  @Get('summary')
  getSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('lawyerId') lawyerId: string,
    @Request() req: any,
  ) {
    return this.service.getSummary(req.user.tenant_id, startDate, endDate, lawyerId);
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

  @Get('tax/annual')
  getAnnualTax(
    @Query('year') year: string,
    @Query('lawyerId') lawyerId: string | undefined,
    @Request() req: any,
  ) {
    const y = parseInt(year) || new Date().getUTCFullYear();
    const lid = lawyerId || req.user.id;
    return this.taxService.getAnnualSummary(lid, y, req.user.tenant_id);
  }

  @Post('tax/recalculate')
  recalculateTax(
    @Body() body: { year?: number; lawyerId?: string },
    @Request() req: any,
  ) {
    const y = body.year || new Date().getUTCFullYear();
    const lid = body.lawyerId || req.user.id;
    return this.taxService.recalculateYear(lid, y, req.user.tenant_id);
  }

  @Patch('tax/darf-paid')
  markDarfPaid(
    @Body() body: { year: number; month: number; lawyerId?: string },
    @Request() req: any,
  ) {
    const lid = body.lawyerId || req.user.id;
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
    const lid = lawyerId || req.user.id;
    return this.taxService.getClientBreakdown(lid, y, m, req.user.tenant_id);
  }
}
