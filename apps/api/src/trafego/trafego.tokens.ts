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
