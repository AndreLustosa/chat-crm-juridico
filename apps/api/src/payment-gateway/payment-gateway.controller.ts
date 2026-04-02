import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Logger,
} from '@nestjs/common';
import { PaymentGatewayService } from './payment-gateway.service';
import { CreateChargeDto, CreateBatchChargesDto } from './payment-gateway.dto';

@Controller('payment-gateway')
export class PaymentGatewayController {
  private readonly logger = new Logger(PaymentGatewayController.name);

  constructor(private service: PaymentGatewayService) {}

  @Post('charges')
  async createCharge(@Body() dto: CreateChargeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log(
      `[POST /charges] billingType=${dto.billingType} paymentId=${dto.honorarioPaymentId}`,
    );
    return this.service.createCharge(
      dto.honorarioPaymentId,
      dto.billingType as 'PIX' | 'BOLETO' | 'CREDIT_CARD',
      tenantId,
    );
  }

  @Post('charges/batch')
  async createBatchCharges(@Body() dto: CreateBatchChargesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log(
      `[POST /charges/batch] honorarioId=${dto.honorarioId} billingType=${dto.billingType}`,
    );
    return this.service.createBatchCharges(
      dto.honorarioId,
      dto.billingType,
      tenantId,
    );
  }

  @Get('charges/:honorarioPaymentId')
  async getChargeDetails(
    @Param('honorarioPaymentId') honorarioPaymentId: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId;
    return this.service.getChargeDetails(honorarioPaymentId, tenantId);
  }

  @Post('customers/sync/:leadId')
  async ensureCustomer(@Param('leadId') leadId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log(`[POST /customers/sync] leadId=${leadId}`);
    return this.service.ensureCustomer(leadId, tenantId);
  }

  @Post('reconcile')
  async reconcile(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log('[POST /reconcile] Iniciando reconciliacao');
    return this.service.reconcile(tenantId);
  }

  @Get('settings')
  async getSettings(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    return this.service.getSettings(tenantId);
  }
}
