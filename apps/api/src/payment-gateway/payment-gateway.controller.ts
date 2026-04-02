import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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

  // ─── ROTAS FIXAS PRIMEIRO (antes de :param) ─────────────

  @Get('settings')
  async getSettings(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    return this.service.getSettings(tenantId);
  }

  /** Lista cobranças direto da API do Asaas */
  @Get('charges/asaas')
  async listAsaasCharges(
    @Query('status') status: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('billingType') billingType: string | undefined,
    @Query('dateGe') dateGe: string | undefined,
    @Query('dateLe') dateLe: string | undefined,
  ) {
    this.logger.log('[GET /charges/asaas] Buscando cobranças direto do Asaas...');
    try {
      const params: any = {
        offset: offset ? parseInt(offset) : 0,
        limit: limit ? parseInt(limit) : 50,
      };
      if (status) params.status = status;
      if (billingType) params.billingType = billingType;
      if (dateGe) params['dueDate[ge]'] = dateGe;
      if (dateLe) params['dueDate[le]'] = dateLe;

      const result = await this.asaasClient.listCharges(params);

      // Enriquecer com nomes dos clientes (cache para não repetir chamadas)
      const customerCache = new Map<string, string>();
      const charges = result?.data || [];
      for (const charge of charges) {
        if (!charge.customer) continue;
        if (customerCache.has(charge.customer)) {
          charge.customerName = customerCache.get(charge.customer);
          continue;
        }
        try {
          const cust = await this.asaasClient.getCustomer(charge.customer);
          const name = cust?.name || charge.customer;
          customerCache.set(charge.customer, name);
          charge.customerName = name;
        } catch {
          charge.customerName = charge.customer;
        }
      }

      this.logger.log(`[GET /charges/asaas] Retornadas ${result?.totalCount ?? charges.length} cobranças (${customerCache.size} clientes)`);
      return result;
    } catch (e: any) {
      this.logger.error(`[GET /charges/asaas] Erro: ${e.message}`);
      return { data: [], totalCount: 0, error: e.message };
    }
  }

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

  // ─── ROTAS COM PARÂMETROS (depois das fixas) ──────────────

  /** Detalhes completos de uma cobrança no Asaas */
  @Get('charges/asaas/detail/:chargeId')
  async getAsaasChargeDetail(@Param('chargeId') chargeId: string) {
    this.logger.log(`[GET /charges/asaas/detail/${chargeId}]`);
    const charge = await this.asaasClient.getCharge(chargeId);
    // Enriquecer com nome do cliente
    if (charge?.customer) {
      try {
        const cust = await this.asaasClient.getCustomer(charge.customer);
        charge.customerName = cust?.name;
        charge.customerEmail = cust?.email;
        charge.customerPhone = cust?.mobilePhone || cust?.phone;
        charge.customerCpfCnpj = cust?.cpfCnpj;
      } catch {}
    }
    // Se PIX, buscar QR code
    if (charge?.billingType === 'PIX' && charge?.status === 'PENDING') {
      try {
        const pix = await this.asaasClient.getPixQrCode(chargeId);
        charge.pixQrCode = pix?.encodedImage;
        charge.pixCopyPaste = pix?.payload;
        charge.pixExpirationDate = pix?.expirationDate;
      } catch {}
    }
    return charge;
  }

  /** Editar cobrança no Asaas */
  @Put('charges/asaas/:chargeId')
  async updateAsaasCharge(
    @Param('chargeId') chargeId: string,
    @Body() body: { value?: number; dueDate?: string; description?: string },
  ) {
    this.logger.log(`[PUT /charges/asaas/${chargeId}] Atualizando cobranca`);
    return this.asaasClient.updateCharge(chargeId, body);
  }

  /** Excluir cobrança no Asaas */
  @Delete('charges/asaas/:chargeId')
  async deleteAsaasCharge(@Param('chargeId') chargeId: string) {
    this.logger.log(`[DELETE /charges/asaas/${chargeId}] Excluindo cobranca no Asaas`);
    return this.asaasClient.deleteCharge(chargeId);
  }

  /** Detalhes de uma cobrança por honorarioPaymentId */
  @Get('charges/:honorarioPaymentId')
  async getChargeDetails(
    @Param('honorarioPaymentId') honorarioPaymentId: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId;
    return this.service.getChargeDetails(honorarioPaymentId, tenantId);
  }

  // ─── POST ACTIONS ─────────────────────────────────────────

  @Post('charges')
  async createCharge(@Body() dto: CreateChargeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log(`[POST /charges] billingType=${dto.billingType} paymentId=${dto.honorarioPaymentId}`);
    return this.service.createCharge(
      dto.honorarioPaymentId,
      dto.billingType as 'PIX' | 'BOLETO' | 'CREDIT_CARD',
      tenantId,
    );
  }

  @Post('charges/batch')
  async createBatchCharges(@Body() dto: CreateBatchChargesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log(`[POST /charges/batch] honorarioId=${dto.honorarioId} billingType=${dto.billingType}`);
    return this.service.createBatchCharges(dto.honorarioId, dto.billingType, tenantId);
  }

  @Post('charges/sync')
  async syncCharges(@Req() req: any) {
    const tenantId = req.user?.tenant_id;
    this.logger.log('[POST /charges/sync] Sincronizando cobranças do Asaas');
    return this.service.reconcile(tenantId);
  }

  // ─── Customers ─────────────────────────────────────────

  /** Lista clientes vinculados (CRM ↔ Asaas) */
  @Get('customers/linked')
  async listLinkedCustomers(@Req() req: any) {
    return this.service.listLinkedCustomers(req.user?.tenant_id);
  }

  /** Lista clientes direto do Asaas */
  @Get('customers/asaas')
  async listAsaasCustomers(
    @Query('name') name: string | undefined,
    @Query('cpfCnpj') cpfCnpj: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    return this.asaasClient.listCustomers({
      name: name || undefined,
      cpfCnpj: cpfCnpj || undefined,
      offset: offset ? parseInt(offset) : 0,
      limit: limit ? parseInt(limit) : 100,
    });
  }

  /** Importa e vincula automaticamente (match CPF/nome) */
  @Post('customers/import')
  async importCustomers(@Req() req: any) {
    this.logger.log('[POST /customers/import] Importando e vinculando clientes');
    return this.service.importAsaasCustomers(req.user?.tenant_id);
  }

  /** Vinculação manual */
  @Post('customers/link')
  async linkCustomer(@Body() body: { asaasCustomerId: string; leadId: string }, @Req() req: any) {
    this.logger.log(`[POST /customers/link] ${body.asaasCustomerId} → ${body.leadId}`);
    return this.service.linkCustomerToLead(body.asaasCustomerId, body.leadId, req.user?.tenant_id);
  }

  /** Desvincular */
  @Delete('customers/:id')
  async unlinkCustomer(@Param('id') id: string) {
    return this.service.unlinkCustomer(id);
  }

  /** Sync individual */
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
}
