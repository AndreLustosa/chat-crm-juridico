import { Cron } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
// Prompts ORG agora ficam em @crm/shared — fonte unica de verdade
import {
  ORG_PROFILE_CONSOLIDATION_PROMPT,
  ORG_PROFILE_INCREMENTAL_PROMPT,
} from '@crm/shared';
import { CronRunnerService } from '../common/cron/cron-runner.service';

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
    private readonly cronRunner: CronRunnerService,
  ) {}

  // ─── Cron: roda toda hora cheia mas decide se executa ─────
  //
  // Antes era hardcoded em 02h diario. Fase 3 PR2: frequencia eh
  // configuravel (daily/weekly/manual) + hora customizavel.
  // Cron roda toda hora cheia e checa o setting pra decidir se executa.
  //
  // Settings lidos:
  //   MEMORY_ORG_CONSOLIDATION_FREQUENCY = 'daily' | 'weekly' | 'manual'
  //   MEMORY_ORG_CONSOLIDATION_WEEKDAY   = 1-7 (1=segunda, default 1)
  //   MEMORY_ORG_CONSOLIDATION_HOUR      = 0-23 (default 2)
  //   MEMORY_ORG_REQUIRE_APPROVAL        = 'true' | 'false' (default 'false')

  @Cron('0 * * * *', { timeZone: 'America/Maceio' })
  async scheduleHourlyCheck() {
    await this.cronRunner.run(
      'memory-org-profile-consolidation',
      60 * 60,
      async () => {
        const enabled = await this.prisma.globalSetting.findUnique({
          where: { key: 'MEMORY_BATCH_ENABLED' },
        });
        if ((enabled?.value ?? 'true').toLowerCase() === 'false') return;

        const should = await this.shouldRunNow();
        if (!should) return;

        await this.consolidateAll();
      },
      { description: 'Cron hora-em-hora: consolida org-profile se frequencia/dia/hora configurados batem com NOW()', schedule: '0 * * * *' },
    );
  }

  /**
   * Decide se a consolidacao deve rodar AGORA baseado nos settings.
   * Roda toda hora cheia, mas so executa se:
   *   - frequency=daily AND hora atual == hora configurada
   *   - frequency=weekly AND weekday atual == weekday configurado AND hora atual == hora configurada
   *   - frequency=manual: NUNCA roda automaticamente
   */
  private async shouldRunNow(): Promise<boolean> {
    const [freqRow, weekdayRow, hourRow] = await Promise.all([
      this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_CONSOLIDATION_FREQUENCY' } }),
      this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_CONSOLIDATION_WEEKDAY' } }),
      this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_CONSOLIDATION_HOUR' } }),
    ]);

    const frequency = (freqRow?.value || 'daily').toLowerCase();
    if (frequency === 'manual') return false;

    const targetHour = parseInt(hourRow?.value || '2', 10);
    if (isNaN(targetHour) || targetHour < 0 || targetHour > 23) return false;

    // Hora local America/Maceio
    const now = new Date();
    const hereHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Maceio', hour: '2-digit', hour12: false }), 10);
    if (hereHour !== targetHour) return false;

    if (frequency === 'daily') return true;

    if (frequency === 'weekly') {
      const targetWeekday = parseInt(weekdayRow?.value || '1', 10); // 1=seg, 7=dom
      // toLocaleString('en-US', { weekday: 'long' }) em Maceio
      const dayName = now.toLocaleDateString('en-US', { timeZone: 'America/Maceio', weekday: 'long' });
      const dayMap: Record<string, number> = {
        Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4,
        Friday: 5, Saturday: 6, Sunday: 7,
      };
      const todayWeekday = dayMap[dayName] || 0;
      return todayWeekday === targetWeekday;
    }

    return false;
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

    // Primeira geracao ou profile zerado: from-scratch obrigatorio.
    // forcePublish=true porque nao tem summary publicado pra IA usar
    // enquanto admin aprova — pending nao faz sentido aqui.
    if (!existing || !existing.summary || existing.summary.trim().length < 50) {
      await this.consolidateProfile(tenantId, { forcePublish: true });
      return { changed: true };
    }

    const since = existing.last_incorporated_at ?? existing.generated_at;

    // Memorias NOVAS ou ATUALIZADAS desde a ultima incorporacao.
    //
    // Bug 5+6 fix: antes filtrava so `created_at > since`. Memoria editada
    // (status='active') tinha updated_at novo mas created_at antigo —
    // nao entrava no diff e o summary nunca refletia a edicao. Agora
    // pegamos OR (created OR updated). LLM trata as recem-editadas como
    // "nova versao" — converge eventualmente.
    const newMemories = await this.prisma.memory.findMany({
      where: {
        tenant_id: tenantId,
        scope: 'organization',
        scope_id: tenantId,
        status: 'active',
        confidence: { gte: MIN_CONFIDENCE_FOR_INCLUSION },
        OR: [
          { created_at: { gt: since } },
          { updated_at: { gt: since } },
        ],
      },
      orderBy: { updated_at: 'asc' },
      select: { content: true, subcategory: true, confidence: true, created_at: true, updated_at: true },
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
      // Bug 7 fix: NAO avanca last_incorporated_at em no-op. Antes
      // avancava sempre, ocultando casos onde memoria foi editada e
      // o filtro nao pegou (cascade do Bug 5+6). Agora deixa intacto —
      // proxima execucao re-checa a janela inteira ate aparecer mudanca
      // legitima ou ate alguem clicar "Refazer do zero".
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

    // Fase 3 PR2: workflow de aprovacao — quando setting
    // MEMORY_ORG_REQUIRE_APPROVAL=true, grava em pending_* em vez de
    // sobrescrever summary. IA continua usando summary atual ate admin
    // aprovar via UI.
    const requireApproval = await this.isApprovalRequired();

    if (requireApproval && changed) {
      await this.prisma.organizationProfile.update({
        where: { tenant_id: tenantId },
        data: {
          pending_summary: result.summary,
          pending_facts: (result.facts ?? existing.facts) as any,
          pending_changes_applied: result.changes_applied || [],
          pending_at: new Date(),
          // Marker avanca pra cron nao reprocessar
          last_incorporated_at: new Date(),
        },
      });

      // Notifica admins/advogados via sistema de notificacoes
      await this.notifyPendingProposal(tenantId, result.summary.length, result.changes_applied?.length || 0);

      this.logger.log(
        `[OrgProfileConsolidation] Tenant ${tenantId}: PROPOSTA pendente criada (${result.summary.length} chars, ${result.changes_applied?.length || 0} mudancas) — aguardando aprovacao admin`,
      );
      return { changed: true };
    }

    // Fluxo normal (sem aprovacao requerida) ─────────────────────────

    // Fase 3: salva snapshot da versao ATUAL antes de sobrescrever (so
    // se o texto mudou — snapshot identico nao agrega valor).
    if (changed) {
      await this.saveSnapshot(existing, 'cron');
    }

    // Bug 1 fix: race UI/cron — usa updateMany com WHERE manually_edited_at
    // IS NULL pra nao sobrescrever edicao manual feita entre o snapshot
    // do consolidateAll e este update. Se admin clicou Salvar entre as
    // 2 fases, count = 0 e nada eh sobrescrito.
    const updated = await this.prisma.organizationProfile.updateMany({
      where: { tenant_id: tenantId, manually_edited_at: null },
      data: {
        summary: result.summary,
        facts: (result.facts ?? existing.facts) as any,
        source_memory_count: activeCount,
        version: changed ? { increment: 1 } : undefined,
        generated_at: changed ? new Date() : undefined,
        last_incorporated_at: new Date(),
      },
    });

    if (updated.count === 0) {
      this.logger.log(
        `[OrgProfileConsolidation] Tenant ${tenantId}: edicao manual detectada durante consolidacao — update pulado (race protection)`,
      );
      return { changed: false };
    }

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
  async consolidateProfile(tenantId: string, options: { forcePublish?: boolean } = {}): Promise<void> {
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

    // Bug 9 fix: incrementa version SO se houve mudanca de texto real.
    // Antes incrementava sempre — UI mostrava v3→v4 sem motivo.
    const existing = await this.prisma.organizationProfile.findUnique({
      where: { tenant_id: tenantId },
    });
    const changed = !existing || existing.summary?.trim() !== result.summary.trim();

    // Fase 3 PR2: workflow de aprovacao — quando setting
    // MEMORY_ORG_REQUIRE_APPROVAL=true, grava em pending_* em vez de
    // sobrescrever summary direto.
    //
    // Excecao: forcePublish=true OU primeira geracao (existing=null, sem
    // summary publicado). Nesses casos NAO faz sentido pending — nao tem
    // o que a IA usar enquanto admin aprova.
    const requireApproval = await this.isApprovalRequired();
    const shouldUsePending =
      requireApproval &&
      changed &&
      !options.forcePublish &&
      existing &&
      existing.summary &&
      existing.summary.trim().length >= 50;

    if (shouldUsePending) {
      await this.prisma.organizationProfile.update({
        where: { tenant_id: tenantId },
        data: {
          pending_summary: result.summary,
          pending_facts: result.facts as any,
          pending_changes_applied: ['Refeito do zero a partir de todas as memórias'],
          pending_at: new Date(),
        },
      });
      await this.notifyPendingProposal(tenantId, result.summary.length, 1);
      this.logger.log(
        `[OrgProfileConsolidation] Tenant ${tenantId}: REBUILD pendente criado — aguardando aprovacao admin`,
      );
      return;
    }

    // Fase 3: salva snapshot da versao anterior antes de sobrescrever
    // (rebuild eh destrutivo — sempre faz snapshot se ha versao previa).
    if (existing && changed) {
      await this.saveSnapshot(existing, 'rebuild');
    }

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
        version: changed ? { increment: 1 } : undefined,
        generated_at: changed ? new Date() : undefined,
        last_incorporated_at: new Date(),
        manually_edited_at: null, // rebuild explicito descarta edicao manual
      },
    });

    this.logger.log(
      `[OrgProfileConsolidation] Tenant ${tenantId}: from-scratch publicado direto — ${memories.length} memorias → ${result.summary.length} chars`,
    );
  }

  /**
   * Le setting MEMORY_ORG_REQUIRE_APPROVAL.
   * Quando true, cron escreve em pending_* em vez de sobrescrever summary.
   */
  private async isApprovalRequired(): Promise<boolean> {
    const row = await this.prisma.globalSetting.findUnique({
      where: { key: 'MEMORY_ORG_REQUIRE_APPROVAL' },
    });
    return (row?.value || 'false').toLowerCase() === 'true';
  }

  /**
   * Cria notificacao no sistema (sininho do CRM) pra admins/advogados
   * quando proposta pendente eh criada. Cliente clica e abre o Painel >
   * Base de Conhecimento pra revisar.
   */
  private async notifyPendingProposal(tenantId: string, summaryChars: number, changesCount: number): Promise<void> {
    try {
      // Pega usuarios com role ADMIN ou ADVOGADO do tenant
      // (User.roles eh String[] — verifica se contem ADMIN ou ADVOGADO)
      const targets = await this.prisma.user.findMany({
        where: {
          tenant_id: tenantId,
          OR: [
            { roles: { has: 'ADMIN' } },
            { roles: { has: 'ADVOGADO' } },
          ],
        },
        select: { id: true },
      });
      if (targets.length === 0) return;

      const title = '📋 Proposta do Resumo do Escritório';
      const body = `${changesCount} mudança${changesCount === 1 ? '' : 's'} acumulada${changesCount === 1 ? '' : 's'} pra revisar. Clique pra abrir e aprovar.`;

      await this.prisma.notification.createMany({
        data: targets.map((t) => ({
          tenant_id: tenantId,
          user_id: t.id,
          notification_type: 'memory_org_pending',
          title,
          body,
          data: { link: '/atendimento/settings/knowledge', summaryChars, changesCount },
        })),
      });

      this.logger.log(
        `[OrgProfileConsolidation] Notificacao enviada pra ${targets.length} usuario(s) sobre proposta pendente`,
      );
    } catch (e: any) {
      this.logger.warn(`[OrgProfileConsolidation] Falha ao criar notificacao: ${e.message}`);
    }
  }

  /**
   * Salva snapshot da versao atual do OrganizationProfile no histórico.
   *
   * Chamado ANTES de qualquer update destrutivo (cron incremental,
   * rebuild from-scratch, edicao manual via API). Permite reverter ou
   * auditar mudancas posteriores.
   *
   * source: 'cron' | 'rebuild' | 'manual_edit' | 'regenerate' | 'restore'
   */
  async saveSnapshot(
    existing: { tenant_id: string; summary: string; facts: any; version: number; source_memory_count: number },
    source: 'cron' | 'rebuild' | 'manual_edit' | 'regenerate' | 'restore',
    createdByUserId?: string,
  ): Promise<void> {
    if (!existing.summary || existing.summary.trim().length < 50) return; // Nada util pra snapshot
    try {
      await (this.prisma as any).organizationProfileSnapshot.create({
        data: {
          tenant_id: existing.tenant_id,
          version: existing.version,
          summary: existing.summary,
          facts: existing.facts,
          source,
          created_by_user_id: createdByUserId || null,
          source_memory_count: existing.source_memory_count,
        },
      });
      this.logger.log(
        `[OrgProfileConsolidation] Snapshot v${existing.version} salvo (tenant=${existing.tenant_id}, source=${source})`,
      );
    } catch (e: any) {
      this.logger.warn(`[OrgProfileConsolidation] Falha ao salvar snapshot: ${e.message}`);
    }
  }

  /**
   * Chama o LLM com o prompt apropriado ao modo.
   * Retorna `{ summary, facts, changes_applied? }` ou null em caso de erro.
   *
   * Prompts sao lidos da GlobalSetting (editaveis pelo admin na UI) com
   * fallback para os defaults hardcoded em memory-prompts.ts.
   * Modelo via GlobalSetting MEMORY_ORG_MODEL (prioridade) ou
   * MEMORY_EXTRACTION_MODEL (fallback legado).
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

    const [modelPrimary, modelFallback, customIncremental, customRebuild] = await Promise.all([
      this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_MODEL' } }),
      this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_EXTRACTION_MODEL' } }),
      this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_INCREMENTAL_PROMPT' } }),
      this.prisma.globalSetting.findUnique({ where: { key: 'MEMORY_ORG_REBUILD_PROMPT' } }),
    ]);

    const model = modelPrimary?.value || modelFallback?.value || 'gpt-4.1';

    const systemPrompt =
      mode === 'incremental'
        ? (customIncremental?.value?.trim() || ORG_PROFILE_INCREMENTAL_PROMPT)
        : (customRebuild?.value?.trim() || ORG_PROFILE_CONSOLIDATION_PROMPT);

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

      // Bug 4 fix: validacao de tamanho do summary do LLM.
      // Antes: aceitava summary de 1 char ou 50K chars sem validar — se o
      // LLM travasse e retornasse "ok", o sistema persistia e destruia o
      // perfil bom anterior. Agora: 200-10000 chars, fora disso retorna
      // null e o caller mantem `existing.summary`.
      const trimmed = parsed.summary.trim();
      if (trimmed.length < 200) {
        this.logger.warn(
          `[OrgProfileConsolidation] LLM retornou summary curto demais (${trimmed.length} chars, min 200) — descartando, mantendo perfil anterior`,
        );
        return null;
      }
      if (trimmed.length > 10000) {
        this.logger.warn(
          `[OrgProfileConsolidation] LLM retornou summary longo demais (${trimmed.length} chars, max 10000) — descartando, mantendo perfil anterior`,
        );
        return null;
      }

      return {
        summary: trimmed,
        facts: parsed.facts ?? {},
        changes_applied: Array.isArray(parsed.changes_applied) ? parsed.changes_applied : [],
      };
    } catch (e: any) {
      this.logger.error(`[OrgProfileConsolidation] LLM erro (${mode}, model=${model}): ${e.message}`);
      return null;
    }
  }
}
