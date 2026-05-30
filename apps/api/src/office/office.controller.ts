import { Body, Controller, Get, Param, Patch, Put, Request } from '@nestjs/common';
import { OfficeService } from './office.service';
import { UpdateOfficeDto } from './dto/update-office.dto';
import { UpdateNotificationDefaultsDto } from './dto/update-notification-defaults.dto';
import { UpdateAiConfigDto } from './dto/update-ai-config.dto';
import { ToggleAiSkillDto } from './dto/toggle-ai-skill.dto';
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

  /**
   * Config da IA do escritório (nome da IA + dados usados nos prompts).
   * A IA em si — skills, modelos, chaves de API — é GLOBAL (Admin Master).
   * Leitura: qualquer usuário do tenant. Edição: somente ADMIN.
   */
  @Get('me/ai-config')
  getAiConfig(@Request() req: any) {
    return this.office.getAiConfig(req.user?.tenant_id);
  }

  @Put('me/ai-config')
  @Roles('ADMIN')
  updateAiConfig(@Request() req: any, @Body() dto: UpdateAiConfigDto) {
    return this.office.updateAiConfig(req.user?.tenant_id, dto);
  }

  /**
   * Áreas de atendimento (skills GLOBAIS) com o estado liga/desliga DESTE
   * escritório. Leitura: qualquer usuário do tenant. Edição: somente ADMIN.
   * O escritório só pode ligar/desligar — o conteúdo da skill é da plataforma.
   */
  @Get('me/ai-skills')
  getAiSkills(@Request() req: any) {
    return this.office.getAiSkills(req.user?.tenant_id);
  }

  @Put('me/ai-skills/:skillId')
  @Roles('ADMIN')
  setAiSkill(@Request() req: any, @Param('skillId') skillId: string, @Body() dto: ToggleAiSkillDto) {
    return this.office.setAiSkillEnabled(req.user?.tenant_id, skillId, dto.enabled);
  }
}
