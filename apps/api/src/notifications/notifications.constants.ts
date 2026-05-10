/**
 * Constantes do NotificationsService.
 *
 * Bug fix 2026-05-10 (NotifService PR3 #16): centraliza magic numbers
 * espalhados (5min, 60min, 90d, 15s, 10KB). Caso queira ajustar
 * comportamento (ex: encurtar dedup pra escritorio que prefere
 * "saber sempre que tem mensagem nova"), tunar aqui em um lugar so.
 */

// ─── Service (API) ────────────────────────────────────────────────────
export const WHATSAPP_DELAY_MS = 5 * 60 * 1000;          // 5min ate disparar fallback
export const RETENTION_DAYS = 90;                         // cleanup cron
export const DEDUP_SAFEGUARD_MS = 2 * 60 * 60 * 1000;    // preserva anchors do worker
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

// ─── Validation (PR3 #10) ─────────────────────────────────────────────
export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 1000;
export const MAX_DATA_BYTES = 10_000;

// TODO 2026-05-10 (NotifService PR3 #9 — diferido):
// process.env.APP_URL eh hardcoded no worker (notification-whatsapp.processor)
// pra montar deep link "Abrir o chat: <url>". Em deploy multi-tenant, cada
// tenant precisa do proprio dominio. Solucao requer:
//   1. Adicionar `app_url String?` ao model Tenant (migration)
//   2. Worker resolver via Tenant.findUnique({ tenant_id }).app_url
//   3. Fallback pro env apenas pra single-tenant retro-compat
// Em deploy single-tenant atual (lustosaadvogados), env funciona.
// Revisitar quando primeiro tenant adicional chegar.
