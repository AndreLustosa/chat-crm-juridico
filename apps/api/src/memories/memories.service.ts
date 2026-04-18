import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const VALID_ORG_SUBCATEGORIES = new Set([
  'office_info',
  'team',
  'fees',
  'procedures',
  'court_info',
  'legal_knowledge',
  'contacts',
  'rules',
]);

const DUPLICATE_THRESHOLD = 0.9;

/**
 * MemoriesService (API)
 * ─────────────────────
 * CRUD de memorias (lead + organization) e LeadProfile.
 * Usa o mesmo modelo de embedding do worker (text-embedding-3-small).
 *
 * Nota: para manualmente disparar a extracao batch, dispomos de um endpoint
 * que enfileira um job na queue 'memory-jobs' (consumida pelo worker).
 */
@Injectable()
export class MemoriesService {
  private readonly logger = new Logger(MemoriesService.name);
  private openaiClient: OpenAI | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async getOpenAI(): Promise<OpenAI> {
    if (this.openaiClient) return this.openaiClient;
    const key = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY || null;
    if (!key) throw new BadRequestException('OPENAI_API_KEY nao configurado nas settings');
    this.openaiClient = new OpenAI({ apiKey: key });
    return this.openaiClient;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const client = await this.getOpenAI();
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536,
    });
    return response.data[0].embedding;
  }

  private toVectorLiteral(emb: number[]): string {
    return `[${emb.join(',')}]`;
  }

  private async findDuplicate(params: {
    tenantId: string;
    scope: 'lead' | 'organization';
    scopeId: string;
    embedding: number[];
  }): Promise<{ id: string; content: string } | null> {
    const vec = this.toVectorLiteral(params.embedding);
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
      params.tenantId,
      params.scope,
      params.scopeId,
    );
    if (rows.length === 0) return null;
    if (Number(rows[0].similarity) < DUPLICATE_THRESHOLD) return null;
    return { id: rows[0].id, content: rows[0].content };
  }

  // ─── Organization memories ────────────────────────────────

  async listOrganization(tenantId: string) {
    if (!tenantId) return { groups: {}, total: 0 };
    const memories = await this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: 'active',
      },
      orderBy: [{ subcategory: 'asc' }, { created_at: 'desc' }],
      select: {
        id: true,
        content: true,
        subcategory: true,
        confidence: true,
        source_type: true,
        created_at: true,
        updated_at: true,
      },
    });

    const groups: Record<string, typeof memories> = {};
    for (const m of memories) {
      const key = m.subcategory || 'geral';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }

    return { groups, total: memories.length };
  }

  async createOrganization(tenantId: string, body: { content: string; subcategory: string; confidence?: number }) {
    if (!tenantId) throw new BadRequestException('tenant_id obrigatorio');
    const content = (body.content || '').trim();
    if (content.length < 5) throw new BadRequestException('content muito curto');
    const subcategory = (body.subcategory || '').trim();
    if (!VALID_ORG_SUBCATEGORIES.has(subcategory)) {
      throw new BadRequestException(`subcategory invalida. Opcoes: ${[...VALID_ORG_SUBCATEGORIES].join(', ')}`);
    }

    const embedding = await this.generateEmbedding(content);
    const dup = await this.findDuplicate({
      tenantId,
      scope: 'organization',
      scopeId: tenantId,
      embedding,
    });
    if (dup) {
      throw new ConflictException(`Ja existe memoria similar: "${dup.content}"`);
    }

    const confidence = typeof body.confidence === 'number' ? body.confidence : 1.0;
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO "Memory" (
        id, tenant_id, scope, scope_id, type, subcategory, content, embedding,
        source_type, confidence, status, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, 'organization', $1, 'semantic', $2, $3, $4::vector,
        'manual', $5, 'active', NOW(), NOW()
      )
      `,
      tenantId,
      subcategory,
      content,
      this.toVectorLiteral(embedding),
      confidence,
    );
    return { success: true };
  }

  async updateMemory(id: string, tenantId: string, body: { content?: string; subcategory?: string }) {
    const existing = await this.prisma.memory.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException('Memoria nao encontrada');

    const patch: any = { updated_at: new Date() };
    if (typeof body.content === 'string' && body.content.trim().length >= 5) {
      patch.content = body.content.trim();
    }
    if (typeof body.subcategory === 'string' && existing.scope === 'organization') {
      if (!VALID_ORG_SUBCATEGORIES.has(body.subcategory)) {
        throw new BadRequestException('subcategory invalida');
      }
      patch.subcategory = body.subcategory;
    }

    // Se content mudou, regenera embedding
    if (patch.content) {
      const emb = await this.generateEmbedding(patch.content);
      await this.prisma.$executeRawUnsafe(
        `
        UPDATE "Memory" SET
          content = $1,
          subcategory = COALESCE($2, subcategory),
          embedding = $3::vector,
          updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5
        `,
        patch.content,
        patch.subcategory ?? null,
        this.toVectorLiteral(emb),
        id,
        tenantId,
      );
    } else {
      await this.prisma.memory.update({ where: { id }, data: patch });
    }
    return { success: true };
  }

  async deleteMemory(id: string, tenantId: string) {
    const existing = await this.prisma.memory.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException('Memoria nao encontrada');
    await this.prisma.memory.delete({ where: { id } });
    return { success: true };
  }

  async getOrganizationStats(tenantId: string) {
    if (!tenantId) return { total: 0, by_subcategory: {}, last_extraction: null };
    const memories = await this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: 'active',
      },
      select: { subcategory: true, source_type: true, created_at: true },
    });

    const bySubcategory: Record<string, number> = {};
    let lastBatch: Date | null = null;
    for (const m of memories) {
      const key = m.subcategory || 'geral';
      bySubcategory[key] = (bySubcategory[key] || 0) + 1;
      if (m.source_type === 'batch' && (!lastBatch || m.created_at > lastBatch)) {
        lastBatch = m.created_at;
      }
    }
    return { total: memories.length, by_subcategory: bySubcategory, last_extraction: lastBatch };
  }

  // ─── Lead memories ────────────────────────────────────────

  async listLead(tenantId: string, leadId: string) {
    const memories = await this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'lead',
        scope_id: leadId,
        status: 'active',
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        content: true,
        type: true,
        confidence: true,
        source_type: true,
        created_at: true,
      },
    });
    return { memories, total: memories.length };
  }

  async getLeadProfile(tenantId: string, leadId: string) {
    const profile = await this.prisma.leadProfile.findFirst({
      where: { tenant_id: tenantId, lead_id: leadId },
    });
    return profile || null;
  }

  async createLeadMemory(tenantId: string, leadId: string, body: { content: string; type?: string }) {
    const content = (body.content || '').trim();
    if (content.length < 5) throw new BadRequestException('content muito curto');
    const type = body.type === 'episodic' ? 'episodic' : 'semantic';

    const embedding = await this.generateEmbedding(content);
    const dup = await this.findDuplicate({
      tenantId,
      scope: 'lead',
      scopeId: leadId,
      embedding,
    });
    if (dup) throw new ConflictException(`Ja existe memoria similar: "${dup.content}"`);

    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO "Memory" (
        id, tenant_id, scope, scope_id, type, content, embedding,
        source_type, confidence, status, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, 'lead', $2, $3, $4, $5::vector,
        'manual', 1.0, 'active', NOW(), NOW()
      )
      `,
      tenantId,
      leadId,
      type,
      content,
      this.toVectorLiteral(embedding),
    );
    return { success: true };
  }

  async deleteAllLeadMemories(tenantId: string, leadId: string) {
    const deleted = await this.prisma.memory.deleteMany({
      where: { tenant_id: tenantId, scope: 'lead', scope_id: leadId },
    });
    await this.prisma.leadProfile.deleteMany({
      where: { tenant_id: tenantId, lead_id: leadId },
    });
    return { success: true, deleted_count: deleted.count };
  }
}
