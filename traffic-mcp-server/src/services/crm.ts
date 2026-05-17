import { config } from '../config.js';
import { CrmError, classifyHttpError } from '../utils/format.js';
import { logger, timed } from '../utils/logger.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

/**
 * Cliente HTTP do CRM. Cache in-memory simples (Map) — invalidado em qualquer
 * mutate. Erros HTTP viram CrmError tipado pra tools layer mapear pra
 * structured error MCP. Cada request tem `tool_call_id` opcional pra
 * rastreabilidade nos logs.
 *
 * Por que nao Redis: o servidor eh single-instance no docker-compose; cache
 * cross-instance traria mais ceremony do que beneficio. Quando escalarmos,
 * trocar Map por ioredis aqui eh isolado.
 */
export class CrmTrafficService {
  private readonly cache = new Map<string, CacheEntry>();

  get enabled(): boolean {
    return config.runtimeMode === 'crm';
  }

  async get<T = unknown>(
    path: string,
    query?: Record<string, unknown>,
    opts: { cache?: boolean; toolCallId?: string } = {},
  ): Promise<T> {
    const cacheEnabled = opts.cache !== false;
    const url = this.url(path, query);
    const cached = cacheEnabled ? this.cache.get(url) : undefined;
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('crm_cache_hit', { url, tool_call_id: opts.toolCallId });
      return cached.value as T;
    }

    const value = await this.request<T>('GET', path, undefined, query, opts.toolCallId);
    if (cacheEnabled) {
      this.cache.set(url, { expiresAt: Date.now() + config.cacheTtlMs, value });
    }
    return value;
  }

  async post<T = unknown>(path: string, body?: unknown, opts: { toolCallId?: string } = {}): Promise<T> {
    const value = await this.request<T>('POST', path, body, undefined, opts.toolCallId);
    this.invalidateCache();
    return value;
  }

  async patch<T = unknown>(path: string, body?: unknown, opts: { toolCallId?: string } = {}): Promise<T> {
    const value = await this.request<T>('PATCH', path, body, undefined, opts.toolCallId);
    this.invalidateCache();
    return value;
  }

  async put<T = unknown>(path: string, body?: unknown, opts: { toolCallId?: string } = {}): Promise<T> {
    const value = await this.request<T>('PUT', path, body, undefined, opts.toolCallId);
    this.invalidateCache();
    return value;
  }

  async delete<T = unknown>(path: string, body?: unknown, opts: { toolCallId?: string } = {}): Promise<T> {
    const value = await this.request<T>('DELETE', path, body, undefined, opts.toolCallId);
    this.invalidateCache();
    return value;
  }

  invalidateCache() {
    if (this.cache.size > 0) {
      logger.debug('crm_cache_invalidate', { entries: this.cache.size });
      this.cache.clear();
    }
  }

  private async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
    toolCallId?: string,
  ): Promise<T> {
    if (!config.crm.apiUrl || !config.crm.apiKey) {
      throw new CrmError(
        'auth',
        'CRM_API_URL e CRM_API_KEY precisam estar configurados para o modo CRM.',
      );
    }

    const url = this.url(path, query);
    const requestId = randomRequestId();

    return timed('crm_http_request', { method, url, request_id: requestId, tool_call_id: toolCallId }, async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${config.crm.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Request-Id': requestId,
            // Marca toda chamada vinda do MCP pra que o CRM consiga
            // distinguir mutate do Claude vs mutate de humano clicando
            // no painel. Backend usa esse header como initiator no
            // TrafficMutateLog (com fallback pra user:<id> se ausente).
            // toolCallId vem do safe() wrapper das tools — permite
            // correlacao linha-a-linha entre logs do MCP e do CRM.
            'X-Initiator': toolCallId
              ? `mcp:claude:${toolCallId}`
              : 'mcp:claude:internal',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e: any) {
        throw new CrmError('network', `Falha de rede chamando o CRM: ${String(e?.message ?? e).slice(0, 200)}`, {
          details: { url, method },
        });
      }

      const text = await response.text();
      const data = text ? safeParseJson(text) : null;

      if (!response.ok) {
        const message = extractErrorMessage(data, text, response);
        const kind = classifyHttpError(response.status);
        throw new CrmError(kind, message, {
          status: response.status,
          details: { url, method, status: response.status, body_preview: text.slice(0, 300) },
        });
      }

      return data as T;
    });
  }

  private url(path: string, query?: Record<string, unknown>): string {
    const base = config.crm.apiUrl?.replace(/\/+$/, '') ?? '';
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${cleanPath}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

export const crmTrafficService = new CrmTrafficService();

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(data: unknown, fallbackText: string, response: Response): string {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // NestJS HttpException padrao: { statusCode, message, error }
    // message pode ser string ou string[]
    if (typeof obj.message === 'string') return `CRM ${response.status}: ${obj.message}`;
    if (Array.isArray(obj.message)) return `CRM ${response.status}: ${obj.message.join('; ')}`;
    if (typeof obj.error === 'string') return `CRM ${response.status}: ${obj.error}`;
  }
  return `CRM ${response.status}: ${fallbackText.slice(0, 200) || response.statusText}`;
}

function randomRequestId(): string {
  // Crypto.randomUUID seria melhor mas vamos manter zero-dep — Math.random
  // eh suficiente pra correlacao em logs (nao eh secret).
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
