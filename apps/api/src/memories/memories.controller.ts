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

  @Post('organization/regenerate-profile')
  @Roles('ADMIN', 'ADVOGADO')
  async regenerateOrgProfile(@Request() req: any) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.regenerateOrganizationProfile(req.user.tenant_id);
  }

  @Post('organization/rebuild-profile')
  @Roles('ADMIN')
  async rebuildOrgProfile(@Request() req: any) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.rebuildOrganizationProfile(req.user.tenant_id);
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
  async createOrg(
    @Request() req: any,
    @Body() body: { content: string; subcategory: string; confidence?: number },
  ) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.createOrganization(req.user.tenant_id, body);
  }

  @Put(':id')
  @Roles('ADMIN', 'ADVOGADO')
  async updateMemory(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { content?: string; subcategory?: string },
  ) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.updateMemory(id, req.user.tenant_id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ADVOGADO')
  async deleteMemory(@Request() req: any, @Param('id') id: string) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.deleteMemory(id, req.user.tenant_id);
  }

  @Post('extract-now')
  @Roles('ADMIN')
  async extractNow(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
    const jobId = `manual-extract-${tenantId}-${Date.now()}`;
    await this.memoryQueue.add(
      'manual-extract',
      { tenant_id: tenantId },
      { jobId, removeOnComplete: true, attempts: 2 },
    );
    return { success: true, job_id: jobId };
  }

  /**
   * POST /memories/backfill-missing-profiles
   *
   * Enfileira `consolidate-profile` pra TODOS os leads ativos do tenant
   * que ainda nao tem LeadProfile.summary. Cobre os 191 leads orfaos do
   * diagnostico 2026-05-08.
   *
   * Idempotente: se um lead ja tem profile, o job apenas regenera.
   * Custo estimado: ~$0.02-0.05 por lead × N leads.
   */
  @Post('backfill-missing-profiles')
  @Roles('ADMIN')
  async backfillMissingProfiles(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');

    // Leads ativos (qualquer Conversation com mensagem nos ultimos 60d)
    // sem LeadProfile.summary preenchido.
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

    return { success: true, total_leads_without_profile: leadsWithoutProfile.length, enqueued };
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
  async createLeadMemory(
    @Request() req: any,
    @Param('leadId') leadId: string,
    @Body() body: { content: string; type?: string },
  ) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.createLeadMemory(req.user.tenant_id, leadId, body);
  }

  @Post('lead/:leadId/regenerate')
  @Roles('ADMIN', 'ADVOGADO')
  async regenerateProfile(@Request() req: any, @Param('leadId') leadId: string) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
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
  @Post('lead/:leadId/generate-facts')
  @Roles('ADMIN', 'ADVOGADO')
  async generateFacts(@Request() req: any, @Param('leadId') leadId: string) {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id ausente');
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
    return this.memoriesService.deleteAllLeadMemories(req.user.tenant_id, leadId);
  }
}
