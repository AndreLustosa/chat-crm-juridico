import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GoogleAdsApi, Customer, errors } from 'google-ads-api';
import { PrismaService } from '../prisma/prisma.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';

/**
 * Helper que monta um Customer do SDK google-ads-api a partir do nosso
 * TrafficAccount + credenciais do TrafegoConfigService.
 *
 * O SDK cuida internamente de:
 *   - Trocar refresh_token por access_token (cache 1h)
 *   - Renovar access_token quando expirar
 *   - Mapear gRPC do Google Ads pra TypeScript
 *
 * Nossa responsabilidade aqui:
 *   - Decriptar refresh_token (esta criptografado em TrafficAccount.refresh_token_enc)
 *   - Buscar credentials (developer_token, client_id/secret) via config service
 *   - Lidar com erros de configuracao incompleta
 */
@Injectable()
export class GoogleAdsClientService {
  private readonly logger = new Logger(GoogleAdsClientService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: TrafegoCryptoService,
    private config: TrafegoConfigService,
  ) {}

  /**
   * Monta um Customer pronto pra fazer queries GAQL na conta-alvo
   * de um tenant. Lanca ServiceUnavailableException se faltar config.
   */
  async getCustomer(tenantId: string, accountId: string): Promise<Customer> {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { id: accountId, tenant_id: tenantId },
    });
    if (!account) {
      throw new ServiceUnavailableException(
        `TrafficAccount ${accountId} nao encontrada (tenant=${tenantId})`,
      );
    }
    if (!account.refresh_token_enc) {
      throw new ServiceUnavailableException(
        'Conta sem refresh_token — reconecte via OAuth.',
      );
    }
    if (!account.customer_id) {
      throw new ServiceUnavailableException(
        'Conta sem customer_id alvo configurado.',
      );
    }

    // Decripta refresh_token. Lanca se chave invalida ou cripto vazio.
    let refreshToken: string;
    try {
      refreshToken = this.crypto.decrypt(account.refresh_token_enc);
    } catch (e: any) {
      throw new ServiceUnavailableException(
        `Falha decriptando refresh_token: ${e.message}. ` +
          `Refaca OAuth (TRAFEGO_ENCRYPTION_KEY pode ter sido rotacionada).`,
      );
    }

    const developerToken = await this.config.getDeveloperToken(tenantId);
    const clientId = await this.config.getOAuthClientId(tenantId);
    const clientSecret = await this.config.getOAuthClientSecret(tenantId);

    if (!developerToken || !clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'Credenciais Google Ads incompletas. Verifique Configuracoes do modulo de trafego.',
      );
    }

    const api = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });

    return api.Customer({
      customer_id: account.customer_id,
      login_customer_id: account.login_customer_id || undefined,
      refresh_token: refreshToken,
    });
  }

  /**
   * Helper pra detectar tipo de erro retornado pelo SDK e mapear pra
   * mensagem util no TrafficSyncLog.
   */
  formatError(error: any): { kind: string; message: string } {
    // GoogleAdsFailure — erro estruturado da API
    if (error instanceof errors.GoogleAdsFailure) {
      const first = error.errors?.[0];
      const errCode = first?.error_code ? Object.values(first.error_code)[0] : '';
      return {
        kind: 'GoogleAdsFailure',
        message: `${errCode}: ${first?.message ?? 'erro sem mensagem'}`.slice(0, 1000),
      };
    }
    // gRPC ou rede
    if (error?.code === 'UNAVAILABLE' || error?.code === 14) {
      return {
        kind: 'NetworkError',
        message: 'Google Ads API indisponivel (rede/gRPC). Tentar novamente depois.',
      };
    }
    // Acesso revogado
    if (
      error?.message?.includes('invalid_grant') ||
      error?.message?.includes('invalid refresh token')
    ) {
      return {
        kind: 'TokenRevoked',
        message: 'Refresh token invalido ou revogado. Reconecte a conta via OAuth.',
      };
    }
    // Generico
    return {
      kind: error?.constructor?.name || 'UnknownError',
      message: (error?.message || String(error)).slice(0, 1000),
    };
  }
}
