import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * Pesquisa nos documentos de referência (SkillAsset) da skill atual.
 * Útil para recuperar trechos relevantes de legislação, jurisprudência, etc.
 */
export class SearchReferencesHandler implements ToolHandler {
  name = 'search_references';

  async execute(
    params: { query: string; max_results?: number },
    context: ToolContext,
  ): Promise<any> {
    const references = (context.skillAssets || []).filter(
      (a: any) => a.asset_type === 'reference' && a.content_text,
    );

    if (references.length === 0) {
      return { found: false, message: 'Nenhum documento de referência disponível para esta skill.' };
    }

    const query = (params.query || '').toLowerCase();
    const maxResults = params.max_results ?? 3;

    // Simple keyword scoring: count how many query words appear in the content
    const words = query.split(/\s+/).filter(Boolean);

    const scored = references.map((ref: any) => {
      const text: string = (ref.content_text || '').toLowerCase();
      const score = words.reduce((acc: number, w: string) => {
        const count = (text.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        return acc + count;
      }, 0);

      // Extract a relevant snippet around the best matching word
      let snippet = '';
      for (const w of words) {
        const idx = text.indexOf(w);
        if (idx >= 0) {
          const start = Math.max(0, idx - 100);
          const end = Math.min(text.length, idx + 300);
          snippet = ref.content_text.slice(start, end);
          break;
        }
      }

      return { name: ref.name, score, snippet: snippet || ref.content_text.slice(0, 300) };
    });

    const results = scored
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, maxResults);

    if (results.length === 0) {
      return {
        found: false,
        message: `Nenhum resultado encontrado para "${params.query}" nos documentos de referência.`,
      };
    }

    return {
      found: true,
      query: params.query,
      results: results.map((r: any) => ({ document: r.name, excerpt: r.snippet })),
    };
  }
}
