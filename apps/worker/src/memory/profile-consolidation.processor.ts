import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PROFILE_CONSOLIDATION_PROMPT, NARRATIVE_FACTS_PROMPT } from './memory-prompts';

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

  /**
   * Gera/atualiza LeadProfile de 1 lead.
   *
   * Fontes consideradas (em ordem de prioridade):
   *   1. Memory entries (scope=lead) — sistema novo, principal fonte
   *   2. Lead data (nome, phone, stage, casos ativos, conversas recentes)
   *   3. LeadProfile existente (pra preservar continuidade)
   *
   * A fonte AiMemory legada (case_state JSON) foi REMOVIDA em 2026-04-20
   * (fase 2d-1 da remocao total). Migracao ja concluida: 122/132 leads com
   * AiMemory foram consolidados em LeadProfile na Fase 1.
   */
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
                // Bug fix 2026-05-09: era take: 5 — insuficiente pra
                // gerar profile de lead novo que ainda nao tem Memory
                // entries (cron 0h ainda nao rodou). Subir pra 80 garante
                // que o LLM tenha contexto da conversa pra trabalhar.
                take: 80,
                select: { text: true, direction: true, created_at: true },
              },
            },
            take: 3,
            orderBy: { last_message_at: 'desc' },
          },
          legal_cases: {
            where: { archived: false },
            select: {
              id: true,
              case_number: true,
              legal_area: true,
              stage: true,
              tracking_stage: true,
              court: true,
              action_type: true,
              opposing_party: true,
            },
          },
        },
      }),
      this.prisma.leadProfile.findUnique({ where: { lead_id: leadId } }),
    ]);

    if (!lead) return;

    // Movimentacoes judiciais dos processos ativos (CaseEvent type=MOVIMENTACAO).
    // Traz as 30 mais recentes pra dar contexto da tramitacao ao LLM.
    // Atualizado em 2026-04-21: antes a IA nao tinha acesso a CaseEvents —
    // o cliente perguntava "qual o status do processo" e ela nao sabia.
    const caseIds = lead.legal_cases.map((c) => c.id);
    const courtMovements = caseIds.length > 0
      ? await this.prisma.caseEvent.findMany({
          where: { case_id: { in: caseIds }, type: 'MOVIMENTACAO' },
          orderBy: [{ event_date: 'desc' }, { created_at: 'desc' }],
          take: 30,
          select: {
            event_date: true,
            title: true,
            description: true,
            source: true,
            case_id: true,
          },
        })
      : [];

    // Bug fix 2026-05-09: lead novo (Jose naelson e outros) tinha esse
    // early return e nunca gerava profile — Memory entries so sao criadas
    // pelo cron 0h, e lead recem-cadastrado conversa pela manha mas
    // espera 12h+ pra ter perfil. Agora: se ha mensagens NA CONVERSA,
    // tambem vale a chamada LLM (mesmo sem Memory entries ainda).
    const totalMessages = lead.conversations.reduce(
      (sum: number, c: any) => sum + (c.messages?.length || 0),
      0,
    );
    if (
      memories.length === 0 &&
      !existing &&
      courtMovements.length === 0 &&
      totalMessages === 0
    ) {
      // Sem nada — lead realmente vazio (cadastrado mas nunca conversou)
      this.logger.debug(`[ProfileConsolidation] Lead ${leadId} sem memorias/processos/mensagens — pulando`);
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
      // Ultimas 30 movimentacoes judiciais dos processos do lead. Inclui
      // data, titulo (primeira linha do texto), descricao completa e fonte
      // (ESAJ, DJEN, MANUAL). Permite ao LLM gerar resumo coerente com a
      // situacao atual da tramitacao.
      court_movements: courtMovements.map((ev) => ({
        date: ev.event_date,
        title: ev.title,
        description: ev.description?.substring(0, 400) || null,
        source: ev.source,
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
    // Modelo configuravel via Ajustes IA. Default gpt-4.1-mini (mais barato,
    // suficiente pra consolidar prosa). Antes era gpt-4.1.
    const modelRow = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_PROFILE_MODEL' },
    });
    const model = modelRow?.value || 'gpt-4.1-mini';

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

  /**
   * generateNarrativeFacts — sob demanda, gera "Dos Fatos" estilo peticao.
   *
   * Diferente de consolidateProfile (summary geral), aqui geramos uma
   * NARRATIVA cronologica numerada que pode ser usada direto numa peticao
   * inicial. Caro mas vale a pena: economiza horas do advogado.
   *
   * Modelo configurado em MEMORY_FACTS_MODEL (default gpt-4.1 — qualidade
   * importa aqui).
   */
  async generateNarrativeFacts(tenantId: string, leadId: string): Promise<{ narrative: string; key_dates: any[] } | null> {
    const apiKey = await this.settings.getOpenAiKey();
    if (!apiKey) return null;

    const [memories, lead, profile] = await Promise.all([
      this.prisma.memory.findMany({
        where: { tenant_id: tenantId, scope: 'lead', scope_id: leadId, status: 'active' },
        orderBy: { created_at: 'asc' }, // cronologico
      }),
      this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          legal_cases: { where: { archived: false } },
          conversations: {
            include: {
              messages: {
                orderBy: { created_at: 'asc' },
                select: { text: true, direction: true, created_at: true },
              },
            },
          },
        },
      }),
      this.prisma.leadProfile.findUnique({ where: { lead_id: leadId } }),
    ]);

    if (!lead) return null;

    const allMessages = lead.conversations.flatMap((c: any) =>
      c.messages.map((m: any) => ({
        from: m.direction === 'in' ? 'CLIENTE' : 'ESCRITORIO',
        text: (m.text ?? '').slice(0, 500),
        date: m.created_at,
      })),
    ).sort((a: any, b: any) => a.date.getTime() - b.date.getTime());

    const payload = {
      lead_data: {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        cpf: (lead as any).cpf || null,
      },
      cases: lead.legal_cases,
      summary: profile?.summary || null,
      memories: memories.map((m: any) => ({
        content: m.content,
        type: m.type,
        date: m.created_at,
      })),
      conversation_chronological: allMessages,
    };

    const modelRow = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_FACTS_MODEL' },
    });
    const model = modelRow?.value || 'gpt-4.1';

    const client = new OpenAI({ apiKey });
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: NARRATIVE_FACTS_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 4096,
        temperature: 0.2,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content);
      if (!parsed.narrative || typeof parsed.narrative !== 'string') return null;
      return { narrative: parsed.narrative, key_dates: parsed.key_dates ?? [] };
    } catch (e: any) {
      this.logger.error(`[NarrativeFacts] LLM erro: ${e.message}`);
      return null;
    }
  }
}
