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
import { PaymentReminderService } from './payment-reminder.service';
import { CreateChargeDto, CreateBatchChargesDto, CreateInstallmentChargeDto } from './payment-gateway.dto';
import { AsaasClient } from './asaas/asaas-client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('payment-gateway')
export class PaymentGatewayController {
  private readonly logger = new Logger(PaymentGatewayController.name);

  constructor(
    private service: PaymentGatewayService,
    private reminder: PaymentReminderService,
    private asaasClient: AsaasClient,
    private prisma: PrismaService,
  ) {}

  // ─── ROTAS FIXAS PRIMEIRO (antes de :param) ─────────────

  @Get('balance')
  async getBalance() {
    return this.asaasClient.getBalance();
  }

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

  /** Lista cobranças locais (armazenadas no sistema), filtráveis por advogado */
  @Get('charges')
  async listLocalCharges(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('lawyerId') lawyerId: string | undefined,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenant_id;
    const where: any = {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      ...(status ? { status } : {}),
    };
    // Filtrar por advogado: cobranças de casos (lawyer_id) OU leads (assigned_lawyer_id na conversa)
    if (lawyerId) {
      where.OR = [
        { honorario_payment: { honorario: { legal_case: { lawyer_id: lawyerId } } } },
        { lead_honorario_payment: { lead_honorario: { lead: { conversations: { some: { assigned_lawyer_id: lawyerId } } } } } },
      ];
    }
    return this.prisma.paymentGatewayCharge.findMany({
      where,
      include: {
        honorario_payment: {
          include: {
            honorario: {
              include: {
                legal_case: {
                  select: { id: true, case_number: true, lawyer_id: true, lead: { select: { id: true, name: true, phone: true } } },
                },
              },
            },
          },
        },
        lead_honorario_payment: {
          include: {
            lead_honorario: {
              include: {
                lead: { select: { id: true, name: true, phone: true } },
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

  /** Confirmar recebimento em dinheiro */
  @Post('charges/asaas/:chargeId/receive-in-cash')
  async receiveInCash(@Param('chargeId') chargeId: string) {
    this.logger.log(`[POST /charges/asaas/${chargeId}/receive-in-cash] Confirmando pagamento em dinheiro`);
    // Buscar dados da cobrança para obter o valor
    const charge = await this.asaasClient.getCharge(chargeId);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const value = charge?.value || 1;
    const result = await this.asaasClient.receiveInCash(chargeId, today, value);
    return result;
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
    // Bug pre-existente: req.user?.tenantId (camelCase) sempre undefined
    // pq JwtStrategy retorna tenant_id (snake_case). Em single-tenant nao
    // afeta. Em multi-tenant, fix esta na lista de defesas pra fazer.
    const tenantId = req.user?.tenant_id ?? req.user?.tenantId;

    // Opcoes extras vindas do modal multi-step (juros, multa, desconto,
    // parcelamento, override de vencimento, repasse de taxas).
    const options = {
      dueDate: dto.dueDate,
      installmentCount: dto.installmentCount,
      interest: dto.interest,
      fine: dto.fine,
      discount: dto.discount,
      splitFees: dto.splitFees,
    };

    // Suporta tanto HonorarioPayment (caso) quanto LeadHonorarioPayment (lead)
    let result: any;
    if (dto.leadHonorarioPaymentId) {
      this.logger.log(`[POST /charges] billingType=${dto.billingType} leadPaymentId=${dto.leadHonorarioPaymentId}`);
      result = await this.service.createChargeForLeadPayment(
        dto.leadHonorarioPaymentId,
        dto.billingType as any,
        tenantId,
        options,
      );
    } else {
      this.logger.log(`[POST /charges] billingType=${dto.billingType} paymentId=${dto.honorarioPaymentId}`);
      result = await this.service.createCharge(
        dto.honorarioPaymentId!,
        dto.billingType as any,
        tenantId,
        options,
      );
    }
    // Aviso imediato ao cliente — fire-and-forget. ReminderService filtra:
    //   - Pula se honorario eh SUCUMBENCIA ou ACORDO
    //   - Pula se Lead.payment_reminders_disabled = true
    //   - Pula se ja foi enviado 'initial' antes (existing charge)
    if (result?.id) {
      this.reminder.sendInitialChargeNotification(result.id).catch((e) => {
        this.logger.warn(`[POST /charges] notif imediata falhou: ${e?.message}`);
      });
    }
    return result;
  }

  @Post('charges/batch')
  async createBatchCharges(@Body() dto: CreateBatchChargesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log(`[POST /charges/batch] honorarioId=${dto.honorarioId} billingType=${dto.billingType}`);
    const result = await this.service.createBatchCharges(dto.honorarioId, dto.billingType, tenantId);
    // Notifica cada charge criada com sucesso. result.results contem os
    // charges criados. Throttle 1.5s entre envios pra batch nao saturar
    // Evolution API.
    if (Array.isArray(result?.results)) {
      for (const c of result.results) {
        if (c?.id) {
          this.reminder.sendInitialChargeNotification(c.id).catch(() => {});
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }
    return result;
  }

  @Post('charges/installment')
  async createInstallmentCharge(@Body() dto: CreateInstallmentChargeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId;
    this.logger.log(`[POST /charges/installment] leadHonorarioId=${dto.leadHonorarioId} billingType=${dto.billingType}`);
    const result = await this.service.createInstallmentCharge(
      dto.leadHonorarioId,
      dto.billingType as 'PIX' | 'BOLETO' | 'CREDIT_CARD',
      tenantId,
    );
    // createInstallmentCharge retorna so a 1a parcela como result principal.
    // result.id eh o id da charge criada. As outras parcelas sao criadas
    // mas nao listadas no return — limitacao do service atual. Notifica
    // a primeira; demais parcelas pegam aviso pelo cron pre-due.
    if (result?.id) {
      this.reminder.sendInitialChargeNotification(result.id).catch(() => {});
    }
    return result;
  }

  @Post('charges/sync')
  async syncCharges(@Req() req: any) {
    const tenantId = req.user?.tenant_id;
    this.logger.log('[POST /charges/sync] Sincronizando cobranças do Asaas');
    return this.service.reconcile(tenantId);
  }

  /**
   * Dashboard de inadimplencia — cobrancas atrasadas com tracking de
   * avisos automaticos enviados (reminder_count, last_reminder_kind).
   * Agrupa em buckets (recente/atencao/urgente/alerta) pra advogado
   * priorizar acoes.
   */
  @Get('overdue-dashboard')
  async getOverdueDashboard(@Req() req: any) {
    return this.service.getOverdueDashboard(req.user?.tenant_id);
  }

  // ─── Templates de cobranca ───────────────────────────────────

  /**
   * Lista todos os templates (com customizacoes mescladas com defaults)
   * + variaveis disponiveis pra UI mostrar lista clicavel de placeholders.
   */
  @Get('templates')
  async getTemplates() {
    const [templates, variables] = await Promise.all([
      this.reminder.loadAllTemplates(),
      Promise.resolve(this.reminder.listAvailableVariables()),
    ]);
    return { templates, variables };
  }

  /**
   * Salva customizacoes de templates. Body eh parcial — kinds nao
   * informados ficam como estao. String vazia remove customizacao
   * (volta pro default).
   */
  @Post('templates')
  async saveTemplates(@Body() body: Record<string, string>) {
    const updated = await this.reminder.saveTemplates(body as any);
    return { templates: updated };
  }

  /**
   * Preview de template — admin edita e ve como vai ficar antes de
   * salvar. Aceita customText opcional pra preview de texto nao
   * salvo ainda.
   */
  @Post('templates/:kind/preview')
  async previewTemplate(
    @Param('kind') kind: string,
    @Body() body: { customText?: string },
  ) {
    const text = await this.reminder.previewTemplate(kind as any, body.customText);
    return { text };
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
