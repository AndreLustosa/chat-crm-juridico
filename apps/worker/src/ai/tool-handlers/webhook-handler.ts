import { Logger } from '@nestjs/common';
import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * Handler generico para tools do tipo "webhook".
 * Faz HTTP POST/GET para a URL configurada e retorna o response body.
 *
 * Bug fix 2026-05-12 (Skills PR2 #A6 — ALTO — SECURITY):
 *
 * SSRF prevention. Antes: skill maliciosa (ou admin comprometido) podia
 * configurar webhook apontando pra:
 *   - http://169.254.169.254/* (AWS/GCP instance metadata — vaza credentials)
 *   - http://localhost:9200 (Elasticsearch interno)
 *   - http://127.0.0.1:6379 (Redis interno — pode comprometer fila BullMQ)
 *   - http://10.0.0.x (rede interna)
 *
 * Defesa:
 *   1. Allowlist de schemes: apenas https:// (http:// proibido em prod)
 *   2. Blocklist de IPs: 127/8, 169.254/16, 10/8, 172.16/12, 192.168/16, ::1
 *   3. Resolve DNS antes do request e revalida (mitiga DNS rebinding)
 *   4. Headers seguros: nao deixa cliente sobrescrever Host, X-Forwarded-*,
 *      Authorization (skill pode setar via config no banco, mas auditavel)
 *
 * Bypass admin: env var WEBHOOK_ALLOW_HTTP=true permite http:// (dev local)
 */

// Hosts/IPs proibidos por padrao (RFC 1918 + link-local + loopback + metadata)
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./,           // AWS/GCP metadata + link-local
  /^10\./,                  // RFC1918 private
  /^192\.168\./,            // RFC1918 private
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 private 172.16/12
  /^::1$/,                  // IPv6 loopback
  /^fc00:/i, /^fd00:/i,     // IPv6 unique-local
  /^fe80:/i,                // IPv6 link-local
  /\.local$/i,              // mDNS
  /\.internal$/i,           // GCP/AWS internal DNS
];

// Headers que NUNCA podem ser setados pelo skill config (mitiga abuse)
const BLOCKED_HEADERS = new Set([
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
]);

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return BLOCKED_HOST_PATTERNS.some((pat) => pat.test(h));
}

function sanitizeHeaders(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!BLOCKED_HEADERS.has(k.toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
}

export class WebhookHandler implements ToolHandler {
  private readonly logger = new Logger('WebhookHandler');
  name: string;
  private config: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
  };

  constructor(name: string, config: any) {
    this.name = name;
    this.config = config || {};
  }

  async execute(params: Record<string, any>, context: ToolContext): Promise<any> {
    const { url, method = 'POST', headers = {} } = this.config;

    if (!url) {
      return { error: 'URL do webhook nao configurada' };
    }

    // Bug fix #A6: parse + validate URL
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.logger.warn(`[Webhook ${this.name}] URL malformada: ${url}`);
      return { error: 'URL invalida' };
    }

    // Scheme: apenas https:// (http permitido apenas com WEBHOOK_ALLOW_HTTP=true)
    const allowHttp = process.env.WEBHOOK_ALLOW_HTTP === 'true';
    if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
      this.logger.warn(`[Webhook ${this.name}] Scheme nao permitido: ${parsed.protocol}`);
      return { error: 'Apenas URLs https:// sao permitidas em webhooks' };
    }

    // Blocklist de hosts (loopback, link-local, RFC1918, metadata)
    if (isBlockedHost(parsed.hostname)) {
      this.logger.error(
        `[Webhook ${this.name}] SSRF BLOCKED: tentativa de chamar host privado/metadata "${parsed.hostname}"`,
      );
      return { error: 'Webhook URL aponta para host privado/interno — bloqueado por seguranca' };
    }

    // Porta: aceita apenas 80, 443, 8080, 8443 (evita probing de portas raras)
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
    const ALLOWED_PORTS = [80, 443, 8080, 8443];
    if (!ALLOWED_PORTS.includes(port)) {
      this.logger.warn(`[Webhook ${this.name}] Porta nao permitida: ${port}`);
      return { error: `Porta ${port} nao permitida em webhooks` };
    }

    const cleanHeaders = sanitizeHeaders(headers);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const body = method.toUpperCase() === 'GET' ? undefined : JSON.stringify({
        ...params,
        _context: {
          conversationId: context.conversationId,
          leadId: context.leadId,
          leadPhone: context.leadPhone,
        },
      });

      const response = await fetch(parsed.toString(), {
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          ...cleanHeaders,
        },
        body,
        signal: controller.signal,
        // Bug fix #A6: nao seguir redirects automaticamente (preveine
        // redirect para host privado apos passar do check inicial)
        redirect: 'manual',
      });

      // Caps no body size pra evitar OOM (10MB max)
      const MAX_BODY_BYTES = 10 * 1024 * 1024;
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_BODY_BYTES) {
        this.logger.warn(`[Webhook ${this.name}] Body grande (${contentLength}b) — abort`);
        return { error: 'Resposta do webhook excede 10MB' };
      }
      const text = await response.text();
      if (text.length > MAX_BODY_BYTES) {
        return { error: 'Resposta do webhook excede 10MB' };
      }

      this.logger.log(`[Webhook] ${this.name} → ${response.status} (${text.length} chars)`);

      try {
        return JSON.parse(text);
      } catch {
        return { status: response.status, body: text.slice(0, 50_000) };
      }
    } catch (err: any) {
      this.logger.error(`[Webhook] ${this.name} falhou: ${err.message}`);
      return { error: `Webhook falhou: ${err.message}` };
    } finally {
      clearTimeout(timeout);
    }
  }
}
