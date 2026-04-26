/**
 * Helper centralizado de horario comercial (Maceio, UTC-3 fixo desde 2019).
 *
 * Antes (2026-04-26): cada service tinha sua propria implementacao com
 * variacoes — alguns excluiam sab/dom, outros so checavam hora, alguns
 * retornavam early sem re-tentar. Resultado: notificacoes perdidas em fim
 * de semana / madrugada / fora do horario.
 *
 * Politica unificada (decidida com André em 2026-04-26):
 *   - Horario comercial = 08h-20h, TODOS os dias (incluindo sab/dom).
 *   - Notificacoes fora do horario sao ADIADAS pra proxima janela, nunca
 *     descartadas.
 *
 * Antes era seg-sex 8h-20h. Mudamos pra incluir fim de semana porque clientes
 * pagam pra serem notificados de movimentacoes processuais sem perda — adiar
 * audiencia da segunda pra segunda 8h chegava tarde demais.
 */

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000; // UTC-3 fixo

/**
 * Retorna true se `nowMs` (default agora) cai dentro do horario comercial
 * em Maceio (08h00-19h59 BRT, qualquer dia).
 */
export function isBusinessHours(nowMs: number = Date.now()): boolean {
  const maceio = new Date(nowMs + BRT_OFFSET_MS);
  const hour = maceio.getUTCHours();
  return hour >= 8 && hour < 20;
}

/**
 * Calcula delay (ms) ate proxima janela 08h00 BRT. Retorna 0 se ja estamos
 * em horario comercial (aviso: caller deve checar isso com isBusinessHours
 * primeiro pra evitar enfileirar com delay=0).
 *
 * Logica:
 *   - Antes de 08h hoje: agendar pra 08h hoje
 *   - Apos 20h: agendar pra 08h amanha
 *   - Em horario: retorna 0 (caller deveria nem chamar isso)
 */
export function msUntilNextBusinessHour(nowMs: number = Date.now()): number {
  if (isBusinessHours(nowMs)) return 0;

  // Trabalha em "wall-clock BRT" — o offset cancela na conversao final
  const maceio = new Date(nowMs + BRT_OFFSET_MS);
  const hour = maceio.getUTCHours();
  const next = new Date(maceio);
  next.setUTCMinutes(0, 0, 0);
  if (hour < 8) {
    // mesmo dia, 08:00 BRT
    next.setUTCHours(8);
  } else {
    // apos 20h: amanha 08:00 BRT
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(8);
  }
  // Volta da timezone fake pra epoch real
  return next.getTime() - BRT_OFFSET_MS - nowMs;
}
