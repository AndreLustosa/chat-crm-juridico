import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  ORG_PROFILE_CONSOLIDATION_PROMPT,
  ORG_PROFILE_INCREMENTAL_PROMPT,
} from './memory-prompts';

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
   * Consolida INCREMENTALMENTE o perfil organizacional de TODOS os tenants ativos.
   * Pula tenants com edicao manual (manually_edited_at IS NOT NULL) — nesses
   * casos, so atualiza se admin clicar "Regenerar" explicitamente.
   *
   * Padrao: INCREMENTAL — LLM recebe summary atual + memorias novas/deletadas
   * desde a ultima incorporacao. Se nao houver mudancas, summary permanece igual.
   */
  async consolidateAll(): Promise<{ tenants: number; skipped: number; changed: number }> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    const manuallyEdited = await this.prisma.organizationProfile.findMany({
      where: { manually_edited_at: { not: null } },
      select: { tenant_id: true },
    });
    const skipSet = new Set(manuallyEdited.map((p) => p.tenant_id));

    let processed = 0;
    let skipped = 0;
    let changed = 0;
    for (const t of tenants) {
      if (skipSet.has(t.id)) {
        skipped++;
        this.logger.log(`[OrgProfileConsolidation] Tenant ${t.id}: pulado (editado manualmente)`);
        continue;
      }
      try {
        const result = await this.consolidateIncremental(t.id);
        processed++;
        if (result?.changed) changed++;
      } catch (e: any) {
        this.logger.warn(
          `[OrgProfileConsolidation] Falha tenant ${t.id}: ${e.message}`,
        );
      }
    }
    this.logger.log(
      `[OrgProfileConsolidation] Cron diario: ${processed}/${tenants.length} tenants processados (${changed} com mudancas, ${skipped} com edicao manual pulados)`,
    );
    return { tenants: processed, skipped, changed };
  }

  /**
   * Job incremental disparado por CRUD de memoria org ou por regen manual.
   * Usa o modo INCREMENTAL (preserva summary, so aplica mudancas).
   */
  async consolidateSingle(job: Job): Promise<{ ok: boolean }> {
    const { tenant_id } = job.data as { tenant_id: string };
    await this.consolidateIncremental(tenant_id);
    return { ok: true };
  }

  /**
   * Job "Refazer do zero" — ignora summary existente e regenera a partir
   * de TODAS as memorias ativas. Usado apenas quando admin clica explicitamente
   * em "Refazer do zero" na UI.
   */
  async rebuildFromScratch(job: Job): Promise<{ ok: boolean }> {
    const { tenant_id } = job.data as { tenant_id: string };
    await this.consolidateProfile(tenant_id);
    return { ok: true };
  }

  /**
   * INCREMENTAL: atualiza o summary existente aplicando apenas as memorias
   * criadas/deletadas desde `last_incorporated_at`. Se nao houver mudancas
   * relevantes, o summary permanece identico.
   *
   * Fallback: se nao existe OrganizationProfile ainda para este tenant,
   * delega ao consolidateProfile (from-scratch — primeira geracao).
   */
  async consolidateIncremental(tenantId: string): Promise<{ changed: boolean }> {
    const existing = await this.prisma.organizationProfile.findUnique({
      where: { tenant_id: tenantId },
    });

    // Primeira geracao ou profile zerado: from-scratch obrigatorio
    if (!existing || !existing.summary || existing.summary.trim().length < 50) {
      await this.consolidateProfile(tenantId);
      return { changed: true };
    }

    const since = existing.last_incorporated_at ?? existing.generated_at;

    // Memorias NOVAS desde a ultima incorporacao
    const newMemories = await this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: 'active',
        confidence: { gte: MIN_CONFIDENCE_FOR_INCLUSION },
        created_at: { gt: since },
      },
      orderBy: { created_at: 'asc' },
      select: { content: true, subcategory: true, confidence: true, created_at: true },
    });

    // Memorias que SAIRAM (superseded ou archived) desde a ultima incorporacao
    const deletedMemories = await this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: { in: ['superseded', 'archived'] },
        updated_at: { gt: since },
      },
      orderBy: { updated_at: 'asc' },
      select: { content: true, subcategory: true },
    });

    if (newMemories.length === 0 && deletedMemories.length === 0) {
      this.logger.log(
        `[OrgProfileConsolidation] Tenant ${tenantId}: sem mudancas desde ${since.toISOString()}, pulando`,
      );
      // Avanca o marker mesmo sem chamar LLM — evita reconsulta inutil amanha
      await this.prisma.organizationProfile.update({
        where: { tenant_id: tenantId },
        data: { last_incorporated_at: new Date() },
      });
      return { changed: false };
    }

    const payload = {
      current_summary: existing.summary,
      new_memories: newMemories.map((m) => ({
        content: m.content,
        subcategory: m.subcategory,
        confidence: m.confidence,
      })),
      deleted_memories: deletedMemories.map((m) => ({
        content: m.content,
        subcategory: m.subcategory,
      })),
    };

    const result = await this.callLLM(payload, 'incremental');
    if (!result) return { changed: false };

    // Contar total de memorias ativas atuais (para source_memory_count)
    const activeCount = await this.prisma.memory.count({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: 'active',
      },
    });

    const changed = result.summary.trim() !== existing.summary.trim();

    await this.prisma.organizationProfile.update({
      where: { tenant_id: tenantId },
      data: {
        summary: result.summary,
        facts: result.facts ?? existing.facts,
        source_memory_count: activeCount,
        version: changed ? { increment: 1 } : undefined,
        generated_at: changed ? new Date() : undefined,
        last_incorporated_at: new Date(),
      },
    });

    this.logger.log(
      `[OrgProfileConsolidation] Tenant ${tenantId}: incremental — ${newMemories.length} novas + ${deletedMemories.length} deletadas${changed ? ` → summary atualizado (${result.summary.length} chars)` : ' → sem mudanca no texto'}`,
    );

    return { changed };
  }

  /**
   * FROM-SCRATCH: regenera o OrganizationProfile do ZERO a partir de TODAS
   * as memorias organizacionais ativas com confidence >= MIN_CONFIDENCE_FOR_INCLUSION.
   *
   * Usado em:
   *   - Primeira geracao (profile nao existe)
   *   - Botao "Refazer do zero" na UI
   *   - Fallback quando incremental nao e possivel
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

    const result = await this.callLLM(payload, 'from-scratch');
    if (!result) return;

    await this.prisma.organizationProfile.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        summary: result.summary,
        facts: result.facts,
        source_memory_count: memories.length,
        version: 1,
        last_incorporated_at: new Date(),
      },
      update: {
        summary: result.summary,
        facts: result.facts,
        source_memory_count: memories.length,
        version: { increment: 1 },
        generated_at: new Date(),
        last_incorporated_at: new Date(),
        manually_edited_at: null, // rebuild explicito descarta edicao manual
      },
    });

    this.logger.log(
      `[OrgProfileConsolidation] Tenant ${tenantId}: from-scratch — ${memories.length} memorias → ${result.summary.length} chars`,
    );
  }

  /**
   * Chama o LLM com o prompt apropriado ao modo.
   * Retorna `{ summary, facts, changes_applied? }` ou null em caso de erro.
   */
  private async callLLM(
    payload: any,
    mode: 'from-scratch' | 'incremental',
  ): Promise<{ summary: string; facts: any; changes_applied?: string[] } | null> {
    const apiKey = await this.settings.getOpenAiKey();
    if (!apiKey) {
      this.logger.warn('[OrgProfileConsolidation] OPENAI_API_KEY ausente');
      return null;
    }
    const modelRow = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_EXTRACTION_MODEL' },
    });
    const model = modelRow?.value || 'gpt-4.1';
    const systemPrompt =
      mode === 'incremental'
        ? ORG_PROFILE_INCREMENTAL_PROMPT
        : ORG_PROFILE_CONSOLIDATION_PROMPT;

    const client = new OpenAI({ apiKey });
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
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
      return {
        summary: parsed.summary,
        facts: parsed.facts ?? {},
        changes_applied: Array.isArray(parsed.changes_applied) ? parsed.changes_applied : [],
      };
    } catch (e: any) {
      this.logger.error(`[OrgProfileConsolidation] LLM erro (${mode}): ${e.message}`);
      return null;
    }
  }
}
