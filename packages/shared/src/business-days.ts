/**
 * Calculo de dias uteis no contexto juridico brasileiro.
 *
 * Antes era simples: pula sabado/domingo. INSUFICIENTE — perdia
 * Carnaval, Corpus Christi, recesso forense (CPC art. 220, 20/12 a
 * 20/01), feriados nacionais (1°mai, 7set, etc.) e estaduais.
 *
 * Esta lib calcula corretamente:
 *   - sabado/domingo
 *   - feriados nacionais fixos (1°jan, 21abr, 1°mai, 7set, 12out,
 *     2nov, 15nov, 25dez)
 *   - feriados moveis (Carnaval = -47 dias da Pascoa, Corpus Christi
 *     = +60 dias da Pascoa, Sexta da Paixao = -2 dias da Pascoa)
 *   - recesso forense CPC art. 220 (20/12 ate 20/01 — TODO suspenso)
 *   - feriados customizados via tabela Holiday (tenant-scoped:
 *     estaduais, municipais, recessos especificos do escritorio)
 *
 * Pascoa eh calculada via algoritmo de Meeus/Jones/Butcher (Gauss).
 *
 * Uso tipico:
 *   const calc = new BusinessDaysCalc({ holidays: customHolidays });
 *   const dueAt = calc.addBusinessDays(new Date(), 15);
 *
 * Sem `holidays`, usa so feriados nacionais + recesso. `holidays` deve
 * vir do banco filtrado por tenant_id antes de instanciar.
 */

interface CustomHoliday {
  date: string | Date; // YYYY-MM-DD ou Date
  recurring_yearly?: boolean; // true = mesma data todo ano
}

export interface BusinessDaysOptions {
  /** Feriados customizados do tenant (estaduais, municipais, etc.) */
  holidays?: CustomHoliday[];
  /** Se true, ignora recesso CPC art. 220 (raro — usar so quando contagem nao eh processual) */
  skipRecessoForense?: boolean;
}

/**
 * Algoritmo de Meeus/Jones/Butcher pra calcular Pascoa do ano.
 * Retorna { month: 3|4, day: 1-31 } pra dia da Pascoa.
 */
function computeEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 ou 4
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Adiciona N dias a uma data. */
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Formato YYYY-MM-DD em UTC pra comparar dates. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Formato MM-DD pra checar feriados anuais (recurring_yearly). */
function toMonthDay(d: Date): string {
  return d.toISOString().slice(5, 10);
}

export class BusinessDaysCalc {
  private readonly opts: BusinessDaysOptions;
  // Cache de feriados por ano (calculados sob demanda)
  private readonly holidayCache = new Map<number, Set<string>>();
  // Set de feriados anuais (recurring_yearly=true) — formato MM-DD
  private readonly recurringYearly = new Set<string>();

  constructor(opts: BusinessDaysOptions = {}) {
    this.opts = opts;
    // Pre-processa feriados customizados anuais
    for (const h of opts.holidays || []) {
      if (h.recurring_yearly) {
        const d = h.date instanceof Date ? h.date : new Date(h.date);
        this.recurringYearly.add(toMonthDay(d));
      }
    }
  }

  /**
   * Retorna Set de YYYY-MM-DD com TODOS os feriados/dias suspensos
   * do ano (nacionais fixos + moveis + recesso CPC + custom do tenant).
   */
  private holidaysForYear(year: number): Set<string> {
    const cached = this.holidayCache.get(year);
    if (cached) return cached;

    const set = new Set<string>();
    const yyyy = String(year).padStart(4, '0');

    // ─── Feriados nacionais fixos ────────────────────────────────
    // Confraternizacao Universal
    set.add(`${yyyy}-01-01`);
    // Tiradentes
    set.add(`${yyyy}-04-21`);
    // Dia do Trabalhador
    set.add(`${yyyy}-05-01`);
    // Independencia
    set.add(`${yyyy}-09-07`);
    // N. Sra. Aparecida (padroeira do Brasil)
    set.add(`${yyyy}-10-12`);
    // Finados
    set.add(`${yyyy}-11-02`);
    // Proclamacao da Republica
    set.add(`${yyyy}-11-15`);
    // Natal
    set.add(`${yyyy}-12-25`);

    // ─── Feriados moveis (calculados via Pascoa) ──────────────────
    const easter = computeEaster(year);
    const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));
    // Sexta-feira da Paixao (-2 dias)
    set.add(toIsoDate(addDays(easterDate, -2)));
    // Carnaval (segunda + terca, -48 e -47 dias)
    set.add(toIsoDate(addDays(easterDate, -48)));
    set.add(toIsoDate(addDays(easterDate, -47)));
    // Corpus Christi (+60 dias)
    set.add(toIsoDate(addDays(easterDate, 60)));

    // ─── Recesso forense CPC art. 220 ────────────────────────────
    // De 20/12 a 20/01 (inclusivo) — todos prazos processuais ficam
    // suspensos. Cobrir tanto o ano corrente quanto o anterior.
    if (!this.opts.skipRecessoForense) {
      // Recesso terminando dentro deste ano (de 20/12/Y-1 a 20/01/Y)
      for (let day = 20; day <= 31; day++) {
        set.add(`${String(year - 1).padStart(4, '0')}-12-${String(day).padStart(2, '0')}`);
      }
      for (let day = 1; day <= 20; day++) {
        set.add(`${yyyy}-01-${String(day).padStart(2, '0')}`);
      }
      // Recesso comecando neste ano (de 20/12/Y a 20/01/Y+1)
      for (let day = 20; day <= 31; day++) {
        set.add(`${yyyy}-12-${String(day).padStart(2, '0')}`);
      }
      for (let day = 1; day <= 20; day++) {
        set.add(`${String(year + 1).padStart(4, '0')}-01-${String(day).padStart(2, '0')}`);
      }
    }

    // ─── Feriados customizados do tenant (data fixa do ano) ──────
    for (const h of this.opts.holidays || []) {
      if (!h.recurring_yearly) {
        const d = h.date instanceof Date ? h.date : new Date(h.date);
        set.add(toIsoDate(d));
      }
    }
    // Recurring yearly: aplica MM-DD a este ano
    for (const md of this.recurringYearly) {
      set.add(`${yyyy}-${md}`);
    }

    this.holidayCache.set(year, set);
    return set;
  }

  /** Retorna true se a data eh dia util (nao sab/dom, nao feriado/recesso). */
  isBusinessDay(d: Date): boolean {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false; // domingo (0) ou sabado (6)
    const set = this.holidaysForYear(d.getUTCFullYear());
    return !set.has(toIsoDate(d));
  }

  /** Retorna true se a data eh feriado (nacional, movel, recesso ou custom). */
  isHoliday(d: Date): boolean {
    const set = this.holidaysForYear(d.getUTCFullYear());
    return set.has(toIsoDate(d));
  }

  /** Adiciona N dias UTEIS a uma data, pulando finais de semana, feriados e recesso. */
  addBusinessDays(date: Date, days: number): Date {
    if (days === 0) return new Date(date);
    const d = new Date(date);
    const direction = days > 0 ? 1 : -1;
    let added = 0;
    const target = Math.abs(days);
    while (added < target) {
      d.setUTCDate(d.getUTCDate() + direction);
      if (this.isBusinessDay(d)) added++;
    }
    return d;
  }

  /** Conta quantos dias uteis ha entre start (exclusive) e end (inclusive). */
  countBusinessDays(start: Date, end: Date): number {
    if (end <= start) return 0;
    const cursor = new Date(start);
    let count = 0;
    while (cursor < end) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (this.isBusinessDay(cursor)) count++;
    }
    return count;
  }

  /** Retorna o proximo dia util A PARTIR de date (incluindo hoje se for util). */
  nextBusinessDay(date: Date): Date {
    const d = new Date(date);
    while (!this.isBusinessDay(d)) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return d;
  }
}

/**
 * Helper standalone — usar quando nao tem access ao banco pra carregar
 * Holiday do tenant. Cobre feriados nacionais + recesso CPC mas NAO
 * estaduais/municipais. Equivalente ao comportamento legado mas correto.
 */
export function addBusinessDaysSimple(date: Date, days: number): Date {
  const calc = new BusinessDaysCalc();
  return calc.addBusinessDays(date, days);
}

/** Lista de feriados nacionais brasileiros pra um ano (uso em UI/seed). */
export function brazilianNationalHolidays(year: number): Array<{ date: string; name: string }> {
  const calc = new BusinessDaysCalc({ skipRecessoForense: true });
  // Forca o populacao do cache
  calc.isBusinessDay(new Date(Date.UTC(year, 5, 15))); // any date
  // Reconstrucao manual com nomes
  const easter = computeEaster(year);
  const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));

  const yyyy = String(year).padStart(4, '0');
  return [
    { date: `${yyyy}-01-01`, name: 'Confraternização Universal' },
    { date: toIsoDate(addDays(easterDate, -48)), name: 'Carnaval (segunda)' },
    { date: toIsoDate(addDays(easterDate, -47)), name: 'Carnaval (terça)' },
    { date: toIsoDate(addDays(easterDate, -2)), name: 'Sexta-feira da Paixão' },
    { date: `${yyyy}-04-21`, name: 'Tiradentes' },
    { date: `${yyyy}-05-01`, name: 'Dia do Trabalhador' },
    { date: toIsoDate(addDays(easterDate, 60)), name: 'Corpus Christi' },
    { date: `${yyyy}-09-07`, name: 'Independência' },
    { date: `${yyyy}-10-12`, name: 'Nossa Senhora Aparecida' },
    { date: `${yyyy}-11-02`, name: 'Finados' },
    { date: `${yyyy}-11-15`, name: 'Proclamação da República' },
    { date: `${yyyy}-12-25`, name: 'Natal' },
  ];
}
