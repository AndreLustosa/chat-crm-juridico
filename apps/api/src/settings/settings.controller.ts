import { Controller, Get, Post, Body, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

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
    @Body() data: { apiUrl: string; apiKey: string }
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem alterar configurações de API');
    }
    await this.settingsService.setWhatsAppConfig(data.apiUrl, data.apiKey);
    return { message: 'Configurações atualizadas com sucesso' };
  }
}
