import { Body, Controller, Get, Put, Request } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';
import { CAPABILITIES, EDITABLE_ROLES } from './permissions.constants';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Permissoes granulares por escritorio. Rotas relativas (prefixo /api do Traefik).
 * GET autenticado (qualquer um le suas capacidades + a matriz do escritorio);
 * PUT so ADMIN.
 */
@Controller()
export class PermissionsController {
  constructor(private readonly perms: PermissionsService) {}

  @Get('me/permissions')
  async get(@Request() req: any) {
    const tenantId = req.user?.tenant_id;
    const roles: string[] = req.user?.roles ?? [];
    const [matrix, my] = await Promise.all([
      this.perms.getEffectiveMatrix(tenantId),
      this.perms.getUserCapabilities(tenantId, roles),
    ]);
    return {
      capabilities: CAPABILITIES,
      roles: EDITABLE_ROLES,
      matrix,
      my: Array.from(my),
      isAdmin: roles.some((r) => (r ?? '').toUpperCase() === 'ADMIN'),
    };
  }

  @Put('me/permissions')
  @Roles('ADMIN')
  async update(@Request() req: any, @Body() body: UpdatePermissionsDto) {
    const matrix = await this.perms.setOverrides(req.user?.tenant_id, body.changes ?? []);
    return { matrix };
  }
}
