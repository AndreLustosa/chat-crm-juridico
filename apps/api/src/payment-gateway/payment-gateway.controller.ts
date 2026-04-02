import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Logger,
} from '@nestjs/common';
import { PaymentGatewayService } from './payment-gateway.service';
import { CreateChargeDto, CreateBatchChargesDto } from './payment-gateway.dto';
import { AsaasClient } from './asaas/asaas-client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('payment-gateway')
export class PaymentGatewayController {
  private readonly logger = new Logger(PaymentGatewayController.name);

  constructor(
    private service: PaymentGatewayService,
    private asaasClient: AsaasClient,
    private prisma: PrismaService,
  ) {}

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

  // ─── Listagem de cobranças ─────────────────────────────

  /** Lista cobranças locais (armazenadas no sistema) */
  @Get('charges')
  async listLocalCharges(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenant_id;
    return this.prisma.paymentGatewayCharge.findMany({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        honorario_payment: {
          include: {
            honorario: {
              include: {
                legal_case: {
                  select: { id: true, case_number: true, lead: { select: { id: true, name: true, phone: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: parseInt(limit || '50'),
      skip: parseInt(offset || '0'),
    });
  }

  /** Lista cobranças direto da API do Asaas */
  @Get('charges/asaas')
  async listAsaasCharges(
    @Query('status') status: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    return this.asaasClient.listCharges({
      status: status || undefined,
      offset: offset ? parseInt(offset) : 0,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  /** Sincroniza cobranças do Asaas para o banco local */
  @Post('charges/sync')
  async syncCharges(@Req() req: any) {
    const tenantId = req.user?.tenant_id;
    this.logger.log('[POST /charges/sync] Sincronizando cobranças do Asaas');
    return this.service.reconcile(tenantId);
  }

  @Get('settings')
  async getSettings(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    return this.service.getSettings(tenantId);
  }
}
