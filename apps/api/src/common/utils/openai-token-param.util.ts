/**
 * openai-token-param.util.ts
 *
 * Bug fix 2026-05-12 (DJEN IA + outros services quebrados):
 *
 * Modelos gen 5.x (gpt-5.4, gpt-5.5), gen 4.1 e o-series (o1, o3) NAO ACEITAM
 * mais o parametro `max_tokens` — exigem `max_completion_tokens`. Tentativa
 * de usar max_tokens com esses modelos retorna 400:
 *
 *   "Unsupported parameter: 'max_tokens' is not supported with this model.
 *    Use 'max_completion_tokens' instead."
 *
 * Modelos antigos (gpt-4o, gpt-4o-mini, gpt-3.5) ainda aceitam max_tokens.
 *
 * Use este helper em TODA chamada chat.completions.create. Quando admin
 * trocar pra modelo novo via settings, nao precisa code change.
 *
 * Uso:
 *   await openai.chat.completions.create({
 *     model,
 *     ...buildTokenParam(model, 2048),  // gera { max_tokens } OU { max_completion_tokens }
 *     messages: [...],
 *   });
 */

const NEW_MODEL_PATTERNS = [
  /^gpt-5/i,         // gpt-5, gpt-5.4-*, gpt-5.5-*
  /^gpt-4\.1/i,      // gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
  /^o1/i,            // o1, o1-mini, o1-preview
  /^o3/i,            // o3, o3-mini
];

/**
 * Retorna `true` se o modelo exige `max_completion_tokens` em vez de `max_tokens`.
 */
export function usesMaxCompletionTokens(model: string): boolean {
  if (!model || typeof model !== 'string') return false;
  return NEW_MODEL_PATTERNS.some((pat) => pat.test(model));
}

/**
 * Gera o objeto correto para spread em chat.completions.create.
 * Modelos novos: { max_completion_tokens: N }
 * Modelos antigos: { max_tokens: N }
 */
export function buildTokenParam(model: string, maxTokens: number): Record<string, number> {
  return usesMaxCompletionTokens(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}
