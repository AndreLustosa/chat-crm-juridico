import { Logger } from '@nestjs/common';
import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * save_memory — IA salva um fato/preferencia/contexto na memoria persistente.
 *
 * Usado quando a IA detecta algo importante DURANTE a conversa que vale
 * lembrar pra proximos turnos ou proximas conversas. Analogo a humano que
 * anota mentalmente "preciso lembrar disso".
 *
 * Diferente de:
 *  - search_memory: BUSCA memorias existentes
 *  - update_lead: atualiza campos estruturados (nome, stage, area)
 *
 * save_memory eh pra fatos NAO ESTRUTURADOS:
 *  - "Lead trabalhou 5 anos como vendedor"
 *  - "Cliente prefere reunioes pela manha"
 *  - "Filho do cliente eh menor de idade, depende dela"
 *  - "Honorario inicial dessa area do escritorio eh R$300" (org)
 *
 * Mecanica:
 *  - Gera embedding na hora (via EmbeddingService)
 *  - Insere Memory entry com source_type='runtime' (vs 'batch' do cron)
 *  - Dedup nao eh feito aqui (cron 03h MemoryDedupService limpa duplicatas)
 *
 * Custo por chamada: ~$0.0001 (1 embedding ada-002 ~$0.0001/1k tokens, content
 * curto). DespreziVel comparado ao turn LLM.
 */
export class SaveMemoryHandler implements ToolHandler {
  name = 'save_memory';
  private readonly logger = new Logger(SaveMemoryHandler.name);

  async execute(
    params: {
      content: string;
      type?: 'fact' | 'preference' | 'context' | 'event';
      scope?: 'lead' | 'organization';
      subcategory?: string;
    },
    context: ToolContext & { embeddingService?: any; tenantId?: string },
  ): Promise<any> {
    const content = (params.content || '').trim();
    if (!content || content.length < 5) {
      return { success: false, error: 'content vazio ou muito curto (min 5 chars)' };
    }
    if (content.length > 500) {
      return { success: false, error: 'content longo demais (max 500 chars). Resumir em 1-2 frases.' };
    }

    const tenantId = context.tenantId;
    if (!tenantId) {
      return { success: false, error: 'tenant indisponivel' };
    }

    const scope = params.scope === 'organization' ? 'organization' : 'lead';
    const scopeId = scope === 'organization' ? tenantId : context.leadId;
    const type = params.type === 'event' || params.type === 'preference' || params.type === 'context'
      ? params.type
      : 'fact';

    // Mapping pro schema (Memory.type aceita 'semantic' | 'episodic')
    const memoryType = type === 'event' ? 'episodic' : 'semantic';

    const embedding = context.embeddingService;
    if (!embedding) {
      this.logger.warn('[save_memory] EmbeddingService indisponivel — salvando sem embedding');
    }

    let embeddingVector: number[] | null = null;
    if (embedding) {
      try {
        embeddingVector = await embedding.generate(content);
      } catch (e: any) {
        this.logger.warn(`[save_memory] Falha ao gerar embedding: ${e.message}`);
        // Continua sem embedding — memoria fica buscavel por fulltext
      }
    }

    try {
      if (embeddingVector && embedding?.toVectorLiteral) {
        await context.prisma.$executeRawUnsafe(
          `
          INSERT INTO "Memory" (
            id, tenant_id, scope, scope_id, type, subcategory, content,
            embedding, source_type, source_id, confidence, status,
            created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6,
            $7::vector, 'runtime', $8, 0.95, 'active',
            NOW(), NOW()
          )
          `,
          tenantId,
          scope,
          scopeId,
          memoryType,
          params.subcategory || null,
          content,
          embedding.toVectorLiteral(embeddingVector),
          context.conversationId,
        );
      } else {
        // Fallback sem embedding (pgvector nullable)
        await context.prisma.memory.create({
          data: {
            tenant_id: tenantId,
            scope,
            scope_id: scopeId,
            type: memoryType,
            subcategory: params.subcategory || null,
            content,
            source_type: 'runtime',
            source_id: context.conversationId,
            confidence: 0.95,
            status: 'active',
          },
        });
      }

      this.logger.log(
        `[save_memory] ${scope}/${memoryType} salvo (lead=${context.leadId}): "${content.slice(0, 80)}"`,
      );

      return {
        success: true,
        message: `Memoria salva (${scope}/${memoryType}). Sera lembrada nas proximas conversas.`,
      };
    } catch (e: any) {
      this.logger.error(`[save_memory] Falha ao inserir: ${e.message}`);
      return { success: false, error: `Falha ao salvar memoria: ${e.message}` };
    }
  }
}
