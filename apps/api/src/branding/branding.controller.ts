import { Body, Controller, Get, Put, Request } from '@nestjs/common';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * White-label por escritorio (Jurisflow). Rotas relativas — o prefixo /api e do
 * Traefik, igual ao modulo subscription. JwtAuthGuard global => autenticado.
 */
@Controller()
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** Logo/icone do escritorio logado — qualquer usuario do tenant pode ler. */
  @Get('me/branding')
  get(@Request() req: any) {
    return this.branding.getForTenant(req.user?.tenant_id);
  }

  /** Atualiza a marca do escritorio — somente ADMIN. "" limpa (volta ao padrao). */
  @Put('me/branding')
  @Roles('ADMIN')
  update(@Request() req: any, @Body() dto: UpdateBrandingDto) {
    return this.branding.update(req.user?.tenant_id, dto);
  }
}
