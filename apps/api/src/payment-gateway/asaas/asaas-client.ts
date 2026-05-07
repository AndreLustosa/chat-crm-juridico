import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { SettingsService } from '../../settings/settings.service';

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

@Injectable()
export class AsaasClient {
  private readonly logger = new Logger(AsaasClient.name);
  private readonly MAX_RETRIES = 3;

  constructor(private settingsService: SettingsService) {}

  async getConfig(): Promise<AsaasConfig> {
    const apiKey = await this.settingsService.get('asaas_api_key');
    const sandboxStr = await this.settingsService.get('asaas_sandbox');
    const sandbox = sandboxStr === 'true';

    // Docs: https://docs.asaas.com/docs/authentication-2
    const baseUrl = sandbox
      ? 'https://api-sandbox.asaas.com/v3'
      : 'https://api.asaas.com/v3';

    this.logger.debug(`[ASAAS] Config: sandbox=${sandbox}, baseUrl=${baseUrl}, apiKey=${apiKey ? `${apiKey.slice(0, 10)}...` : 'NAO CONFIGURADA'}`);

    return { apiKey: apiKey || '', baseUrl, sandbox };
  }

  // ─── Core HTTP wrapper ─────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    data?: any,
    params?: any,
  ): Promise<T> {
    const config = await this.getConfig();
    if (!config.apiKey) {
      throw new Error('Asaas API key nao configurada. Configure "asaas_api_key" nas configuracoes.');
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

  async createCustomer(data: CreateCustomerData): Promise<any> {
    return this.request<any>('POST', '/customers', data);
  }

  async getCustomer(customerId: string): Promise<any> {
    return this.request<any>('GET', `/customers/${customerId}`);
  }

  // ─── Charges (Payments) ────────────────────────────────

  async createCharge(data: CreateChargeData): Promise<any> {
    return this.request<any>('POST', '/payments', data);
  }

  async getCharge(chargeId: string): Promise<any> {
    return this.request<any>('GET', `/payments/${chargeId}`);
  }

  async getPixQrCode(chargeId: string): Promise<any> {
    return this.request<any>('GET', `/payments/${chargeId}/pixQrCode`);
  }

  async updateCharge(chargeId: string, data: { value?: number; dueDate?: string; description?: string }): Promise<any> {
    return this.request<any>('PUT', `/payments/${chargeId}`, data);
  }

  async getBalance(): Promise<any> {
    return this.request<any>('GET', '/finance/balance');
  }

  async receiveInCash(chargeId: string, paymentDate: string, value: number): Promise<any> {
    return this.request<any>('POST', `/payments/${chargeId}/receiveInCash`, {
      paymentDate,
      value,
    });
  }

  async deleteCharge(chargeId: string): Promise<any> {
    return this.request<any>('DELETE', `/payments/${chargeId}`);
  }

  async listCharges(params?: any): Promise<any> {
    return this.request<any>('GET', '/payments', undefined, params);
  }

  // ─── Customers List ───────────────────────────────────────

  async listCustomers(params?: {
    name?: string;
    email?: string;
    cpfCnpj?: string;
    externalReference?: string;
    offset?: number;
    limit?: number;
  }): Promise<any> {
    return this.request<any>('GET', '/customers', undefined, params);
  }
}
