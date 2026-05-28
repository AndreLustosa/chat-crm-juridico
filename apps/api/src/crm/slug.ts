/**
 * Helpers de slug pra keys de Funnel e FunnelStage. As keys são imutáveis
 * depois de criadas (a IA referencia em prompts e tools), então geramos
 * automaticamente do nome no momento da criação e nunca regeneramos.
 */

/** Converte um texto em snake_case lower-case sem acentos, limite 40 chars. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (acentos)
    .replace(/[^a-z0-9]+/g, '_')        // não-alphanum → underscore
    .replace(/^_+|_+$/g, '')            // remove _ do início/fim
    .substring(0, 40);
}

/**
 * Garante slug único dentro do escopo apropriado. `checkExists` é uma função
 * que recebe um candidato e responde se ele já existe. Tenta o slug base
 * primeiro, depois `_2`, `_3`, etc. até achar disponível.
 */
export async function uniqueSlug(
  input: string,
  checkExists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(input) || 'item';
  if (!(await checkExists(base))) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}_${i}`;
    if (!(await checkExists(candidate))) return candidate;
  }
  throw new Error(`Nao foi possivel gerar slug unico pra "${input}"`);
}
