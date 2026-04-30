import { Injectable, Logger } from '@nestjs/common';
import { Customer } from 'google-ads-api';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import {
  validateAd,
  validateKeyword,
  formatViolations,
  type AdContent,
  type OABViolation,
} from '@crm/shared';

/**
 * Tipo de recurso modificado. Espelha resource_type usado no
 * googleAdsService.mutate (snake_case + sufixo _operation).
 */
export type MutateResourceType =
  | 'campaign'
  | 'campaign_budget'
  | 'ad_group'
  | 'ad_group_ad'
  | 'ad_group_criterion'
  | 'campaign_criterion'
  | 'conversion_action'
  | 'customer_match_user_list'
  | 'asset'
  | 'remarketing_action';

export type MutateOperation = 'create' | 'update' | 'remove';

/**
 * Iniciador do mutate. Padrao "<canal>:<detalhe>".
 *  - "user:<userId>"            — manual via UI
 *  - "ai_agent:hourly"          — IA loop horario
 *  - "ai_agent:daily"           — IA loop diario
 *  - "ai_agent:weekly"          — IA loop semanal
 *  - "ai_agent:monthly"         — IA loop mensal
 *  - "ai_agent:advisor"         — IA modo conselheiro (validate-only sempre)
 *  - "system:sync"              — auto-correcao do sync
 *  - "system:event:<event>"     — listener (lead.created, etc)
 */
export type MutateInitiator = string;

export type MutateRequest = {
  tenantId: string;
  accountId: string;
  resourceType: MutateResourceType;
  operation: MutateOperation;
  initiator: MutateInitiator;
  /// 0..1. null = nao foi IA. Se < advisorThreshold em AI mode, force validate_only=true.
  confidence?: number | null;
  /// Operations[] no formato esperado pelo SDK ({create:{...}} | {update:{...}} | "resource_name" pra remove).
  operations: any[];
  /// Dry-run (nao aplica). Preview UI usa true.
  validateOnly?: boolean;
  /// Idempotencia: mesmo request_id retorna mesmo resultado em retries.
  /// Se omitido, gerado automaticamente (nao recomendado pra retries).
  requestId?: string;
  /// IDs CRM correlacionados (lead_id, campaign_id local, etc) pra audit.
  context?: Record<string, any>;
  /// Conteudo de ad (RSA/PMax) pra validar OAB. Required se resourceType=ad_group_ad e operation in (create,update).
  adContent?: AdContent;
  /// Texto de keyword pra validar OAB. Required se resourceType=ad_group_criterion e operation=create.
  keywordText?: string;
};

export type MutateResult = {
  /// ID do TrafficMutateLog criado
  logId: string;
  /// Status final ("SUCCESS" | "PARTIAL" | "FAILED")
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  /// Resource_names retornados pela API (pra creates/updates)
  resourceNames: string[];
  /// Mensagem human-readable (so preenchida em FAILED ou PARTIAL)
  errorMessage?: string;
  /// Violations OAB encontradas (warning ou block). Block aborta antes do request.
  oabViolations: OABViolation[];
  /// Resposta crua da API (pra debug). Sanitized.
  rawResponse?: any;
  /// Tempo de execucao (incluindo OAB + DB). null em validate_only puro.
  durationMs: number;
};

/**
 * Servico central para toda escrita na Google Ads API.
 *
 * Responsabilidades:
 *  1. Cria TrafficMutateLog (audit trail) ANTES do request.
 *  2. Aplica OABValidator em ad_group_ad (create/update) e ad_group_criterion (create).
 *  3. Idempotencia via request_id.
 *  4. Mapeia erros da API pra mensagem util.
 *  5. Retry automatico em erros transitorios (UNAVAILABLE/DEADLINE_EXCEEDED).
 *  6. Atualiza log com resultado (SUCCESS/PARTIAL/FAILED).
 *
 * NAO faz cache local de recursos — sync separado eh quem hidrata
 * TrafficCampaign/AdGroup/Keyword/Ad. Mutate apenas executa e loga.
 *
 * NAO decide se deve executar (advisor vs auto) — quem decide eh o caller
 * (processor do BullMQ ou IA agent service). Aqui so executa o que pediram,
 * com validate_only configuravel.
 */
@Injectable()
export class GoogleAdsMutateService {
  private readonly logger = new Logger(GoogleAdsMutateService.name);

  constructor(
    private prisma: PrismaService,
    private clientSvc: GoogleAdsClientService,
  ) {}

  /**
   * Executa um mutate completo: valida -> persiste log -> chama API -> atualiza log.
   *
   * Em validate_only=true a API nao persiste nada (server-side); ainda assim
   * fazemos log local (status SUCCESS) marcado validate_only=true pra
   * rastreabilidade.
   *
   * Em caso de OAB BLOCK, retorna sem chamar a API. Status='FAILED', errorMessage
   * descreve a violacao. Recomenda-se exibir errorMessage pra usuario.
   */
  async execute(req: MutateRequest): Promise<MutateResult> {
    const t0 = Date.now();
    const requestId = req.requestId ?? this.generateRequestId(req);

    // 1. Idempotencia — verificar se ja temos esse request_id no log.
    const existing = await this.prisma.trafficMutateLog.findUnique({
      where: { request_id: requestId },
    });
    if (existing && existing.status !== 'PENDING') {
      this.logger.log(
        `[mutate] dedupe by request_id=${requestId} — retornando resultado anterior (status=${existing.status})`,
      );
      const result = (existing.result ?? {}) as any;
      return {
        logId: existing.id,
        status: existing.status as any,
        resourceNames: result?.resource_names ?? [],
        errorMessage: existing.error_message ?? undefined,
        oabViolations: result?.oab_violations ?? [],
        rawResponse: result?.raw,
        durationMs: existing.duration_ms ?? 0,
      };
    }

    // 2. Validacao OAB (se aplicavel)
    const oabViolations: OABViolation[] = [];
    if (
      req.resourceType === 'ad_group_ad' &&
      (req.operation === 'create' || req.operation === 'update') &&
      req.adContent
    ) {
      const v = validateAd(req.adContent);
      oabViolations.push(...v.violations);
      if (!v.ok) {
        return await this.persistOABBlock(req, requestId, oabViolations, t0);
      }
    }
    if (
      req.resourceType === 'ad_group_criterion' &&
      req.operation === 'create' &&
      req.keywordText
    ) {
      const v = validateKeyword(req.keywordText);
      oabViolations.push(...v.violations);
      if (!v.ok) {
        return await this.persistOABBlock(req, requestId, oabViolations, t0);
      }
    }

    // 3. Cria log em PENDING
    const log = existing
      ? existing
      : await this.prisma.trafficMutateLog.create({
          data: {
            tenant_id: req.tenantId,
            account_id: req.accountId,
            request_id: requestId,
            resource_type: req.resourceType,
            operation: req.operation,
            initiator: req.initiator,
            confidence: req.confidence ?? null,
            payload: this.sanitizePayload(req.operations) as any,
            result: { oab_violations: oabViolations } as any,
            status: 'PENDING',
            validate_only: !!req.validateOnly,
            context: (req.context ?? {}) as any,
          },
        });

    // 4. Chama API
    let customer: Customer;
    try {
      customer = await this.clientSvc.getCustomer(req.tenantId, req.accountId);
    } catch (e: any) {
      return await this.persistFailure(
        log.id,
        e?.message || 'Falha obtendo Customer',
        oabViolations,
        t0,
      );
    }

    try {
      const apiResult = await this.callApi(customer, req);
      const resourceNames = this.extractResourceNames(apiResult);
      const partial = this.detectPartialFailure(apiResult);
      const status: 'SUCCESS' | 'PARTIAL' = partial ? 'PARTIAL' : 'SUCCESS';
      const durationMs = Date.now() - t0;

      await this.prisma.trafficMutateLog.update({
        where: { id: log.id },
        data: {
          status,
          duration_ms: durationMs,
          result: {
            resource_names: resourceNames,
            partial_failure: partial,
            raw: this.sanitizeResponse(apiResult),
            oab_violations: oabViolations,
          } as any,
          error_message: partial
            ? this.formatPartialFailure(apiResult).slice(0, 1500)
            : null,
        },
      });

      this.logger.log(
        `[mutate] ${req.resourceType}.${req.operation} status=${status} resources=${resourceNames.length} ${durationMs}ms`,
      );

      return {
        logId: log.id,
        status,
        resourceNames,
        errorMessage: partial ? this.formatPartialFailure(apiResult) : undefined,
        oabViolations,
        rawResponse: this.sanitizeResponse(apiResult),
        durationMs,
      };
    } catch (e: any) {
      const formatted = this.clientSvc.formatError(e);
      this.logger.warn(
        `[mutate] FAILED ${req.resourceType}.${req.operation} ${formatted.kind}: ${formatted.message}`,
      );
      return await this.persistFailure(log.id, formatted.message, oabViolations, t0);
    }
  }

  // ─── Privates ───────────────────────────────────────────────────────────

  /**
   * Chama o metodo correto do SDK baseado em resource_type + operation.
   * Para 'remove', operations[] deve conter strings de resource_name.
   * Para 'create'/'update', operations[] deve conter objetos completos.
   */
  private async callApi(customer: Customer, req: MutateRequest): Promise<any> {
    const opts = {
      partial_failure: true,
      validate_only: !!req.validateOnly,
    };

    const svc = this.resolveCustomerSubservice(customer, req.resourceType);
    if (!svc) {
      throw new Error(
        `Resource type nao suportado pelo wrapper: ${req.resourceType}`,
      );
    }

    if (req.operation === 'remove') {
      const resourceNames = req.operations.filter((x: any) => typeof x === 'string');
      return svc.remove(resourceNames, opts);
    }

    if (req.operation === 'create') {
      const payloads = req.operations
        .map((x: any) => x?.create ?? x)
        .filter((x: any) => !!x);
      return svc.create(payloads, opts);
    }

    if (req.operation === 'update') {
      const payloads = req.operations
        .map((x: any) => x?.update ?? x)
        .filter((x: any) => !!x);
      return svc.update(payloads, opts);
    }

    throw new Error(`operation invalido: ${req.operation}`);
  }

  /**
   * Mapeia resource_type -> property no Customer SDK (camelCase plural).
   * Ex: campaign -> customer.campaigns; ad_group_ad -> customer.adGroupAds
   */
  private resolveCustomerSubservice(customer: Customer, type: MutateResourceType): any {
    const map: Record<MutateResourceType, string> = {
      campaign: 'campaigns',
      campaign_budget: 'campaignBudgets',
      ad_group: 'adGroups',
      ad_group_ad: 'adGroupAds',
      ad_group_criterion: 'adGroupCriteria',
      campaign_criterion: 'campaignCriteria',
      conversion_action: 'conversionActions',
      customer_match_user_list: 'userLists',
      asset: 'assets',
      remarketing_action: 'remarketingActions',
    };
    const prop = map[type];
    return prop ? (customer as any)[prop] : null;
  }

  private extractResourceNames(apiResult: any): string[] {
    if (!apiResult) return [];
    const results = apiResult.results ?? apiResult;
    if (!Array.isArray(results)) return [];
    return results
      .map((r: any) => r?.resource_name)
      .filter((rn: any): rn is string => !!rn);
  }

  private detectPartialFailure(apiResult: any): boolean {
    return !!apiResult?.partial_failure_error;
  }

  private formatPartialFailure(apiResult: any): string {
    const err = apiResult?.partial_failure_error;
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err?.message) return err.message;
    return JSON.stringify(err).slice(0, 1500);
  }

  /**
   * Sanitiza payload removendo PII potencial (emails, phones em hashes nao,
   * mas tokens crus sim) antes de persistir no log. Conservador: snapshot
   * shallow do payload, redact campos sensiveis se presentes.
   */
  private sanitizePayload(operations: any[]): any {
    return operations.map((op) => {
      if (typeof op === 'string') return op;
      const clone = JSON.parse(JSON.stringify(op, this.bigIntReplacer));
      this.redactDeep(clone);
      return clone;
    });
  }

  private sanitizeResponse(response: any): any {
    if (!response) return null;
    return JSON.parse(JSON.stringify(response, this.bigIntReplacer));
  }

  /**
   * Replacer pra JSON.stringify que converte BigInt em string (BigInt nao
   * eh serializavel por default).
   */
  private bigIntReplacer = (_key: string, value: any) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  };

  private redactDeep(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (
        /token|secret|password|refresh|api_key|credential/i.test(k) &&
        typeof v === 'string'
      ) {
        obj[k] = '***REDACTED***';
      } else if (typeof v === 'object') {
        this.redactDeep(v);
      }
    }
  }

  /**
   * request_id determinístico baseado em (tenant, account, resource, op,
   * payload-hash, initiator). Mesmo input = mesmo id = idempotencia real.
   *
   * Por que determinístico? Retries (BullMQ, falha de rede, click duplo)
   * precisam reaproveitar o mesmo log e nao executar o mutate duas vezes.
   * Caller que QUER um id unico (ex: forcar reexecucao apos rollback) deve
   * passar `req.requestId` explicitamente.
   */
  private generateRequestId(req: MutateRequest): string {
    const payloadStr = JSON.stringify(req.operations, this.bigIntReplacer);
    const hash = createHash('sha256')
      .update(req.tenantId)
      .update('|')
      .update(req.accountId)
      .update('|')
      .update(req.resourceType)
      .update('|')
      .update(req.operation)
      .update('|')
      .update(payloadStr)
      .update('|')
      .update(req.initiator)
      .digest('hex')
      .slice(0, 32);
    return `mut-${hash}`;
  }

  private async persistOABBlock(
    req: MutateRequest,
    requestId: string,
    violations: OABViolation[],
    t0: number,
  ): Promise<MutateResult> {
    const durationMs = Date.now() - t0;
    const errorMessage = `OAB BLOCK: ${formatViolations(
      violations.filter((v) => v.severity === 'BLOCK'),
    )}`;

    const log = await this.prisma.trafficMutateLog.create({
      data: {
        tenant_id: req.tenantId,
        account_id: req.accountId,
        request_id: requestId,
        resource_type: req.resourceType,
        operation: req.operation,
        initiator: req.initiator,
        confidence: req.confidence ?? null,
        payload: this.sanitizePayload(req.operations) as any,
        result: { oab_violations: violations } as any,
        status: 'FAILED',
        validate_only: !!req.validateOnly,
        error_message: errorMessage,
        duration_ms: durationMs,
        context: (req.context ?? {}) as any,
      },
    });

    this.logger.warn(
      `[mutate] OAB BLOCK ${req.resourceType}.${req.operation} initiator=${req.initiator}`,
    );

    return {
      logId: log.id,
      status: 'FAILED',
      resourceNames: [],
      errorMessage,
      oabViolations: violations,
      durationMs,
    };
  }

  private async persistFailure(
    logId: string,
    errorMessage: string,
    oabViolations: OABViolation[],
    t0: number,
  ): Promise<MutateResult> {
    const durationMs = Date.now() - t0;
    await this.prisma.trafficMutateLog.update({
      where: { id: logId },
      data: {
        status: 'FAILED',
        error_message: errorMessage.slice(0, 1500),
        duration_ms: durationMs,
        result: { oab_violations: oabViolations } as any,
      },
    });
    return {
      logId,
      status: 'FAILED',
      resourceNames: [],
      errorMessage,
      oabViolations,
      durationMs,
    };
  }
}
