/**
 * Tokens DI do modulo de trafego.
 *
 * EXISTE EM ARQUIVO SEPARADO (nao em trafego.module.ts) pra evitar
 * CIRCULAR IMPORT: se a constant fica no module e o controller importa
 * dela, e o module importa o controller, o decorator @Inject(TOKEN) do
 * controller eh avaliado quando o module ainda nao terminou de carregar
 * → TOKEN === undefined em runtime → NestJS falha com
 * "UndefinedDependencyException".
 *
 * Bug introduzido em commit 073a297 (sync mutate) e detectado pela IA
 * da VPS em deploy 2026-05-17. Resolvido extraindo tokens pra arquivo
 * dedicado sem nenhum outro import.
 */

/**
 * Token DI pra QueueEvents da fila trafego-mutate. Singleton instance
 * usada pelo TrafegoController pra aguardar resultado real do worker
 * via job.waitUntilFinished — sem isso o controller retornaria ok:true
 * imediatamente sem ver o resultado real.
 */
export const TRAFEGO_MUTATE_QUEUE_EVENTS = 'TRAFEGO_MUTATE_QUEUE_EVENTS';

/**
 * Token DI pra QueueEvents da fila trafego-enhanced-conv. Usada pelo
 * endpoint trigger manual de upload Enhanced Conversions for Leads
 * (Sprint 1.5, 2026-05-17). QueueEvents eh per-queue — nao pode reusar
 * o de mutate.
 */
export const TRAFEGO_ENHANCED_CONV_QUEUE_EVENTS =
  'TRAFEGO_ENHANCED_CONV_QUEUE_EVENTS';

/**
 * Token DI pra QueueEvents da fila trafego-read. Usada pelos endpoints
 * de leitura live no Google Ads (call history, billing status, etc) que
 * enfileiram um job + aguardam resultado (Sprint 4, 2026-05-17).
 *
 * Read live precisa do GoogleAdsClientService que so existe no worker
 * module. Pra evitar refactor maior (ou duplicacao do client), API
 * delega via queue.
 */
export const TRAFEGO_READ_QUEUE_EVENTS = 'TRAFEGO_READ_QUEUE_EVENTS';
