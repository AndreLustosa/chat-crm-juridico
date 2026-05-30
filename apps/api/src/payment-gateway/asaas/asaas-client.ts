import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { SettingsService } from '../../settings/settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptValue } from '../../common/utils/crypto.util';

interface AsaasConfig {
  apiKey: string;
  baseUrl: string;
  sandbox: boolean;
}

interface CreateCustomerData {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  externalReference?: string;
}

interface CreateChargeData {
  customer: string;
  /**
   * BOLETO | PIX | CREDIT_CARD | UNDEFINED
   * UNDEFINED permite o cliente escolher entre boleto/pix/cartao na tela do Asaas.
   */
  billingType: string;
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
  postalService?: boolean;
  installmentCount?: number;  // Parcelamento: número de parcelas
  installmentValue?: number;  // Parcelamento: valor de cada parcela

  // ─── Juros, multa, desconto (Asaas docs: Customizing Payment) ─────
  interest?: { value: number };          // % juros ao mês
  fine?: { value: number; type?: 'PERCENTAGE' | 'FIXED' }; // multa
  discount?: {
    value: number;
    dueDateLimitDays: number;            // 0 = ate o vencimento
    type?: 'PERCENTAGE' | 'FIXED';
  };

  // ─── Repasse de taxas ao cliente ──────────────────────────────────
  // Se true, taxa Asaas (cartao 2.99% + R$ 0.49) aparece somada no checkout
  // do cliente em vez de descontar do recebido. So aplica quando billingType
  // permite cartao (CREDIT_CARD ou UNDEFINED).
  splitFees?: boolean;
}

interface ListChargesParams {
  customer?: string;
  status?: string;
  offset?: number;
  limit?: number;
}

/** Assinatura recorrente (billing SaaS — cobra o escritório mensalmente). */
interface CreateSubscriptionData {
  customer: string;
  /** BOLETO | PIX | CREDIT_CARD | UNDEFINED (UNDEFINED = cliente escolhe no checkout). */
  billingType: string;
  value: number;
  /** Data da 1ª cobrança (YYYY-MM-DD). */
  nextDueDate: string;
  /** WEEKLY | BIWEEKLY | MONTHLY | QUARTERLY | SEMIANNUALLY | YEARLY */
  cycle: string;
  description?: string;
  /** Para desambiguar no webhook: usamos "saas:<tenant_id>". */
  externalReference?: string;
}

@Injectable()
export class AsaasClient {
  private readonly logger = new Logger(AsaasClient.name);
  private readonly MAX_RETRIES = 3;

  constructor(
    private settingsService: SettingsService,
    private prisma: PrismaService,
  ) {}

  private baseUrlFor(sandbox: boolean): string {
    // Docs: https://docs.asaas.com/docs/authentication-2
    return sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  }

  /**
   * Config do Asaas — regra multi-tenant:
   *  1) Tenant TEM chave própria → usa a conta DELE (honorários → clientes dele).
   *  2) Tenant é INTERNO (escritório do dono) e sem chave → usa a conta GLOBAL.
   *  3) Tenant externo SEM chave → apiKey vazia → request() bloqueia com aviso.
   *     NUNCA cai silenciosamente na conta da plataforma.
   *  Sem tenantId (ex.: assinatura SaaS) → sempre a conta GLOBAL da plataforma.
   */
  async getConfig(tenantId?: string): Promise<AsaasConfig> {
    if (tenantId) {
      try {
        const t = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { asaas_api_key: true, asaas_sandbox: true, is_internal: true },
        });
        const ownKey = t?.asaas_api_key ? decryptValue(t.asaas_api_key) : '';
        if (ownKey) {
          const sandbox = !!t?.asaas_sandbox;
          this.logger.debug(`[ASAAS] Config tenant=${tenantId} (conta própria), sandbox=${sandbox}`);
          return { apiKey: ownKey, baseUrl: this.baseUrlFor(sandbox), sandbox };
        }
        if (!t?.is_internal) {
          this.logger.warn(`[ASAAS] Tenant ${tenantId} sem Asaas configurado e não-interno — bloqueando.`);
          return { apiKey: '', baseUrl: this.baseUrlFor(false), sandbox: false };
        }
        // Tenant interno sem chave própria → usa o global abaixo.
      } catch (e: any) {
        this.logger.warn(`[ASAAS] Falha lendo config do tenant ${tenantId}: ${e.message}. Usando global.`);
      }
    }

    // Conta GLOBAL da plataforma (tenant interno, assinatura SaaS, ou fallback de erro).
    const apiKey = await this.settingsService.get('asaas_api_key');
    const sandboxStr = await this.settingsService.get('asaas_sandbox');
    const sandbox = sandboxStr === 'true';
    this.logger.debug(`[ASAAS] Config GLOBAL, sandbox=${sandbox}, apiKey=${apiKey ? `${apiKey.slice(0, 10)}...` : 'NAO CONFIGURADA'}`);
    return { apiKey: apiKey || '', baseUrl: this.baseUrlFor(sandbox), sandbox };
  }

  // ─── Core HTTP wrapper ─────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    data?: any,
    params?: any,
    tenantId?: string,
  ): Promise<T> {
    const config = await this.getConfig(tenantId);
    if (!config.apiKey) {
      throw new Error('Asaas não configurado para este escritório. Configure em Configurações → Pagamentos.');
    }

    const url = `${config.baseUrl}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(
          `[ASAAS] ${method.toUpperCase()} ${path} (tentativa ${attempt}/${this.MAX_RETRIES})`,
        );

        const response = await axios({
          method,
          url,
          data,
          params,
          headers: {
            access_token: config.apiKey,
            'Content-Type': 'application/json',
            'User-Agent': 'LexCRM/1.0',  // Obrigatório desde Nov/2024
          },
          timeout: 30000,
        });

        this.logger.debug(
          `[ASAAS] Resposta ${response.status} para ${method.toUpperCase()} ${path}`,
        );

        return response.data as T;
      } catch (err) {
        const axiosErr = err as AxiosError<any>;
        const status = axiosErr.response?.status;
        const asaasErrors = axiosErr.response?.data?.errors;

        // Nao retentar erros de validacao (4xx)
        if (status && status >= 400 && status < 500) {
          const errorMsg = asaasErrors?.length
            ? asaasErrors.map((e: any) => `${e.code}: ${e.description}`).join('; ')
            : axiosErr.message;
          throw new Error(`[Asaas ${status}] ${errorMsg}`);
        }

        lastError = new Error(
          `[Asaas] Falha na tentativa ${attempt}: ${axiosErr.message}`,
        );
        this.logger.warn(lastError.message);

        // Backoff exponencial + jitter — apenas para erros de rede / 5xx.
        // Jitter aleatorio (+0-500ms) quebra thundering herd quando varias
        // replicas batem no Asaas ao mesmo tempo apos uma queda transitoria.
        if (attempt < this.MAX_RETRIES) {
          const baseDelay = Math.pow(2, attempt) * 500;
          const jitter = Math.floor(Math.random() * 500);
          await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
        }
      }
    }

    throw lastError || new Error('[Asaas] Erro desconhecido apos retentativas');
  }

  // ─── Customers ─────────────────────────────────────────

  // tenantId (opcional) roteia para a conta Asaas DO ESCRITÓRIO; sem ele,
  // usa a conta global da plataforma (ver getConfig).

  async createCustomer(data: CreateCustomerData, tenantId?: string): Promise<any> {
    return this.request<any>('POST', '/customers', data, undefined, tenantId);
  }

  async getCustomer(customerId: string, tenantId?: string): Promise<any> {
    return this.request<any>('GET', `/customers/${customerId}`, undefined, undefined, tenantId);
  }

  // ─── Charges (Payments) ────────────────────────────────

  async createCharge(data: CreateChargeData, tenantId?: string): Promise<any> {
    return this.request<any>('POST', '/payments', data, undefined, tenantId);
  }

  async getCharge(chargeId: string, tenantId?: string): Promise<any> {
    return this.request<any>('GET', `/payments/${chargeId}`, undefined, undefined, tenantId);
  }

  async getPixQrCode(chargeId: string, tenantId?: string): Promise<any> {
    return this.request<any>('GET', `/payments/${chargeId}/pixQrCode`, undefined, undefined, tenantId);
  }

  async updateCharge(chargeId: string, data: { value?: number; dueDate?: string; description?: string }, tenantId?: string): Promise<any> {
    return this.request<any>('PUT', `/payments/${chargeId}`, data, undefined, tenantId);
  }

  async getBalance(tenantId?: string): Promise<any> {
    return this.request<any>('GET', '/finance/balance', undefined, undefined, tenantId);
  }

  /**
   * Testa uma chave Asaas AVULSA (sem salvar) — usado pelo botão "Testar
   * conexão" quando o escritório digita a chave. Faz um GET /finance/balance
   * direto com a chave informada. Não usa retry (feedback rápido ao usuário).
   */
  async testKey(apiKey: string, sandbox: boolean): Promise<{ ok: boolean; error?: string }> {
    if (!apiKey?.trim()) return { ok: false, error: 'Informe a chave de API.' };
    try {
      await axios.get(`${this.baseUrlFor(sandbox)}/finance/balance`, {
        headers: { access_token: apiKey.trim(), 'User-Agent': 'LexCRM/1.0' },
        timeout: 15000,
      });
      return { ok: true };
    } catch (err) {
      const e = err as AxiosError<any>;
      const status = e.response?.status;
      if (status === 401) return { ok: false, error: 'Chave inválida (401). Confira a chave no painel do Asaas.' };
      const asaasMsg = e.response?.data?.errors?.[0]?.description;
      return { ok: false, error: asaasMsg || e.message || 'Falha ao conectar no Asaas.' };
    }
  }

  async receiveInCash(chargeId: string, paymentDate: string, value: number, tenantId?: string): Promise<any> {
    return this.request<any>('POST', `/payments/${chargeId}/receiveInCash`, {
      paymentDate,
      value,
    }, undefined, tenantId);
  }

  async deleteCharge(chargeId: string, tenantId?: string): Promise<any> {
    return this.request<any>('DELETE', `/payments/${chargeId}`, undefined, undefined, tenantId);
  }

  async listCharges(params?: any, tenantId?: string): Promise<any> {
    return this.request<any>('GET', '/payments', undefined, params, tenantId);
  }

  // ─── Customers List ───────────────────────────────────────

  async listCustomers(params?: {
    name?: string;
    email?: string;
    cpfCnpj?: string;
    externalReference?: string;
    offset?: number;
    limit?: number;
  }, tenantId?: string): Promise<any> {
    return this.request<any>('GET', '/customers', undefined, params, tenantId);
  }

  // ─── Subscriptions (assinatura recorrente — billing SaaS) ──────────
  // OBS: a MESMA conta Asaas cobra honorários (clientes do escritório) e a
  // assinatura SaaS (o escritório). Por isso toda subscription SaaS leva
  // externalReference="saas:<tenant_id>" — o webhook desambigua por esse prefixo.

  async createSubscription(data: CreateSubscriptionData): Promise<any> {
    return this.request<any>('POST', '/subscriptions', data);
  }

  async getSubscription(subscriptionId: string): Promise<any> {
    return this.request<any>('GET', `/subscriptions/${subscriptionId}`);
  }

  async cancelSubscription(subscriptionId: string): Promise<any> {
    return this.request<any>('DELETE', `/subscriptions/${subscriptionId}`);
  }

  /** Pagamentos gerados por uma assinatura — usado p/ pegar a invoiceUrl da 1ª cobrança. */
  async listSubscriptionPayments(subscriptionId: string): Promise<any> {
    return this.request<any>('GET', `/subscriptions/${subscriptionId}/payments`);
  }
}
