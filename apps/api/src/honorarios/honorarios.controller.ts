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
import { HonorariosService } from './honorarios.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('honorarios')
export class HonorariosController {
  constructor(private readonly service: HonorariosService) {}

  /** Parcelas pendentes/atrasadas com dados do processo e cliente (para tab Receitas) */
  @Get('pending-payments')
  pendingPayments(
    @Query('lawyerId') lawyerId: string | undefined,
    @Request() req: any,
  ) {
    return this.service.findPendingPayments(req.user.tenant_id, lawyerId);
  }

  @Get('case/:caseId')
  findByCaseId(
    @Param('caseId') caseId: string,
    @Request() req: any,
  ) {
    return this.service.findByCaseId(caseId, req.user.tenant_id);
  }

  @Post('case/:caseId')
  create(
    @Param('caseId') caseId: string,
    @Body() body: {
      type: string;
      total_value: number;
      installment_count?: number;
      contract_date?: string;
      notes?: string;
    },
    @Request() req: any,
  ) {
    return this.service.create(caseId, body, req.user.tenant_id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: {
      type?: string;
      total_value?: number;
      notes?: string;
      contract_date?: string;
    },
    @Request() req: any,
  ) {
    return this.service.update(id, body, req.user.tenant_id);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.remove(id, req.user.tenant_id);
  }

  @Post(':id/payments')
  addPayment(
    @Param('id') id: string,
    @Body() body: {
      amount: number;
      due_date: string;
      payment_method?: string;
      notes?: string;
    },
    @Request() req: any,
  ) {
    return this.service.addPayment(id, body, req.user.tenant_id);
  }

  @Patch('payments/:paymentId/mark-paid')
  markPaid(
    @Param('paymentId') paymentId: string,
    @Body() body: { payment_method?: string },
    @Request() req: any,
  ) {
    return this.service.markPaid(paymentId, body, req.user.tenant_id);
  }

  @Delete('payments/:paymentId')
  deletePayment(
    @Param('paymentId') paymentId: string,
    @Request() req: any,
  ) {
    return this.service.deletePayment(paymentId, req.user.tenant_id);
  }
}
