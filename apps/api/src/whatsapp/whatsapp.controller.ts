import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request, Logger } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettingsService } from '../settings/settings.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bug fix 2026-05-10 (PR1 Webhooks #15): adicionar @Roles('ADMIN') +
 * audit log em endpoints destrutivos. Antes qualquer user logado podia:
 *   - createInstance: cria instancia WhatsApp (sem audit, sem tenant scope)
 *   - deleteInstance: derruba a instancia do escritorio
 *   - logoutInstance: forca logout, encerra sessao do WhatsApp
 *   - setInstanceSettings: muda rejectCall, alwaysOnline (afeta operacao)
 * Agora @Roles + audit log + tenant validation onde aplicavel.
 */
@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly settingsService: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Audit fire-and-forget — nao bloqueia operacao. */
  private auditAction(actorUserId: string | undefined, action: string, instanceName: string, meta?: any) {
    this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action,
        entity: 'Instance',
        entity_id: instanceName,
        meta_json: meta || undefined,
      },
    }).catch((e: any) => {
      this.logger.warn(`[AUDIT] Falha ao gravar ${action} de ${instanceName}: ${e.message}`);
    });
  }

  /**
   * Verifica que a instance pertence ao tenant do user (ou nao tem tenant —
   * legacy single-tenant). ADMIN sem tenant_id no token nao passa.
   */
  private async assertInstanceTenant(name: string, req: any): Promise<void> {
    const userTenantId = req?.user?.tenant_id;
    if (!userTenantId) {
      throw new Error('Token sem tenant_id — login expirado');
    }
    const instance = await this.prisma.instance.findFirst({
      where: { name },
      select: { tenant_id: true },
    });
    // Se nao existe, deixa o service retornar 404
    if (!instance) return;
    if (instance.tenant_id && instance.tenant_id !== userTenantId) {
      this.logger.warn(
        `[CROSS-TENANT BLOCKED] user ${req?.user?.id} (tenant ${userTenantId}) ` +
        `tentou operar em instance "${name}" (tenant ${instance.tenant_id})`,
      );
      throw new Error('Instancia pertence a outro tenant');
    }
  }

  @Get('instances')
  async listInstances() {
    return this.whatsappService.listInstances();
  }

  @Post('instances')
  @Roles('ADMIN')
  async createInstance(@Body('name') name: string, @Request() req: any) {
    const instance = await this.whatsappService.createInstance(name);
    this.auditAction(req?.user?.id, 'whatsapp_create_instance', name, { tenant_id: req?.user?.tenant_id });

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
  @Roles('ADMIN')
  async deleteInstance(@Param('name') name: string, @Request() req: any) {
    await this.assertInstanceTenant(name, req);
    this.auditAction(req?.user?.id, 'whatsapp_delete_instance', name, { tenant_id: req?.user?.tenant_id });
    return this.whatsappService.deleteInstance(name);
  }

  @Post('instances/:name/logout')
  @Roles('ADMIN')
  async logoutInstance(@Param('name') name: string, @Request() req: any) {
    await this.assertInstanceTenant(name, req);
    this.auditAction(req?.user?.id, 'whatsapp_logout_instance', name, { tenant_id: req?.user?.tenant_id });
    return this.whatsappService.logoutInstance(name);
  }

  @Get('instances/:name/connect')
  @Roles('ADMIN')
  async getConnectCode(@Param('name') name: string, @Request() req: any) {
    await this.assertInstanceTenant(name, req);
    return this.whatsappService.getConnectCode(name);
  }

  @Get('instances/:name/status')
  async getConnectionStatus(@Param('name') name: string) {
    return this.whatsappService.getConnectionStatus(name);
  }

  @Get('instances/:name/contacts')
  @Roles('ADMIN')
  async fetchContacts(@Param('name') name: string, @Request() req: any) {
    await this.assertInstanceTenant(name, req);
    return this.whatsappService.fetchContacts(name);
  }

  @Post('instances/:name/sync')
  @Roles('ADMIN')
  async syncContacts(@Param('name') name: string, @Request() req: any) {
    await this.assertInstanceTenant(name, req);
    const tenantId = req.user?.tenant_id;
    this.auditAction(req?.user?.id, 'whatsapp_sync_contacts', name, { tenant_id: tenantId });
    return this.whatsappService.syncContacts(name, tenantId);
  }

  @Post('instances/:name/settings')
  @Roles('ADMIN')
  async setInstanceSettings(
    @Param('name') name: string,
    @Body() body: { rejectCall?: boolean; msgCall?: string; alwaysOnline?: boolean },
    @Request() req: any,
  ) {
    await this.assertInstanceTenant(name, req);
    this.auditAction(req?.user?.id, 'whatsapp_set_instance_settings', name, {
      tenant_id: req?.user?.tenant_id,
      changes: body,
    });
    return this.whatsappService.setInstanceSettings(name, body);
  }
}
