import { DEFAULT_LIMIT, MICROS_PER_CURRENCY } from '../constants.js';
import type { DatePreset, DateRange, MetricTotals, ToolResponse } from '../types.js';

export function fromMicros(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  return Number(value) / MICROS_PER_CURRENCY;
}

export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function money(value: number | null | undefined): string {
  const n = value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

export function percent(value: number | null | undefined): string {
  const n = value ?? 0;
  return `${(n * 100).toFixed(2)}%`;
}

export function dateBr(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), 200);
}

export function paginate<T>(items: T[], page = 1, limit = DEFAULT_LIMIT): T[] {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(page, 1);
  return items.slice((safePage - 1) * safeLimit, safePage * safeLimit);
}

export function totals(rows: Array<{ spend: number; clicks: number; impressions: number; conversions: number }>): MetricTotals {
  const spend = rows.reduce((sum, r) => sum + r.spend, 0);
  const clicks = rows.reduce((sum, r) => sum + r.clicks, 0);
  const impressions = rows.reduce((sum, r) => sum + r.impressions, 0);
  const conversions = rows.reduce((sum, r) => sum + r.conversions, 0);
  return {
    spend,
    clicks,
    impressions,
    conversions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? spend / clicks : null,
    cpl: conversions > 0 ? spend / conversions : null,
    conversion_rate: clicks > 0 ? conversions / clicks : 0,
  };
}

export function markdownTable(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  if (rows.length === 0) return 'Nenhum registro encontrado.';
  const header = `| ${headers.join(' |')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((v) => String(v ?? '')).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

export function ok<T>(data: T, markdown: string): ToolResponse<T> {
  return {
    content: [{ type: 'text', text: markdown }],
    structuredContent: { data },
  };
}

export function fail(message: string): ToolResponse<never> {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function formatError(error: any): string {
  const text = String(error?.message ?? error ?? 'erro desconhecido');
  const code = error?.code ?? error?.failure?.errors?.[0]?.error_code;
  if (text.includes('invalid_grant') || text.includes('refresh token') || code === 'AUTHENTICATION_ERROR') {
    return 'Erro de autenticacao com Google Ads. Verifique refresh token, client id, client secret e developer token.';
  }
  if (text.includes('quota') || code === 'QUOTA_EXCEEDED') {
    return 'Limite de requisicoes da Google Ads API atingido. Aguarde alguns minutos e tente novamente.';
  }
  if (text.includes('PERMISSION_DENIED')) {
    return 'Permissao negada pelo Google Ads. Confira se o usuario OAuth tem acesso a conta informada.';
  }
  return `Erro: ${text.slice(0, 1200)}. Verifique os parametros e tente novamente.`;
}

export function resolveDateRange(input: {
  date_from?: string;
  date_to?: string;
  date_preset?: DatePreset;
}): DateRange {
  const preset = input.date_preset ?? (!input.date_from && !input.date_to ? 'LAST_7_DAYS' : undefined);
  const now = new Date();
  const today = toIsoDate(now);
  const yesterdayDate = addDays(now, -1);

  if (preset === 'TODAY') return { from: today, to: today };
  if (preset === 'YESTERDAY') {
    const y = toIsoDate(yesterdayDate);
    return { from: y, to: y };
  }
  if (preset === 'LAST_30_DAYS') return { from: toIsoDate(addDays(now, -29)), to: today };
  if (preset === 'THIS_MONTH') return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === 'LAST_MONTH') {
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthEnd = addDays(firstThisMonth, -1);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    return { from: toIsoDate(lastMonthStart), to: toIsoDate(lastMonthEnd) };
  }
  if (preset === 'LAST_7_DAYS') return { from: toIsoDate(addDays(now, -6)), to: today };
  return {
    from: input.date_from ?? toIsoDate(addDays(now, -6)),
    to: input.date_to ?? today,
  };
}

export function rangeWhere(range: DateRange): string {
  return `segments.date BETWEEN '${range.from}' AND '${range.to}'`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
