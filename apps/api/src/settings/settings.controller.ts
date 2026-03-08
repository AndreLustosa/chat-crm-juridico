import { Controller, Get, Post, Patch, Delete, Body, UseGuards, Request, ForbiddenException, Param, Put, Logger } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateSkillDto, UpdateSkillDto } from './dto/settings.dto';

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
    @Body() data: { apiKey?: string; adminKey?: string; defaultModel?: string; cooldownSeconds?: number }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem alterar configurações de IA');
    }
    if (data.apiKey)    await this.settingsService.setAiConfig(data.apiKey);
    if (data.adminKey)  await this.settingsService.setAdminKey(data.adminKey);
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

  @Get('ai-costs')
  async getAiCosts(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem ver custos de IA');
    }
    return this.settingsService.getAiCosts();
  }
}
