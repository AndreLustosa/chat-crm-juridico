import { Controller, Get, Post, Patch, Delete, Body, UseGuards, Request, ForbiddenException, Param } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly whatsappService: WhatsappService,
  ) {}

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
    return this.settingsService.getWhatsAppConfig();
  }

  @Post('whatsapp-config')
  async setWhatsAppConfig(
    @Request() req: any,
    @Body() data: { apiUrl: string; apiKey: string; webhookUrl?: string }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem alterar configurações de API');
    }

    console.log('Salvando configurações:', data);
    await this.settingsService.setWhatsAppConfig(data.apiUrl, data.apiKey, data.webhookUrl);

    // Reaplicar webhook em todas as instâncias existentes
    if (data.webhookUrl) {
      try {
        const instances = await this.whatsappService.listInstances();
        const names: string[] = (instances as any[]).map((i) => i.instanceName).filter(Boolean);
        await Promise.allSettled(
          names.map((name) => this.whatsappService.setWebhook(name, data.webhookUrl!)),
        );
        console.log(`Webhook atualizado em ${names.length} instância(s):`, names);
      } catch (e) {
        console.error('Falha ao reaplicar webhook nas instâncias:', e);
      }
    }

    return { message: 'Configurações atualizadas com sucesso' };
  }

  @Get('ai-config')
  async getAiConfig(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem ver configurações de IA');
    }
    return this.settingsService.getAiConfig();
  }

  @Post('ai-config')
  async setAiConfig(
    @Request() req: any,
    @Body() data: { apiKey?: string; defaultModel?: string }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem alterar configurações de IA');
    }
    if (data.apiKey) await this.settingsService.setAiConfig(data.apiKey);
    if (data.defaultModel) await this.settingsService.setDefaultModel(data.defaultModel);
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
  async createSkill(@Request() req: any, @Body() data: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem criar skills');
    }
    return this.settingsService.createSkill(data);
  }

  @Patch('skills/:id')
  async updateSkill(@Request() req: any, @Param('id') id: string, @Body() data: any) {
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
}
