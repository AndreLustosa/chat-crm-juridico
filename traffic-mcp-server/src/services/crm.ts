import { config } from '../config.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

export class CrmTrafficService {
  private readonly cache = new Map<string, CacheEntry>();

  get enabled(): boolean {
    return config.runtimeMode === 'crm';
  }

  async get<T = unknown>(path: string, query?: Record<string, unknown>, opts: { cache?: boolean } = { cache: true }): Promise<T> {
    const url = this.url(path, query);
    const cached = opts.cache !== false ? this.cache.get(url) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    const value = await this.request<T>('GET', path, undefined, query);
    if (opts.cache !== false) {
      this.cache.set(url, { expiresAt: Date.now() + config.cacheTtlMs, value });
    }
    return value;
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const value = await this.request<T>('POST', path, body);
    this.invalidateCache();
    return value;
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    const value = await this.request<T>('PATCH', path, body);
    this.invalidateCache();
    return value;
  }

  async delete<T = unknown>(path: string, body?: unknown): Promise<T> {
    const value = await this.request<T>('DELETE', path, body);
    this.invalidateCache();
    return value;
  }

  invalidateCache() {
    this.cache.clear();
  }

  private async request<T>(method: Method, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    if (!config.crm.apiUrl || !config.crm.apiKey) {
      throw new Error('CRM_API_URL e CRM_API_KEY precisam estar configurados para o modo CRM.');
    }

    const response = await fetch(this.url(path, query), {
      method,
      headers: {
        Authorization: `Bearer ${config.crm.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const data = text ? safeParseJson(text) : null;

    if (!response.ok) {
      const message = typeof data === 'object' && data && 'message' in data
        ? String((data as any).message)
        : text || response.statusText;
      throw new Error(`CRM retornou ${response.status}: ${message}`);
    }

    return data as T;
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
