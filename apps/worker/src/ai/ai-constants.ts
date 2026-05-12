/**
 * ai-constants.ts (Skills PR3 #M7)
 *
 * Centraliza constantes magicas espalhadas no modulo de Sophia (IA atendente).
 * Antes: 0.7, 2048, 5, 30000, 150 etc espalhados em ai.processor.ts (2745 linhas),
 * tool-executor.ts, prompt-builder.ts. Refactor pra constantes nomeadas em um
 * lugar so facilita ajustes futuros e da semantica clara aos numeros.
 *
 * Nao mover defaults de skills (que vem do banco) — soh literais hardcoded.
 */

// ─── LLM tunings ──────────────────────────────────────────────────

/** Max iteracoes do loop de function calling antes de dar timeout. */
export const TOOL_EXECUTOR_MAX_ITERATIONS = 5;

/** Timeout total da chamada OpenAI/Anthropic (ms). */
export const LLM_REQUEST_TIMEOUT_MS = 60_000;

/** Temperature padrao quando skill nao especifica. */
export const DEFAULT_TEMPERATURE = 0.7;

/** Max tokens padrao quando skill nao especifica. */
export const DEFAULT_MAX_TOKENS = 500;

/** Floor de max_tokens — mesmo skill setando menor, eleva pra evitar resposta truncada. */
export const MIN_MAX_TOKENS = 800;

// ─── Historico de conversa ────────────────────────────────────────

/**
 * Janela de mensagens cross-conversation que o LLM ve no contexto.
 * Mais que 150 trava worker (memoria) sem ganho de qualidade — testado em
 * conversas longas, IA ja perde o fio em ~80 msgs de qualquer jeito.
 */
export const MAX_HISTORICAL_MESSAGES = 150;

/** Cap de imagens inline no chatTurns (gen 5.x suporta vision, mas base64 e caro). */
export const MAX_INLINE_IMAGES = 5;

/** Cap de mensagens carregadas do convo pro fallback path (sem cross-conv). */
export const FALLBACK_CONVO_MESSAGES = 80;

// ─── Tool execution ───────────────────────────────────────────────

/** Cap de chars no resumo de tool_call_id na log. */
export const TOOL_CALL_LOG_PREVIEW_CHARS = 200;

// ─── Defer / Retry ────────────────────────────────────────────────

/** Atraso pra re-enfileirar AI job aguardando transcricao de audio. */
export const AI_DEFER_DELAY_MS = 10_000;

/** Max retries de defer antes de seguir com placeholder. */
export const MAX_AUDIO_RETRIES = 4;

/** Janela em que mensagem de audio eh considerada "fresca" pra defer. */
export const AUDIO_FRESH_WINDOW_MS = 5 * 60_000;

/** Cap em transcribe attempts (Whisper) por audio antes de marcar failed. */
export const MAX_TRANSCRIBE_ATTEMPTS = 3;

// ─── Sanitize / Validation ────────────────────────────────────────

/** Max chars em campos texto vindos do banco antes de injetar no prompt. */
export const MAX_PROMPT_VAR_CHARS = 1000;

/** Max chars no nome do lead (campo simples). */
export const MAX_LEAD_NAME_CHARS = 200;

/** Max chars em notes do lead. */
export const MAX_LEAD_NOTES_CHARS = 2000;

// ─── References ───────────────────────────────────────────────────

/** Cap em quantidade de references injetadas pelo PromptBuilder. */
export const MAX_REFERENCES_PER_SKILL = 30;
