import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PROFILE_CONSOLIDATION_PROMPT } from './memory-prompts';

/**
 * ProfileConsolidationProcessor
 * ─────────────────────────────
 * Reconsolida o LeadProfile de cada lead que ganhou memorias nas ultimas 24h.
 *
 * Invocado:
 *   - Automaticamente pelo DailyMemoryBatchProcessor (job consolidate-profiles-after-batch)
 *   - Manualmente via endpoint (job consolidate-profile) — botao "Regenerar" no frontend
 */
@Injectable()
export class ProfileConsolidationProcessor {
  private readonly logger = new Logger(ProfileConsolidationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async consolidateAfterBatch(job: Job): Promise<{ leads: number }> {
    const { tenant_id } = job.data as { tenant_id: string };

    const rows = await this.prisma.$queryRaw<{ lead_id: string }[]>`
      SELECT DISTINCT scope_id AS lead_id
      FROM "Memory"
      WHERE tenant_id = ${tenant_id}
        AND scope = 'lead'
        AND status = 'active'
        AND created_at >= NOW() - INTERVAL '24 hours'
    `;

    for (const { lead_id } of rows) {
      try {
        await this.consolidateProfile(tenant_id, lead_id);
      } catch (e: any) {
        this.logger.warn(
          `[ProfileConsolidation] Falha lead ${lead_id}: ${e.message}`,
        );
      }
    }

    // Deduplicacao das memorias do lead apos consolidar
    for (const { lead_id } of rows) {
      await this.dedupLeadMemories(tenant_id, lead_id).catch(() => {});
    }

    this.logger.log(`[ProfileConsolidation] ${rows.length} perfis reconsolidados (tenant=${tenant_id})`);
    return { leads: rows.length };
  }

  async consolidateSingle(job: Job): Promise<{ ok: boolean }> {
    const { tenant_id, lead_id } = job.data as {
      tenant_id: string;
      lead_id: string;
    };
    await this.consolidateProfile(tenant_id, lead_id);
    return { ok: true };
  }

  /** Gera/atualiza LeadProfile de 1 lead. */
  async consolidateProfile(tenantId: string, leadId: string): Promise<void> {
    const [memories, lead, existing] = await Promise.all([
      this.prisma.memory.findMany({
        where: { tenant_id: tenantId, scope: 'lead', scope_id: leadId, status: 'active' },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          conversations: {
            include: {
              messages: {
                orderBy: { created_at: 'desc' },
                take: 5,
                select: { text: true, direction: true, created_at: true },
              },
            },
            take: 3,
            orderBy: { last_message_at: 'desc' },
          },
          legal_cases: {
            where: { archived: false },
            select: {
              case_number: true,
              legal_area: true,
              stage: true,
              court: true,
              action_type: true,
            },
          },
        },
      }),
      this.prisma.leadProfile.findUnique({ where: { lead_id: leadId } }),
    ]);

    if (!lead) return;
    if (memories.length === 0 && !existing) {
      // Sem memorias e sem perfil — nao ha o que consolidar
      return;
    }

    const payload = {
      lead_data: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        is_client: lead.is_client,
        stage: lead.stage,
        tags: lead.tags,
      },
      cases: lead.legal_cases,
      memories: memories.map((m) => ({
        content: m.content,
        type: m.type,
        created_at: m.created_at,
      })),
      recent_messages: lead.conversations.flatMap((c) =>
        c.messages.map((m) => ({
          direction: m.direction,
          text: (m.text ?? '').substring(0, 200),
          date: m.created_at,
        })),
      ),
      existing_summary: existing?.summary || null,
    };

    const result = await this.callLLM(payload);
    if (!result) return;

    await this.prisma.leadProfile.upsert({
      where: { lead_id: leadId },
      create: {
        tenant_id: tenantId,
        lead_id: leadId,
        summary: result.summary,
        facts: result.facts,
        message_count: memories.length,
        version: 1,
      },
      update: {
        summary: result.summary,
        facts: result.facts,
        message_count: memories.length,
        version: { increment: 1 },
        generated_at: new Date(),
      },
    });
  }

  /** Deduplica memorias muito similares do lead (cosine > 0.95). */
  private async dedupLeadMemories(tenantId: string, leadId: string): Promise<void> {
    const duplicates = await this.prisma.$queryRaw<{ id_a: string; id_b: string }[]>`
      SELECT a.id AS id_a, b.id AS id_b
      FROM "Memory" a JOIN "Memory" b ON a.id < b.id
      WHERE a.tenant_id = ${tenantId}
        AND b.tenant_id = ${tenantId}
        AND a.scope = 'lead' AND a.scope_id = ${leadId}
        AND b.scope = 'lead' AND b.scope_id = ${leadId}
        AND a.status = 'active' AND b.status = 'active'
        AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND 1 - (a.embedding <=> b.embedding) > 0.95
    `;

    for (const dup of duplicates) {
      await this.prisma.memory.update({
        where: { id: dup.id_a },
        data: { status: 'superseded', superseded_by: dup.id_b },
      }).catch(() => {});
    }
  }

  private async callLLM(payload: any): Promise<{ summary: string; facts: any } | null> {
    const apiKey = await this.settings.getOpenAiKey();
    if (!apiKey) return null;
    const modelRow = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_EXTRACTION_MODEL' },
    });
    const model = modelRow?.value || 'gpt-4.1';

    const client = new OpenAI({ apiKey });
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: PROFILE_CONSOLIDATION_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 2048,
        temperature: 0.3,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content);
      if (!parsed.summary || typeof parsed.summary !== 'string') return null;
      return { summary: parsed.summary, facts: parsed.facts ?? {} };
    } catch (e: any) {
      this.logger.error(`[ProfileConsolidation] LLM erro: ${e.message}`);
      return null;
    }
  }
}
