/** Configurações do CRM salvas em localStorage. */

const KEY_STAGNATION_DAYS = 'crm_stagnation_days';
const DEFAULT_STAGNATION_DAYS = 3;

export function getStagnationDays(): number {
  if (typeof window === 'undefined') return DEFAULT_STAGNATION_DAYS;
  const raw = localStorage.getItem(KEY_STAGNATION_DAYS);
  if (!raw) return DEFAULT_STAGNATION_DAYS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_STAGNATION_DAYS;
}

export function setStagnationDays(days: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY_STAGNATION_DAYS, String(Math.max(1, Math.round(days))));
}
