import { Logger } from '@nestjs/common';
import type { ToolHandler, ToolContext } from '../tool-executor';
import { checkSaveMemoryCap, requireTenant } from './tool-guards.util';

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

    // Bug fix 2026-05-11 (Skills PR1 #C9 — CRITICO):
    // Cap de 5 save_memory por conversa em 5min. Antes: IA confusa
    // (ou prompt-injectada) podia chamar 20+ vezes — cada chamada gera
    // embedding ($0.0001 × OpenAI rate limit). Em loop, drena cota.
    const cap = checkSaveMemoryCap(context.conversationId);
    if (!cap.ok) {
      this.logger.warn(
        `[save_memory] Cap atingido pra conversa ${context.conversationId} ` +
        `(5 chamadas em 5min). Aborta.`,
      );
      return {
        success: false,
        error: 'Limite de save_memory por conversa atingido (5 em 5min). ' +
          'Foque em responder o cliente — voce ja salvou bastante.',
      };
    }

    let tenantId: string;
    try {
      tenantId = requireTenant(context);
    } catch (e: any) {
      return { success: false, error: e.message };
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

    // Bug 9 fix: dedup ANTES de inserir.
    // Antes a IA podia chamar save_memory 10x na mesma conversa com fato
    // similar — todas eram inseridas e so o cron 03h limpava. Resultado:
    // base poluida durante o dia, regen incremental processava duplicatas.
    // Agora: se ja existe memoria similar (cosine >= 0.92), retorna ok
    // sem inserir.
    if (embeddingVector) {
      try {
        const dup = (await context.prisma.$queryRawUnsafe(
          `SELECT id, content, 1 - (embedding <=> $1::vector) AS sim
           FROM "Memory"
           WHERE tenant_id = $2
             AND scope = $3
             AND scope_id = $4
             AND status = 'active'
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT 1`,
          embedding.toVectorLiteral(embeddingVector),
          tenantId,
          scope,
          scopeId,
        )) as Array<{ id: string; content: string; sim: number }>;
        if (dup.length > 0 && Number(dup[0].sim) >= 0.92) {
          this.logger.log(
            `[save_memory] Dedup: memoria similar ja existe (sim=${Number(dup[0].sim).toFixed(3)}) — ignorando insert. Existente: "${dup[0].content.slice(0, 60)}"`,
          );
          return {
            success: true,
            already_exists: true,
            message: 'Fato similar ja registrado na memoria — sem necessidade de duplicar.',
          };
        }
      } catch (e: any) {
        this.logger.warn(`[save_memory] Falha em dedup check (${e.message}) — prosseguindo com insert`);
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
