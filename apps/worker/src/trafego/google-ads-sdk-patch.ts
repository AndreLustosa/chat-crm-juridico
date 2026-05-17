/**
 * Monkey patch do SDK google-ads-api v23.x para corrigir bug no
 * `recursiveFieldMaskSearch` que descende em oneof fields vazios (ex:
 * `{ maximize_conversions: {} }`) sem adicionar o parent path no
 * update_mask. Resultado pre-patch: mutate retorna SUCCESS mas Google
 * ignora silenciosamente — no-op real.
 *
 * Caso reproduzivel (achado em 2026-05-17):
 *   - traffic_update_campaign_bidding_strategy mudando de TARGET_SPEND
 *     pra MAXIMIZE_CONVERSIONS NUNCA aplicava no Google Ads, apesar do
 *     status SUCCESS em TrafficMutateLog. Sintoma persistia em retries
 *     mesmo apos adicionar bidding_strategy_type explicito no payload.
 *   - Causa raiz no SDK: `for (const key of Object.keys(data))` descende
 *     em value={}, recursiveCall retorna [], for child of children nao
 *     executa, `continue` pula o `paths.push(fieldKey)`. Mask gerado sem
 *     "maximize_conversions" path. Google interpreta como "nada pra
 *     atualizar" → no-op.
 *
 * Fix: adicionar `paths.push(fieldKey)` quando filho vazio. Esse fix eh
 * MAIS PERMISSIVO que o original — so adiciona path em casos em que o
 * SDK pulava. Casos que ja funcionavam (campos scalares, objects com
 * filhos populados) continuam identicos.
 *
 * Aplicar via import no main.ts (antes de qualquer instancia do SDK).
 * Idempotente — patch checa flag pra nao re-aplicar.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const utils = require('google-ads-api/build/src/utils');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const protos = require('google-ads-api/build/src/protos');

declare const console: { log: (...args: unknown[]) => void };

const PATCH_FLAG = Symbol.for('@andre/google-ads-api-fieldmask-patch');

if (!(utils as any)[PATCH_FLAG]) {
  const toSnakeCase = utils.toSnakeCase as (s: string) => string;

  /**
   * Versao corrigida: quando children.length === 0 (objeto vazio ou so
   * com chaves filtradas como "resourceName"), adiciona o parent path
   * em vez de pular silenciosamente.
   */
  function recursiveFieldMaskSearchFixed(data: Record<string, unknown>): string[] {
    const paths: string[] = [];
    for (const key of Object.keys(data)) {
      if (key === 'resourceName') continue;
      const fieldKey = toSnakeCase(key);
      const value = (data as any)[key];
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        const children = recursiveFieldMaskSearchFixed(value);
        if (children.length === 0) {
          // FIX: oneof empty object (ex: maximize_conversions: {}) precisa
          // do parent path no mask, senao Google ignora o update.
          paths.push(fieldKey);
        } else {
          for (const child of children) {
            paths.push(`${fieldKey}.${child}`);
          }
        }
        continue;
      }
      paths.push(fieldKey);
    }
    return paths;
  }

  function getFieldMaskFixed(data: Record<string, unknown>) {
    const paths = recursiveFieldMaskSearchFixed(data);
    return new protos.protobuf.FieldMask({ paths });
  }

  (utils as any).recursiveFieldMaskSearch = recursiveFieldMaskSearchFixed;
  (utils as any).getFieldMask = getFieldMaskFixed;
  (utils as any)[PATCH_FLAG] = true;

  // Log unico de inicializacao — fica visivel nos logs do worker pra
  // saber que o patch carregou. Stripped em prod se LOG_LEVEL baixo.
  // eslint-disable-next-line no-console
  console.log(
    '[google-ads-sdk-patch] recursiveFieldMaskSearch + getFieldMask substituidos por versoes que tratam oneof empty objects',
  );
}

export {}; // marker pra TS reconhecer como module
