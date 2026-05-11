import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

/**
 * memory-llm.util.ts (Memoria PR2 #A1+#A2+#A3+#A11)
 *
 * Helpers compartilhados para chamadas LLM do sistema de memoria.
 * Resolve 4 bugs altos de uma vez:
 *
 *   #A1 — Retry com backoff exponencial em erros transientes (429/5xx/network).
 *         Antes: 1 falha de rede no LLM = memoria perdida pra sempre
 *         (o batch nao reprocessa esse range de mensagens).
 *
 *   #A2 — Timeout explicito (60s). Antes: hang infinito drenava worker
 *         em situacao de OpenAI degradation.
 *
 *   #A3 — Cache de cliente OpenAI por apiKey. Antes: `new OpenAI()` a cada
 *         chamada → reconstroi keepAlive agent, perde conexao reusada,
 *         leak de sockets sob carga.
 *
 *   #A11 — Logging estruturado de custo. Apos cada chamada bem-sucedida,
 *          registra em AiUsage (call_type, tokens, cost_usd, tenant_id).
 *          Permite ver na UI quanto custou cada componente.
 */

// ─── #A3 Singleton cache do client OpenAI ─────────────────────────
const clientCache = new Map<string, OpenAI>();

export function getOpenAIClient(apiKey: string): OpenAI {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new OpenAI({
      apiKey,
      // #A2 — Timeout global do client. O `withResponse` override por chamada
      // tambem usa este como teto. SDK aborta automaticamente apos isso.
      timeout: 60_000, // 60s
      maxRetries: 0, // desliga retry interno do SDK — fazemos nosso (com backoff)
    });
    clientCache.set(apiKey, client);
  }
  return client;
}

// ─── #A1 Retry com backoff exponencial ────────────────────────────

const RETRY_DELAYS_MS = [1000, 3000, 7000]; // 3 retries: 1s, 3s, 7s

function isRetryable(err: any): boolean {
  if (!err) return false;
  const status = err?.status ?? err?.response?.status;
  // 429 (rate limit), 408 (timeout), 5xx — retryable
  if (status === 429 || status === 408) return true;
  if (status >= 500 && status <= 599) return true;
  // Erros de rede sem status numerico
  const code = err?.code ?? err?.cause?.code;
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return true;
  }
  // Mensagens do OpenAI SDK pra rate/overload
  const msg = String(err?.message ?? '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('rate limit') || msg.includes('overloaded')) {
    return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export interface LlmCallOptions {
  logger?: Logger;
  /** Tag pra logs e AiUsage.call_type (ex: 'memory_batch', 'profile_consolidation') */
  callType: string;
  /** Tenant pra registrar em AiUsage (opcional) */
  tenantId?: string;
  /** Para logs apenas */
  contextLabel?: string;
}

/**
 * Executa uma chamada chat.completions com retry+backoff+timeout+cost tracking.
 * Lanca o ultimo erro se todos os retries falharem.
 */
export async function callOpenAiChat(
  apiKey: string,
  prisma: PrismaService | null,
  request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  options: LlmCallOptions,
): Promise<OpenAI.Chat.ChatCompletion> {
  const client = getOpenAIClient(apiKey);
  let lastErr: any = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const start = Date.now();
      const response = await client.chat.completions.create(request);
      const elapsed = Date.now() - start;

      // #A11 — registrar custo (best-effort, nao bloqueia)
      if (prisma && response.usage) {
        await recordAiUsage(prisma, {
          call_type: options.callType,
          tenant_id: options.tenantId,
          model: request.model,
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
        }).catch(() => {});
      }

      if (options.logger) {
        const ctx = options.contextLabel ? ` ${options.contextLabel}` : '';
        options.logger.log(
          `[LLM]${ctx} OK (${request.model}, ${elapsed}ms, ` +
          `${response.usage?.prompt_tokens || '?'}+${response.usage?.completion_tokens || '?'} tokens` +
          (options.tenantId ? `, tenant=${options.tenantId}` : '') +
          (attempt > 0 ? `, attempt=${attempt + 1}` : '') +
          `)`,
        );
      }

      return response;
    } catch (err: any) {
      lastErr = err;
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(err)) {
        if (options.logger) {
          options.logger.warn(
            `[LLM] FALHA ${options.callType} (model=${request.model}, ` +
            `attempt=${attempt + 1}/${RETRY_DELAYS_MS.length + 1}, ` +
            `retryable=${isRetryable(err)}): ${err.message}`,
          );
        }
        throw err;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (options.logger) {
        options.logger.warn(
          `[LLM] retry ${options.callType} apos ${delay}ms ` +
          `(attempt=${attempt + 1}, erro=${err.status || err.code || 'unknown'}: ${err.message})`,
        );
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ─── #A11 AiUsage tracking ────────────────────────────────────────

/**
 * Pricing por 1k tokens em USD (modelos comuns do sistema de memoria).
 * Atualizar quando OpenAI mudar precos.
 */
const PRICING_USD_PER_1K = {
  // ratio (input, output)
  'gpt-4.1': { input: 0.002, output: 0.008 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'text-embedding-3-small': { input: 0.00002, output: 0 },
  'text-embedding-3-large': { input: 0.00013, output: 0 },
};

function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  // Match exato primeiro, depois prefix
  let pricing = (PRICING_USD_PER_1K as any)[model];
  if (!pricing) {
    for (const [k, v] of Object.entries(PRICING_USD_PER_1K)) {
      if (model.startsWith(k)) { pricing = v; break; }
    }
  }
  if (!pricing) return 0; // modelo desconhecido — registra tokens mas custo=0
  return (
    (inputTokens / 1000) * pricing.input +
    (outputTokens / 1000) * pricing.output
  );
}

async function recordAiUsage(
  prisma: PrismaService,
  params: {
    call_type: string;
    tenant_id?: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
  },
): Promise<void> {
  const cost = computeCostUsd(params.model, params.input_tokens, params.output_tokens);
  // Schema usa prompt_tokens / completion_tokens (OpenAI legacy naming)
  await (prisma as any).aiUsage.create({
    data: {
      call_type: params.call_type,
      tenant_id: params.tenant_id ?? null,
      model: params.model,
      prompt_tokens: params.input_tokens,
      completion_tokens: params.output_tokens,
      total_tokens: params.input_tokens + params.output_tokens,
      cost_usd: cost,
    },
  });
}

// ─── #A7 Search/output caps ───────────────────────────────────────

/** Cap max de resultados em queries semanticas (search_memory tool). */
export const MAX_MEMORY_SEARCH_RESULTS = 20;

/** Cap max de caracteres no texto de query semantica. */
export const MAX_MEMORY_QUERY_CHARS = 500;

/** Cap max de caracteres na saida do LLM (JSON parseable) antes de descartar. */
export const MAX_LLM_OUTPUT_CHARS = 50_000;
