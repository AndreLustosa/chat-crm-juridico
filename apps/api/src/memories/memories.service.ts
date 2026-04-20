import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  DEFAULT_ORG_PROFILE_INCREMENTAL_PROMPT,
  DEFAULT_ORG_PROFILE_REBUILD_PROMPT,
  DEFAULT_ORG_MODEL,
  AVAILABLE_ORG_MODELS,
} from './memory-prompts-defaults';
import { applyMemoryVarsMigration } from './skill-migration.util';
import { cleanHardcodedOrgInfo } from './skill-cleanup.util';

const ORG_PROFILE_DEBOUNCE_MS = 60_000; // 60s — evita regenerar a cada edit

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
    @InjectQueue('memory-jobs') private readonly memoryQueue: Queue,
  ) {}

  /**
   * Enfileira regeneracao debounced do OrganizationProfile apos CRUD.
   * Usa jobId com minuto truncado: varias edicoes em 60s resultam no mesmo
   * jobId (BullMQ deduplica e mantem so o primeiro).
   */
  private async triggerOrgProfileRegen(tenantId: string, reason: string) {
    try {
      const bucket = Math.floor(Date.now() / ORG_PROFILE_DEBOUNCE_MS);
      const jobId = `org-profile-${tenantId}-${bucket}`;
      await this.memoryQueue.add(
        'consolidate-org-profile',
        { tenant_id: tenantId, reason },
        {
          jobId,
          delay: ORG_PROFILE_DEBOUNCE_MS,
          removeOnComplete: true,
          attempts: 2,
        },
      );
    } catch (e: any) {
      // Nao bloqueia o CRUD se a fila falhar
      this.logger.warn(`[OrgProfile] Falha ao enfileirar regen: ${e.message}`);
    }
  }

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
    await this.triggerOrgProfileRegen(tenantId, 'create-org');
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
    if (existing.scope === 'organization') {
      await this.triggerOrgProfileRegen(tenantId, 'update-org');
    }
    return { success: true };
  }

  async deleteMemory(id: string, tenantId: string) {
    const existing = await this.prisma.memory.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException('Memoria nao encontrada');
    await this.prisma.memory.delete({ where: { id } });
    if (existing.scope === 'organization') {
      await this.triggerOrgProfileRegen(tenantId, 'delete-org');
    }
    return { success: true };
  }

  // ─── Organization Profile (consolidado em prosa) ─────────

  async getOrganizationProfile(tenantId: string) {
    if (!tenantId) return null;
    const profile = await this.prisma.organizationProfile.findUnique({
      where: { tenant_id: tenantId },
    });
    return profile || null;
  }

  /**
   * Regen INCREMENTAL imediata (modo padrao).
   * Se houver edicao manual, limpa o flag primeiro — admin abdicou dela ao
   * clicar "Regenerar". Atualizacao cirurgica: LLM recebe summary + mudancas
   * desde a ultima incorporacao.
   */
  async regenerateOrganizationProfile(tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenant_id obrigatorio');
    await this.prisma.organizationProfile.updateMany({
      where: { tenant_id: tenantId, manually_edited_at: { not: null } },
      data: { manually_edited_at: null },
    });
    const jobId = `org-profile-force-${tenantId}-${Date.now()}`;
    await this.memoryQueue.add(
      'consolidate-org-profile',
      { tenant_id: tenantId, reason: 'manual-force' },
      { jobId, removeOnComplete: true, attempts: 2 },
    );
    return { success: true, job_id: jobId, mode: 'incremental' };
  }

  /**
   * Refazer do ZERO — descarta summary atual e regenera a partir de todas
   * as memorias ativas. Usado pelo botao "Refazer do zero" (operacao cara
   * e irreversivel — perde qualquer edicao manual e o texto atual).
   */
  async rebuildOrganizationProfile(tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenant_id obrigatorio');
    await this.prisma.organizationProfile.updateMany({
      where: { tenant_id: tenantId, manually_edited_at: { not: null } },
      data: { manually_edited_at: null },
    });
    const jobId = `org-profile-rebuild-${tenantId}-${Date.now()}`;
    await this.memoryQueue.add(
      'rebuild-org-profile',
      { tenant_id: tenantId, reason: 'manual-rebuild' },
      { jobId, removeOnComplete: true, attempts: 2 },
    );
    return { success: true, job_id: jobId, mode: 'from-scratch' };
  }

  /**
   * Atualiza o texto do OrganizationProfile manualmente (edicao do admin).
   * Marca `manually_edited_at` para proteger contra sobrescrita pelo cron.
   */
  async updateOrganizationProfileSummary(tenantId: string, summary: string) {
    if (!tenantId) throw new BadRequestException('tenant_id obrigatorio');
    const clean = (summary || '').trim();
    if (clean.length < 50) {
      throw new BadRequestException('Resumo muito curto (min. 50 caracteres)');
    }
    if (clean.length > 10000) {
      throw new BadRequestException('Resumo muito longo (max. 10.000 caracteres)');
    }
    const existing = await this.prisma.organizationProfile.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Perfil ainda nao foi gerado — use "Regenerar" primeiro');
    }
    const updated = await this.prisma.organizationProfile.update({
      where: { tenant_id: tenantId },
      data: {
        summary: clean,
        version: { increment: 1 },
        generated_at: new Date(),
        manually_edited_at: new Date(),
      },
    });
    return updated;
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

  // ─── Configuracoes do OrganizationProfile (prompt + modelo) ──────

  /**
   * Le configuracoes atuais do pipeline de consolidacao do OrgProfile.
   * Retorna valores customizados (se admin editou via UI) + defaults (sempre
   * expostos para o frontend mostrar "restaurar padrao").
   *
   * Keys GlobalSetting:
   *   - MEMORY_ORG_MODEL: modelo usado (ex: gpt-4.1). Fallback: MEMORY_EXTRACTION_MODEL
   *   - MEMORY_ORG_INCREMENTAL_PROMPT: prompt da atualizacao incremental
   *   - MEMORY_ORG_REBUILD_PROMPT: prompt do "Refazer do zero"
   */
  async getOrganizationProfileSettings() {
    const [modelPrimary, modelLegacy, customIncremental, customRebuild] =
      await Promise.all([
        this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_MODEL' } }),
        this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_EXTRACTION_MODEL' } }),
        this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_INCREMENTAL_PROMPT' } }),
        this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_REBUILD_PROMPT' } }),
      ]);

    return {
      model: modelPrimary?.value || modelLegacy?.value || DEFAULT_ORG_MODEL,
      model_default: DEFAULT_ORG_MODEL,
      available_models: AVAILABLE_ORG_MODELS,
      incremental_prompt: customIncremental?.value || '',
      incremental_prompt_default: DEFAULT_ORG_PROFILE_INCREMENTAL_PROMPT,
      incremental_is_custom: !!(customIncremental?.value && customIncremental.value.trim()),
      rebuild_prompt: customRebuild?.value || '',
      rebuild_prompt_default: DEFAULT_ORG_PROFILE_REBUILD_PROMPT,
      rebuild_is_custom: !!(customRebuild?.value && customRebuild.value.trim()),
    };
  }

  /**
   * Remove linhas hardcoded do corpo das skills que duplicam dados institucionais
   * agora providos pela variavel {{office_memories}} (numeros oficiais e endereco).
   *
   * @param dryRun Se true (default), apenas mostra o que SERIA removido sem aplicar.
   */
  async cleanSkillHardcodedOrgInfo(dryRun = true) {
    const skills = await (this.prisma as any).promptSkill.findMany({
      select: { id: true, name: true, area: true, system_prompt: true, active: true },
      orderBy: { order: 'asc' },
    });

    const report: Array<{
      id: string;
      name: string;
      area: string;
      active: boolean;
      changed: boolean;
      chars_removed: number;
      matches: Array<{ rule: string; matched_text: string; line_number: number }>;
      old_length: number;
      new_length: number;
      applied: boolean;
    }> = [];

    for (const skill of skills) {
      const result = cleanHardcodedOrgInfo(skill.system_prompt || '');
      const entry = {
        id: skill.id,
        name: skill.name,
        area: skill.area,
        active: skill.active,
        changed: result.changed,
        chars_removed: result.chars_removed,
        matches: result.matches,
        old_length: (skill.system_prompt || '').length,
        new_length: result.updated.length,
        applied: false,
      };
      if (result.changed && !dryRun) {
        await (this.prisma as any).promptSkill.update({
          where: { id: skill.id },
          data: { system_prompt: result.updated },
        });
        entry.applied = true;
      }
      report.push(entry);
    }

    const summary = {
      dry_run: dryRun,
      total_skills: skills.length,
      would_change: report.filter((r) => r.changed).length,
      applied_changes: report.filter((r) => r.applied).length,
      total_chars_removed: report.reduce((sum, r) => sum + (r.applied ? r.chars_removed : 0), 0),
    };

    return { summary, report };
  }

  /**
   * Migra skills ativas: injeta o bloco de variaveis de memoria no topo do
   * system_prompt de cada skill que ainda nao as use. Idempotente e seguro —
   * so ADICIONA o header, nao toca no corpo.
   *
   * Retorna lista de skills processadas com flag `changed`.
   */
  async migrateSkillsToMemoryVars() {
    const skills = await (this.prisma as any).promptSkill.findMany({
      select: { id: true, name: true, area: true, system_prompt: true, active: true },
      orderBy: { order: 'asc' },
    });

    const report: Array<{
      id: string;
      name: string;
      area: string;
      active: boolean;
      changed: boolean;
      reason: string;
      old_length: number;
      new_length: number;
    }> = [];

    for (const skill of skills) {
      const result = applyMemoryVarsMigration(skill.system_prompt || '');
      const entry = {
        id: skill.id,
        name: skill.name,
        area: skill.area,
        active: skill.active,
        changed: result.changed,
        reason: result.reason || 'unknown',
        old_length: (skill.system_prompt || '').length,
        new_length: result.updated.length,
      };
      if (result.changed) {
        await (this.prisma as any).promptSkill.update({
          where: { id: skill.id },
          data: { system_prompt: result.updated },
        });
      }
      report.push(entry);
    }

    const summary = {
      total_skills: skills.length,
      migrated: report.filter((r) => r.changed).length,
      already_migrated: report.filter((r) => r.reason === 'already_migrated').length,
    };

    return { summary, report };
  }

  /**
   * Atualiza configuracoes do pipeline. Cada campo e opcional.
   * Passar string vazia em *_prompt equivale a "restaurar padrao" (apaga a key).
   */
  async updateOrganizationProfileSettings(body: {
    model?: string;
    incremental_prompt?: string;
    rebuild_prompt?: string;
  }) {
    const ops: Promise<any>[] = [];

    if (typeof body.model === 'string') {
      const m = body.model.trim();
      if (!m) throw new BadRequestException('model nao pode ser vazio');
      const isValid = AVAILABLE_ORG_MODELS.some((opt) => opt.value === m);
      if (!isValid) {
        throw new BadRequestException(
          `modelo invalido. Opcoes: ${AVAILABLE_ORG_MODELS.map((o) => o.value).join(', ')}`,
        );
      }
      ops.push(
        this.prisma.globalSetting.upsert({
          where: { key: 'MEMORY_ORG_MODEL' },
          create: { key: 'MEMORY_ORG_MODEL', value: m },
          update: { value: m },
        }),
      );
    }

    if (typeof body.incremental_prompt === 'string') {
      const p = body.incremental_prompt.trim();
      if (p === '') {
        // Restaurar padrao — apaga a key
        ops.push(
          this.prisma.globalSetting.deleteMany({ where: { key: 'MEMORY_ORG_INCREMENTAL_PROMPT' } }),
        );
      } else {
        if (p.length < 100) {
          throw new BadRequestException('incremental_prompt muito curto (min. 100 chars)');
        }
        ops.push(
          this.prisma.globalSetting.upsert({
            where: { key: 'MEMORY_ORG_INCREMENTAL_PROMPT' },
            create: { key: 'MEMORY_ORG_INCREMENTAL_PROMPT', value: p },
            update: { value: p },
          }),
        );
      }
    }

    if (typeof body.rebuild_prompt === 'string') {
      const p = body.rebuild_prompt.trim();
      if (p === '') {
        ops.push(
          this.prisma.globalSetting.deleteMany({ where: { key: 'MEMORY_ORG_REBUILD_PROMPT' } }),
        );
      } else {
        if (p.length < 100) {
          throw new BadRequestException('rebuild_prompt muito curto (min. 100 chars)');
        }
        ops.push(
          this.prisma.globalSetting.upsert({
            where: { key: 'MEMORY_ORG_REBUILD_PROMPT' },
            create: { key: 'MEMORY_ORG_REBUILD_PROMPT', value: p },
            update: { value: p },
          }),
        );
      }
    }

    await Promise.all(ops);
    return this.getOrganizationProfileSettings();
  }
}
