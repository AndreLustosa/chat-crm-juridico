import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * search_memory — busca semantica em memorias (lead + organizacao) e
 * fulltext em mensagens passadas do mesmo lead.
 *
 * Injetada via MemoryRetrievalService (passado em context.memoryRetrieval).
 * Se o service nao estiver disponivel, degrada graciosamente.
 */
export class SearchMemoryHandler implements ToolHandler {
  name = 'search_memory';

  async execute(
    params: { query: string },
    context: ToolContext & { memoryRetrieval?: any; tenantId?: string },
  ): Promise<any> {
    const query = (params.query || '').trim();
    if (!query) {
      return { success: false, message: 'query vazia' };
    }

    const mr = context.memoryRetrieval;
    if (!mr || !context.tenantId) {
      return {
        success: false,
        message: 'Servico de memoria indisponivel.',
      };
    }

    const [leadResults, orgResults, msgResults] = await Promise.all([
      mr
        .searchMemories({
          tenant_id: context.tenantId,
          scope: 'lead',
          scope_id: context.leadId,
          query,
          limit: 5,
        })
        .catch(() => []),
      mr
        .searchMemories({
          tenant_id: context.tenantId,
          scope: 'organization',
          scope_id: context.tenantId,
          query,
          limit: 5,
        })
        .catch(() => []),
      mr
        .searchMessages({
          tenant_id: context.tenantId,
          lead_id: context.leadId,
          query,
          limit: 5,
        })
        .catch(() => []),
    ]);

    return {
      success: true,
      found: leadResults.length > 0 || orgResults.length > 0 || msgResults.length > 0,
      lead_memories: leadResults.map((m: any) => ({
        content: m.content,
        date: m.created_at,
      })),
      office_memories: orgResults.map((m: any) => ({
        content: m.content,
        category: m.subcategory,
      })),
      messages: msgResults.map((m: any) => ({
        text: (m.text ?? '').substring(0, 300),
        from: m.direction === 'in' ? 'cliente' : 'escritorio',
        date: m.created_at,
      })),
    };
  }
}
