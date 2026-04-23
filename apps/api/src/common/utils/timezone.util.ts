/**
 * Helper de timezone — compensa a convencao "UTC naive = BRT" usada no app.
 *
 * Contexto:
 * ─────────
 * O frontend grava horarios de eventos com `Date.UTC(y, m-1, d, h, mi)`, que
 * produz um Date cujo timestamp corresponde literalmente a "08:20 UTC" quando
 * a intencao do usuario era "08:20 horario de Maceio (BRT)". Essa convencao
 * simplifica a EXIBICAO (worker e frontend formatam com `timeZone: 'UTC'` pra
 * nao subtrair 3h), mas cria problema em calculos de agendamento absoluto:
 *
 *   // BUG sem helper:
 *   const triggerAt = startAt.getTime() - 30 * 60 * 1000;
 *
 * Aqui `startAt.getTime()` retorna o epoch REAL do "08:20 UTC" salvo — que
 * corresponde a 05:20 BRT no relogio de parede. BullMQ entao dispara 30min
 * antes disso (04:50 BRT), nao 30min antes de 08:20 BRT real (07:50 BRT).
 *
 * Diferenca: 3 horas (BRT = UTC-3, Brasil aboliu horario de verao em 2019,
 * entao o offset eh fixo).
 *
 * Bug reportado em 2026-04-23 — audiencia Dra. Gianny / Guilherme Porto
 * (08:20 BRT) teve reminder de 30min enviado as 04:50 BRT.
 *
 * Uso:
 * ────
 *   const triggerAt = brazilNaiveToRealEpoch(startAt) - 30 * 60 * 1000;
 *   const delay = Math.max(triggerAt - Date.now(), 1000);
 *
 * Nao use em comparacoes A - B onde ambos sao Dates "UTC naive BRT" — o
 * offset cancela. Use APENAS quando comparar/subtrair contra `Date.now()`
 * ou outro timestamp que represente o instante real (epoch UTC verdadeiro).
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3, sem DST desde 2019

/**
 * Recebe um Date "UTC naive" (horario local de Maceio armazenado como se
 * fosse UTC) e retorna o epoch real (ms desde 1970-01-01 UTC) que
 * corresponde ao MESMO wall-clock em BRT (UTC-3).
 *
 * Exemplo:
 *   Input:  Date gravado como 2026-04-23T08:20:00.000Z (intencao: 08:20 BRT)
 *   Output: epoch de 2026-04-23T11:20:00.000Z (que eh 08:20 BRT real)
 */
export function brazilNaiveToRealEpoch(d: Date): number {
  return d.getTime() + BRT_OFFSET_MS;
}

/**
 * Calcula quantos minutos faltam (positivo) ou se passaram (negativo) ate
 * um evento cujo `start_at` eh UTC naive BRT.
 *
 * Exemplo:
 *   now = 10:50 BRT (UTC real 13:50)
 *   evt.start_at = 2026-04-23T11:20:00.000Z (naive BRT — intencao 11:20 BRT)
 *   -> retorna 30 (minutos ate o evento)
 */
export function minutesUntilBrazilNaive(startAt: Date, nowMs = Date.now()): number {
  const diffMs = brazilNaiveToRealEpoch(startAt) - nowMs;
  return Math.round(diffMs / 60000);
}

/**
 * Inverso de `brazilNaiveToRealEpoch` — pega o "agora" real (epoch UTC) e
 * retorna um Date no mesmo wall-clock BRT mas codificado como UTC naive,
 * pra comparar com colunas `start_at`/`due_at` no Postgres.
 *
 * Uso tipico: WHERE start_at <= now (em query Prisma):
 *   const nowNaive = brazilRealNowToNaive();
 *   prisma.calendarEvent.findMany({ where: { start_at: { lte: nowNaive } } })
 */
export function brazilRealNowToNaive(nowMs = Date.now()): Date {
  return new Date(nowMs - BRT_OFFSET_MS);
}

/**
 * Mesma ideia de `brazilRealNowToNaive` mas pra um instante arbitrario
 * (ex: "15 min a partir de agora"). Retorna Date codificado como UTC naive
 * correspondente ao wall-clock BRT.
 */
export function brazilRealEpochToNaive(ms: number): Date {
  return new Date(ms - BRT_OFFSET_MS);
}
