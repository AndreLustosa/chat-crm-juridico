/**
 * Utilitário de horário de expediente.
 *
 * Centraliza: (a) detecção se o instante atual está dentro do expediente,
 * (b) geração da string informativa injetada no prompt via
 * {{business_hours_info}}, e (c) cálculo do próximo expediente útil
 * (pulando fim de semana e feriados do tenant).
 *
 * Settings lidas de GlobalSetting com fallback para defaults:
 *  - AFTER_HOURS_START   (default "17:00") — inicio do "fora do expediente"
 *  - AFTER_HOURS_END     (default "08:00") — inicio do "dentro do expediente"
 *  - BUSINESS_DAYS       (default "1,2,3,4,5") — seg=1 ... dom=0
 *  - TIMEZONE            (default "America/Maceio")
 */

export interface BusinessHoursSettings {
  start: { h: number; m: number }; // ex: 17:00
  end: { h: number; m: number };   // ex: 08:00
  businessDays: Set<number>;       // ex: {1,2,3,4,5}
  timezone: string;                // ex: "America/Maceio"
}

export interface BusinessHoursStatus {
  /** true = escritório aberto agora; false = fora do expediente/feriado. */
  isBusinessHour: boolean;
  /** Data "naive" no fuso do escritório — usada para extrair h/m/dow via getUTC*. */
  nowLocal: Date;
  /** Hora local formatada (HH:MM). */
  currentTime: string;
  /** Nome do dia da semana em pt-BR (ex: "sábado"). */
  currentDayName: string;
  /** true = hoje é feriado conforme tabela Holiday. */
  isHoliday: boolean;
  /** Nome do feriado, se houver. */
  holidayName?: string | null;
}

const DAY_NAMES_PT = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

const DAY_NAMES_PT_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ─── Carregamento de settings ──────────────────────────────────────────

export async function loadBusinessHoursSettings(prisma: any): Promise<BusinessHoursSettings> {
  const rows = await prisma.globalSetting.findMany({
    where: {
      key: {
        in: ['AFTER_HOURS_START', 'AFTER_HOURS_END', 'BUSINESS_DAYS', 'TIMEZONE'],
      },
    },
  });
  const map = new Map<string, string>(rows.map((r: any) => [r.key, r.value]));
  return {
    start: parseHHMM(map.get('AFTER_HOURS_START') ?? '17:00'),
    end: parseHHMM(map.get('AFTER_HOURS_END') ?? '08:00'),
    businessDays: parseBusinessDays(map.get('BUSINESS_DAYS') ?? '1,2,3,4,5'),
    timezone: map.get('TIMEZONE') || 'America/Maceio',
  };
}

function parseHHMM(value: string): { h: number; m: number } {
  const parts = value.split(':');
  const h = Number.parseInt(parts[0] ?? '0', 10);
  const m = Number.parseInt(parts[1] ?? '0', 10);
  return {
    h: Number.isFinite(h) && h >= 0 && h < 24 ? h : 0,
    m: Number.isFinite(m) && m >= 0 && m < 60 ? m : 0,
  };
}

function parseBusinessDays(value: string): Set<number> {
  const days = value
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
  return new Set(days.length > 0 ? days : [1, 2, 3, 4, 5]);
}

// ─── Cálculo do "agora" no fuso do escritório ──────────────────────────

/**
 * Retorna um Date cujos componentes UTC correspondem à hora LOCAL no fuso
 * informado. Não é um instante real — serve só para extrair h/m/dow via
 * getUTCHours/getUTCMinutes/getUTCDay.
 */
export function nowInTimezone(timezone: string): Date {
  const parts: Record<string, string> = {};
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  for (const p of formatted) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const hourStr = parts.hour === '24' ? '00' : parts.hour;
  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T${hourStr}:${parts.minute}:${parts.second}Z`,
  );
}

// ─── Classificação do momento ──────────────────────────────────────────

export function isBusinessMoment(nowLocal: Date, settings: BusinessHoursSettings): boolean {
  const dow = nowLocal.getUTCDay();
  if (!settings.businessDays.has(dow)) return false;

  const minutesNow = nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes();
  const startMinutes = settings.end.h * 60 + settings.end.m;       // 08:00
  const endMinutes = settings.start.h * 60 + settings.start.m;     // 17:00
  return minutesNow >= startMinutes && minutesNow < endMinutes;
}

// ─── Feriados ──────────────────────────────────────────────────────────

async function checkHoliday(
  prisma: any,
  nowLocal: Date,
  tenantId?: string | null,
): Promise<{ isHoliday: boolean; name?: string | null }> {
  // Janela do dia local como UTC-naive (mesmo convenção usada no resto do app).
  const y = nowLocal.getUTCFullYear();
  const mo = nowLocal.getUTCMonth();
  const d = nowLocal.getUTCDate();
  const dayStart = new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(y, mo, d, 23, 59, 59, 999));

  try {
    // Feriado exato (não recorrente)
    const exact = await prisma.holiday.findFirst({
      where: {
        date: { gte: dayStart, lte: dayEnd },
        recurring_yearly: false,
        ...(tenantId
          ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] }
          : {}),
      },
      select: { name: true },
    });
    if (exact) return { isHoliday: true, name: exact.name };

    // Feriado recorrente anual (mesmo mês/dia, qualquer ano)
    const month = mo + 1;
    const day = d;
    const raw = tenantId
      ? await prisma.$queryRaw`
          SELECT name FROM "Holiday"
          WHERE recurring_yearly = true
            AND EXTRACT(MONTH FROM date) = ${month}
            AND EXTRACT(DAY FROM date) = ${day}
            AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
          LIMIT 1
        `
      : await prisma.$queryRaw`
          SELECT name FROM "Holiday"
          WHERE recurring_yearly = true
            AND EXTRACT(MONTH FROM date) = ${month}
            AND EXTRACT(DAY FROM date) = ${day}
          LIMIT 1
        `;
    const arr = raw as any[];
    if (arr.length > 0) return { isHoliday: true, name: arr[0]?.name || 'Feriado' };
  } catch {
    // Falha ao consultar não bloqueia o fluxo — assume não feriado
  }
  return { isHoliday: false };
}

// ─── API pública ───────────────────────────────────────────────────────

export async function computeBusinessHoursStatus(
  prisma: any,
  tenantId?: string | null,
): Promise<BusinessHoursStatus> {
  const settings = await loadBusinessHoursSettings(prisma);
  const nowLocal = nowInTimezone(settings.timezone);
  const holiday = await checkHoliday(prisma, nowLocal, tenantId);
  const withinHours = isBusinessMoment(nowLocal, settings) && !holiday.isHoliday;

  return {
    isBusinessHour: withinHours,
    nowLocal,
    currentTime: formatHHMM(nowLocal),
    currentDayName: DAY_NAMES_PT[nowLocal.getUTCDay()] ?? '',
    isHoliday: holiday.isHoliday,
    holidayName: holiday.name ?? null,
  };
}

/**
 * String pronta para injetar no system prompt via {{business_hours_info}}.
 * - Dentro do expediente: string vazia (skill segue fluxo normal sem poluir o prompt).
 * - Fora do expediente ou feriado: bloco multi-linha com data/hora atual,
 *   motivo do fechamento e próximo expediente útil.
 */
export async function computeBusinessHoursInfo(
  prisma: any,
  tenantId?: string | null,
): Promise<string> {
  const status = await computeBusinessHoursStatus(prisma, tenantId);
  if (status.isBusinessHour) return '';

  const settings = await loadBusinessHoursSettings(prisma);
  const next = await computeNextBusinessStart(prisma, status.nowLocal, settings, tenantId);

  const reason = status.isHoliday
    ? `FERIADO (${status.holidayName || 'feriado local'})`
    : settings.businessDays.has(status.nowLocal.getUTCDay())
      ? 'FORA DO HORÁRIO COMERCIAL'
      : 'FIM DE SEMANA';

  const startStr = formatHHMM({ h: settings.end.h, m: settings.end.m });
  const endStr = formatHHMM({ h: settings.start.h, m: settings.start.m });

  const lines = [
    `🕐 AGORA: ${capitalize(status.currentDayName)} ${status.currentTime} (${settings.timezone}).`,
    `ESCRITÓRIO FECHADO — ${reason}.`,
    `Funcionamento: segunda a sexta, das ${startStr} às ${endStr}.`,
    `Próximo expediente: ${next}.`,
  ];
  return lines.join('\n');
}

/**
 * Retorna string legível do próximo momento em que o escritório abre.
 * Ex: "segunda 21/04 às 08:00".
 */
async function computeNextBusinessStart(
  prisma: any,
  nowLocal: Date,
  settings: BusinessHoursSettings,
  tenantId?: string | null,
): Promise<string> {
  // Parte do início do dia atual e avança até achar dia útil não-feriado.
  // Se hoje é dia útil e ainda antes do horário de abertura, a abertura é hoje.
  const startMinutes = settings.end.h * 60 + settings.end.m;
  const nowMinutes = nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes();

  for (let offset = 0; offset < 14; offset++) {
    const candidate = new Date(nowLocal.getTime());
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    candidate.setUTCHours(settings.end.h, settings.end.m, 0, 0);

    // Se for hoje e já passou do horário de abertura, pular
    if (offset === 0 && nowMinutes >= startMinutes) continue;

    if (!settings.businessDays.has(candidate.getUTCDay())) continue;

    const holiday = await checkHoliday(prisma, candidate, tenantId);
    if (holiday.isHoliday) continue;

    const dayName = DAY_NAMES_PT_SHORT[candidate.getUTCDay()] ?? '';
    const dd = String(candidate.getUTCDate()).padStart(2, '0');
    const mm = String(candidate.getUTCMonth() + 1).padStart(2, '0');
    return `${dayName} ${dd}/${mm} às ${formatHHMM({ h: settings.end.h, m: settings.end.m })}`;
  }
  return 'próximo dia útil';
}

// ─── Helpers de formatação ────────────────────────────────────────────

function formatHHMM(d: Date | { h: number; m: number }): string {
  const h = d instanceof Date ? d.getUTCHours() : d.h;
  const m = d instanceof Date ? d.getUTCMinutes() : d.m;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
