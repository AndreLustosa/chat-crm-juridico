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
        tenant_id: true,
        ficha_trabalhista: { select: { data: true } },
      },
    });

    if (!lead) throw new NotFoundException('Lead nao encontrado');

    // Extrair CPF/CNPJ da ficha trabalhista (campo "cpf" no JSON data)
    const fichaData = (lead.ficha_trabalhista as any)?.data as Record<string, any> | undefined;
    const cpfCnpj = fichaData?.cpf || fichaData?.cpfCnpj || fichaData?.cnpj || null;

    if (!cpfCnpj) {
      throw new BadRequestException(
        'Lead nao possui CPF/CNPJ cadastrado. Preencha a ficha trabalhista antes de criar o cliente no gateway.',
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

  async createCharge(
    honorarioPaymentId: string,
    billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD',
    tenantId?: string,
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
    const dueDate = payment.due_date ? new Date(payment.due_date) : new Date();
    const dueDateStr = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const asaasCharge = await this.asaas.createCharge({
      customer: customer.external_id,
      billingType,
      value: Number(payment.amount),
      dueDate: dueDateStr,
      description: `Honorario - ${legalCase.case_number || 'Processo'} ${legalCase.legal_area ? `(${legalCase.legal_area})` : ''}`.trim(),
      externalReference: honorarioPaymentId,
    });

    this.logger.log(
      `[CHARGE] Criada no Asaas: ${asaasCharge.id} | ${billingType} | R$ ${Number(payment.amount)} | Venc: ${dueDateStr}`,
    );

    // Buscar dados de PIX se aplicavel
    let pixData: any = null;
    if (billingType === 'PIX' && asaasCharge.id) {
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

    const lastConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id, status: { not: 'ENCERRADO' } },
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

    // Buscar ou criar conversa para o lead
    let lastConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id, status: { not: 'ENCERRADO' } },
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
