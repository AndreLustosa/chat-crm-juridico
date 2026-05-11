import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MemoriesService } from './memories.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('memories')
@UseGuards(JwtAuthGuard)
export class MemoriesController {
  constructor(
    private readonly memoriesService: MemoriesService,
    private readonly prisma: PrismaService,
    @InjectQueue('memory-jobs') private readonly memoryQueue: Queue,
  ) {}

  // ─── Organization ────────────────────────────────────────

  @Get('organization')
  async listOrganization(@Request() req: any) {
    return this.memoriesService.listOrganization(req.user?.tenant_id);
  }

  @Get('organization/stats')
  async getOrgStats(@Request() req: any) {
    return this.memoriesService.getOrganizationStats(req.user?.tenant_id);
  }

  @Get('organization/profile')
  async getOrgProfile(@Request() req: any) {
    return this.memoriesService.getOrganizationProfile(req.user?.tenant_id);
  }

  /**
   * Bug fix 2026-05-11 (Memoria PR2 #A6):
   * Throttle agressivo (5 chamadas / 10min) em operacoes caras de LLM.
   * Antes: admin clicando 10x = 10 jobs enfileirados = 10x o custo.
   * Cada regen custa ~US$0.04, batch de 10 cliques sairia US$0.40 por
   * impaciencia. BullMQ deduplica jobs por ID, mas o ID e timestamp-based
   * em alguns flows — Throttle e a defesa robusta.
   */
  @Post('organization/regenerate-profile')
  @Roles('ADMIN', 'ADVOGADO')
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  async regenerateOrgProfile(@Request() req: any) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.regenerateOrganizationProfile(req.user.tenant_id, req.user.id);
  }

  @Post('organization/rebuild-profile')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 3, ttl: 30 * 60_000 } })
  async rebuildOrgProfile(@Request() req: any) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.rebuildOrganizationProfile(req.user.tenant_id, req.user.id);
  }

  @Get('organization/settings')
  @Roles('ADMIN')
  async getOrgSettings() {
    return this.memoriesService.getOrganizationProfileSettings();
  }

  /**
   * Migra todas as skills ativas para usar as variaveis do sistema de memoria.
   * Idempotente: so adiciona o bloco `{{office_memories}} / {{lead_profile}} /
   * {{recent_episodes}}` no topo das skills que ainda nao as usam.
   *
   * Seguro: nao remove nem reescreve o corpo existente.
   */
  @Post('migrate-skills-to-memory-vars')
  @Roles('ADMIN')
  async migrateSkills() {
    return this.memoriesService.migrateSkillsToMemoryVars();
  }

  // POST /memories/migrate-legacy-leads-to-profile REMOVIDO em 2026-04-20
  // (fase 2d-2 da remocao total). Endpoint foi usado UMA unica vez para migrar
  // 122/132 leads com AiMemory para LeadProfile. Virou dead code apos a
  // migracao. Schema/tabela AiMemory e dropado na fase 2d-3.

  /**
   * Remove linhas hardcoded (numeros oficiais, endereco) dos corpos das skills,
   * que viraram redundantes com {{office_memories}}.
   *
   * Query params:
   *   - dry_run=true (default): so mostra o que seria removido, NAO aplica
   *   - dry_run=false: aplica as mudancas no banco
   *
   * Exemplo:
   *   GET /memories/skills/clean-hardcoded-org-info           (dry run — preview)
   *   POST /memories/skills/clean-hardcoded-org-info?dry_run=false  (apply)
   */
  @Get('skills/clean-hardcoded-org-info')
  @Roles('ADMIN')
  async previewCleanSkillsHardcoded() {
    return this.memoriesService.cleanSkillHardcodedOrgInfo(true);
  }

  @Post('skills/clean-hardcoded-org-info')
  @Roles('ADMIN')
  async applyCleanSkillsHardcoded(@Query('dry_run') dryRunParam?: string) {
    const dryRun = dryRunParam !== 'false';
    return this.memoriesService.cleanSkillHardcodedOrgInfo(dryRun);
  }

  @Put('organization/settings')
  @Roles('ADMIN')
  async updateOrgSettings(
    @Body() body: { model?: string; incremental_prompt?: string; rebuild_prompt?: string },
  ) {
    return this.memoriesService.updateOrganizationProfileSettings(body);
  }

  @Put('organization/profile')
  @Roles('ADMIN', 'ADVOGADO')
  async updateOrgProfile(
    @Request() req: any,
    @Body() body: { summary: string },
  ) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.updateOrganizationProfileSummary(
      req.user.tenant_id,
      body.summary,
      req.user.id,
    );
  }

  /**
   * GET /memories/organization/snapshots
   *
   * Lista versoes anteriores do OrganizationProfile (historico). Cada
   * snapshot foi capturado ANTES de uma mudanca (cron, rebuild, edicao
   * manual, regenerate). Retorna ordenado por created_at desc, max 50.
   */
  @Get('organization/snapshots')
  @Roles('ADMIN', 'ADVOGADO')
  async listOrgSnapshots(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.listOrganizationSnapshots(tenantId);
  }

  /**
   * GET /memories/organization/pending
   *
   * Retorna a proposta pendente do OrganizationProfile (Fase 3 PR2).
   * Quando MEMORY_ORG_REQUIRE_APPROVAL=true, o cron grava aqui em vez
   * de sobrescrever o summary. Admin revisa via UI.
   */
  @Get('organization/pending')
  @Roles('ADMIN', 'ADVOGADO')
  async getOrgPending(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.getOrganizationPending(tenantId);
  }

  /**
   * POST /memories/organization/pending/approve
   *
   * Move pending_* para summary/facts oficial. Cria snapshot da versao
   * anterior antes. Limpa pending_*.
   */
  @Post('organization/pending/approve')
  @Roles('ADMIN', 'ADVOGADO')
  async approveOrgPending(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.approveOrganizationPending(tenantId, req.user.id);
  }

  /**
   * POST /memories/organization/pending/reject
   *
   * Descarta a proposta pendente. summary atual permanece intacto.
   */
  @Post('organization/pending/reject')
  @Roles('ADMIN', 'ADVOGADO')
  async rejectOrgPending(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.rejectOrganizationPending(tenantId, req.user.id);
  }

  /**
   * PUT /memories/organization/pending
   *
   * Edita o pending_summary antes de aprovar. Util quando admin quer
   * ajustar 1-2 frases que o LLM errou antes de publicar.
   */
  @Put('organization/pending')
  @Roles('ADMIN', 'ADVOGADO')
  async editOrgPending(
    @Request() req: any,
    @Body() body: { summary: string },
  ) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.editOrganizationPending(tenantId, body.summary, req.user.id);
  }

  /**
   * POST /memories/organization/snapshots/:id/restore
   *
   * Restaura uma versao anterior do OrganizationProfile. A versao ATUAL
   * vira um snapshot novo (source='restore') antes da restauracao.
   * Marca manually_edited_at = NOW pra proteger contra cron 02h.
   */
  @Post('organization/snapshots/:id/restore')
  @Roles('ADMIN', 'ADVOGADO')
  async restoreOrgSnapshot(@Request() req: any, @Param('id') snapshotId: string) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.restoreOrganizationSnapshot(tenantId, snapshotId, req.user.id);
  }

  @Post('organization')
  @Roles('ADMIN', 'ADVOGADO')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async createOrg(
    @Request() req: any,
    @Body() body: { content: string; subcategory: string; confidence?: number },
  ) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    // Bug fix #A4: passa actorUserId pra audit log
    return this.memoriesService.createOrganization(req.user.tenant_id, body, req.user.id);
  }

  @Put(':id')
  @Roles('ADMIN', 'ADVOGADO')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async updateMemory(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { content?: string; subcategory?: string },
  ) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.updateMemory(id, req.user.tenant_id, body, req.user.id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ADVOGADO')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async deleteMemory(@Request() req: any, @Param('id') id: string) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.deleteMemory(id, req.user.tenant_id, req.user.id);
  }

  @Post('extract-now')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 2, ttl: 60 * 60_000 } })
  async extractNow(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    const jobId = `manual-extract-${tenantId}-${Date.now()}`;
    await this.memoryQueue.add(
      'manual-extract',
      { tenant_id: tenantId },
      { jobId, removeOnComplete: true, attempts: 2 },
    );
    // Audit log da extracao manual (custosa)
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: req.user.id,
        action: 'memory_manual_extract',
        entity: 'Tenant',
        entity_id: tenantId,
        meta_json: { job_id: jobId },
      },
    }).catch(() => { /* nao bloqueia */ });
    return { success: true, job_id: jobId };
  }

  /**
   * POST /memories/backfill-missing-profiles
   *
   * Enfileira `consolidate-profile` pra leads ativos do tenant que ainda
   * nao tem LeadProfile.summary. Cobre os 191 leads orfaos do diagnostico
   * 2026-05-08.
   *
   * Idempotente: se um lead ja tem profile, o job apenas regenera.
   * Custo estimado: ~$0.02-0.05 por lead × N leads.
   *
   * Bug fix 2026-05-10 (Memoria PR1 #C8 — CRITICO):
   * Antes este endpoint enfileirava TODOS os leads sem profile sem confirmacao.
   * 1 clique acidental = ate US$ 50 de OpenAI gerado em background, sem cap
   * configuravel pelo caller. Pior: nao havia preview — admin descobria so
   * pelo log/fatura.
   *
   * Agora exige body explicito:
   *   { confirm: true, max_leads: number (1-200) }
   *
   * - `confirm: true` obrigatorio (previne CSRF + clique duplo)
   * - `max_leads` limitado a [1, 200] — nunca mais que 200 por chamada
   *   (US$ 10 max por execucao; admin chama de novo se precisar mais)
   *
   * GET /memories/backfill-missing-profiles/preview retorna o COUNT sem
   * enfileirar nada. Use isso pra planejar.
   */
  @Get('backfill-missing-profiles/preview')
  @Roles('ADMIN')
  async previewBackfill(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint as count FROM "Lead" l
      WHERE l.tenant_id = ${tenantId}
        AND EXISTS (
          SELECT 1 FROM "Conversation" c
          WHERE c.lead_id = l.id
            AND c.last_message_at > NOW() - INTERVAL '60 days'
        )
        AND NOT EXISTS (
          SELECT 1 FROM "LeadProfile" lp
          WHERE lp.lead_id = l.id AND length(coalesce(lp.summary, '')) > 50
        )
    `;
    const total = Number(rows[0]?.count || 0);
    return {
      total_leads_without_profile: total,
      estimated_cost_usd_max: (total * 0.05).toFixed(2),
      estimated_cost_usd_min: (total * 0.02).toFixed(2),
      hint: 'POST com body { confirm: true, max_leads: N (1-200) } pra enfileirar.',
    };
  }

  // Throttle: 3 backfills por hora — operacao MUITO cara
  // (max_leads=200 × $0.05 = US$10 por chamada)
  @Post('backfill-missing-profiles')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  async backfillMissingProfiles(
    @Request() req: any,
    @Body() body: { confirm?: boolean; max_leads?: number },
  ) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');

    // Bug fix #C8: confirmacao explicita obrigatoria
    if (body?.confirm !== true) {
      throw new BadRequestException(
        'Confirmacao obrigatoria. Envie { confirm: true, max_leads: N } no body. ' +
        'Use GET /memories/backfill-missing-profiles/preview pra ver o total antes.',
      );
    }
    const maxLeadsRaw = Number(body?.max_leads);
    if (!Number.isInteger(maxLeadsRaw) || maxLeadsRaw < 1 || maxLeadsRaw > 200) {
      throw new BadRequestException(
        'max_leads obrigatorio: inteiro entre 1 e 200. ' +
        'Para enfileirar mais que 200 leads, faca multiplas chamadas em sequencia.',
      );
    }

    // Leads ativos (qualquer Conversation com mensagem nos ultimos 60d)
    // sem LeadProfile.summary preenchido. Limitado por max_leads.
    // Bug 2026-05-08: query original usava l.last_message_at, mas essa
    // coluna fica em Conversation. Reescrita usa EXISTS+Conversation.
    const leadsWithoutProfile = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM "Lead" l
      WHERE l.tenant_id = ${tenantId}
        AND EXISTS (
          SELECT 1 FROM "Conversation" c
          WHERE c.lead_id = l.id
            AND c.last_message_at > NOW() - INTERVAL '60 days'
        )
        AND NOT EXISTS (
          SELECT 1 FROM "LeadProfile" lp
          WHERE lp.lead_id = l.id AND length(coalesce(lp.summary, '')) > 50
        )
      ORDER BY (
        SELECT MAX(c.last_message_at) FROM "Conversation" c WHERE c.lead_id = l.id
      ) DESC
      LIMIT ${maxLeadsRaw}
    `;

    let enqueued = 0;
    for (const lead of leadsWithoutProfile) {
      try {
        await this.memoryQueue.add(
          'consolidate-profile',
          { tenant_id: tenantId, lead_id: lead.id },
          {
            jobId: `backfill-${tenantId}-${lead.id}`,
            // Espalha em ate 30 minutos pra nao saturar API
            delay: Math.floor(Math.random() * 30 * 60 * 1000),
            removeOnComplete: true,
            attempts: 2,
          },
        );
        enqueued++;
      } catch {
        // Ignora — proximo run pega
      }
    }

    // Audit log — quem disparou e quantos leads foram enfileirados
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: req.user?.id || null,
        action: 'memory_backfill_profiles',
        entity: 'Tenant',
        entity_id: tenantId,
        meta_json: {
          tenant_id: tenantId,
          requested_max: maxLeadsRaw,
          enqueued,
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return {
      success: true,
      enqueued,
      max_leads_requested: maxLeadsRaw,
      hint: enqueued === maxLeadsRaw
        ? 'Limite atingido. Pode haver mais leads sem profile — chame de novo apos os jobs concluirem.'
        : undefined,
    };
  }

  // ─── Lead ────────────────────────────────────────────────

  @Get('lead/:leadId')
  async listLead(@Request() req: any, @Param('leadId') leadId: string) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.listLead(req.user.tenant_id, leadId);
  }

  @Get('lead/:leadId/profile')
  async getLeadProfile(@Request() req: any, @Param('leadId') leadId: string) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.getLeadProfile(req.user.tenant_id, leadId);
  }

  @Post('lead/:leadId')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async createLeadMemory(
    @Request() req: any,
    @Param('leadId') leadId: string,
    @Body() body: { content: string; type?: string },
  ) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.createLeadMemory(req.user.tenant_id, leadId, body, req.user.id);
  }

  // Throttle: 10 regen por lead em 10min (admin clicando varias vezes em
  // sequencia drena cap diario). Cada regen custa ~US$0.02-0.05.
  @Post('lead/:leadId/regenerate')
  @Roles('ADMIN', 'ADVOGADO')
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  async regenerateProfile(@Request() req: any, @Param('leadId') leadId: string) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    // Bug fix #A5: valida que lead pertence ao tenant antes de enfileirar
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { tenant_id: true },
    });
    if (!lead) throw new BadRequestException('Lead nao encontrado');
    if (lead.tenant_id !== tenantId) {
      throw new BadRequestException('Lead nao pertence ao tenant atual');
    }
    const jobId = `consolidate-${tenantId}-${leadId}-${Date.now()}`;
    await this.memoryQueue.add(
      'consolidate-profile',
      { tenant_id: tenantId, lead_id: leadId },
      { jobId, removeOnComplete: true, attempts: 2 },
    );
    return { success: true, job_id: jobId };
  }

  /**
   * POST /memories/lead/:leadId/generate-facts
   *
   * Gera narrative_facts (estilo "Dos Fatos" da peticao inicial) sob demanda.
   * Caro (LLM gpt-4.1 default) — usado em 2 momentos: contratacao do cliente
   * e troca de atendente.
   *
   * Resposta: 200 OK com { job_id }. O job processa async; advogado
   * recarrega o painel do lead em ~10-20s pra ver o resultado em
   * LeadProfile.facts.narrative + LeadProfile.facts.key_dates.
   */
  // Throttle: 3 generate-facts por lead em 30min — gpt-4.1 e o modelo mais
  // caro do sistema de memoria (~US$0.05-0.15 por chamada). Sem cap, admin
  // gerando varias versoes "pra escolher uma" detona orcamento.
  @Post('lead/:leadId/generate-facts')
  @Roles('ADMIN', 'ADVOGADO')
  @Throttle({ default: { limit: 3, ttl: 30 * 60_000 } })
  async generateFacts(@Request() req: any, @Param('leadId') leadId: string) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    // Bug fix #A5: valida lead pertence ao tenant
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { tenant_id: true },
    });
    if (!lead) throw new BadRequestException('Lead nao encontrado');
    if (lead.tenant_id !== tenantId) {
      throw new BadRequestException('Lead nao pertence ao tenant atual');
    }
    const jobId = `gen-facts-${tenantId}-${leadId}-${Date.now()}`;
    await this.memoryQueue.add(
      'generate-narrative-facts',
      { tenant_id: tenantId, lead_id: leadId },
      { jobId, removeOnComplete: true, attempts: 2 },
    );
    return { success: true, job_id: jobId };
  }

  @Delete('lead/:leadId/all')
  @Roles('ADMIN')
  async deleteAllLeadMemories(@Request() req: any, @Param('leadId') leadId: string) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    // Bug fix #C5: passa actorUserId pra audit log
    return this.memoriesService.deleteAllLeadMemories(req.user.tenant_id, leadId, req.user.id);
  }
}
