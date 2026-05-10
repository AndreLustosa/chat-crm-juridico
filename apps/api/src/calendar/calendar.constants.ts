/**
 * Constantes do modulo Calendar/Events/Tasks.
 *
 * Bug fix 2026-05-10 (PR3 baixo #3): centraliza magic numbers que estavam
 * espalhados (1000, 5000, 60_000, 25 * 1024 * 1024, etc). Caso queira
 * ajustar pra um deploy especifico (ambiente lento, escritorio menor),
 * tunar aqui em um lugar so.
 */

// ─── BullMQ retry/backoff ─────────────────────────────────────────────
export const BULLMQ_REMINDER_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: 50,
};

// Delay minimo de jobs imediatos (1s evita race com ack do BullMQ)
export const MIN_JOB_DELAY_MS = 1_000;

// Tolerancia pra considerar reminder retroativo (60s = janela do cron)
export const RETROACTIVE_TOLERANCE_MS = 60_000;

// ─── Reminders ────────────────────────────────────────────────────────
export const PUSH_CRON_BATCH_LIMIT = 100;
export const ORPHAN_CRON_BATCH_LIMIT = 50;
export const HEARING_FALLBACK_BATCH_LIMIT = 100;
export const HEARING_FALLBACK_MIN_HOURS_AHEAD = 6;
export const STALE_REMINDER_HOURS = 24;

// ─── Tasks ────────────────────────────────────────────────────────────
export const OVERDUE_SLA_WINDOW_HOURS = 75;
export const OVERDUE_TASKS_BATCH_LIMIT = 500;
export const ACK_BATCH_MAX_IDS = 200;
export const WORKLOAD_WINDOW_DAYS = 90;
export const DELEGATION_METRICS_TASKS_LIMIT = 2000;

// ─── Calendar findAll ─────────────────────────────────────────────────
export const FINDALL_EVENTS_LIMIT = 1000;
export const RECURRENCE_MAX_INSTANCES = 365;

// ─── Attachments ──────────────────────────────────────────────────────
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB

// ─── OpenAI / IA ──────────────────────────────────────────────────────
export const OPENAI_NBA_TIMEOUT_MS = 10_000; // suggestNextAction
export const OPENAI_REMINDER_MAX_TOKENS = 400; // generateClientMessage
export const OPENAI_HEARING_MAX_TOKENS = 350; // generateHearingScheduledMessage

// ─── SMTP ─────────────────────────────────────────────────────────────
export const SMTP_POOL_MAX_CONNECTIONS = 5;
export const SMTP_POOL_MAX_MESSAGES = 100;
