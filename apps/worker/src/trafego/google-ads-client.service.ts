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
   * Bypass do SDK wrappers (`customer.campaigns.update`, `customer.mutateResources`)
   * pra ter controle TOTAL sobre o update_mask enviado pro Google.
   *
   * Por que existe (achado em 2026-05-17): o SDK google-ads-api v23 chama
   * internamente `getFieldMask(payload)` que tem dois bugs:
   *   1. Pra oneof empty objects (`maximize_conversions: {}`), nao adiciona
   *      o parent path → mask sem o oneof → Google ignora silenciosamente
   *      ("SUCCESS" sem efeito).
   *   2. Se forcarmos o parent path (via monkey-patch), Google rejeita com
   *      FIELD_HAS_SUBFIELDS pq oneof eh message-type, nao scalar.
   *
   * Pra mutate de bidding strategy, o caminho RFC-correto eh:
   *   - body: { resource_name, bidding_strategy_type, <oneof>: {...} }
   *   - mask: ["bidding_strategy_type"]  (apenas o enum scalar)
   *
   * Google usa o enum pra escolher qual oneof field "selecionar" e o body
   * pra popular os defaults. Mas o SDK auto-mask nao faz isso direito —
   * passar diretamente via GoogleAdsServiceClient.mutate eh o jeito de
   * forcar mask exato.
   *
   * Loga response completo (sanitizado) pra debug. Sem isso, fica impossivel
   * saber por que um mutate "deu SUCCESS" mas nao aplicou.
   */
  async mutateCampaignWithExplicitMask(
    customer: Customer,
    customerId: string,
    campaignResource: Record<string, unknown>,
    updateMaskPaths: string[],
    validateOnly: boolean,
  ): Promise<{ ok: boolean; raw: unknown; resourceNames: string[]; error?: string }> {
    // GoogleAdsServiceClient eh acessivel via loadService (protected na
    // classe Service, exposto via cast pra `any`). Esse eh o entry point
    // gRPC bruto onde mask vai sem mutacao.
    const svc = (customer as any).loadService('GoogleAdsServiceClient');

    const request = {
      customer_id: customerId,
      mutate_operations: [
        {
          campaign_operation: {
            update: campaignResource,
            update_mask: { paths: updateMaskPaths },
          },
        },
      ],
      validate_only: validateOnly,
      partial_failure: true,
    };

    this.logger.log(
      `[mutate-grpc] customer=${customerId} mask=${JSON.stringify(updateMaskPaths)} validate_only=${validateOnly} body=${JSON.stringify(campaignResource, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
    );

    return new Promise((resolve, reject) => {
      svc.mutate(request, (err: any, response: any) => {
        if (err) {
          const formatted = this.formatError(err);
          this.logger.warn(
            `[mutate-grpc] FAILED kind=${formatted.kind} ${formatted.message}`,
          );
          return reject(err);
        }
        const resourceNames = (response?.mutate_operation_responses ?? [])
          .map((r: any) => r?.campaign_result?.resource_name)
          .filter((rn: any): rn is string => !!rn);
        const partial = response?.partial_failure_error;
        this.logger.log(
          `[mutate-grpc] SUCCESS resources=${resourceNames.length} partial=${partial ? 'YES' : 'no'} raw=${JSON.stringify(this.safeSnapshot(response))}`,
        );
        resolve({
          ok: !partial,
          raw: response,
          resourceNames,
          error: partial ? JSON.stringify(partial).slice(0, 500) : undefined,
        });
      });
    });
  }

  /**
   * Snapshot defensivo da response do Google pra log — converte BigInt e
   * trunca pra evitar polluir muito o log com payloads gigantes.
   */
  private safeSnapshot(response: unknown): unknown {
    try {
      const json = JSON.stringify(response, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      return JSON.parse(json.length > 2000 ? json.slice(0, 2000) + '...[truncated]' : json);
    } catch {
      return '(unserializable)';
    }
  }

  /**
   * Helper pra detectar tipo de erro retornado pelo SDK e mapear pra
   * mensagem util no TrafficSyncLog.
   */
  formatError(error: any): { kind: string; message: string } {
    // GoogleAdsFailure — erro estruturado da API. Pode ter MULTIPLOS errors,
    // junta todos pra log nao perder info (campos invalidos numa query
    // costumam ser listados todos juntos).
    if (error instanceof errors.GoogleAdsFailure) {
      const all = (error.errors ?? []).map((e: any) => {
        const code = e?.error_code ? Object.values(e.error_code)[0] : '';
        return `[${code}] ${e?.message ?? 'sem msg'}`;
      });
      return {
        kind: 'GoogleAdsFailure',
        message: (all.length > 0
          ? all.join(' | ')
          : 'GoogleAdsFailure sem detalhes'
        ).slice(0, 1500),
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
        // Mensagem expandida em 2026-05-17 (BUG #3): o sintoma mais comum
        // de "revogacao recorrente a cada 7 dias" eh o OAuth Consent Screen
        // do projeto Google Cloud estar em status "Testing" — Google revoga
        // refresh tokens automaticamente apos 7 dias nesse modo. Publicar o
        // app ("Push to production") em https://console.cloud.google.com/apis/credentials/consent
        // remove o limite. Causas alternativas: senha da conta Google trocada,
        // limite de 50 refresh tokens por OAuth client estourado, acesso
        // revogado manualmente em myaccount.google.com/permissions.
        message:
          'Refresh token invalido ou revogado. Reconecte a conta via OAuth. ' +
          'Se isso esta acontecendo recorrentemente (a cada ~7 dias), o OAuth ' +
          'Consent Screen do projeto Google Cloud provavelmente esta em ' +
          'modo "Testing" — publique o app em ' +
          'https://console.cloud.google.com/apis/credentials/consent.',
      };
    }
    // Generico
    return {
      kind: error?.constructor?.name || 'UnknownError',
      message: (error?.message || String(error)).slice(0, 1000),
    };
  }
}
