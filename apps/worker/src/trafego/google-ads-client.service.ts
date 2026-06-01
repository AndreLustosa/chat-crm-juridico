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
  /**
   * Resolve nomes de localizacao -> geo_target_constants via
   * GeoTargetConstantService.SuggestGeoTargetConstants (Google Ads API v23).
   * Usado pelo read job 'suggest_geo_targets' e pela resolucao de
   * geo_target_names no create/update de campanha (gestor passa "Arapiraca"
   * sem precisar saber o codigo numerico).
   */
  async suggestGeoTargets(
    customer: Customer,
    opts: { query: string; countryCode?: string; locale?: string },
  ): Promise<
    Array<{
      id: string;
      name: string;
      canonical_name: string;
      target_type: string;
      country_code: string;
      reach: string;
    }>
  > {
    const request: any = {
      locale: opts.locale || 'pt',
      location_names: { names: [opts.query] },
    };
    if (opts.countryCode) request.country_code = opts.countryCode;
    const response: any =
      await customer.geoTargetConstants.suggestGeoTargetConstants(request);
    const suggestions: any[] = response?.geo_target_constant_suggestions ?? [];
    return suggestions
      .map((s) => {
        const g = s?.geo_target_constant ?? {};
        return {
          id: g.id != null ? String(g.id) : '',
          name: g.name ?? '',
          canonical_name: g.canonical_name ?? '',
          target_type: g.target_type ?? '',
          country_code: g.country_code ?? '',
          reach: s?.reach != null ? String(s.reach) : '',
        };
      })
      .filter((x) => x.id);
  }

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
   * Por que existe (achado em 2026-05-17 apos 4 iteracoes):
   *
   * (A) Bug no SDK google-ads-api v23: `utils.js#recursiveFieldMaskSearch`
   *     descende em oneof empty objects (`maximize_conversions: {}`) e
   *     retorna [] sem adicionar o parent path no mask. Resultado: mutate
   *     vai com mask vazio (ou so com fields scalares laterais) e Google
   *     ignora silenciosamente ("SUCCESS" sem efeito).
   *
   * (B) Naive fix de adicionar o oneof name no mask (`["maximize_conversions"]`)
   *     trigga FIELD_HAS_SUBFIELDS — Google nao aceita oneof message-type
   *     diretamente no mask. Precisa de SUBFIELD path.
   *
   * (C) Naive fix de usar `bidding_strategy_type` enum no body+mask falha
   *     porque esse campo eh READ-ONLY / output_only no Campaign — Google
   *     ignora silenciosamente (no-op).
   *
   * (D) RFC-correto (docs oficiais Google, client-libs/java/field-masks):
   *     - body: { resource_name, <oneof>: {...} }  (sem bidding_strategy_type)
   *     - mask: ["<oneof>.<subfield>"]  (subfield path do oneof)
   *
   *     Exemplo MaximizeConversions sem CPA alvo:
   *       body: { resource_name, maximize_conversions: {} }
   *       mask: ["maximize_conversions.target_cpa_micros"]
   *
   *     A presenca do subfield path no mask signala pro Google:
   *     "trocar pra este oneof, com subfield no default."
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

    // CRITICO: bypass deve injetar headers (developer-token + login-customer-id)
    // que o SDK normalmente injeta via interceptor. Sem isso o Google rejeita
    // com `DEVELOPER_TOKEN_PARAMETER_MISSING` antes mesmo de validar o
    // mask/body — todos os erros "INVALID_ARGUMENT" anteriores (db1f985,
    // da11954, 0c2ed08, 8915341) eram esse falso positivo.
    //
    // Padrao copiado de google-ads-api/build/src/customer.js#430 onde o
    // metodo de alto-nivel `mutate` faz exatamente isso.
    const headers = (customer as any).callHeaders;

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
      `[mutate-grpc] customer=${customerId} mask=${JSON.stringify(updateMaskPaths)} validate_only=${validateOnly} body=${JSON.stringify(campaignResource, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))} headers=${JSON.stringify(this.redactHeaders(headers))}`,
    );

    try {
      // google-gax retorna `[response, metadata, status]` em unary call.
      const result = await svc.mutate(request, {
        otherArgs: { headers },
      });
      const response = Array.isArray(result) ? result[0] : result;

      const resourceNames = (response?.mutate_operation_responses ?? [])
        .map((r: any) => r?.campaign_result?.resource_name)
        .filter((rn: any): rn is string => !!rn);
      const partial = response?.partial_failure_error;
      this.logger.log(
        `[mutate-grpc] SUCCESS resources=${resourceNames.length} partial=${partial ? 'YES' : 'no'} raw=${JSON.stringify(this.safeSnapshot(response))}`,
      );
      return {
        ok: !partial,
        raw: response,
        resourceNames,
        error: partial ? JSON.stringify(partial).slice(0, 500) : undefined,
      };
    } catch (err: any) {
      // Erros request-level (INVALID_ARGUMENT, FAILED_PRECONDITION) vem como
      // Error gRPC nativo SEM partial_failure_error. O detalhe estruturado
      // (field_mask_error, mutate_error, etc) fica num trailer binario.
      // Internamente o SDK chama `getGoogleAdsError(err)` mas via bypass
      // precisamos decodificar a mao. Padrao copiado de
      // google-ads-api/build/src/service.js#100.
      const detailed = this.decodeGoogleAdsFailureFromMetadata(err);
      this.logger.warn(
        `[mutate-grpc] FAILED code=${err.code} msg="${err.message}" detailed=${JSON.stringify(detailed)}`,
      );
      throw err;
    }
  }

  /**
   * Bug fix 2026-05-18 (BUG-E v2) — bypass pra remove generico de qualquer
   * resource_type, usando GoogleAdsService.mutate (alto-nivel batch) direto.
   *
   * Por que existe: SDK Opteo nao expoe `.remove` em todos os subservices
   * (ex: customer.assets.remove === undefined). O wrapper alto-nivel
   * customer.mutateResources teoricamente serve, mas no nosso teste em
   * prod ele estava montando MutateOperation com `asset_operation` vazio
   * (Google rejeitava com OPERATION_REQUIRED). Solucao: bypass via
   * loadService('GoogleAdsServiceClient').mutate() com shape EXPLICITO,
   * espelhando o pattern do mutateCampaignWithExplicitMask que funciona.
   *
   * resourceType: snake_case enum tipo 'asset', 'campaign_asset', etc.
   * Internamente vira `<resource_type>_operation` no MutateOperation.
   */
  async removeResourcesViaGoogleAdsService(
    customer: Customer,
    customerId: string,
    resourceType: string,
    resourceNames: string[],
    validateOnly: boolean = false,
  ): Promise<{ ok: boolean; raw: unknown; resourceNames: string[]; error?: string }> {
    const svc = (customer as any).loadService('GoogleAdsServiceClient');
    const headers = (customer as any).callHeaders;

    // Validacao defensiva — resource_names devem ser strings com formato
    // customers/X/<plural>/Y. Se vier ID puro ou vazio, rejeita antes de
    // gastar request.
    for (const rn of resourceNames) {
      if (typeof rn !== 'string' || rn.length === 0) {
        throw new Error(
          `removeResourcesViaGoogleAdsService: resource_name invalido: ${JSON.stringify(rn)}`,
        );
      }
      if (!/^customers\/\d+\/[a-zA-Z]+\/.+/.test(rn)) {
        throw new Error(
          `removeResourcesViaGoogleAdsService: resource_name fora do formato esperado customers/X/<entity>/Y: ${rn}`,
        );
      }
    }

    // resource_type 'asset' vira 'asset_operation'.
    // 'campaign_asset' vira 'campaign_asset_operation'.
    const opKey = `${resourceType}_operation`;
    const mutate_operations = resourceNames.map((rn) => ({
      [opKey]: {
        remove: rn,
      },
    }));

    const request = {
      customer_id: customerId,
      mutate_operations,
      validate_only: validateOnly,
      partial_failure: false,
    };

    this.logger.log(
      `[remove-grpc] customer=${customerId} resource_type=${resourceType} count=${resourceNames.length} opKey=${opKey} validate_only=${validateOnly}`,
    );

    try {
      const result = await svc.mutate(request, {
        otherArgs: { headers },
      });
      const response = Array.isArray(result) ? result[0] : result;

      // Resource names dos resultados (campos sao XxxOperationResponse)
      const responseNames: string[] = [];
      for (const r of response?.mutate_operation_responses ?? []) {
        // Procura qualquer campo *_result com resource_name
        for (const k of Object.keys(r ?? {})) {
          if (k.endsWith('_result') && r[k]?.resource_name) {
            responseNames.push(r[k].resource_name);
          }
        }
      }
      this.logger.log(
        `[remove-grpc] SUCCESS removed=${responseNames.length} raw=${JSON.stringify(this.safeSnapshot(response))}`,
      );
      return {
        ok: true,
        raw: response,
        resourceNames: responseNames.length > 0 ? responseNames : resourceNames,
      };
    } catch (err: any) {
      const detailed = this.decodeGoogleAdsFailureFromMetadata(err);
      this.logger.warn(
        `[remove-grpc] FAILED code=${err.code} msg="${err.message}" detailed=${JSON.stringify(detailed)}`,
      );
      throw err;
    }
  }

  /**
   * Bug fix 2026-05-17 (BUG-A) — bypass pra Customer mutate.
   *
   * O metodo alto-nivel `customer.customers.update(payloads)` do SDK Opteo
   * chama CustomerService.mutateCustomer internamente, mas com auto-mask
   * que NAO pega nested fields como
   * `conversion_tracking_setting.enhanced_conversions_for_leads_enabled`.
   * Resultado: payload mal-formado, Google rejeita com
   * "[5] Mutate operations must have 'create', 'update', or 'remove' specified."
   *
   * Solucao: chamar CustomerService.mutateCustomer direto via loadService,
   * com `update_mask.paths` explicito.
   *
   * Padrao espelhado em mutateCampaignWithExplicitMask.
   */
  async mutateCustomerWithExplicitMask(
    customer: Customer,
    customerId: string,
    customerResource: Record<string, unknown>,
    updateMaskPaths: string[],
    validateOnly: boolean,
  ): Promise<{ ok: boolean; raw: unknown; resourceNames: string[]; error?: string }> {
    const svc = (customer as any).loadService('CustomerServiceClient');
    const headers = (customer as any).callHeaders;

    const request = {
      customer_id: customerId,
      operation: {
        update: customerResource,
        update_mask: { paths: updateMaskPaths },
      },
      validate_only: validateOnly,
    };

    this.logger.log(
      `[mutate-customer-grpc] customer=${customerId} mask=${JSON.stringify(updateMaskPaths)} validate_only=${validateOnly} body=${JSON.stringify(customerResource)} headers=${JSON.stringify(this.redactHeaders(headers))}`,
    );

    try {
      const result = await svc.mutateCustomer(request, {
        otherArgs: { headers },
      });
      const response = Array.isArray(result) ? result[0] : result;

      const resourceName = response?.result?.resource_name;
      this.logger.log(
        `[mutate-customer-grpc] SUCCESS resource=${resourceName ?? '?'} raw=${JSON.stringify(this.safeSnapshot(response))}`,
      );
      return {
        ok: true,
        raw: response,
        resourceNames: resourceName ? [resourceName] : [],
      };
    } catch (err: any) {
      const detailed = this.decodeGoogleAdsFailureFromMetadata(err);
      this.logger.warn(
        `[mutate-customer-grpc] FAILED code=${err.code} msg="${err.message}" detailed=${JSON.stringify(detailed)}`,
      );
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sprint 4.2 (2026-05-17) — Experiment lifecycle wrappers
  //
  // Experiment opera por RPC nao-CRUD (ScheduleExperiment, EndExperiment,
  // PromoteExperiment, GraduateExperiment). NAO sao operacoes mutate
  // padrao — sao actions assincronas que mudam o status_lifecycle
  // (SETUP -> INITIATED -> ENABLED -> PROMOTED/HALTED/GRADUATED).
  //
  // Wrappers thin: pegam customer + experiment_resource_name + customer_id,
  // chamam o metodo SDK, retornam {ok, raw, error?}. Log estruturado.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * ScheduleExperiment — passa SETUP -> INITIATED (assincrono no Google,
   * materializa draft campaigns como trial campaigns reais). Quando
   * conclusao async termina, status vira ENABLED.
   *
   * Retorna long-running operation — o caller pode polling
   * listExperimentAsyncErrors pra ver erros, ou query experiment.status
   * via GAQL pra ver progressao.
   */
  async scheduleExperiment(
    customer: Customer,
    customerId: string,
    experimentResourceName: string,
    validateOnly: boolean = false,
  ): Promise<{ ok: boolean; raw: unknown; error?: string }> {
    this.logger.log(
      `[experiment-schedule] customer=${customerId} experiment=${experimentResourceName} validate_only=${validateOnly}`,
    );
    try {
      const result = await customer.experiments.scheduleExperiment({
        customer_id: customerId,
        experiment: experimentResourceName,
        validate_only: validateOnly,
      } as any);
      this.logger.log(
        `[experiment-schedule] SUCCESS raw=${JSON.stringify(this.safeSnapshot(result))}`,
      );
      return { ok: true, raw: result };
    } catch (err: any) {
      const detailed = this.decodeGoogleAdsFailureFromMetadata(err);
      this.logger.warn(
        `[experiment-schedule] FAILED code=${err.code} msg="${err.message}" detailed=${JSON.stringify(detailed)}`,
      );
      throw err;
    }
  }

  /**
   * EndExperiment — encerra um experiment em ENABLED. Status vira HALTED.
   * Nao promove ningem — apenas para o traffic split e mantem control + treatment
   * como estavam. Util quando admin viu que treatment esta pior e quer
   * encerrar logo sem perder mais budget.
   */
  async endExperiment(
    customer: Customer,
    customerId: string,
    experimentResourceName: string,
  ): Promise<{ ok: boolean; raw: unknown; error?: string }> {
    this.logger.log(
      `[experiment-end] customer=${customerId} experiment=${experimentResourceName}`,
    );
    try {
      const result = await customer.experiments.endExperiment({
        experiment: experimentResourceName,
      } as any);
      this.logger.log(
        `[experiment-end] SUCCESS raw=${JSON.stringify(this.safeSnapshot(result))}`,
      );
      return { ok: true, raw: result };
    } catch (err: any) {
      const detailed = this.decodeGoogleAdsFailureFromMetadata(err);
      this.logger.warn(
        `[experiment-end] FAILED code=${err.code} msg="${err.message}" detailed=${JSON.stringify(detailed)}`,
      );
      throw err;
    }
  }

  /**
   * PromoteExperiment — encerra ENABLED e promove o treatment como nova
   * versao da base_campaign (aplica as mudancas do treatment na base).
   * Trial campaigns viram removidos. Status vira PROMOTED.
   *
   * Async — retorna long-running operation. Listener (futuro) pode polling
   * pra ver quando promotion termina.
   *
   * USE SO se metrics do treatment estao validamente melhores (treatment
   * tem traffic significativo + tempo suficiente — recomendado >= 2 semanas
   * de exposicao).
   */
  async promoteExperiment(
    customer: Customer,
    customerId: string,
    experimentResourceName: string,
  ): Promise<{ ok: boolean; raw: unknown; error?: string }> {
    this.logger.log(
      `[experiment-promote] customer=${customerId} experiment=${experimentResourceName}`,
    );
    try {
      const result = await customer.experiments.promoteExperiment({
        experiment: experimentResourceName,
      } as any);
      this.logger.log(
        `[experiment-promote] SUCCESS raw=${JSON.stringify(this.safeSnapshot(result))}`,
      );
      return { ok: true, raw: result };
    } catch (err: any) {
      const detailed = this.decodeGoogleAdsFailureFromMetadata(err);
      this.logger.warn(
        `[experiment-promote] FAILED code=${err.code} msg="${err.message}" detailed=${JSON.stringify(detailed)}`,
      );
      throw err;
    }
  }

  /**
   * GraduateExperiment — encerra ENABLED e separa o treatment como
   * campanha standalone (NAO aplica na base — cria nova campanha permanente
   * a partir do treatment). Status vira GRADUATED.
   *
   * REQUER `campaign_budget_mappings`: tuplas (experimentCampaign, newBudget)
   * porque trial campaigns nao tem budget proprio (compartilham com base).
   * Ao graduate, cada trial campaign vira standalone e precisa de budget.
   *
   * USE quando voce gostou do treatment MAS quer rodar paralelo com a base
   * em vez de substituir (ex: treatment foca em audiencia X, base mantem
   * audiencia Y).
   */
  async graduateExperiment(
    customer: Customer,
    customerId: string,
    experimentResourceName: string,
    campaignBudgetMappings: Array<{
      experimentCampaignResourceName: string;
      campaignBudgetResourceName: string;
    }>,
  ): Promise<{ ok: boolean; raw: unknown; error?: string }> {
    this.logger.log(
      `[experiment-graduate] customer=${customerId} experiment=${experimentResourceName} mappings=${campaignBudgetMappings.length}`,
    );
    try {
      const result = await customer.experiments.graduateExperiment({
        experiment: experimentResourceName,
        campaign_budget_mappings: campaignBudgetMappings.map((m) => ({
          experiment_campaign: m.experimentCampaignResourceName,
          campaign_budget: m.campaignBudgetResourceName,
        })),
      } as any);
      this.logger.log(
        `[experiment-graduate] SUCCESS raw=${JSON.stringify(this.safeSnapshot(result))}`,
      );
      return { ok: true, raw: result };
    } catch (err: any) {
      const detailed = this.decodeGoogleAdsFailureFromMetadata(err);
      this.logger.warn(
        `[experiment-graduate] FAILED code=${err.code} msg="${err.message}" detailed=${JSON.stringify(detailed)}`,
      );
      throw err;
    }
  }

  /**
   * Redact developer-token pra log nao expor secret completo.
   */
  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
      if (/token|secret/i.test(k) && typeof v === 'string') {
        out[k] = v.length > 8 ? `${v.slice(0, 4)}***${v.slice(-4)}` : '***';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Extrai GoogleAdsFailure detalhada do metadata trailer de um erro gRPC.
   *
   * Por que existe (achado em 2026-05-17): erros request-level (ex.
   * INVALID_ARGUMENT em mutate de bidding strategy) vem como `Error` gRPC
   * nativo, NAO como GoogleAdsFailure tipado. O detalhe estruturado
   * (field_mask_error.FIELD_HAS_SUBFIELDS, mutate_error, etc) fica num
   * trailer binario `google.ads.googleads.v23.errors.googleadsfailure-bin`.
   *
   * O metodo de alto nivel do SDK (`customer.campaigns.update`) ja faz isso
   * via `Service.getGoogleAdsError(err)`. Mas o bypass via
   * `loadService('GoogleAdsServiceClient').mutate()` pula essa camada —
   * precisamos decodificar a mao.
   *
   * Padrao copiado de `google-ads-api/build/src/service.js#100-111`.
   */
  private decodeGoogleAdsFailureFromMetadata(err: any): any {
    if (!err?.metadata) {
      return { reason: 'no_metadata' };
    }
    try {
      const FAILURE_KEY = 'google.ads.googleads.v23.errors.googleadsfailure-bin';
      // gRPC Metadata expoe `internalRepr` (Map<string, Buffer[]>) e tambem
      // `get(key)`. SDK usa internalRepr direto; tentamos os dois pra
      // robustez.
      const internalRepr = err.metadata.internalRepr;
      let buffers: any[] | undefined;
      if (internalRepr && typeof internalRepr.get === 'function') {
        buffers = internalRepr.get(FAILURE_KEY);
      }
      if (!buffers && typeof err.metadata.get === 'function') {
        buffers = err.metadata.get(FAILURE_KEY);
      }
      if (!buffers || buffers.length === 0) {
        // Lista chaves disponiveis pra debug
        const availableKeys: string[] = [];
        if (internalRepr && typeof internalRepr.keys === 'function') {
          for (const k of internalRepr.keys()) availableKeys.push(k);
        }
        return { reason: 'no_failure_trailer', available_keys: availableKeys };
      }
      const buffer = buffers[0];
      const failure = (errors as any).GoogleAdsFailure.decode(buffer);
      // toJSON() devolve representacao serializavel (sem BigInt issues)
      return failure?.toJSON?.() ?? failure;
    } catch (e: any) {
      return { reason: 'decode_error', error: e.message };
    }
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
