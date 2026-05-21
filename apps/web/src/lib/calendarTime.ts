// ─── Vencimento de CalendarEvent (convencao UTC-naive-BRT) ───────────
//
// Bug reportado 2026-05-21 (Andre): tarefa marcada 10:00 aparecia
// "vencida" as 09:37. Causa: CalendarEvents sao gravados na convencao
// UTC-naive-BRT — a hora BRT eh marcada com sufixo Z (ex: 10:00 BRT vira
// "2026-05-21T10:00:00.000Z"). Por isso TODO display de evento usa
// timeZone:'UTC'. Mas a checagem de vencido fazia
// `new Date(start_at) < new Date()`, comparando o epoch armazenado (que
// esta 3h "adiantado" em relacao ao instante real que representa) com o
// instante real — resultado: evento parecia vencido 3h antes da hora real.
//
// Brasil (Maceio) eh UTC-3 fixo (sem horario de verao desde 2019), entao
// alinhamos subtraindo 3h do "agora" antes de comparar — assim a
// comparacao fica "naive-BRT vs naive-BRT".
export const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * True se um CalendarEvent (start_at na convencao UTC-naive-BRT) ja passou
 * em relacao ao horario atual de Brasilia/Maceio.
 *
 * Use SOMENTE para CalendarEvent.start_at / end_at (gravados naive-BRT).
 * NAO use para Task.due_at — esse eh instante UTC real e deve ser comparado
 * com `new Date()` direto.
 */
export function isCalendarEventOverdue(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now() - BRT_OFFSET_MS;
}
