import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SAAS_PLANS, getPlan } from '../subscription/plans';

/**
 * Billing da ASSINATURA SaaS via STRIPE (cobra o ESCRITÓRIO/Tenant). Fase 5.
 *
 * Substitui o SaasBillingService (Asaas) APENAS para a assinatura do sistema —
 * os HONORÁRIOS (escritório → clientes) continuam no Asaas. A lógica de
 * assinatura (subscription_status, gating, trial) é a mesma; aqui só trocamos o
 * "motor" de cobrança. Customer Stripe = o Tenant (Tenant.stripe_customer_id).
 *
 * Catálogo (Products/Prices) é criado pelo PRÓPRIO código (ensureCatalog),
 * idempotente via lookup_key = plan.code — sem trabalho manual no dashboard.
 *
 * Chaves (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET) vêm de Settings ou env —
 * NUNCA hardcoded. Config feita pelo SUPER_ADMIN (tela master).
 */
@Injectable()
export class StripeBillingService {
  private readonly logger = new Logger(StripeBillingService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Client Stripe (lazy). Lê a secret key de Settings → env. */
  private async client(): Promise<Stripe> {
    if (this.stripe) return this.stripe;
    const key = (await this.settings.get('STRIPE_SECRET_KEY')) || process.env.STRIPE_SECRET_KEY;
    if (!key) throw new BadRequestException('Stripe não configurado (STRIPE_SECRET_KEY ausente).');
    this.stripe = new Stripe(key);
    return this.stripe;
  }

  /** Base URL do frontend (success/cancel/return). */
  private appUrl(): string {
    return (process.env.PUBLIC_APP_URL || 'https://andrelustosaadvogados.com.br/sistema').replace(/\/+$/, '');
  }

  /**
   * Garante Product + Price (recorrente mensal, BRL) de cada plano do catálogo.
   * Idempotente: usa o lookup_key = plan.code. Retorna { code: priceId }.
   */
  async ensureCatalog(): Promise<Record<string, string>> {
    const stripe = await this.client();
    const map: Record<string, string> = {};
    for (const plan of SAAS_PLANS) {
      const existing = await stripe.prices.list({ lookup_keys: [plan.code], active: true, limit: 1 });
      if (existing.data[0]) {
        map[plan.code] = existing.data[0].id;
        continue;
      }
      const product = await stripe.products.create({
        name: `Jurisflow — ${plan.name}`,
        metadata: {
          code: plan.code,
          processos_limit: String(plan.processos_limit),
          ai_enabled: String(plan.ai_enabled),
        },
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(plan.price * 100), // BRL → centavos
        currency: 'brl',
        recurring: { interval: 'month' },
        lookup_key: plan.code,
        nickname: plan.name,
      });
      map[plan.code] = price.id;
      this.logger.log(`[STRIPE] Plano provisionado: ${plan.code} → ${price.id}`);
    }
    return map;
  }

  private async priceIdFor(code: string): Promise<string> {
    const stripe = await this.client();
    const found = await stripe.prices.list({ lookup_keys: [code], active: true, limit: 1 });
    if (found.data[0]) return found.data[0].id;
    const map = await this.ensureCatalog();
    const id = map[code];
    if (!id) throw new BadRequestException('Plano não encontrado no Stripe.');
    return id;
  }

  /**
   * Inicia a assinatura: garante o customer Stripe do escritório e cria uma
   * Checkout Session (mode=subscription). Devolve a URL hospedada do Stripe.
   * O status só vira ACTIVE quando o pagamento confirmar (webhook).
   */
  async checkout(opts: { tenantId: string; planCode: string; email?: string }): Promise<{ url: string | null }> {
    const plan = getPlan(opts.planCode);
    if (!plan) throw new BadRequestException('Plano inválido.');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: opts.tenantId },
      select: { id: true, name: true, stripe_customer_id: true, is_internal: true },
    });
    if (!tenant) throw new NotFoundException('Escritório não encontrado.');
    if (tenant.is_internal) throw new BadRequestException('Escritório interno não assina (acesso ilimitado).');

    try {
      const stripe = await this.client();

      // 1) Customer Stripe do escritório (cria + persiste na 1ª vez).
      let customerId = tenant.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: tenant.name,
          email: opts.email,
          metadata: { tenant_id: tenant.id },
        });
        customerId = customer.id;
        await this.prisma.tenant.update({ where: { id: tenant.id }, data: { stripe_customer_id: customerId } });
      }

      // 2) Preço do plano (garante no catálogo se faltar).
      const priceId = await this.priceIdFor(plan.code);

      // 3) Checkout Session (assinatura mensal).
      const base = this.appUrl();
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}/assinatura?status=sucesso`,
        cancel_url: `${base}/assinatura?status=cancelado`,
        subscription_data: { metadata: { tenant_id: tenant.id, saas: 'true' } },
        metadata: { tenant_id: tenant.id, plan: plan.code },
        tax_id_collection: { enabled: true }, // coleta CPF/CNPJ no proprio checkout (cobranca BR)
        // tax_id_collection exige customer_update[address]=auto: o Stripe precisa
        // salvar o endereco (e o CPF/CNPJ) coletados no customer existente. Sem
        // 'address' ele recusa com "could not find a valid address".
        customer_update: { name: 'auto', address: 'auto' },
        locale: 'pt-BR',
      });

      // Grava o plano escolhido (status muda só no webhook).
      await this.prisma.tenant.update({ where: { id: tenant.id }, data: { plan: plan.code } });

      this.logger.log(`[STRIPE] Checkout tenant=${tenant.id} plano=${plan.code} session=${session.id}`);
      return { url: session.url };
    } catch (e: any) {
      // Erros de validacao proprios (plano/interno/sem-config) sobem como estao.
      if (e instanceof BadRequestException || e instanceof NotFoundException) throw e;
      // Erro do SDK do Stripe (ex.: customer_update faltando) → loga a causa REAL
      // e expoe a mensagem do Stripe como 400 (pra aparecer na tela, sem virar 500 generico).
      this.logger.error(`[STRIPE] checkout falhou (tenant=${opts.tenantId}): ${e?.message}`);
      throw new BadRequestException(`Stripe: ${e?.message || 'falha ao iniciar o checkout.'}`);
    }
  }

  /**
   * Customer Portal (Stripe Billing): o escritório gerencia o próprio cartão,
   * troca de plano e cancela — página hospedada do Stripe. Zero código nosso.
   */
  async portal(tenantId: string): Promise<{ url: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripe_customer_id: true },
    });
    if (!tenant?.stripe_customer_id) {
      throw new BadRequestException('Escritório ainda não tem assinatura no Stripe.');
    }
    const stripe = await this.client();
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${this.appUrl()}/assinatura`,
    });
    return { url: session.url };
  }

  /** Verifica a assinatura do webhook (HMAC) e devolve o evento. Lança se inválido. */
  async constructEvent(rawBody: string | Buffer, signature: string): Promise<Stripe.Event> {
    const secret = (await this.settings.get('STRIPE_WEBHOOK_SECRET')) || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new BadRequestException('Stripe webhook secret não configurado.');
    const stripe = await this.client();
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  /** Mapeia eventos do Stripe → subscription_status (mesma máquina de estados do Asaas). */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const tenantId = s.metadata?.tenant_id;
        if (tenantId && s.subscription) {
          await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { stripe_subscription_id: String(s.subscription) },
          });
        }
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice;
        const tenantId = await this.tenantByCustomer(inv.customer);
        if (tenantId) {
          const periodEnd = inv.lines?.data?.[0]?.period?.end;
          await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
              subscription_status: 'ACTIVE',
              current_period_end: periodEnd ? new Date(periodEnd * 1000) : null,
            },
          });
          this.logger.log(`[STRIPE] Tenant ${tenantId} ATIVADO (${event.type}).`);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const tenantId = await this.tenantByCustomer(inv.customer);
        if (tenantId) {
          await this.prisma.tenant.update({ where: { id: tenantId }, data: { subscription_status: 'PAST_DUE' } });
          this.logger.log(`[STRIPE] Tenant ${tenantId} PAST_DUE.`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = await this.tenantByCustomer(sub.customer);
        if (tenantId) {
          await this.prisma.tenant.update({ where: { id: tenantId }, data: { subscription_status: 'CANCELED' } });
          this.logger.log(`[STRIPE] Tenant ${tenantId} CANCELED.`);
        }
        break;
      }
      case 'customer.subscription.updated': {
        // Disparado quando o cliente TROCA DE PLANO (upgrade/downgrade) pelo
        // Customer Portal. Sincroniza o campo `plan` (que governa o limite de
        // processos e o gate de IA) com o preço atual da assinatura no Stripe.
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = await this.tenantByCustomer(sub.customer);
        if (tenantId) {
          // lookup_key do price = plan.code (definido no ensureCatalog).
          const lookupKey = sub.items?.data?.[0]?.price?.lookup_key ?? undefined;
          const plan = lookupKey && getPlan(lookupKey) ? lookupKey : undefined;
          // Reflete o status do Stripe na máquina de estados interna.
          const status =
            sub.status === 'active'
              ? 'ACTIVE'
              : sub.status === 'past_due' || sub.status === 'unpaid'
                ? 'PAST_DUE'
                : sub.status === 'canceled'
                  ? 'CANCELED'
                  : undefined;
          // current_period_end mudou de lugar entre versões da API — busca defensiva.
          const anySub = sub as any;
          const periodEndUnix = anySub.current_period_end ?? anySub.items?.data?.[0]?.current_period_end;
          if (plan || status || periodEndUnix) {
            await this.prisma.tenant.update({
              where: { id: tenantId },
              data: {
                ...(plan ? { plan } : {}),
                ...(status ? { subscription_status: status } : {}),
                ...(periodEndUnix ? { current_period_end: new Date(periodEndUnix * 1000) } : {}),
              },
            });
            this.logger.log(`[STRIPE] Tenant ${tenantId} atualizado (plano=${plan ?? '—'}, status=${status ?? '—'}).`);
          }
        }
        break;
      }
      default:
        this.logger.debug(`[STRIPE] Evento ignorado: ${event.type}`);
    }
  }

  private async tenantByCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ): Promise<string | null> {
    const customerId = typeof customer === 'string' ? customer : customer?.id;
    if (!customerId) return null;
    const t = await this.prisma.tenant.findFirst({
      where: { stripe_customer_id: customerId },
      select: { id: true },
    });
    return t?.id ?? null;
  }
}
