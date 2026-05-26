import { Body, Controller, Get, Patch, Put, Request } from '@nestjs/common';
import { OfficeService } from './office.service';
import { UpdateOfficeDto } from './dto/update-office.dto';
import { UpdateNotificationDefaultsDto } from './dto/update-notification-defaults.dto';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Dados do escritório (Jurisflow → Configurações > Escritório). Rotas relativas
 * (o prefixo /api é do Traefik). JwtAuthGuard global => autenticado.
 */
@Controller()
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  /** Dados do escritório logado — qualquer usuário do tenant pode ler. */
  @Get('me/office')
  get(@Request() req: any) {
    return this.office.getForTenant(req.user?.tenant_id);
  }

  /** Edita nome/CNPJ/telefone do escritório — somente ADMIN. */
  @Put('me/office')
  @Roles('ADMIN')
  update(@Request() req: any, @Body() dto: UpdateOfficeDto) {
    return this.office.update(req.user?.tenant_id, dto);
  }

  /**
   * Padrão do escritório para o aviso de "tarefa vencida" (3 canais:
   * whatsapp/badge/sound) — somente ADMIN. Faz merge em
   * Tenant.notification_defaults.taskOverdue. Retorna o objeto salvo.
   */
  @Patch('me/office/notification-defaults')
  @Roles('ADMIN')
  updateNotificationDefaults(@Request() req: any, @Body() dto: UpdateNotificationDefaultsDto) {
    return this.office.updateNotificationDefaults(req.user?.tenant_id, dto);
  }
}
