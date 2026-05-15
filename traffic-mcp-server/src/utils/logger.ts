/**
 * Logger estruturado para o traffic-mcp-server.
 *
 * Por que zero-dep e nao pino: o servidor eh pequeno, contained, e adicionar
 * pino traz transports + formatters que precisariamos configurar separadamente
 * em prod (sonic-boom, pino-pretty etc). JSON line direto em stdout funciona
 * com docker logs, journalctl, ELK, Datadog Agent etc sem ceremony.
 *
 * Cada chamada produz UMA linha JSON em stdout (NDJSON). Conforme spec MCP,
 * stderr eh para erros do processo; stdout eh apropriado pra eventos
 * (Streamable HTTP nao usa stdout pra protocolo).
 *
 * Eventos previstos:
 *   - tool_call_start    { tool, arg_keys, user_id?, tenant_id? }
 *   - tool_call_end      { tool, duration_ms, status, error_kind? }
 *   - http_request       { method, url, duration_ms, status }
 *   - oauth_event        { kind, client_id?, scopes? }
 *   - guard_rail_block   { rule, tool, details }
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

const PII_KEYS = new Set([
  'authorization',
  'authorization_token',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'developer_token',
  'password',
  'cpf',
  'cnpj',
  'phone',
  'email',
]);

/**
 * Redact PII de objetos antes de logar. Recursivo, mas com limite de
 * profundidade pra evitar stack overflow em referencias circulares ou
 * estruturas absurdas vindas do CRM.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated:max-depth]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (PII_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redact(val, depth + 1);
  }
  return out;
}

function emit(level: LogLevel, event: string, context: LogContext = {}) {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentMinLevel()]) return;

  const redactedContext = redact(context);
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redactedContext && typeof redactedContext === 'object' && !Array.isArray(redactedContext)
      ? (redactedContext as Record<string, unknown>)
      : { context: redactedContext }),
  };

  // JSON.stringify pode falhar com BigInt — cobre BigInt convertendo pra string.
  let serialized: string;
  try {
    serialized = JSON.stringify(line, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch (e: any) {
    serialized = JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'logger_serialize_failed',
      original_event: event,
      error: String(e?.message ?? e),
    });
  }

  // process.stdout.write evita o newline extra do console.log e garante que
  // cada linha eh um JSON parseable independente.
  process.stdout.write(serialized + '\n');
}

export const logger = {
  debug: (event: string, context?: LogContext) => emit('debug', event, context),
  info: (event: string, context?: LogContext) => emit('info', event, context),
  warn: (event: string, context?: LogContext) => emit('warn', event, context),
  error: (event: string, context?: LogContext) => emit('error', event, context),
};

/**
 * Helper pra medir duracao de uma operacao async e logar inicio/fim
 * automaticamente. Use em chamadas de tool e HTTP requests.
 */
export async function timed<T>(
  event: string,
  context: LogContext,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  logger.info(`${event}_start`, context);
  try {
    const result = await fn();
    logger.info(`${event}_end`, {
      ...context,
      duration_ms: Date.now() - startedAt,
      status: 'ok',
    });
    return result;
  } catch (error: any) {
    logger.error(`${event}_end`, {
      ...context,
      duration_ms: Date.now() - startedAt,
      status: 'error',
      error_kind: error?.kind ?? error?.name ?? 'Unknown',
      error_message: String(error?.message ?? error).slice(0, 500),
    });
    throw error;
  }
}
