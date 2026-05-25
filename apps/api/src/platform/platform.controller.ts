import { Controller, Get } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Back-office da PLATAFORMA (SaaS) — restrito ao SUPER_ADMIN (dono).
 * JwtAuthGuard global autentica; @Roles('SUPER_ADMIN') na classe garante que
 * nenhum admin de escritorio-cliente alcance estas rotas (o RolesGuard libera
 * SUPER_ADMIN em qualquer @Roles, e bloqueia os demais aqui).
 */
@Controller('platform')
@Roles('SUPER_ADMIN')
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  /** Contadores agregados (total, ativos, inativos, adimplentes, inadimplentes...). */
  @Get('stats')
  stats() {
    return this.svc.getStats();
  }

  /** Lista de todos os escritorios com status de assinatura. */
  @Get('tenants')
  tenants() {
    return this.svc.listTenants();
  }
}
