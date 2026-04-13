import { Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards } from '@nestjs/common';
import { LeadHonorariosService } from './lead-honorarios.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsString, IsNumber, IsOptional, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

class PaymentItemDto {
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  amount: number;

  @IsString()
  due_date: string;
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

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadHonorariosController {
  constructor(private readonly service: LeadHonorariosService) {}

  // ─── Endpoints globais (módulo financeiro) ───────────────
  @Get('honorarios-negociados/pending-payments')
  findPendingPayments(@Request() req: any) {
    return this.service.findPendingPayments(req.user?.tenant_id);
  }

  @Get('honorarios-negociados/summary')
  getSummary(@Request() req: any) {
    return this.service.getSummary(req.user?.tenant_id);
  }

  // ─── CRUD por lead ──────────────────────────────────────
  @Get(':leadId/honorarios-negociados')
  findAll(@Param('leadId') leadId: string) {
    return this.service.findByLead(leadId);
  }

  @Post(':leadId/honorarios-negociados')
  create(
    @Param('leadId') leadId: string,
    @Body() body: CreateLeadHonorarioDto,
    @Request() req: any,
  ) {
    return this.service.create(leadId, body, req.user?.tenant_id);
  }

  @Patch(':leadId/honorarios-negociados/:id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateLeadHonorarioDto,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':leadId/honorarios-negociados/:id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // ─── Parcelas (payments) ────────────────────────────────
  @Post('honorarios-negociados/:honorarioId/payments')
  addPayment(
    @Param('honorarioId') honorarioId: string,
    @Body() body: AddPaymentDto,
  ) {
    return this.service.addPayment(honorarioId, body);
  }

  @Delete('honorarios-negociados/payments/:paymentId')
  deletePayment(@Param('paymentId') paymentId: string) {
    return this.service.deletePayment(paymentId);
  }

  @Patch('honorarios-negociados/payments/:paymentId/mark-paid')
  markPaid(
    @Param('paymentId') paymentId: string,
    @Body() body: MarkPaidDto,
  ) {
    return this.service.markPaid(paymentId, body);
  }
}
