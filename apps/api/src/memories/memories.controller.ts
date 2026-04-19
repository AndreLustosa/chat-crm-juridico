import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MemoriesService } from './memories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('memories')
@UseGuards(JwtAuthGuard)
export class MemoriesController {
  constructor(
    private readonly memoriesService: MemoriesService,
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
    );
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

  @Delete('lead/:leadId/all')
  @Roles('ADMIN')
  async deleteAllLeadMemories(@Request() req: any, @Param('leadId') leadId: string) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.memoriesService.deleteAllLeadMemories(req.user.tenant_id, leadId);
  }
}
