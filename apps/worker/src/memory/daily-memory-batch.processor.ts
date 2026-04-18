import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmbeddingService } from './embedding.service';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { BATCH_EXTRACTION_PROMPT } from './memory-prompts';

const DEFAULT_BATCH_SIZE = 30;
const MIN_MESSAGE_LEN = 3;
const MAX_EXISTING_MEMORIES_LEAD = 15;
const MAX_EXISTING_MEMORIES_ORG = 20;
const DUPLICATE_THRESHOLD = 0.9;

interface ExtractedMemory {
  content: string;
  scope: 'lead' | 'organization';
  subcategory?: string | null;
  type?: 'semantic' | 'episodic';
  confidence?: number;
}

interface SupersededMemory {
  old_memory_id: string;
  reason: string;
}

interface ExtractionResult {
  memories: ExtractedMemory[];
  superseded: SupersededMemory[];
}

/**
 * DailyMemoryBatchProcessor
 * ─────────────────────────
 * Cron noturno (00:00 America/Maceio) que analisa mensagens do dia e
 * extrai memorias de lead + organizacionais em lotes via GPT-4.1.
 *
 * Pipeline:
 *   1. scheduleDailyExtraction() — cron enfileira 1 job por tenant
 *   2. processTenantBatch() — varre conversas do dia em lotes de 30 msgs
 *   3. extractFromBatch() — chama LLM, dedupe, insere memorias
 *   4. Ao final: enfileira consolidate-profiles-after-batch
 */
@Injectable()
@Processor('memory-jobs')
export class DailyMemoryBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(DailyMemoryBatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly embedding: EmbeddingService,
    private readonly retrieval: MemoryRetrievalService,
    @InjectQueue('memory-jobs') private readonly memoryQueue: Queue,
  ) {
    super();
  }

  // ─── Cron: agenda todos os tenants meia-noite ─────────────

  @Cron('0 0 * * *', { timeZone: 'America/Maceio' })
  async scheduleDailyExtraction() {
    const enabled = await this.isEnabled();
    if (!enabled) {
      this.logger.log('[MemoryBatch] MEMORY_BATCH_ENABLED=false — pulando extracao diaria');
      return;
    }

    this.logger.log('=== Inicio da extracao diaria de memorias ===');
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    const today = new Date().toISOString().split('T')[0];

    for (const tenant of tenants) {
      await this.memoryQueue.add(
        'daily-batch-extract',
        { tenant_id: tenant.id },
        {
          jobId: `daily-batch-${tenant.id}-${today}`,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        },
      );
    }
    this.logger.log(`[MemoryBatch] Agendada extracao para ${tenants.length} tenants`);
  }

  private async isEnabled(): Promise<boolean> {
    const row = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_BATCH_ENABLED' },
    });
    return (row?.value ?? 'true').toLowerCase() !== 'false';
  }

  // ─── Processador BullMQ ───────────────────────────────────

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'daily-batch-extract':
        return this.processTenantBatch(job);
      case 'manual-extract':
        return this.processTenantBatch(job);
      default:
        this.logger.warn(`[MemoryBatch] Job desconhecido: ${job.name}`);
        return null;
    }
  }

  /** Processa um tenant inteiro: itera conversas do dia e extrai memorias. */
  async processTenantBatch(job: Job): Promise<{ conversations: number; messages: number; leadMemories: number; orgMemories: number }> {
    const { tenant_id } = job.data as { tenant_id: string };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenant_id,
        messages: { some: { created_at: { gte: since } } },
      },
      select: {
        id: true,
        lead_id: true,
        messages: {
          where: { created_at: { gte: since } },
          orderBy: { created_at: 'asc' },
          select: {
            text: true,
            direction: true,
            type: true,
            created_at: true,
            skill_id: true,
          },
        },
      },
    });

    const totalMessages = conversations.reduce((sum, c) => sum + c.messages.length, 0);
    this.logger.log(
      `[MemoryBatch] Tenant ${tenant_id}: ${conversations.length} conversas, ${totalMessages} mensagens`,
    );

    let leadMemories = 0;
    let orgMemories = 0;

    for (const conv of conversations) {
      const useful = conv.messages.filter((m) => m.text && m.text.trim().length > MIN_MESSAGE_LEN);
      if (useful.length === 0) continue;

      for (const batch of this.chunk(useful, DEFAULT_BATCH_SIZE)) {
        try {
          const result = await this.extractFromBatch(tenant_id, conv.lead_id, conv.id, batch);
          leadMemories += result.leadCount;
          orgMemories += result.orgCount;
        } catch (e: any) {
          this.logger.error(
            `[MemoryBatch] Falha em batch (conv=${conv.id}): ${e.message}`,
          );
          // Continua processando outros batches — nao propaga a falha
        }
      }
    }

    this.logger.log(
      `[MemoryBatch] Tenant ${tenant_id}: ${leadMemories} memorias lead + ${orgMemories} organizacionais`,
    );

    // Reconsolida perfis dos leads afetados — executa apos 5s para dar tempo
    // dos embeddings serem persistidos antes de consultar
    await this.memoryQueue.add(
      'consolidate-profiles-after-batch',
      { tenant_id },
      { delay: 5000, removeOnComplete: true, attempts: 2 },
    );

    return {
      conversations: conversations.length,
      messages: totalMessages,
      leadMemories,
      orgMemories,
    };
  }

  /** Chama LLM, dedupe, persiste memorias. */
  private async extractFromBatch(
    tenantId: string,
    leadId: string,
    conversationId: string,
    messages: Array<{
      text: string | null;
      direction: string;
      type: string;
      created_at: Date;
      skill_id: string | null;
    }>,
  ): Promise<{ leadCount: number; orgCount: number }> {
    const [existingLead, existingOrg] = await Promise.all([
      this.prisma.memory.findMany({
        where: { tenant_id: tenantId, scope: 'lead', scope_id: leadId, status: 'active' },
        orderBy: { created_at: 'desc' },
        take: MAX_EXISTING_MEMORIES_LEAD,
        select: { id: true, content: true },
      }),
      this.prisma.memory.findMany({
        where: { tenant_id: tenantId, scope: 'organization', scope_id: tenantId, status: 'active' },
        orderBy: { created_at: 'desc' },
        take: MAX_EXISTING_MEMORIES_ORG,
        select: { id: true, content: true, subcategory: true },
      }),
    ]);

    const payload = {
      conversation_messages: messages.map((m) => ({
        sender:
          m.direction === 'in'
            ? 'CLIENTE'
            : m.skill_id
              ? 'IA'
              : 'OPERADOR',
        text: m.text,
        time: m.created_at,
      })),
      existing_lead_memories: existingLead,
      existing_org_memories: existingOrg,
    };

    const result = await this.callLLM(payload);
    if (!result) return { leadCount: 0, orgCount: 0 };

    let leadCount = 0;
    let orgCount = 0;

    for (const memory of result.memories) {
      if (!memory.content || memory.content.trim().length < 5) continue;
      const scopeId = memory.scope === 'organization' ? tenantId : leadId;

      let embedding: number[];
      try {
        embedding = await this.embedding.generate(memory.content);
      } catch (e: any) {
        this.logger.warn(`[MemoryBatch] Falha ao gerar embedding: ${e.message}`);
        continue;
      }

      const dup = await this.retrieval.findDuplicate({
        tenant_id: tenantId,
        scope: memory.scope,
        scope_id: scopeId,
        content: memory.content,
        embedding,
        threshold: DUPLICATE_THRESHOLD,
      });
      if (dup) continue;

      try {
        await this.prisma.$executeRawUnsafe(
          `
          INSERT INTO "Memory" (
            id, tenant_id, scope, scope_id, type, subcategory, content,
            embedding, source_type, source_id, confidence, status,
            created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6,
            $7::vector, 'batch', $8, $9, 'active',
            NOW(), NOW()
          )
          `,
          tenantId,
          memory.scope,
          scopeId,
          memory.type ?? 'semantic',
          memory.subcategory ?? null,
          memory.content,
          this.embedding.toVectorLiteral(embedding),
          conversationId,
          memory.confidence ?? 0.9,
        );
        if (memory.scope === 'lead') leadCount++;
        else orgCount++;
      } catch (e: any) {
        this.logger.warn(`[MemoryBatch] Falha ao inserir memoria: ${e.message}`);
      }
    }

    for (const sup of result.superseded) {
      try {
        await this.prisma.memory.updateMany({
          where: { id: sup.old_memory_id, tenant_id: tenantId },
          data: { status: 'superseded', superseded_by: sup.reason },
        });
      } catch {
        // Ignora se memoria nao existir mais
      }
    }

    return { leadCount, orgCount };
  }

  /** Chamada ao GPT-4.1 com response_format=json_object. */
  private async callLLM(payload: any): Promise<ExtractionResult | null> {
    const apiKey = await this.settings.getOpenAiKey();
    if (!apiKey) {
      this.logger.warn('[MemoryBatch] OPENAI_API_KEY ausente — abortando');
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
          { role: 'system', content: BATCH_EXTRACTION_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 1500,
        temperature: 0.3,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content);
      return {
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        superseded: Array.isArray(parsed.superseded) ? parsed.superseded : [],
      };
    } catch (e: any) {
      this.logger.error(`[MemoryBatch] Erro no LLM: ${e.message}`);
      return null;
    }
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
}
