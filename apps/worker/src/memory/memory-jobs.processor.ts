import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DailyMemoryBatchProcessor } from './daily-memory-batch.processor';
import { ProfileConsolidationProcessor } from './profile-consolidation.processor';
import { OrgProfileConsolidationProcessor } from './org-profile-consolidation.processor';

/**
 * MemoryJobsProcessor — ponto UNICO de consumo da fila `memory-jobs`.
 *
 * Por que um so: BullMQ distribui cada job para UM worker da fila. Se tivermos
 * multiplos @Processor('memory-jobs'), eles competem — o que "vencer" e nao
 * reconhecer o job.name vai marca-lo como completo silenciosamente (com return
 * null). Resultado: jobs sendo descartados aleatoriamente conforme o workload.
 *
 * Fix: um unico processor escuta a fila e roteia por `job.name` para os
 * services especializados (DailyMemoryBatch, ProfileConsolidation,
 * OrgProfileConsolidation).
 *
 * Jobs suportados:
 *   - daily-batch-extract / manual-extract     → DailyMemoryBatchProcessor
 *   - consolidate-profiles-after-batch         → ProfileConsolidationProcessor
 *   - consolidate-profile                      → ProfileConsolidationProcessor
 *   - consolidate-org-profile                  → OrgProfileConsolidationProcessor
 */
@Injectable()
@Processor('memory-jobs')
export class MemoryJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryJobsProcessor.name);

  constructor(
    private readonly batch: DailyMemoryBatchProcessor,
    private readonly profile: ProfileConsolidationProcessor,
    private readonly orgProfile: OrgProfileConsolidationProcessor,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'daily-batch-extract':
      case 'manual-extract':
        return this.batch.processTenantBatch(job);

      case 'consolidate-profiles-after-batch':
        return this.profile.consolidateAfterBatch(job);

      case 'consolidate-profile':
        return this.profile.consolidateSingle(job);

      // Geracao SOB DEMANDA da narrative_facts (estilo "Dos Fatos" da
      // peticao inicial). Disparado pelo botao "Gerar Fatos" no Painel
      // do Lead. Usa MEMORY_FACTS_MODEL (default gpt-4.1).
      case 'generate-narrative-facts':
        return this.generateNarrativeFactsHandler(job);

      case 'consolidate-org-profile':
        return this.orgProfile.consolidateSingle(job);

      case 'rebuild-org-profile':
        return this.orgProfile.rebuildFromScratch(job);

      default:
        this.logger.warn(`[MemoryJobs] Job desconhecido: ${job.name}`);
        return null;
    }
  }

  private async generateNarrativeFactsHandler(job: Job): Promise<{ ok: boolean; chars: number }> {
    const { tenant_id, lead_id } = job.data as { tenant_id: string; lead_id: string };

    // Bug fix 2026-05-10 (Memoria PR1 #C1 — CRITICO):
    // Antes upsert do LeadProfile usava `WHERE lead_id` apenas (eh @unique).
    // Atacante (ou bug em outro caller) podia enfileirar job com
    // tenant_id=A + lead_id=<lead-do-tenant-B> → profile do B sobrescrito
    // com facts de A. Catastrofico (cross-tenant).
    // Agora valida que lead realmente pertence ao tenant_id do job.
    if (!tenant_id || !lead_id) {
      this.logger.error(`[MemoryJobs] generate-narrative-facts sem tenant_id ou lead_id`);
      return { ok: false, chars: 0 };
    }
    const lead = await (this.profile as any).prisma.lead.findUnique({
      where: { id: lead_id },
      select: { tenant_id: true },
    });
    if (!lead) {
      this.logger.warn(`[MemoryJobs] Lead ${lead_id} nao encontrado — abort`);
      return { ok: false, chars: 0 };
    }
    if (lead.tenant_id !== tenant_id) {
      this.logger.error(
        `[MemoryJobs] CROSS-TENANT BLOCKED: job tenant_id=${tenant_id} ` +
        `mas lead ${lead_id} pertence a tenant ${lead.tenant_id} — abort`,
      );
      return { ok: false, chars: 0 };
    }

    const result = await this.profile.generateNarrativeFacts(tenant_id, lead_id);
    if (!result) {
      this.logger.warn(`[MemoryJobs] generateNarrativeFacts retornou null lead=${lead_id}`);
      return { ok: false, chars: 0 };
    }
    // Persiste em LeadProfile.facts.narrative + facts.key_dates
    const existing = await this.profile['prisma'].leadProfile.findUnique({
      where: { lead_id },
      select: { facts: true },
    });
    const facts = (existing?.facts as any) || {};
    facts.narrative = result.narrative;
    facts.key_dates = result.key_dates;
    facts.narrative_generated_at = new Date().toISOString();

    await this.profile['prisma'].leadProfile.upsert({
      where: { lead_id },
      create: {
        tenant_id,
        lead_id,
        summary: '',
        facts,
        message_count: 0,
        version: 1,
      },
      update: {
        facts,
        version: { increment: 1 },
        generated_at: new Date(),
      },
    });

    this.logger.log(`[MemoryJobs] narrative_facts gerada lead=${lead_id} (${result.narrative.length} chars, ${result.key_dates.length} datas)`);
    return { ok: true, chars: result.narrative.length };
  }
}
