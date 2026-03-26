import { Controller, Get, Post, Patch, Delete, Body, UseGuards, Request, ForbiddenException, Param, Put, Logger, UseInterceptors, UploadedFile, Res, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';
import { CreateSkillDto, UpdateSkillDto, CreateSkillToolDto, UpdateSkillToolDto } from './dto/settings.dto';

/** Mascara uma chave de API, mostrando apenas os primeiros 4 e últimos 4 caracteres */
function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 10) return '****';
  return `${key.slice(0, 4)}${'*'.repeat(Math.min(key.length - 8, 20))}${key.slice(-4)}`;
}

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly whatsappService: WhatsappService,
    private readonly s3Service: S3Service,
  ) {}

  // ─── Generic Settings ─────────────────────────────────

  @Get()
  async getAll(@Request() req: any) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    return this.settingsService.getAll();
  }

  @Put()
  async upsert(@Request() req: any, @Body() data: { key: string; value: string }) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    return this.settingsService.upsert(data.key, data.value);
  }

  @Get('whatsapp-config/health')
  async checkHealth(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem testar a conexão');
    }
    
    try {
      // Tenta listar instâncias como um teste de fumaça para a API e Key
      await this.whatsappService.listInstances();
      return { status: 'online' };
    } catch (error) {
      return { status: 'offline', error: error.message };
    }
  }

  @Get('whatsapp-config')
  async getWhatsAppConfig(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem ver configurações de API');
    }
    const config = await this.settingsService.getWhatsAppConfig();
    return { ...config, apiKey: maskApiKey(config.apiKey) };
  }

  @Post('whatsapp-config')
  async setWhatsAppConfig(
    @Request() req: any,
    @Body() data: { apiUrl: string; apiKey?: string; webhookUrl?: string }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem alterar configurações de API');
    }

    await this.settingsService.setWhatsAppConfig(data.apiUrl, data.apiKey, data.webhookUrl);

    // Reaplicar webhook em todas as instâncias existentes
    if (data.webhookUrl) {
      try {
        const instances = await this.whatsappService.listInstances();
        const names: string[] = (instances as any[]).map((i) => i.instanceName).filter(Boolean);
        await Promise.allSettled(
          names.map((name) => this.whatsappService.setWebhook(name, data.webhookUrl!)),
        );
        this.logger.log(`Webhook atualizado em ${names.length} instância(s)`);
      } catch (e) {
        this.logger.error('Falha ao reaplicar webhook nas instâncias:', e?.message);
      }
    }

    return { message: 'Configurações atualizadas com sucesso' };
  }

  @Get('ai-config')
  async getAiConfig(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem ver configurações de IA');
    }
    const config = await this.settingsService.getAiConfig();
    return { ...config, apiKey: maskApiKey(config.apiKey) };
  }

  @Post('ai-config')
  async setAiConfig(
    @Request() req: any,
    @Body() data: { apiKey?: string; adminKey?: string; anthropicApiKey?: string; defaultModel?: string; cooldownSeconds?: number }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem alterar configurações de IA');
    }
    if (data.apiKey)    await this.settingsService.setAiConfig(data.apiKey);
    if (data.adminKey)  await this.settingsService.setAdminKey(data.adminKey);
    if (data.anthropicApiKey) await this.settingsService.upsert('ANTHROPIC_API_KEY', data.anthropicApiKey);
    if (data.defaultModel) await this.settingsService.setDefaultModel(data.defaultModel);
    if (data.cooldownSeconds !== undefined) await this.settingsService.setCooldownSeconds(Number(data.cooldownSeconds));
    return { message: 'Configurações de IA salvas com sucesso' };
  }

  @Get('skills')
  async getSkills() {
    return this.settingsService.getSkills();
  }

  @Patch('skills/:id/toggle')
  async toggleSkill(
    @Request() req: any,
    @Param('id') id: string,
    @Body() data: { isActive: boolean }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem gerenciar skills');
    }
    await this.settingsService.toggleSkill(id, data.isActive);
    return { message: 'Skill atualizada com sucesso' };
  }

  @Post('skills')
  async createSkill(@Request() req: any, @Body() data: CreateSkillDto) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem criar skills');
    }
    return this.settingsService.createSkill(data);
  }

  @Patch('skills/:id')
  async updateSkill(@Request() req: any, @Param('id') id: string, @Body() data: UpdateSkillDto) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem editar skills');
    }
    return this.settingsService.updateSkill(id, data);
  }

  @Delete('skills/:id')
  async deleteSkill(@Request() req: any, @Param('id') id: string) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem excluir skills');
    }
    return this.settingsService.deleteSkill(id);
  }

  @Post('skills/reset-defaults')
  async resetSkillsToDefaults(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores');
    }
    return this.settingsService.resetSkillsToDefaults();
  }

  // ─── Skill Tools CRUD ─────────────────────────────────

  @Get('skills/:skillId/tools')
  async getSkillTools(@Param('skillId') skillId: string) {
    return this.settingsService.getSkillTools(skillId);
  }

  @Post('skills/:skillId/tools')
  async createSkillTool(
    @Request() req: any,
    @Param('skillId') skillId: string,
    @Body() data: CreateSkillToolDto,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    return this.settingsService.createSkillTool(skillId, data);
  }

  @Patch('skills/tools/:toolId')
  async updateSkillTool(
    @Request() req: any,
    @Param('toolId') toolId: string,
    @Body() data: UpdateSkillToolDto,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    return this.settingsService.updateSkillTool(toolId, data);
  }

  @Delete('skills/tools/:toolId')
  async deleteSkillTool(@Request() req: any, @Param('toolId') toolId: string) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    return this.settingsService.deleteSkillTool(toolId);
  }

  // ─── Skill Assets / References ──────────────────────────

  @Get('skills/:skillId/assets')
  async getSkillAssets(@Param('skillId') skillId: string) {
    return this.settingsService.getSkillAssets(skillId);
  }

  @Post('skills/:skillId/assets')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSkillAsset(
    @Request() req: any,
    @Param('skillId') skillId: string,
    @UploadedFile() file: any,
    @Body() body: { asset_type?: string; inject_mode?: string },
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    if (!file) throw new NotFoundException('Nenhum arquivo enviado');

    const ext = file.originalname.split('.').pop() || 'bin';
    const uuid = crypto.randomUUID();
    const s3Key = `skill-assets/${skillId}/${uuid}.${ext}`;

    await this.s3Service.uploadBuffer(s3Key, file.buffer, file.mimetype);

    // Extract text content for references (.md, .txt)
    let contentText: string | null = null;
    const assetType = body.asset_type || 'asset';
    const injectMode = body.inject_mode || (assetType === 'reference' ? 'full_text' : 'none');

    if (assetType === 'reference' && injectMode !== 'none') {
      if (file.mimetype === 'text/markdown' || file.mimetype === 'text/plain' || ext === 'md' || ext === 'txt') {
        contentText = file.buffer.toString('utf-8');
      }
      // TODO: Add PDF/DOCX text extraction with mammoth/pdf-parse
    }

    return this.settingsService.createSkillAsset(skillId, {
      name: file.originalname,
      s3_key: s3Key,
      mime_type: file.mimetype,
      size: file.size,
      asset_type: assetType,
      inject_mode: injectMode,
      content_text: contentText,
    });
  }

  @Patch('skills/assets/:assetId')
  async updateSkillAsset(
    @Request() req: any,
    @Param('assetId') assetId: string,
    @Body() body: { inject_mode?: string; asset_type?: string },
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    return this.settingsService.updateSkillAsset(assetId, body);
  }

  @Delete('skills/assets/:assetId')
  async deleteSkillAsset(@Request() req: any, @Param('assetId') assetId: string) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    const asset = await this.settingsService.deleteSkillAsset(assetId);
    if (asset?.s3_key) {
      try { await this.s3Service.deleteObject(asset.s3_key); } catch {}
    }
    return { ok: true };
  }

  @Get('skills/assets/:assetId/download')
  async downloadSkillAsset(@Param('assetId') assetId: string, @Res() res: any) {
    const asset = await this.settingsService.findSkillAssetById(assetId);
    if (!asset) throw new NotFoundException('Asset não encontrado');

    const { buffer, contentType } = await this.s3Service.getObjectBuffer(asset.s3_key);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(asset.name)}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Get('ai-costs')
  async getAiCosts(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem ver custos de IA');
    }
    return this.settingsService.getAiCosts();
  }

  // ─── Clicksign ────────────────────────────────────────

  @Get('clicksign')
  async getClicksign(@Request() req: any) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    const cfg = await this.settingsService.getClicksignConfig();
    return {
      ...cfg,
      apiToken:     maskApiKey(cfg.apiToken),
      webhookToken: maskApiKey(cfg.webhookToken),
    };
  }

  @Patch('clicksign')
  async setClicksign(@Request() req: any, @Body() body: { baseUrl?: string; apiToken?: string; webhookToken?: string }) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    await this.settingsService.setClicksignConfig(body);
    return { ok: true };
  }

  // ─── Contrato Trabalhista ─────────────────────────────

  @Get('contract')
  async getContract() {
    return this.settingsService.getContractConfig();
  }

  @Patch('contract')
  async setContract(@Request() req: any, @Body() body: Record<string, string>) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    await this.settingsService.setContractConfig(body);
    return { ok: true };
  }

  // ─── CRM Config ───────────────────────────────────────

  @Get('crm-config')
  async getCrmConfig() {
    return this.settingsService.getCrmConfig();
  }

  @Patch('crm-config')
  async setCrmConfig(@Request() req: any, @Body() body: { stagnationDays?: number }) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    await this.settingsService.setCrmConfig(body);
    return { ok: true };
  }

  // ─── Canned Responses ─────────────────────────────────

  @Get('canned-responses')
  async getCannedResponses() {
    return this.settingsService.getCannedResponses();
  }

  @Patch('canned-responses')
  async setCannedResponses(
    @Request() req: any,
    @Body() body: { responses: { id: string; label: string; text: string }[] },
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    await this.settingsService.setCannedResponses(body.responses || []);
    return { ok: true };
  }

  // ─── TTS (Text-to-Speech) ─────────────────────────────

  @Get('tts')
  async getTtsConfig(@Request() req: any) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    return this.settingsService.getTtsConfig();
  }

  @Patch('tts')
  async setTtsConfig(
    @Request() req: any,
    @Body() body: { enabled?: boolean; googleApiKey?: string; voice?: string; language?: string },
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas administradores');
    await this.settingsService.setTtsConfig(body);
    return { ok: true };
  }
}
