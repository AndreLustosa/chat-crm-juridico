export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const MICROS_PER_CURRENCY = 1_000_000;
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_REPORT_DAILY_LIMIT = 9500;

export const SUPPORTED_DATE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
] as const;
