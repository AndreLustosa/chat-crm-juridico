import { Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards, UnauthorizedException } from '@nestjs/common';
import { LeadHonorariosService } from './lead-honorarios.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IsString, IsNumber, IsOptional, IsArray, ValidateNested, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

class PaymentItemDto {
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  due_date?: string;
}

class CreateLeadHonorarioDto {
  @IsString()
  type: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0.01, { message: 'Valor deve ser maior que zero' })
  total_value: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentItemDto)
  payments: PaymentItemDto[];
}

class UpdateLeadHonorarioDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  total_value?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

class AddPaymentDto {
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  amount: number;

  @IsString()
  due_date: string;
}

class MarkPaidDto {
  @IsOptional()
  @IsString()
  payment_method?: string;
}

/**
 * Bug fix 2026-05-12 (Leads PR2 #A1 — CRITICO):
 *
 * Antes: controller tinha so @UseGuards(JwtAuthGuard) e ZERO @Roles. Qualquer
 * user autenticado (estagiario, recepcionista, comercial) marcava parcelas
 * como PAGAS, deletava honorarios negociados, mudava valores. Operacoes
 * financeiras devem ser restritas a ADMIN/ADVOGADO/FINANCEIRO.
 *
 * Tambem: req.user.tenant_id era passado como optional. Agora valida
 * obrigatoriamente (lanca 401 se token sem tenant_id).
 */
@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadHonorariosController {
  constructor(private readonly service: LeadHonorariosService) {}

  private requireTenant(req: any): string {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return req.user.tenant_id;
  }

  // ─── Endpoints globais (módulo financeiro) ───────────────
  // GET endpoints podem ser mais abertos (visualizacao), mas exigem tenant.
  @Get('honorarios-negociados/pending-payments')
  @Roles('ADMIN', 'ADVOGADO', 'FINANCEIRO')
  findPendingPayments(@Request() req: any) {
    return this.service.findPendingPayments(this.requireTenant(req));
  }

  @Get('honorarios-negociados/summary')
  @Roles('ADMIN', 'ADVOGADO', 'FINANCEIRO')
  getSummary(@Request() req: any) {
    return this.service.getSummary(this.requireTenant(req));
  }

  // ─── CRUD por lead ──────────────────────────────────────
  @Get(':leadId/honorarios-negociados')
  @Roles('ADMIN', 'ADVOGADO', 'FINANCEIRO')
  findAll(@Param('leadId') leadId: string, @Request() req: any) {
    return this.service.findByLead(leadId, this.requireTenant(req));
  }

  @Post(':leadId/honorarios-negociados')
  @Roles('ADMIN', 'ADVOGADO', 'FINANCEIRO')
  create(
    @Param('leadId') leadId: string,
    @Body() body: CreateLeadHonorarioDto,
    @Request() req: any,
  ) {
    return this.service.create(leadId, body, this.requireTenant(req), req.user.id);
  }

  @Patch(':leadId/honorarios-negociados/:id')
  @Roles('ADMIN', 'ADVOGADO', 'FINANCEIRO')
  update(
    @Param('id') id: string,
    @Body() body: UpdateLeadHonorarioDto,
    @Request() req: any,
  ) {
    return this.service.update(id, body, this.requireTenant(req), req.user.id);
  }

  // DELETE eh restrito a ADMIN (operacao destrutiva em registro financeiro)
  @Delete(':leadId/honorarios-negociados/:id')
  @Roles('ADMIN')
  delete(@Param('id') id: string, @Request() req: any) {
    return this.service.delete(id, this.requireTenant(req), req.user.id);
  }

  // ─── Parcelas (payments) ────────────────────────────────
  @Post('honorarios-negociados/:honorarioId/payments')
  @Roles('ADMIN', 'ADVOGADO', 'FINANCEIRO')
  addPayment(
    @Param('honorarioId') honorarioId: string,
    @Body() body: AddPaymentDto,
    @Request() req: any,
  ) {
    return this.service.addPayment(honorarioId, body, this.requireTenant(req), req.user.id);
  }

  @Delete('honorarios-negociados/payments/:paymentId')
  @Roles('ADMIN')
  deletePayment(@Param('paymentId') paymentId: string, @Request() req: any) {
    return this.service.deletePayment(paymentId, this.requireTenant(req), req.user.id);
  }

  @Patch('honorarios-negociados/payments/:paymentId/mark-paid')
  @Roles('ADMIN', 'ADVOGADO', 'FINANCEIRO')
  markPaid(
    @Param('paymentId') paymentId: string,
    @Body() body: MarkPaidDto,
    @Request() req: any,
  ) {
    return this.service.markPaid(paymentId, body, this.requireTenant(req), req.user.id);
  }
}
