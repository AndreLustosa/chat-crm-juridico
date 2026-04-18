import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

export interface MemoryHit {
  id: string;
  content: string;
  type: string;
  subcategory: string | null;
  confidence: number;
  created_at: Date;
  similarity: number;
}

export interface MessageHit {
  id: string;
  text: string | null;
  direction: string;
  type: string;
  created_at: Date;
}

/**
 * MemoryRetrievalService
 * ──────────────────────
 * Busca semantica em memorias (pgvector + cosine similarity) e fulltext
 * em mensagens historicas. Usado por:
 *   - Tool `search_memory` no tool-executor (IA acessa sob demanda)
 *   - prompt-builder (injeta memorias recentes ja conhecidas sem busca)
 */
@Injectable()
export class MemoryRetrievalService {
  private readonly logger = new Logger(MemoryRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /** Busca memorias por similaridade semantica (cosine). */
  async searchMemories(params: {
    tenant_id: string;
    scope: 'lead' | 'organization';
    scope_id: string;
    query: string;
    limit?: number;
    min_similarity?: number;
  }): Promise<MemoryHit[]> {
    const { tenant_id, scope, scope_id, query } = params;
    const limit = params.limit ?? 5;
    const minSim = params.min_similarity ?? 0.7;

    const queryEmbedding = await this.embedding.generate(query);
    const vec = this.embedding.toVectorLiteral(queryEmbedding);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, content, type, subcategory, confidence, created_at,
             1 - (embedding <=> $1::vector) AS similarity
      FROM "Memory"
      WHERE tenant_id = $2
        AND scope = $3
        AND scope_id = $4
        AND status = 'active'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $5
      `,
      vec,
      tenant_id,
      scope,
      scope_id,
      limit,
    );

    const filtered = rows.filter((r) => Number(r.similarity) >= minSim);

    if (filtered.length > 0) {
      const ids = filtered.map((r) => r.id);
      await this.prisma.$executeRawUnsafe(
        `UPDATE "Memory" SET access_count = access_count + 1, last_accessed = NOW() WHERE id = ANY($1::uuid[])`,
        ids,
      );
    }

    return filtered.map((r) => ({
      id: r.id,
      content: r.content,
      type: r.type,
      subcategory: r.subcategory,
      confidence: Number(r.confidence),
      created_at: r.created_at,
      similarity: Number(r.similarity),
    }));
  }

  /** Busca fulltext em mensagens historicas do lead. */
  async searchMessages(params: {
    tenant_id: string;
    lead_id: string;
    query: string;
    limit?: number;
  }): Promise<MessageHit[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversation: {
          lead_id: params.lead_id,
          tenant_id: params.tenant_id,
        },
        text: { contains: params.query, mode: 'insensitive' },
      },
      orderBy: { created_at: 'desc' },
      take: params.limit ?? 10,
      select: {
        id: true,
        text: true,
        direction: true,
        type: true,
        created_at: true,
      },
    });
    return rows as MessageHit[];
  }

  /** Detecta duplicata antes de inserir nova memoria. Retorna memoria similar ou null. */
  async findDuplicate(params: {
    tenant_id: string;
    scope: 'lead' | 'organization';
    scope_id: string;
    content: string;
    embedding: number[];
    threshold?: number;
  }): Promise<{ id: string; content: string } | null> {
    const threshold = params.threshold ?? 0.9;
    const vec = this.embedding.toVectorLiteral(params.embedding);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
      FROM "Memory"
      WHERE tenant_id = $2
        AND scope = $3
        AND scope_id = $4
        AND status = 'active'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 1
      `,
      vec,
      params.tenant_id,
      params.scope,
      params.scope_id,
    );
    if (rows.length === 0) return null;
    if (Number(rows[0].similarity) < threshold) return null;
    return { id: rows[0].id, content: rows[0].content };
  }

  /** Busca memorias organizacionais agrupadas por subcategoria — usado no prompt-builder. */
  async getOrganizationMemories(tenantId: string) {
    return this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: 'active',
      },
      orderBy: [{ subcategory: 'asc' }, { confidence: 'desc' }],
    });
  }

  /** Memorias episodicas recentes do lead — injetadas no prompt. */
  async getRecentEpisodicMemories(tenantId: string, leadId: string, limit = 5) {
    return this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'lead',
        scope_id: leadId,
        status: 'active',
        type: 'episodic',
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }
}
