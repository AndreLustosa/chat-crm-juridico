import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient } from './asaas/asaas-client';
import { getPlan } from '../subscription/plans';

/**
 * Billing da ASSINATURA SaaS (cobra o ESCRITÓRIO/Tenant mensalmente) — Fase 2a.
 *
 * Vive no payment-gateway module pra reusar o AsaasClient (mesma conta Asaas
 * que cobra honorários). A desambiguação no webhook é por externalReference
 * "saas:<tenant_id>" — ver isSaasWebhookEvent + handleWebhook.
 *
 * Customer Asaas = o Tenant (não um Lead). Guardamos em Tenant.asaas_customer_id
 * / asaas_subscription_id. O status (TRIALING→ACTIVE/PAST_DUE/CANCELED) é dirigido
 * pelos eventos do webhook e lido pelo subscription module (gate/trial).
 *
 * NOTA RLS (#66): checkout/webhook são operações de SISTEMA (webhook sem tenant
 * no contexto). Com a RLS ligada no futuro, precisam do caminho com bypass.
 */
@Injectable()
export class SaasBillingService {
  private readonly logger = new Logger(SaasBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasClient,
  ) {}

  /**
   * Inicia a assinatura: garante o customer Asaas do escritório, cria a
   * subscription mensal no plano escolhido e devolve a invoiceUrl (página
   * hospedada do Asaas) pro frontend redirecionar. O status só vira ACTIVE
   * quando o pagamento confirmar (webhook).
   */
  async checkout(opts: {
    tenantId: string;
    planCode: string;
    cpfCnpj: string;
    name?: string;
    email?: string;
  }): Promise<{ invoiceUrl: string | null; subscriptionId: string; planCode: string }> {
    const plan = getPlan(opts.planCode);
    if (!plan) throw new BadRequestException('Plano inválido.');

    const cpfCnpj = (opts.cpfCnpj || '').replace(/\D/g, '');
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      throw new BadRequestException('CPF/CNPJ inválido.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: opts.tenantId },
      select: { id: true, name: true, asaas_customer_id: true, is_internal: true },
    });
    if (!tenant) throw new NotFoundException('Escritório não encontrado.');
    if (tenant.is_internal) {
      throw new BadRequestException('Escritório interno não assina (acesso ilimitado).');
    }

    // 1) Garante o customer Asaas do escritório.
    let customerId = tenant.asaas_customer_id;
    if (!customerId) {
      const customer = await this.asaas.createCustomer({
        name: opts.name?.trim() || tenant.name,
        cpfCnpj,
        email: opts.email,
        externalReference: `saas:${tenant.id}`,
      });
      customerId = customer.id;
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { asaas_customer_id: customerId },
      });
    }

    // 2) Cria a assinatura mensal (cliente escolhe forma de pagamento no checkout).
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const subscription = await this.asaas.createSubscription({
      customer: customerId!,
      billingType: 'UNDEFINED',
      value: plan.price,
      nextDueDate: today,
      cycle: 'MONTHLY',
      description: `Jurisflow — ${plan.name}`,
      externalReference: `saas:${tenant.id}`,
    });

    // 3) Grava a assinatura + o plano escolhido (status muda só no webhook de pagamento).
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { asaas_subscription_id: subscription.id, plan: plan.code },
    });

    // 4) Pega a invoiceUrl da 1ª cobrança (página hospedada do Asaas).
    let invoiceUrl: string | null = subscription?.invoiceUrl ?? null;
    try {
      const payments = await this.asaas.listSubscriptionPayments(subscription.id);
      const first = payments?.data?.[0];
      if (first?.invoiceUrl) invoiceUrl = first.invoiceUrl;
    } catch (e: any) {
      this.logger.warn(`[SAAS-BILLING] Falha ao buscar invoiceUrl da subscription ${subscription.id}: ${e?.message}`);
    }

    this.logger.log(
      `[SAAS-BILLING] Checkout tenant=${tenant.id} plano=${plan.code} sub=${subscription.id} invoice=${invoiceUrl ? 'ok' : 'null'}`,
    );

    return { invoiceUrl, subscriptionId: subscription.id, planCode: plan.code };
  }

  /**
   * Processa eventos do webhook Asaas que pertencem à assinatura SaaS.
   * Chamado pelo PaymentGatewayWebhookController APÓS a validação de token,
   * só quando isSaasWebhookEvent(body) === true.
   */
  async handleWebhook(body: any): Promise<void> {
    const event: string = body?.event || '';
    const payment = body?.payment;
    const subId: string | undefined = payment?.subscription || body?.subscription?.id;
    const extRef: string =
      payment?.externalReference || body?.subscription?.externalReference || '';

    const tenantId =
      this.tenantIdFromRef(extRef) ||
      (subId ? await this.tenantIdFromSubscription(subId) : null);

    if (!tenantId) {
      this.logger.warn(`[SAAS-BILLING] Webhook SaaS sem tenant resolvido (event=${event}, ref=${extRef}, sub=${subId})`);
      return;
    }

    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      // current_period_end é informativo (o gate usa o status); calcula de forma
      // determinística a partir do vencimento da cobrança (evita dupla extensão
      // em eventos repetidos).
      const base = payment?.dueDate ? new Date(payment.dueDate) : new Date();
      const periodEnd = new Date(base);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { subscription_status: 'ACTIVE', current_period_end: periodEnd },
      });
      this.logger.log(`[SAAS-BILLING] Tenant ${tenantId} ATIVADO (event=${event}).`);
    } else if (event === 'PAYMENT_OVERDUE') {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { subscription_status: 'PAST_DUE' },
      });
      this.logger.log(`[SAAS-BILLING] Tenant ${tenantId} PAST_DUE (pagamento vencido).`);
    } else if (event === 'SUBSCRIPTION_DELETED' || event === 'PAYMENT_REFUNDED') {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { subscription_status: 'CANCELED' },
      });
      this.logger.log(`[SAAS-BILLING] Tenant ${tenantId} CANCELED (event=${event}).`);
    } else {
      this.logger.debug(`[SAAS-BILLING] Evento SaaS ignorado: ${event} (tenant=${tenantId}).`);
    }
  }

  private tenantIdFromRef(ref: string): string | null {
    return typeof ref === 'string' && ref.startsWith('saas:') ? ref.slice(5) : null;
  }

  private async tenantIdFromSubscription(subId: string): Promise<string | null> {
    const t = await this.prisma.tenant.findFirst({
      where: { asaas_subscription_id: subId },
      select: { id: true },
    });
    return t?.id ?? null;
  }
}

/**
 * O evento do webhook Asaas pertence à assinatura SaaS? (vs. honorário).
 * Desambigua por externalReference "saas:" ou eventos SUBSCRIPTION_*.
 * Usado pelo controller do webhook pra rotear sem tocar no fluxo de honorários.
 */
export function isSaasWebhookEvent(body: any): boolean {
  const event: string = body?.event || '';
  const ref: string =
    body?.payment?.externalReference || body?.subscription?.externalReference || '';
  return event.startsWith('SUBSCRIPTION_') || (typeof ref === 'string' && ref.startsWith('saas:'));
}
