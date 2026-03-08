import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request, Logger } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettingsService } from '../settings/settings.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get('instances')
  async listInstances() {
    return this.whatsappService.listInstances();
  }

  @Post('instances')
  async createInstance(@Body('name') name: string) {
    const instance = await this.whatsappService.createInstance(name);
    
    // Autoconfigura o webhook assim que a instância é criada
    try {
      const config = await this.settingsService.getWhatsAppConfig();
      if (config.webhookUrl) {
        await this.whatsappService.setWebhook(name, config.webhookUrl);
        this.logger.log(`Webhook configurado automaticamente para instância: ${name}`);
      }
    } catch (e) {
      this.logger.error(`Falha ao configurar webhook automático para ${name}:`, e);
    }

    return instance;
  }

  @Delete('instances/:name')
  async deleteInstance(@Param('name') name: string) {
    return this.whatsappService.deleteInstance(name);
  }

  @Post('instances/:name/logout')
  async logoutInstance(@Param('name') name: string) {
    return this.whatsappService.logoutInstance(name);
  }

  @Get('instances/:name/connect')
  async getConnectCode(@Param('name') name: string) {
    return this.whatsappService.getConnectCode(name);
  }

  @Get('instances/:name/status')
  async getConnectionStatus(@Param('name') name: string) {
    return this.whatsappService.getConnectionStatus(name);
  }

  @Get('instances/:name/contacts')
  async fetchContacts(@Param('name') name: string) {
    return this.whatsappService.fetchContacts(name);
  }

  @Post('instances/:name/sync')
  async syncContacts(@Param('name') name: string, @Request() req: any) {
    const tenantId = req.user?.tenant_id;
    return this.whatsappService.syncContacts(name, tenantId);
  }

  @Post('instances/:name/settings')
  async setInstanceSettings(
    @Param('name') name: string,
    @Body() body: { rejectCall?: boolean; msgCall?: string; alwaysOnline?: boolean },
  ) {
    return this.whatsappService.setInstanceSettings(name, body);
  }
}
