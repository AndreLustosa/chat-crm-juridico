import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient } from './asaas/asaas-client';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';

// Mapeamento de status Asaas → interno
const ASAAS_STATUS_MAP: Record<string, string> = {
  PENDING: 'PENDING',
  RECEIVED: 'RECEIVED',
  CONFIRMED: 'CONFIRMED',
  OVERDUE: 'OVERDUE',
  REFUNDED: 'REFUNDED',
  DELETED: 'DELETED',
  RECEIVED_IN_CASH: 'RECEIVED',
};

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(
    private prisma: PrismaService,
    private asaas: AsaasClient,
    private whatsapp: WhatsappService,
    private financeiroService: FinanceiroService,
    private chatGateway: ChatGateway,
  ) {}

  // ─── Customer sync ─────────────────────────────────────

  async ensureCustomer(leadId: string, tenantId?: string) {
    // Verificar se ja existe registro local
    const existing = await this.prisma.paymentGatewayCustomer.findFirst({
      where: {
        lead_id: leadId,
        gateway: 'ASAAS',
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
    });

    if (existing) {
      this.logger.debug(`[CUSTOMER] Lead ${leadId} ja tem customer Asaas: ${existing.external_id}`);
      return existing;
    }

    // Buscar dados do lead
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        cpf_cnpj: true,
        tenant_id: true,
        ficha_trabalhista: { select: { data: true } },
      },
    });

    if (!lead) throw new NotFoundException('Lead nao encontrado');

    // Buscar CPF/CNPJ: primeiro do painel do lead, depois da ficha trabalhista
    const fichaData = (lead.ficha_trabalhista as any)?.data as Record<string, any> | undefined;
    const cpfCnpj = lead.cpf_cnpj || fichaData?.cpf || fichaData?.cpfCnpj || fichaData?.cnpj || null;

    if (!cpfCnpj) {
      throw new BadRequestException(
        'Lead não possui CPF/CNPJ cadastrado. Preencha o CPF no painel do lead antes de gerar cobrança.',
      );
    }

    // Criar customer no Asaas
    const asaasCustomer = await this.asaas.createCustomer({
      name: lead.name || 'Sem nome',
      cpfCnpj,
      email: lead.email || undefined,
      phone: lead.phone || undefined,
      externalReference: lead.id,
    });

    this.logger.log(
      `[CUSTOMER] Criado no Asaas: ${asaasCustomer.id} para lead ${leadId}`,
    );

    // Salvar localmente
    const customer = await this.prisma.paymentGatewayCustomer.create({
      data: {
        tenant_id: tenantId || lead.tenant_id,
        lead_id: leadId,
        gateway: 'ASAAS',
        external_id: asaasCustomer.id,
        cpf_cnpj: cpfCnpj,
        sync_status: 'SYNCED',
        last_synced_at: new Date(),
      },
    });

    return customer;
  }

  // ─── Charge creation ───────────────────────────────────

  /**
   * Defesa contra erro 400 invalid_dueDate do Asaas.
   *
   * Asaas rejeita dueDate < hoje com codigo invalid_dueDate. Isso quebrava
   * a geracao de cobranca pra qualquer parcela ja vencida (caso comum em
   * inadimplencia: parcela vence dia 27, advogado vai gerar cobranca dia 28).
   *
   * Estrategia: se a data solicitada estiver no passado, ajusta pra HOJE+1
   * (proxima oportunidade valida) e loga warn pra rastreabilidade. Mantem a
   * cobranca cobravel sem fazer o usuario re-selecionar manualmente.
   */
  private normalizeDueDateForAsaas(requested: Date, paymentRef: string): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const req = new Date(requested);
    req.setHours(0, 0, 0, 0);
    if (req < today) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      this.logger.warn(
        `[CHARGE] dueDate ${req.toISOString().slice(0, 10)} no passado pra payment ${paymentRef} — ajustado pra ${tomorrow.toISOString().slice(0, 10)} (Asaas rejeita data passada)`,
      );
      return tomorrow;
    }
    return requested;
  }

  /**
   * Opcoes adicionais aceitas pelo modal Asaas-style multi-step.
   * Mantidas opcionais pra preservar compat com chamadas antigas (workspace,
   * batch, installment, etc) que so passam billingType.
   */
  private buildAsaasOptionalFields(options?: {
    dueDate?: string;
    installmentCount?: number;
    interest?: { value: number };
    fine?: { value: number; type?: 'PERCENTAGE' | 'FIXED' };
    discount?: { value: number; dueDateLimitDays: number; type?: 'PERCENTAGE' | 'FIXED' };
    splitFees?: boolean;
    value?: number; // valor base, usado pra calcular installmentValue
  }) {
    if (!options) return {};
    const out: any = {};
    // Asaas exige installmentCount >= 2; 1 = nao parcelado.
    if (options.installmentCount && options.installmentCount >= 2 && options.value) {
      out.installmentCount = options.installmentCount;
      out.installmentValue = +(options.value / options.installmentCount).toFixed(2);
    }
    if (options.interest && options.interest.value > 0) {
      out.interest = { value: options.interest.value };
    }
    if (options.fine && options.fine.value > 0) {
      out.fine = {
        value: options.fine.value,
        type: options.fine.type || 'PERCENTAGE',
      };
    }
    if (options.discount && options.discount.value > 0) {
      out.discount = {
        value: options.discount.value,
        dueDateLimitDays: options.discount.dueDateLimitDays ?? 0,
        type: options.discount.type || 'PERCENTAGE',
      };
    }
    if (typeof options.splitFees === 'boolean') {
      out.splitFees = options.splitFees;
    }
    return out;
  }

  async createCharge(
    honorarioPaymentId: string,
    billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED',
    tenantId?: string,
    options?: {
      dueDate?: string;
      installmentCount?: number;
      interest?: { value: number };
      fine?: { value: number; type?: 'PERCENTAGE' | 'FIXED' };
      discount?: { value: number; dueDateLimitDays: number; type?: 'PERCENTAGE' | 'FIXED' };
      splitFees?: boolean;
    },
  ) {
    // Verificar se ja existe cobranca para este pagamento
    const existingCharge = await this.prisma.paymentGatewayCharge.findUnique({
      where: { honorario_payment_id: honorarioPaymentId },
    });
    if (existingCharge) {
      this.logger.warn(`[CHARGE] Ja existe cobranca para payment ${honorarioPaymentId}: ${existingCharge.external_id}`);
      return existingCharge;
    }

    // Buscar pagamento com relacoes
    const payment = await this.prisma.honorarioPayment.findUnique({
      where: { id: honorarioPaymentId },
      include: {
        honorario: {
          include: {
            legal_case: {
              select: {
                id: true,
                case_number: true,
                legal_area: true,
                lead_id: true,
                tenant_id: true,
                lead: {
                  select: { id: true, name: true, phone: true, email: true },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Pagamento de honorario nao encontrado');

    const legalCase = (payment as any).honorario?.legal_case;
    if (!legalCase?.lead_id) {
      throw new BadRequestException('Caso juridico nao possui lead vinculado');
    }

    // Garantir que o customer existe no Asaas
    const customer = await this.ensureCustomer(
      legalCase.lead_id,
      tenantId || legalCase.tenant_id,
    );

    // Criar cobranca no Asaas
    // Override do due_date: prioriza options.dueDate (usuario escolheu no modal)
    // sobre payment.due_date (campo padrao da parcela). Se ambos null, usa hoje.
    const requestedDueDate = options?.dueDate
      ? new Date(options.dueDate)
      : payment.due_date
      ? new Date(payment.due_date)
      : new Date();
    // Defesa: Asaas rejeita dueDate < hoje com 400 invalid_dueDate. Se a parcela
    // estiver atrasada, ajusta pra hoje+1 (mantem cobranca cobravel) e loga.
    const dueDate = this.normalizeDueDateForAsaas(requestedDueDate, honorarioPaymentId);
    const dueDateStr = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const baseValue = Number(payment.amount);
    const optionalFields = this.buildAsaasOptionalFields({ ...options, value: baseValue });

    const asaasCharge = await this.asaas.createCharge({
      customer: customer.external_id,
      billingType,
      value: baseValue,
      dueDate: dueDateStr,
      description: `Honorario - ${legalCase.case_number || 'Processo'} ${legalCase.legal_area ? `(${legalCase.legal_area})` : ''}`.trim(),
      externalReference: honorarioPaymentId,
      ...optionalFields,
    });

    this.logger.log(
      `[CHARGE] Criada no Asaas: ${asaasCharge.id} | ${billingType} | R$ ${baseValue} | Venc: ${dueDateStr}` +
      (optionalFields.installmentCount ? ` | ${optionalFields.installmentCount}x` : ''),
    );

    // Buscar dados de PIX se aplicavel (PIX direto ou UNDEFINED com PIX habilitado)
    let pixData: any = null;
    if ((billingType === 'PIX' || billingType === 'UNDEFINED') && asaasCharge.id) {
      try {
        pixData = await this.asaas.getPixQrCode(asaasCharge.id);
      } catch (e: any) {
        this.logger.warn(`[CHARGE] Falha ao buscar QR Code PIX: ${e.message}`);
      }
    }

    // Salvar localmente
    const charge = await this.prisma.paymentGatewayCharge.create({
      data: {
        tenant_id: tenantId || legalCase.tenant_id,
        honorario_payment_id: honorarioPaymentId,
        legal_case_id: legalCase?.id || null,
        gateway: 'ASAAS',
        external_id: asaasCharge.id,
        customer_external_id: customer.external_id,
        billing_type: billingType,
        amount: Number(payment.amount),
        due_date: dueDate,
        status: asaasCharge.status || 'PENDING',
        description: asaasCharge.description || null,
        pix_qr_code: pixData?.encodedImage || null,
        pix_copy_paste: pixData?.payload || null,
        pix_expiration_date: pixData?.expirationDate
          ? new Date(pixData.expirationDate)
          : null,
        boleto_url: asaasCharge.bankSlipUrl || null,
        boleto_barcode: asaasCharge.nossoNumero || null,
        invoice_url: asaasCharge.invoiceUrl || null,
      },
    });

    return {
      ...charge,
      pix: pixData
        ? {
            qrCode: pixData.encodedImage,
            copyPaste: pixData.payload,
            expirationDate: pixData.expirationDate,
          }
        : null,
      boleto: asaasCharge.bankSlipUrl
        ? {
            url: asaasCharge.bankSlipUrl,
            barcode: asaasCharge.nossoNumero,
          }
        : null,
    };
  }

  // ─── Cobrança para LeadHonorarioPayment ─────────────────

  async createChargeForLeadPayment(
    leadHonorarioPaymentId: string,
    billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED',
    tenantId?: string,
    options?: {
      dueDate?: string;
      installmentCount?: number;
      interest?: { value: number };
      fine?: { value: number; type?: 'PERCENTAGE' | 'FIXED' };
      discount?: { value: number; dueDateLimitDays: number; type?: 'PERCENTAGE' | 'FIXED' };
      splitFees?: boolean;
    },
  ) {
    const existingCharge = await this.prisma.paymentGatewayCharge.findUnique({
      where: { lead_honorario_payment_id: leadHonorarioPaymentId },
    });
    if (existingCharge) {
      this.logger.warn(`[CHARGE] Ja existe cobranca para lead payment ${leadHonorarioPaymentId}: ${existingCharge.external_id}`);
      return existingCharge;
    }

    const payment = await this.prisma.leadHonorarioPayment.findUnique({
      where: { id: leadHonorarioPaymentId },
      include: {
        lead_honorario: {
          include: {
            lead: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Pagamento de honorário negociado não encontrado');

    const lead = (payment as any).lead_honorario?.lead;
    if (!lead?.id) throw new BadRequestException('Honorário negociado não possui lead vinculado');

    const honTenant = (payment as any).lead_honorario?.tenant_id;
    const customer = await this.ensureCustomer(lead.id, tenantId || honTenant);

    const requestedDueDate = options?.dueDate
      ? new Date(options.dueDate)
      : payment.due_date
      ? new Date(payment.due_date)
      : new Date();
    const dueDate = this.normalizeDueDateForAsaas(requestedDueDate, leadHonorarioPaymentId);
    const dueDateStr = dueDate.toISOString().slice(0, 10);
    const honType = (payment as any).lead_honorario?.type || '';
    const typeLabels: Record<string, string> = { CONTRATUAL: 'Contratuais', ENTRADA: 'Entrada', ACORDO: 'Acordo' };

    const baseValue = Number(payment.amount);
    const optionalFields = this.buildAsaasOptionalFields({ ...options, value: baseValue });

    const asaasCharge = await this.asaas.createCharge({
      customer: customer.external_id,
      billingType,
      value: baseValue,
      dueDate: dueDateStr,
      description: `Honorário ${typeLabels[honType] || honType} - Lead ${lead.name || 'Sem nome'}`.trim(),
      externalReference: leadHonorarioPaymentId,
      ...optionalFields,
    });

    this.logger.log(`[CHARGE] Criada para lead: ${asaasCharge.id} | ${billingType} | R$ ${baseValue} | Venc: ${dueDateStr}`);

    let pixData: any = null;
    if ((billingType === 'PIX' || billingType === 'UNDEFINED') && asaasCharge.id) {
      try { pixData = await this.asaas.getPixQrCode(asaasCharge.id); }
      catch (e: any) { this.logger.warn(`[CHARGE] Falha QR Code PIX: ${e.message}`); }
    }

    const charge = await this.prisma.paymentGatewayCharge.create({
      data: {
        tenant_id: tenantId || honTenant || null,
        lead_honorario_payment_id: leadHonorarioPaymentId,
        gateway: 'ASAAS',
        external_id: asaasCharge.id,
        customer_external_id: customer.external_id,
        billing_type: billingType,
        amount: Number(payment.amount),
        due_date: dueDate,
        status: asaasCharge.status || 'PENDING',
        description: asaasCharge.description || null,
        pix_qr_code: pixData?.encodedImage || null,
        pix_copy_paste: pixData?.payload || null,
        pix_expiration_date: pixData?.expirationDate ? new Date(pixData.expirationDate) : null,
        boleto_url: asaasCharge.bankSlipUrl || null,
        boleto_barcode: asaasCharge.nossoNumero || null,
        invoice_url: asaasCharge.invoiceUrl || null,
      },
    });

    return {
      ...charge,
      pix: pixData ? { qrCode: pixData.encodedImage, copyPaste: pixData.payload, expirationDate: pixData.expirationDate } : null,
      boleto: asaasCharge.bankSlipUrl ? { url: asaasCharge.bankSlipUrl, barcode: asaasCharge.nossoNumero } : null,
    };
  }

  // ─── Cobrança parcelada (Asaas installment) ────────────

  async createInstallmentCharge(
    leadHonorarioId: string,
    billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD',
    tenantId?: string,
  ) {
    // Buscar honorário com parcelas pendentes
    const honorario = await this.prisma.leadHonorario.findUnique({
      where: { id: leadHonorarioId },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true } },
        payments: {
          where: { status: { in: ['PENDENTE', 'ATRASADO'] } },
          orderBy: { due_date: 'asc' },
        },
      },
    });

    if (!honorario) throw new NotFoundException('Honorário negociado não encontrado');
    if (!honorario.lead?.id) throw new BadRequestException('Lead não vinculado');
    if (honorario.payments.length === 0) throw new BadRequestException('Nenhuma parcela pendente');

    // Verificar se já existem cobranças para essas parcelas
    const paymentIds = honorario.payments.map(p => p.id);
    const existingCharges = await this.prisma.paymentGatewayCharge.findMany({
      where: { lead_honorario_payment_id: { in: paymentIds } },
    });
    if (existingCharges.length > 0) {
      throw new BadRequestException(`Já existem ${existingCharges.length} cobrança(s) gerada(s) para este honorário`);
    }

    // Garantir customer no Asaas
    const customer = await this.ensureCustomer(
      honorario.lead.id,
      tenantId || honorario.tenant_id || undefined,
    );

    const totalValue = honorario.payments.reduce((s, p) => s + Number(p.amount), 0);
    const installmentCount = honorario.payments.length;
    const installmentValue = Number(honorario.payments[0].amount); // Asaas usa valor da primeira parcela
    const firstDueDate = honorario.payments[0].due_date || new Date();
    const dueDateStr = new Date(firstDueDate).toISOString().slice(0, 10);

    const typeLabels: Record<string, string> = { CONTRATUAL: 'Contratuais', ENTRADA: 'Entrada', ACORDO: 'Acordo' };
    const description = `Honorário ${typeLabels[honorario.type] || honorario.type} - ${honorario.lead.name || 'Lead'} (${installmentCount}x)`.trim();

    // Criar cobrança parcelada no Asaas
    const asaasCharge = await this.asaas.createCharge({
      customer: customer.external_id,
      billingType,
      value: totalValue,
      dueDate: dueDateStr,
      description,
      externalReference: leadHonorarioId,
      installmentCount,
      installmentValue,
    });

    this.logger.log(`[CHARGE] Parcelada criada no Asaas: ${asaasCharge.id} | ${billingType} | ${installmentCount}x R$ ${installmentValue} | Total: R$ ${totalValue}`);

    let pixData: any = null;
    if (billingType === 'PIX' && asaasCharge.id) {
      try { pixData = await this.asaas.getPixQrCode(asaasCharge.id); }
      catch (e: any) { this.logger.warn(`[CHARGE] Falha QR Code PIX: ${e.message}`); }
    }

    // Salvar cobrança vinculada à primeira parcela
    const charge = await this.prisma.paymentGatewayCharge.create({
      data: {
        tenant_id: tenantId || honorario.tenant_id || null,
        lead_honorario_payment_id: honorario.payments[0].id,
        gateway: 'ASAAS',
        external_id: asaasCharge.id,
        customer_external_id: customer.external_id,
        billing_type: billingType,
        amount: totalValue,
        due_date: new Date(firstDueDate),
        status: asaasCharge.status || 'PENDING',
        description,
        pix_qr_code: pixData?.encodedImage || null,
        pix_copy_paste: pixData?.payload || null,
        pix_expiration_date: pixData?.expirationDate ? new Date(pixData.expirationDate) : null,
        boleto_url: asaasCharge.bankSlipUrl || null,
        boleto_barcode: asaasCharge.nossoNumero || null,
        invoice_url: asaasCharge.invoiceUrl || null,
      },
    });

    return {
      ...charge,
      installmentCount,
      installmentValue,
      totalValue,
      pix: pixData ? { qrCode: pixData.encodedImage, copyPaste: pixData.payload, expirationDate: pixData.expirationDate } : null,
      boleto: asaasCharge.bankSlipUrl ? { url: asaasCharge.bankSlipUrl, barcode: asaasCharge.nossoNumero } : null,
    };
  }

  // ─── Batch charges ─────────────────────────────────────

  async createBatchCharges(
    honorarioId: string,
    billingType: string,
    tenantId?: string,
  ) {
    const payments = await this.prisma.honorarioPayment.findMany({
      where: {
        honorario_id: honorarioId,
        status: 'PENDENTE',
        gateway_charge: null, // sem cobranca existente
      },
      orderBy: { due_date: 'asc' },
    });

    if (payments.length === 0) {
      throw new BadRequestException('Nenhuma parcela pendente sem cobranca encontrada');
    }

    this.logger.log(
      `[BATCH] Criando ${payments.length} cobrancas ${billingType} para honorario ${honorarioId}`,
    );

    const results: any[] = [];
    const errors: any[] = [];

    for (const payment of payments) {
      try {
        const charge = await this.createCharge(
          payment.id,
          billingType as 'PIX' | 'BOLETO' | 'CREDIT_CARD',
          tenantId,
        );
        results.push(charge);
      } catch (e: any) {
        this.logger.error(
          `[BATCH] Erro ao criar cobranca para payment ${payment.id}: ${e.message}`,
        );
        errors.push({ paymentId: payment.id, error: e.message });
      }
    }

    return { created: results.length, errors: errors.length, results, errorDetails: errors };
  }

  // ─── Charge details ────────────────────────────────────

  async getChargeDetails(honorarioPaymentId: string, tenantId?: string) {
    const charge = await this.prisma.paymentGatewayCharge.findUnique({
      where: { honorario_payment_id: honorarioPaymentId },
    });

    if (!charge) {
      throw new NotFoundException('Cobranca nao encontrada para este pagamento');
    }

    // Buscar dados frescos do Asaas
    let asaasData: any = null;
    try {
      asaasData = await this.asaas.getCharge(charge.external_id);

      // Atualizar status local se mudou
      const mappedStatus = ASAAS_STATUS_MAP[asaasData.status] || asaasData.status;
      if (mappedStatus !== charge.status) {
        await this.prisma.paymentGatewayCharge.update({
          where: { id: charge.id },
          data: {
            status: mappedStatus,
            paid_at: asaasData.paymentDate ? new Date(asaasData.paymentDate) : charge.paid_at,
            net_value: asaasData.netValue || charge.net_value,
            invoice_url: asaasData.invoiceUrl || charge.invoice_url,
          },
        });
      }
    } catch (e: any) {
      this.logger.warn(`[CHARGE] Falha ao consultar Asaas: ${e.message}`);
    }

    return {
      local: charge,
      gateway: asaasData,
    };
  }

  // ─── Webhook handling ──────────────────────────────────

  async handleWebhook(payload: any) {
    const event = payload?.event;
    const paymentData = payload?.payment;

    if (!paymentData?.id) {
      this.logger.warn('[WEBHOOK] Payload sem payment.id, ignorando');
      return;
    }

    this.logger.log(
      `[WEBHOOK] Evento: ${event} | Payment: ${paymentData.id} | Status: ${paymentData.status}`,
    );

    // Buscar cobranca local pelo external_id
    const charge = await this.prisma.paymentGatewayCharge.findUnique({
      where: { external_id: paymentData.id },
    });

    if (!charge) {
      this.logger.warn(
        `[WEBHOOK] Cobranca nao encontrada localmente para external_id: ${paymentData.id} — processando evento mesmo assim`,
      );

      // Mesmo sem registro local, notificar cliente
      const mappedStatusNoCharge = ASAAS_STATUS_MAP[paymentData.status] || paymentData.status;

      // Notificar exclusão/estorno
      if (mappedStatusNoCharge === 'DELETED' || mappedStatusNoCharge === 'REFUNDED' || event === 'PAYMENT_DELETED') {
        try {
          await this.notifyClientChargeDeleted(paymentData, { amount: paymentData.value }, mappedStatusNoCharge === 'REFUNDED' ? 'REFUNDED' : 'DELETED');
        } catch (e: any) {
          this.logger.warn(`[WEBHOOK] Falha ao notificar cliente (sem registro local): ${e.message}`);
        }
      }

      // Notificar pagamento confirmado
      if (mappedStatusNoCharge === 'RECEIVED' || mappedStatusNoCharge === 'CONFIRMED' || event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
        try {
          await this.notifyClientPaymentReceived(paymentData, { amount: paymentData.value });
        } catch (e: any) {
          this.logger.warn(`[WEBHOOK] Falha ao notificar cliente sobre pagamento (sem registro local): ${e.message}`);
        }
      }

      return;
    }

    // Mapear status
    const mappedStatus = ASAAS_STATUS_MAP[paymentData.status] || paymentData.status;

    // Idempotencia: se status ja e o mesmo, nao reprocessar
    if (charge.status === mappedStatus) {
      this.logger.debug(`[WEBHOOK] Status ja era ${mappedStatus}, ignorando duplicata`);
      return;
    }

    // Atualizar cobranca local
    const updatedCharge = await this.prisma.paymentGatewayCharge.update({
      where: { id: charge.id },
      data: {
        status: mappedStatus,
        paid_at: paymentData.paymentDate
          ? new Date(paymentData.paymentDate)
          : charge.paid_at,
        payment_date: paymentData.confirmedDate
          ? new Date(paymentData.confirmedDate)
          : charge.payment_date,
        net_value: paymentData.netValue || charge.net_value,
        invoice_url: paymentData.invoiceUrl || charge.invoice_url,
        webhook_payload: payload,
      },
    });

    // Se pagamento RECEIVED ou CONFIRMED, marcar HonorarioPayment como PAGO
    if (
      (mappedStatus === 'RECEIVED' || mappedStatus === 'CONFIRMED') &&
      charge.honorario_payment_id
    ) {
      try {
        // Atualizar parcela do honorario
        await this.prisma.honorarioPayment.update({
          where: { id: charge.honorario_payment_id },
          data: {
            status: 'PAGO',
            paid_at: new Date(),
            payment_method: charge.billing_type,
          },
        });

        this.logger.log(
          `[WEBHOOK] HonorarioPayment ${charge.honorario_payment_id} marcado como PAGO`,
        );

        // Criar transacao financeira via FinanceiroService
        try {
          const transaction = await this.financeiroService.createFromHonorarioPayment(
            charge.honorario_payment_id,
            charge.tenant_id || undefined,
          );

          // Vincular transacao a cobranca
          if (transaction?.id) {
            await this.prisma.paymentGatewayCharge.update({
              where: { id: charge.id },
              data: { transaction_id: transaction.id },
            });
          }

          this.logger.log(
            `[WEBHOOK] Transacao financeira criada: ${transaction?.id}`,
          );
        } catch (e: any) {
          this.logger.warn(
            `[WEBHOOK] Falha ao criar transacao financeira: ${e.message}`,
          );
        }

        // Emitir evento via WebSocket
        this.emitFinancialUpdate(charge.tenant_id, {
          type: 'payment_confirmed',
          chargeId: charge.id,
          honorarioPaymentId: charge.honorario_payment_id,
          status: mappedStatus,
          amount: Number(charge.amount),
        });
      } catch (e: any) {
        this.logger.error(
          `[WEBHOOK] Erro ao processar pagamento confirmado: ${e.message}`,
        );
      }
    }

    // Se pagamento RECEIVED/CONFIRMED e tem transaction_id mas NÃO tem honorario (receita avulsa),
    // dar baixa direta na FinancialTransaction
    if (
      (mappedStatus === 'RECEIVED' || mappedStatus === 'CONFIRMED') &&
      charge.transaction_id &&
      !charge.honorario_payment_id
    ) {
      try {
        await this.prisma.financialTransaction.update({
          where: { id: charge.transaction_id },
          data: {
            status: 'PAGO',
            paid_at: new Date(),
            payment_method: charge.billing_type,
          },
        });
        this.logger.log(`[WEBHOOK] FinancialTransaction ${charge.transaction_id} marcada como PAGO (receita avulsa)`);
      } catch (e: any) {
        this.logger.warn(`[WEBHOOK] Falha ao dar baixa em transação avulsa: ${e.message}`);
      }
    }

    // Se pagamento RECEIVED ou CONFIRMED, notificar cliente via WhatsApp
    if (mappedStatus === 'RECEIVED' || mappedStatus === 'CONFIRMED') {
      try {
        await this.notifyClientPaymentReceived(paymentData, charge);
      } catch (e: any) {
        this.logger.warn(`[WEBHOOK] Falha ao notificar cliente sobre pagamento: ${e.message}`);
      }
    }

    // Se cobrança DELETADA ou REFUNDED, notificar cliente via WhatsApp
    if (mappedStatus === 'DELETED' || mappedStatus === 'REFUNDED') {
      try {
        await this.notifyClientChargeDeleted(paymentData, charge, mappedStatus);
      } catch (e: any) {
        this.logger.warn(`[WEBHOOK] Falha ao notificar cliente sobre exclusão: ${e.message}`);
      }
    }

    // Emitir update generico de status
    this.emitFinancialUpdate(charge.tenant_id, {
      type: 'charge_status_update',
      chargeId: charge.id,
      externalId: charge.external_id,
      oldStatus: charge.status,
      newStatus: mappedStatus,
    });

    return updatedCharge;
  }

  // ─── Reconciliation ────────────────────────────────────

  /**
   * Dashboard de inadimplência — lista cobrancas PENDING/OVERDUE com
   * vencimento no passado. Inclui tracking de avisos enviados pelo
   * PaymentReminderService pra advogado ver de relance:
   *   - Quantas vezes ja cobrou automaticamente
   *   - Qual foi o ultimo aviso (por kind: overdue-1d, 3d, 7d, 15d)
   *   - Quanto tempo passou desde o ultimo aviso
   *
   * Agrupa em buckets pra UI mostrar "stages":
   *   recente   = 1-2 dias atrasado
   *   atencao   = 3-6 dias
   *   urgente   = 7-14 dias
   *   alerta    = 15+ dias (ja saiu da cobranca automatica, advogado decide)
   */
  async getOverdueDashboard(tenantId?: string) {
    const now = new Date();
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);

    const charges = await this.prisma.paymentGatewayCharge.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        due_date: { lt: today0 },
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: {
        honorario_payment: {
          include: {
            honorario: {
              include: {
                legal_case: {
                  select: {
                    id: true,
                    case_number: true,
                    legal_area: true,
                    lead: {
                      select: {
                        id: true,
                        name: true,
                        phone: true,
                        payment_reminders_disabled: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        lead_honorario_payment: {
          include: {
            lead_honorario: {
              include: {
                lead: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    payment_reminders_disabled: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { due_date: 'asc' }, // atraso maior primeiro
    });

    // Normaliza shape
    const items = charges.map((c: any) => {
      const dueDate = c.due_date as Date;
      const daysOverdue = Math.floor(
        (today0.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      let bucket: 'recente' | 'atencao' | 'urgente' | 'alerta';
      if (daysOverdue <= 2) bucket = 'recente';
      else if (daysOverdue <= 6) bucket = 'atencao';
      else if (daysOverdue <= 14) bucket = 'urgente';
      else bucket = 'alerta';

      // Resolve honorario_type + lead via uma das duas FKs (case ou lead-fase)
      let honorarioType = '';
      let lead: any = null;
      let legalCase: any = null;
      if (c.honorario_payment) {
        honorarioType = c.honorario_payment.honorario?.type || '';
        const lc = c.honorario_payment.honorario?.legal_case;
        if (lc) {
          legalCase = {
            id: lc.id,
            case_number: lc.case_number,
            legal_area: lc.legal_area,
          };
          lead = lc.lead;
        }
      } else if (c.lead_honorario_payment) {
        honorarioType = c.lead_honorario_payment.lead_honorario?.type || '';
        lead = c.lead_honorario_payment.lead_honorario?.lead;
      }

      // Notif eligible: so CONTRATUAL/ENTRADA + cliente nao desligou
      const eligibleForReminder =
        (honorarioType === 'CONTRATUAL' || honorarioType === 'ENTRADA') &&
        !lead?.payment_reminders_disabled;

      return {
        id: c.id,
        amount: Number(c.amount),
        due_date: dueDate.toISOString(),
        days_overdue: daysOverdue,
        bucket,
        billing_type: c.billing_type,
        status: c.status,
        invoice_url: c.invoice_url,
        // Tracking
        reminder_count: c.reminder_count || 0,
        last_reminder_kind: c.last_reminder_kind,
        last_reminder_sent_at: c.last_reminder_sent_at?.toISOString() || null,
        eligible_for_reminder: eligibleForReminder,
        honorario_type: honorarioType,
        // Cliente
        lead: lead ? {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          reminders_disabled: !!lead.payment_reminders_disabled,
        } : null,
        legal_case: legalCase,
      };
    });

    // Agrega stats
    const stats = {
      total: items.length,
      total_amount: items.reduce((s, i) => s + i.amount, 0),
      recente: items.filter(i => i.bucket === 'recente').length,
      atencao: items.filter(i => i.bucket === 'atencao').length,
      urgente: items.filter(i => i.bucket === 'urgente').length,
      alerta: items.filter(i => i.bucket === 'alerta').length,
      // Quantos clientes distintos sao inadimplentes — mais util que charge count
      // pra entender impacto real
      unique_clients: new Set(items.map(i => i.lead?.id).filter(Boolean)).size,
    };

    return { items, stats };
  }

  async reconcile(tenantId?: string) {
    const where: any = { status: 'PENDING', gateway: 'ASAAS' };
    if (tenantId) where.tenant_id = tenantId;

    const pendingCharges = await this.prisma.paymentGatewayCharge.findMany({
      where,
      take: 100,
      orderBy: { created_at: 'asc' },
    });

    this.logger.log(`[RECONCILE] Verificando ${pendingCharges.length} cobrancas pendentes`);

    let updated = 0;
    let errors = 0;

    for (const charge of pendingCharges) {
      try {
        const asaasData = await this.asaas.getCharge(charge.external_id);
        const mappedStatus = ASAAS_STATUS_MAP[asaasData.status] || asaasData.status;

        if (mappedStatus !== charge.status) {
          // Reprocessar como se fosse um webhook
          await this.handleWebhook({
            event: 'PAYMENT_' + asaasData.status,
            payment: asaasData,
          });
          updated++;
        }
      } catch (e: any) {
        this.logger.warn(
          `[RECONCILE] Erro ao verificar cobranca ${charge.external_id}: ${e.message}`,
        );
        errors++;
      }
    }

    return { total: pendingCharges.length, updated, errors };
  }

  // ─── Settings ──────────────────────────────────────────

  async getSettings(tenantId?: string) {
    const config = await this.asaas.getConfig();

    return {
      provider: 'ASAAS',
      configured: !!config.apiKey,
      sandbox: config.sandbox,
    };
  }

  // ─── Helpers ───────────────────────────────────────────

  // ─── Customer Sync (CRM ↔ Asaas) ──────────────────────

  /**
   * Importa clientes do Asaas e tenta vincular automaticamente aos leads do CRM.
   * Match por: 1) externalReference (lead_id), 2) CPF/CNPJ, 3) nome exato
   */
  async importAsaasCustomers(tenantId?: string): Promise<{
    total: number; linked: number; alreadyLinked: number; unlinked: any[];
  }> {
    this.logger.log('[CUSTOMER-SYNC] Importando clientes do Asaas...');
    let allCustomers: any[] = [];
    let offset = 0;
    const limit = 100;

    // Paginar todos os clientes do Asaas
    while (true) {
      const page = await this.asaas.listCustomers({ offset, limit });
      const items = page?.data || [];
      allCustomers = [...allCustomers, ...items];
      if (!page?.hasMore || items.length === 0) break;
      offset += limit;
    }

    this.logger.log(`[CUSTOMER-SYNC] ${allCustomers.length} clientes encontrados no Asaas`);

    let linked = 0;
    let alreadyLinked = 0;
    const unlinked: any[] = [];

    for (const cust of allCustomers) {
      if (cust.deleted) continue;

      // Ja vinculado?
      const existing = await this.prisma.paymentGatewayCustomer.findFirst({
        where: { gateway: 'ASAAS', external_id: cust.id },
      });
      if (existing) { alreadyLinked++; continue; }

      // Match 1: externalReference = lead_id
      let leadId: string | null = null;
      if (cust.externalReference) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: cust.externalReference },
          select: { id: true },
        });
        if (lead) leadId = lead.id;
      }

      // Match 2: CPF/CNPJ
      if (!leadId && cust.cpfCnpj) {
        const cpfClean = cust.cpfCnpj.replace(/\D/g, '');
        // Busca no campo cpf_cnpj do Lead
        const lead = await this.prisma.lead.findFirst({
          where: {
            cpf_cnpj: cpfClean,
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
          select: { id: true },
        });
        if (lead) leadId = lead.id;

        // Fallback: busca na ficha trabalhista
        if (!leadId) {
          const fichas = await this.prisma.fichaTrabalhista.findMany({
            where: { data: { path: ['cpf'], equals: cpfClean } },
            select: { lead_id: true },
            take: 1,
          });
          if (fichas.length > 0) leadId = fichas[0].lead_id;
        }
      }

      // Match 3: nome exato (case insensitive)
      if (!leadId && cust.name) {
        const lead = await this.prisma.lead.findFirst({
          where: {
            name: { equals: cust.name, mode: 'insensitive' },
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
          select: { id: true },
        });
        if (lead) leadId = lead.id;
      }

      if (leadId) {
        // Vincular
        try {
          await this.prisma.paymentGatewayCustomer.create({
            data: {
              tenant_id: tenantId || null,
              lead_id: leadId,
              gateway: 'ASAAS',
              external_id: cust.id,
              cpf_cnpj: cust.cpfCnpj?.replace(/\D/g, '') || null,
              sync_status: 'SYNCED',
              last_synced_at: new Date(),
            },
          });
          // Atualizar cpf_cnpj no Lead se vazio
          if (cust.cpfCnpj) {
            await this.prisma.lead.updateMany({
              where: { id: leadId, cpf_cnpj: null },
              data: { cpf_cnpj: cust.cpfCnpj.replace(/\D/g, '') },
            });
          }
          linked++;
        } catch (e: any) {
          this.logger.warn(`[CUSTOMER-SYNC] Erro ao vincular ${cust.id}: ${e.message}`);
        }
      } else {
        // Match 4: se tem telefone, criar lead automaticamente e vincular
        const rawPhone = (cust.mobilePhone || cust.phone || '').replace(/\D/g, '');
        if (rawPhone && rawPhone.length >= 10) {
          // Normalizar telefone para formato do sistema (55+DD+8dig, sem 9 extra)
          let phone = rawPhone;
          if (phone.length <= 11) phone = '55' + phone;
          // Remover 9 extra: 5582999867111 (13dig) → 558299867111 (12dig)
          if (phone.length === 13 && phone.startsWith('55') && phone[4] === '9') {
            phone = phone.slice(0, 4) + phone.slice(5);
          }

          try {
            // Verificar se já existe lead com esse telefone (busca exata + parcial)
            let existingLead = await this.prisma.lead.findFirst({
              where: { OR: [{ phone }, { phone: rawPhone }, { phone: { contains: rawPhone.slice(-10) } }] },
              select: { id: true },
            });

            if (!existingLead) {
              // Criar lead a partir dos dados do Asaas com telefone normalizado
              existingLead = await this.prisma.lead.create({
                data: {
                  tenant_id: tenantId || null,
                  name: cust.name || null,
                  phone: phone,
                  email: cust.email || null,
                  cpf_cnpj: cust.cpfCnpj?.replace(/\D/g, '') || null,
                  stage: 'FINALIZADO',
                  is_client: true,
                  became_client_at: new Date(),
                  origin: 'asaas_import',
                },
              });
              this.logger.log(`[CUSTOMER-SYNC] Lead criado a partir do Asaas: ${existingLead.id} (${cust.name})`);
            }

            // Vincular
            await this.prisma.paymentGatewayCustomer.create({
              data: {
                tenant_id: tenantId || null,
                lead_id: existingLead.id,
                gateway: 'ASAAS',
                external_id: cust.id,
                cpf_cnpj: cust.cpfCnpj?.replace(/\D/g, '') || null,
                sync_status: 'SYNCED',
                last_synced_at: new Date(),
              },
            });
            linked++;
            continue;
          } catch (e: any) {
            this.logger.warn(`[CUSTOMER-SYNC] Erro ao criar lead para ${cust.name}: ${e.message}`);
          }
        }

        unlinked.push({
          asaasId: cust.id,
          name: cust.name,
          cpfCnpj: cust.cpfCnpj,
          email: cust.email,
          phone: rawPhone || null,
        });
      }
    }

    this.logger.log(`[CUSTOMER-SYNC] Resultado: ${linked} vinculados, ${alreadyLinked} ja vinculados, ${unlinked.length} sem match`);
    return { total: allCustomers.length, linked, alreadyLinked, unlinked };
  }

  /** Vinculacao manual: conecta um cliente Asaas a um lead do CRM */
  async linkCustomerToLead(asaasCustomerId: string, leadId: string, tenantId?: string) {
    // Buscar dados do cliente no Asaas
    const cust = await this.asaas.getCustomer(asaasCustomerId);
    if (!cust) throw new NotFoundException('Cliente nao encontrado no Asaas');

    // Verificar se lead existe
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead nao encontrado');

    // Criar vinculo
    const record = await this.prisma.paymentGatewayCustomer.create({
      data: {
        tenant_id: tenantId || null,
        lead_id: leadId,
        gateway: 'ASAAS',
        external_id: asaasCustomerId,
        cpf_cnpj: cust.cpfCnpj?.replace(/\D/g, '') || null,
        sync_status: 'SYNCED',
        last_synced_at: new Date(),
      },
    });

    // Atualizar cpf_cnpj no Lead
    if (cust.cpfCnpj) {
      await this.prisma.lead.updateMany({
        where: { id: leadId, cpf_cnpj: null },
        data: { cpf_cnpj: cust.cpfCnpj.replace(/\D/g, '') },
      });
    }

    return record;
  }

  /** Desvincular um cliente */
  async unlinkCustomer(id: string) {
    return this.prisma.paymentGatewayCustomer.delete({ where: { id } });
  }

  /** Lista clientes vinculados (local) */
  async listLinkedCustomers(tenantId?: string) {
    return this.prisma.paymentGatewayCustomer.findMany({
      where: { gateway: 'ASAAS', ...(tenantId ? { tenant_id: tenantId } : {}) },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, cpf_cnpj: true } },
      },
      orderBy: { last_synced_at: 'desc' },
    });
  }

  /**
   * Notifica o cliente via WhatsApp quando um pagamento é confirmado.
   */
  private async notifyClientPaymentReceived(paymentData: any, charge: any) {
    const customerId = paymentData.customer;
    if (!customerId) return;

    const gatewayCustomer = await this.prisma.paymentGatewayCustomer.findFirst({
      where: { external_id: customerId, gateway: 'ASAAS' },
      include: { lead: { select: { id: true, name: true, phone: true } } },
    });

    if (!gatewayCustomer?.lead?.phone) return;

    const lead = gatewayCustomer.lead;
    const firstName = (lead.name || 'Cliente').split(' ')[0];
    const valor = Number(paymentData.value || charge?.amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const descricao = paymentData.description || '';

    const msg =
      `✅ *Pagamento Confirmado!*\n\n` +
      `Olá, ${firstName}!\n\n` +
      `Confirmamos o recebimento do pagamento no valor de *${valor}*${descricao ? ` (${descricao})` : ''}.\n\n` +
      `Agradecemos pela pontualidade! Qualquer dúvida, estamos à disposição.\n\n` +
      `_André Lustosa Advogados_`;

    let clientPhone = lead.phone.replace(/\D/g, '');
    if (clientPhone.length <= 11) clientPhone = '55' + clientPhone;
    if (clientPhone.length === 13 && clientPhone.startsWith('55') && clientPhone[4] === '9') {
      clientPhone = clientPhone.slice(0, 4) + clientPhone.slice(5);
    }

    // Filtra por instancia REGISTRADA DESTE tenant — defesa multi-tenant
    // pos-incidente 2026-04-29 + hardening 2026-05-06.
    const knownInstances = (await this.prisma.instance.findMany({
      where: { type: 'whatsapp', tenant_id: lead.tenant_id ?? undefined },
      select: { name: true },
    })).map(i => i.name);

    const lastConvo = await this.prisma.conversation.findFirst({
      where: {
        lead_id: lead.id,
        status: { not: 'ENCERRADO' },
        ...(knownInstances.length > 0 ? { instance_name: { in: knownInstances } } : {}),
      },
      orderBy: { last_message_at: 'desc' },
      select: { id: true, instance_name: true },
    }).catch(() => null);

    try {
      const sendResult = await this.whatsapp.sendText(clientPhone, msg, lastConvo?.instance_name ?? undefined);
      this.logger.log(`[WEBHOOK] Confirmação de pagamento enviada para ${clientPhone}`);

      if (lastConvo) {
        const evolutionMsgId = sendResult?.data?.key?.id || `sys_payment_${Date.now()}`;
        await this.prisma.message.create({
          data: { conversation_id: lastConvo.id, direction: 'out', type: 'text', text: msg, external_message_id: evolutionMsgId, status: 'enviado' },
        });
        await this.prisma.conversation.update({ where: { id: lastConvo.id }, data: { last_message_at: new Date() } });
      }
    } catch (e: any) {
      this.logger.warn(`[WEBHOOK] Falha ao enviar confirmação para ${clientPhone}: ${e.message}`);
    }
  }

  /**
   * Notifica o cliente via WhatsApp quando uma cobrança é excluída/estornada.
   * Busca o lead vinculado ao customer do Asaas para enviar a mensagem.
   */
  private async notifyClientChargeDeleted(paymentData: any, charge: any, status: string) {
    // Buscar o cliente Asaas → Lead
    const customerId = paymentData.customer;
    if (!customerId) return;

    const gatewayCustomer = await this.prisma.paymentGatewayCustomer.findFirst({
      where: { external_id: customerId, gateway: 'ASAAS' },
      include: { lead: { select: { id: true, name: true, phone: true } } },
    });

    if (!gatewayCustomer?.lead?.phone) {
      this.logger.warn(`[WEBHOOK] Sem telefone do cliente para notificar (customer: ${customerId})`);
      return;
    }

    const lead = gatewayCustomer.lead;
    const firstName = (lead.name || 'Cliente').split(' ')[0];
    const valor = Number(paymentData.value || charge.amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const descricao = paymentData.description || '';
    const isEstorno = status === 'REFUNDED';

    const msg = isEstorno
      ? (
        `💰 *Estorno de Cobrança*\n\n` +
        `Olá, ${firstName}!\n\n` +
        `Informamos que a cobrança no valor de *${valor}*${descricao ? ` (${descricao})` : ''} foi *estornada*.\n\n` +
        `O valor será devolvido conforme a forma de pagamento utilizada.\n` +
        `Qualquer dúvida, estamos à disposição.\n\n` +
        `_André Lustosa Advogados_`
      )
      : (
        `📋 *Cobrança Cancelada*\n\n` +
        `Olá, ${firstName}!\n\n` +
        `Informamos que a cobrança no valor de *${valor}*${descricao ? ` (${descricao})` : ''} foi *cancelada*.\n\n` +
        `Caso tenha dúvidas sobre o motivo ou precise de uma nova cobrança, responda esta mensagem.\n\n` +
        `_André Lustosa Advogados_`
      );

    // Normalizar telefone: 55+DD+8dig (sem 9 extra) — mesmo formato do to12Digits
    let clientPhone = lead.phone.replace(/\D/g, '');
    if (clientPhone.length <= 11) clientPhone = '55' + clientPhone;
    // Remover 9 extra: 5582999867111 (13dig) → 558299867111 (12dig)
    if (clientPhone.length === 13 && clientPhone.startsWith('55') && clientPhone[4] === '9') {
      clientPhone = clientPhone.slice(0, 4) + clientPhone.slice(5);
    }

    // Atualizar telefone do lead para o formato normalizado (evita duplicatas)
    if (lead.phone !== clientPhone) {
      await this.prisma.lead.update({ where: { id: lead.id }, data: { phone: clientPhone } }).catch(() => {});
    }

    // Buscar ou criar conversa para o lead — filtra por instancia
    // registrada DESTE tenant (defesa multi-tenant 2026-04-29 + 2026-05-06).
    const knownInstances = (await this.prisma.instance.findMany({
      where: { type: 'whatsapp', tenant_id: lead.tenant_id ?? undefined },
      select: { name: true },
    })).map(i => i.name);

    let lastConvo = await this.prisma.conversation.findFirst({
      where: {
        lead_id: lead.id,
        status: { not: 'ENCERRADO' },
        ...(knownInstances.length > 0 ? { instance_name: { in: knownInstances } } : {}),
      },
      orderBy: { last_message_at: 'desc' },
      select: { id: true, instance_name: true },
    }).catch(() => null);

    if (!lastConvo) {
      // Criar conversa para que a mensagem fique visível no chat
      try {
        const newConvo = await this.prisma.conversation.create({
          data: {
            lead_id: lead.id,
            channel: 'WHATSAPP',
            status: 'ABERTO',
            instance_name: 'whatsapp',
            last_message_at: new Date(),
          },
        });
        lastConvo = { id: newConvo.id, instance_name: 'whatsapp' };
        this.logger.log(`[WEBHOOK] Conversa criada para lead ${lead.id}: ${newConvo.id}`);
      } catch (e: any) {
        this.logger.warn(`[WEBHOOK] Falha ao criar conversa: ${e.message}`);
      }
    }
    try {
      const sendResult = await this.whatsapp.sendText(
        clientPhone,
        msg,
        lastConvo?.instance_name ?? undefined,
      );
      this.logger.log(`[WEBHOOK] Notificação de ${status} enviada para ${clientPhone}`);

      // Salvar mensagem na conversa (visível para o operador)
      if (lastConvo) {
        const evolutionMsgId = sendResult?.data?.key?.id || `sys_charge_${Date.now()}`;
        await this.prisma.message.create({
          data: {
            conversation_id: lastConvo.id,
            direction: 'out',
            type: 'text',
            text: msg,
            external_message_id: evolutionMsgId,
            status: 'enviado',
          },
        });
        await this.prisma.conversation.update({
          where: { id: lastConvo.id },
          data: { last_message_at: new Date() },
        });
      }
    } catch (e: any) {
      this.logger.warn(`[WEBHOOK] Falha ao enviar WhatsApp para ${clientPhone}: ${e.message}`);
    }
  }

  private emitFinancialUpdate(tenantId: string | null, data: any) {
    try {
      if (this.chatGateway?.server && tenantId) {
        this.chatGateway.server
          .to('tenant:' + tenantId)
          .emit('financial_update', data);
      }
    } catch (e: any) {
      this.logger.warn(`[SOCKET] Falha ao emitir evento: ${e.message}`);
    }
  }
}
