import { Controller, Get, Post, Patch, Delete, Body, UseGuards, Request, Param, Put, Logger, UseInterceptors, UploadedFile, Res, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';
import { CreateSkillDto, UpdateSkillDto, CreateSkillToolDto, UpdateSkillToolDto } from './dto/settings.dto';
import { PrismaService } from '../prisma/prisma.service';
import { computeBusinessHoursInfo } from '@crm/shared';

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
    private readonly prisma: PrismaService,
  ) {}

  // ─── Generic Settings ─────────────────────────────────

  @Get()
  @Roles('ADMIN')
  async getAll() {
    return this.settingsService.getAll();
  }

  @Put()
  @Roles('ADMIN')
  async upsert(@Body() data: { key: string; value: string }) {
    return this.settingsService.upsert(data.key, data.value);
  }

  // ─── DJEN Lawyers ──────────────────────────────────────

  @Get('djen-lawyers')
  @Roles('ADMIN', 'ADVOGADO')
  async getDjenLawyers() {
    const raw = await this.settingsService.get('DJEN_LAWYERS');
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
    // Fallback: montar a partir dos settings legados
    const oab  = (await this.settingsService.get('DJEN_OAB_NUMBER'))  || '14209';
    const uf   = (await this.settingsService.get('DJEN_OAB_UF'))      || 'AL';
    const nome = (await this.settingsService.get('DJEN_LAWYER_NAME')) || 'André Freire Lustosa';
    return [{ oab, uf, nome }];
  }

  @Patch('djen-lawyers')
  @Roles('ADMIN')
  async saveDjenLawyers(@Body() body: { lawyers: Array<{ oab: string; uf: string; nome: string }> }) {
    await this.settingsService.upsert('DJEN_LAWYERS', JSON.stringify(body.lawyers));
    return { message: 'Advogados DJEN salvos com sucesso', count: body.lawyers.length };
  }

  // ─── Horário do Escritório (afeta cron AfterHours e {{business_hours_info}}) ───

  @Get('office-hours')
  @Roles('ADMIN')
  async getOfficeHours() {
    const [enabled, start, end, days, tz] = await Promise.all([
      this.settingsService.get('AFTER_HOURS_AI_ENABLED'),
      this.settingsService.get('AFTER_HOURS_START'),
      this.settingsService.get('AFTER_HOURS_END'),
      this.settingsService.get('BUSINESS_DAYS'),
      this.settingsService.get('TIMEZONE'),
    ]);
    return {
      // NOTA: na var `AFTER_HOURS_START` está a hora que o escritório FECHA.
      // Na UI exportamos como "close" pra não confundir o admin.
      ai_enabled: (enabled ?? 'true').toLowerCase() !== 'false',
      open_time:  end   ?? '08:00', // AFTER_HOURS_END  = abertura
      close_time: start ?? '17:00', // AFTER_HOURS_START = fechamento
      business_days: (days ?? '1,2,3,4,5')
        .split(',')
        .map((v) => Number.parseInt(v.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6),
      timezone: tz ?? 'America/Maceio',
    };
  }

  @Put('office-hours')
  @Roles('ADMIN')
  async saveOfficeHours(@Body() body: {
    ai_enabled?: boolean;
    open_time?: string;
    close_time?: string;
    business_days?: number[];
    timezone?: string;
  }) {
    if (typeof body.ai_enabled === 'boolean') {
      await this.settingsService.upsert('AFTER_HOURS_AI_ENABLED', body.ai_enabled ? 'true' : 'false');
    }
    if (body.open_time && /^\d{2}:\d{2}$/.test(body.open_time)) {
      await this.settingsService.upsert('AFTER_HOURS_END', body.open_time);
    }
    if (body.close_time && /^\d{2}:\d{2}$/.test(body.close_time)) {
      await this.settingsService.upsert('AFTER_HOURS_START', body.close_time);
    }
    if (Array.isArray(body.business_days)) {
      const clean = body.business_days
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
        .join(',');
      if (clean) await this.settingsService.upsert('BUSINESS_DAYS', clean);
    }
    if (body.timezone && body.timezone.length > 0) {
      await this.settingsService.upsert('TIMEZONE', body.timezone);
    }
    return { message: 'Horário do escritório salvo' };
  }

  /**
   * Preview das variáveis DINÂMICAS do sistema (calculadas em tempo real).
   * Usado pela UI de skills para mostrar ao editor o que cada variável
   * resolveria AGORA — evita surpresa no prompt final.
   *
   * Só inclui variáveis globais (não por-lead). Para variáveis por-lead
   * (lead_name, lead_memory, etc), mostrar "ex:" em vez de preview real.
   */
  @Get('variable-preview')
  @Roles('ADMIN')
  async getVariablePreview() {
    const businessHoursInfo = await computeBusinessHoursInfo(this.prisma).catch(() => '');
    return {
      business_hours_info: businessHoursInfo,
    };
  }

  @Get('whatsapp-config/health')
  @Roles('ADMIN')
  async checkHealth() {
    try {
      await this.whatsappService.listInstances();
      return { status: 'online' };
    } catch (error) {
      return { status: 'offline', error: error.message };
    }
  }

  @Get('whatsapp-config')
  @Roles('ADMIN')
  async getWhatsAppConfig() {
    const config = await this.settingsService.getWhatsAppConfig();
    return { ...config, apiKey: maskApiKey(config.apiKey) };
  }

  @Post('whatsapp-config')
  @Roles('ADMIN')
  async setWhatsAppConfig(@Body() data: { apiUrl: string; apiKey?: string; webhookUrl?: string }) {
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
  @Roles('ADMIN')
  async getAiConfig() {
    const config = await this.settingsService.getAiConfig();
    return { ...config, apiKey: maskApiKey(config.apiKey) };
  }

  @Get('transcription-config')
  @Roles('ADMIN')
  async getTranscriptionConfig() {
    const cfg = await this.settingsService.getTranscriptionConfig();
    return {
      ...cfg,
      // Mascara segredos no GET (admin reedita sem ver o valor real)
      groqApiKey: maskApiKey(cfg.groqApiKey),
      hfToken: maskApiKey(cfg.hfToken),
      isGroqConfigured: !!cfg.groqApiKey,
      isHfTokenConfigured: !!cfg.hfToken,
    };
  }

  @Post('transcription-config')
  @Roles('ADMIN')
  async setTranscriptionConfig(@Body() data: {
    groqApiKey?: string;
    groqModel?: string;
    whisperServiceUrl?: string;
    defaultProvider?: string;
    hfToken?: string;
  }) {
    await this.settingsService.setTranscriptionConfig(data);
    return { message: 'Configurações de transcrição salvas' };
  }

  @Post('ai-config')
  @Roles('ADMIN')
  async setAiConfig(@Body() data: { apiKey?: string; adminKey?: string; anthropicApiKey?: string; defaultModel?: string; djenModel?: string; djenPrompt?: string; djenNotifyTemplate?: string; adminBotEnabled?: boolean; cooldownSeconds?: number; memoryProfileModel?: string; memoryFactsModel?: string; memoryOrgFrequency?: string; memoryOrgWeekday?: number; memoryOrgHour?: number; memoryOrgRequireApproval?: boolean }) {
    if (data.apiKey)    await this.settingsService.setAiConfig(data.apiKey);
    if (data.adminKey)  await this.settingsService.setAdminKey(data.adminKey);
    if (data.anthropicApiKey) await this.settingsService.upsert('ANTHROPIC_API_KEY', data.anthropicApiKey);
    if (data.defaultModel) await this.settingsService.setDefaultModel(data.defaultModel);
    if (data.djenModel)    await this.settingsService.setDjenModel(data.djenModel);
    if (data.djenPrompt !== undefined) await this.settingsService.setDjenPrompt(data.djenPrompt);
    if (data.djenNotifyTemplate !== undefined) await this.settingsService.setDjenNotifyTemplate(data.djenNotifyTemplate);
    if (data.adminBotEnabled !== undefined) await this.settingsService.setAdminBotEnabled(data.adminBotEnabled);
    if (data.cooldownSeconds !== undefined) await this.settingsService.setCooldownSeconds(Number(data.cooldownSeconds));
    // Modelos da memoria — escolha do admin via UI Ajustes IA
    if (data.memoryProfileModel) await this.settingsService.upsert('MEMORY_PROFILE_MODEL', data.memoryProfileModel);
    if (data.memoryFactsModel)   await this.settingsService.upsert('MEMORY_FACTS_MODEL', data.memoryFactsModel);
    // Workflow OrganizationProfile (Fase 3 PR2)
    if (data.memoryOrgFrequency) {
      const v = data.memoryOrgFrequency.toLowerCase();
      if (!['daily', 'weekly', 'manual'].includes(v)) {
        throw new Error('memoryOrgFrequency deve ser daily, weekly ou manual');
      }
      await this.settingsService.upsert('MEMORY_ORG_CONSOLIDATION_FREQUENCY', v);
    }
    if (data.memoryOrgWeekday !== undefined) {
      const w = Number(data.memoryOrgWeekday);
      if (!Number.isInteger(w) || w < 1 || w > 7) {
        throw new Error('memoryOrgWeekday deve ser 1-7');
      }
      await this.settingsService.upsert('MEMORY_ORG_CONSOLIDATION_WEEKDAY', String(w));
    }
    if (data.memoryOrgHour !== undefined) {
      const h = Number(data.memoryOrgHour);
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        throw new Error('memoryOrgHour deve ser 0-23');
      }
      await this.settingsService.upsert('MEMORY_ORG_CONSOLIDATION_HOUR', String(h));
    }
    if (data.memoryOrgRequireApproval !== undefined) {
      await this.settingsService.upsert('MEMORY_ORG_REQUIRE_APPROVAL', String(!!data.memoryOrgRequireApproval));
    }
    return { message: 'Configurações de IA salvas com sucesso' };
  }

  @Get('skills')
  async getSkills() {
    return this.settingsService.getSkills();
  }

  @Patch('skills/:id/toggle')
  @Roles('ADMIN')
  async toggleSkill(@Param('id') id: string, @Body() data: { isActive: boolean }) {
    await this.settingsService.toggleSkill(id, data.isActive);
    return { message: 'Skill atualizada com sucesso' };
  }

  @Post('skills/reset-defaults')
  @Roles('ADMIN')
  async resetSkillsToDefaults() {
    return this.settingsService.resetSkillsToDefaults();
  }

  @Post('skills')
  @Roles('ADMIN')
  async createSkill(@Body() data: CreateSkillDto) {
    return this.settingsService.createSkill(data);
  }

  @Patch('skills/:id')
  @Roles('ADMIN')
  async updateSkill(@Param('id') id: string, @Body() data: UpdateSkillDto) {
    return this.settingsService.updateSkill(id, data);
  }

  @Delete('skills/:id')
  @Roles('ADMIN')
  async deleteSkill(@Param('id') id: string) {
    return this.settingsService.deleteSkill(id);
  }

  // ─── Skill Tools CRUD ─────────────────────────────────

  @Get('skills/:skillId/tools')
  async getSkillTools(@Param('skillId') skillId: string) {
    return this.settingsService.getSkillTools(skillId);
  }

  @Post('skills/:skillId/tools')
  @Roles('ADMIN')
  async createSkillTool(@Param('skillId') skillId: string, @Body() data: CreateSkillToolDto) {
    return this.settingsService.createSkillTool(skillId, data);
  }

  @Patch('skills/tools/:toolId')
  @Roles('ADMIN')
  async updateSkillTool(@Param('toolId') toolId: string, @Body() data: UpdateSkillToolDto) {
    return this.settingsService.updateSkillTool(toolId, data);
  }

  @Delete('skills/tools/:toolId')
  @Roles('ADMIN')
  async deleteSkillTool(@Param('toolId') toolId: string) {
    return this.settingsService.deleteSkillTool(toolId);
  }

  // ─── Skill Assets / References ──────────────────────────

  @Get('skills/:skillId/assets')
  async getSkillAssets(@Param('skillId') skillId: string) {
    return this.settingsService.getSkillAssets(skillId);
  }

  @Post('skills/:skillId/assets')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSkillAsset(
    @Param('skillId') skillId: string,
    @UploadedFile() file: any,
    @Body() body: { asset_type?: string; inject_mode?: string },
  ) {
    if (!file) throw new NotFoundException('Nenhum arquivo enviado');

    const ext = file.originalname.split('.').pop() || 'bin';
    const uuid = crypto.randomUUID();
    const s3Key = `skill-assets/${skillId}/${uuid}.${ext}`;

    await this.s3Service.uploadBuffer(s3Key, file.buffer, file.mimetype);

    let contentText: string | null = null;
    const assetType = body.asset_type || 'asset';
    const injectMode = body.inject_mode || (assetType === 'reference' ? 'full_text' : 'none');

    if (assetType === 'reference' && injectMode !== 'none') {
      if (file.mimetype === 'text/markdown' || file.mimetype === 'text/plain' || ext === 'md' || ext === 'txt') {
        contentText = file.buffer.toString('utf-8');
      }
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
  @Roles('ADMIN')
  async updateSkillAsset(@Param('assetId') assetId: string, @Body() body: { inject_mode?: string; asset_type?: string; content_text?: string; size?: number }) {
    return this.settingsService.updateSkillAsset(assetId, body);
  }

  @Delete('skills/assets/:assetId')
  @Roles('ADMIN')
  async deleteSkillAsset(@Param('assetId') assetId: string) {
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
  @Roles('ADMIN')
  async getAiCosts() {
    return this.settingsService.getAiCosts();
  }

  // ─── Clicksign ────────────────────────────────────────

  @Get('clicksign')
  @Roles('ADMIN')
  async getClicksign() {
    const cfg = await this.settingsService.getClicksignConfig();
    return {
      ...cfg,
      apiToken:     maskApiKey(cfg.apiToken),
      webhookToken: maskApiKey(cfg.webhookToken),
    };
  }

  @Patch('clicksign')
  @Roles('ADMIN')
  async setClicksign(@Body() body: { baseUrl?: string; apiToken?: string; webhookToken?: string }) {
    await this.settingsService.setClicksignConfig(body);
    return { ok: true };
  }

  // ─── Contrato Trabalhista ─────────────────────────────

  @Get('contract')
  async getContract() {
    return this.settingsService.getContractConfig();
  }

  @Patch('contract')
  @Roles('ADMIN')
  async setContract(@Body() body: Record<string, string>) {
    await this.settingsService.setContractConfig(body);
    return { ok: true };
  }

  // ─── CRM Config ───────────────────────────────────────

  @Get('crm-config')
  async getCrmConfig() {
    return this.settingsService.getCrmConfig();
  }

  @Patch('crm-config')
  @Roles('ADMIN')
  async setCrmConfig(@Body() body: { stagnationDays?: number }) {
    await this.settingsService.setCrmConfig(body);
    return { ok: true };
  }

  // ─── Canned Responses ─────────────────────────────────

  @Get('canned-responses')
  async getCannedResponses() {
    return this.settingsService.getCannedResponses();
  }

  @Patch('canned-responses')
  @Roles('ADMIN')
  async setCannedResponses(@Body() body: { responses: { id: string; label: string; text: string }[] }) {
    await this.settingsService.setCannedResponses(body.responses || []);
    return { ok: true };
  }

  // ─── TTS (Text-to-Speech) ─────────────────────────────

  @Get('tts')
  @Roles('ADMIN')
  async getTtsConfig() {
    return this.settingsService.getTtsConfig();
  }

  @Patch('tts')
  @Roles('ADMIN')
  async setTtsConfig(@Body() body: { enabled?: boolean; googleApiKey?: string; voice?: string; language?: string }) {
    await this.settingsService.setTtsConfig(body);
    return { ok: true };
  }
}
