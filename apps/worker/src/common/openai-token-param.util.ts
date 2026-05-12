/**
 * openai-token-param.util.ts (worker)
 *
 * Bug fix 2026-05-12: helper pra buildar max_tokens vs max_completion_tokens
 * conforme o modelo. Modelos gen 5.x / 4.1 / o-series exigem
 * max_completion_tokens. Antigos (4o, 3.5) aceitam max_tokens.
 *
 * Espelha apps/api/src/common/utils/openai-token-param.util.ts.
 */

const NEW_MODEL_PATTERNS = [
  /^gpt-5/i,
  /^gpt-4\.1/i,
  /^o1/i,
  /^o3/i,
];

export function usesMaxCompletionTokens(model: string): boolean {
  if (!model || typeof model !== 'string') return false;
  return NEW_MODEL_PATTERNS.some((pat) => pat.test(model));
}

export function buildTokenParam(model: string, maxTokens: number): Record<string, number> {
  return usesMaxCompletionTokens(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}
