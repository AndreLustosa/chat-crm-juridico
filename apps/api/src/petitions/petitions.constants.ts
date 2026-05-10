/**
 * Constantes do modulo Peticoes + IA.
 *
 * Bug fix 2026-05-10 (Peticoes PR3 #29):
 * Centraliza magic numbers (timeouts, max_tokens, cache TTLs) que
 * estavam espalhados em 3 services. Tunar comportamento (custo,
 * latencia, retencao) requer mudanca em um lugar so.
 */

// ─── Timeouts ─────────────────────────────────────────────────
export const ANTHROPIC_TIMEOUT_MS = 120_000;
export const OPENAI_TIMEOUT_MS = 120_000;

// ─── Retry ────────────────────────────────────────────────────
export const ANTHROPIC_MAX_RETRIES = 3;
export const OPENAI_MAX_RETRIES = 2;

// ─── Token caps (controle de custo) ───────────────────────────
export const PETITION_GENERATE_MAX_TOKENS = 4096;
export const CHAT_MAX_TOKENS_WITH_SKILLS = 16384;
export const CHAT_MAX_TOKENS_NORMAL = 8192;
export const CHAT_MAX_TOKENS_FALLBACK_HAIKU = 2048;
export const CHAT_THINKING_BUDGET_TOKENS = 2000;

// ─── Historico ────────────────────────────────────────────────
export const CHAT_MAX_HISTORY_MESSAGES = 20;
export const CHAT_MAX_HISTORY_DB_FETCH = 40;
export const CHAT_MAX_CHARS_PER_MESSAGE = 8000;

// ─── Cache ────────────────────────────────────────────────────
export const TEMPLATES_CACHE_TTL_MS = 5 * 60_000;
export const TEMPLATES_CACHE_MAX_ENTRIES = 500;

// ─── Cleanup ──────────────────────────────────────────────────
export const CHAT_RETENTION_MONTHS = 6;

// ─── Export ───────────────────────────────────────────────────
export const EXPORT_PDF_MAX_BYTES = 20 * 1024 * 1024; // 20MB cap

// ─── Rate limit ──────────────────────────────────────────────
export const RATE_LIMIT_GENERATE_PER_5MIN = 5;
export const RATE_LIMIT_CHAT_PER_MIN = 20;
