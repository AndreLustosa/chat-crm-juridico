import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ORG_PROFILE_CONSOLIDATION_PROMPT } from './memory-prompts';

const MIN_CONFIDENCE_FOR_INCLUSION = 0.6;

/**
 * OrgProfileConsolidationProcessor
 * ─────────────────────────────────
 * Consolida as memorias organizacionais de cada tenant em um UNICO resumo
 * coeso em prosa (OrganizationProfile.summary), substituindo a injecao crua
 * das 86+ memorias atomicas no system prompt da IA.
 *
 * Invocacao:
 *   - Cron diario 02:00 America/Maceio (apos dedup das 03h seria... espera,
 *     roda ANTES da dedup para aproveitar batch da meia-noite e ter perfil
 *     fresco no dia seguinte). Na real: 02h roda consolidacao, 03h roda dedup.
 *   - Sob demanda via API (POST /memories/organization/regenerate-profile)
 *     com jobId debounced para nao regenerar a cada edicao
 *   - Apos create/update/delete de memoria organizacional (debounce 60s)
 *
 * Custo estimado: ~$0.04 por tenant por regeneracao (GPT-4.1, ~500 tokens saida).
 */
@Injectable()
export class OrgProfileConsolidationProcessor {
  private readonly logger = new Logger(OrgProfileConsolidationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // ─── Cron: roda diariamente as 02h ────────────────────────

  @Cron('0 2 * * *', { timeZone: 'America/Maceio' })
  async scheduleDailyConsolidation() {
    const enabled = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_BATCH_ENABLED' },
    });
    if ((enabled?.value ?? 'true').toLowerCase() === 'false') return;

    await this.consolidateAll();
  }

  /**
   * Consolida o perfil organizacional de TODOS os tenants ativos.
   * Pula tenants com edicao manual (manually_edited_at IS NOT NULL) — nesses
   * casos, so regenera se admin clicar "Regenerar" explicitamente (que limpa
   * o flag via API).
   */
  async consolidateAll(): Promise<{ tenants: number; skipped: number }> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    const manuallyEdited = await this.prisma.organizationProfile.findMany({
      where: { manually_edited_at: { not: null } },
      select: { tenant_id: true },
    });
    const skipSet = new Set(manuallyEdited.map((p) => p.tenant_id));

    let processed = 0;
    let skipped = 0;
    for (const t of tenants) {
      if (skipSet.has(t.id)) {
        skipped++;
        this.logger.log(`[OrgProfileConsolidation] Tenant ${t.id}: pulado (editado manualmente)`);
        continue;
      }
      try {
        await this.consolidateProfile(t.id);
        processed++;
      } catch (e: any) {
        this.logger.warn(
          `[OrgProfileConsolidation] Falha tenant ${t.id}: ${e.message}`,
        );
      }
    }
    this.logger.log(
      `[OrgProfileConsolidation] ${processed}/${tenants.length} perfis regenerados (${skipped} com edicao manual, pulados)`,
    );
    return { tenants: processed, skipped };
  }

  async consolidateSingle(job: Job): Promise<{ ok: boolean }> {
    const { tenant_id } = job.data as { tenant_id: string };
    await this.consolidateProfile(tenant_id);
    return { ok: true };
  }

  /**
   * Regenera o OrganizationProfile de um tenant a partir das memorias
   * organizacionais ativas com confidence >= MIN_CONFIDENCE_FOR_INCLUSION.
   */
  async consolidateProfile(tenantId: string): Promise<void> {
    const memories = await this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: 'active',
        confidence: { gte: MIN_CONFIDENCE_FOR_INCLUSION },
      },
      orderBy: [{ subcategory: 'asc' }, { confidence: 'desc' }],
      select: { id: true, content: true, subcategory: true, confidence: true },
    });

    if (memories.length === 0) {
      this.logger.log(`[OrgProfileConsolidation] Tenant ${tenantId}: sem memorias org, pulando`);
      return;
    }

    const payload = {
      tenant_id: tenantId,
      memory_count: memories.length,
      memories: memories.map((m) => ({
        content: m.content,
        subcategory: m.subcategory,
        confidence: m.confidence,
      })),
    };

    const result = await this.callLLM(payload);
    if (!result) return;

    await this.prisma.organizationProfile.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        summary: result.summary,
        facts: result.facts,
        source_memory_count: memories.length,
        version: 1,
      },
      update: {
        summary: result.summary,
        facts: result.facts,
        source_memory_count: memories.length,
        version: { increment: 1 },
        generated_at: new Date(),
      },
    });

    this.logger.log(
      `[OrgProfileConsolidation] Tenant ${tenantId}: ${memories.length} memorias → ${result.summary.length} chars`,
    );
  }

  private async callLLM(payload: any): Promise<{ summary: string; facts: any } | null> {
    const apiKey = await this.settings.getOpenAiKey();
    if (!apiKey) {
      this.logger.warn('[OrgProfileConsolidation] OPENAI_API_KEY ausente');
      return null;
    }
    const modelRow = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_EXTRACTION_MODEL' },
    });
    const model = modelRow?.value || 'gpt-4.1';

    const client = new OpenAI({ apiKey });
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: ORG_PROFILE_CONSOLIDATION_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 2500,
        temperature: 0.3,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content);
      if (!parsed.summary || typeof parsed.summary !== 'string') return null;
      return { summary: parsed.summary, facts: parsed.facts ?? {} };
    } catch (e: any) {
      this.logger.error(`[OrgProfileConsolidation] LLM erro: ${e.message}`);
      return null;
    }
  }
}
