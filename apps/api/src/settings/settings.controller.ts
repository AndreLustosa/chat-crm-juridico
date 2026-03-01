import { Controller, Get, Post, Body, UseGuards, Request, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
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
    @Body() data: { apiKey: string }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem alterar configurações de IA');
    }
    await this.settingsService.setAiConfig(data.apiKey);
    return { message: 'Chave OpenAI salva com sucesso' };
  }
}
