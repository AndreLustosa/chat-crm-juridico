import { Controller, Get, Post, Patch, Param, Body, Request } from '@nestjs/common';
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

  /** Provisiona um novo escritorio + admin (convite por link). So SUPER_ADMIN. */
  @Post('tenants')
  createTenant(@Body() body: { officeName?: string; name?: string; email?: string; cnpj?: string; cpf?: string; phone?: string }) {
    return this.svc.createTenant(body);
  }

  // ─── Gestao (Fase 3) — acoes reversiveis; a purga fisica e manual/auditada ──

  /** Suspende o acesso do escritorio (reversivel). */
  @Patch('tenants/:id/suspend')
  suspend(@Param('id') id: string, @Request() req: any) {
    return this.svc.suspend(id, req.user?.tenant_id);
  }

  /** Reativa o escritorio (restaura status; cancela exclusao agendada). */
  @Patch('tenants/:id/reactivate')
  reactivate(@Param('id') id: string, @Request() req: any) {
    return this.svc.reactivate(id, req.user?.tenant_id);
  }

  /** Agenda a exclusao (suspende + carencia). Body { confirmName } = nome exato do escritorio. */
  @Patch('tenants/:id/schedule-deletion')
  scheduleDeletion(@Param('id') id: string, @Body() body: { confirmName?: string }, @Request() req: any) {
    return this.svc.scheduleDeletion(id, body?.confirmName ?? '', req.user?.tenant_id);
  }

  /** Cancela a exclusao agendada (mantem suspenso). */
  @Patch('tenants/:id/cancel-deletion')
  cancelDeletion(@Param('id') id: string, @Request() req: any) {
    return this.svc.cancelDeletion(id, req.user?.tenant_id);
  }

  /** Liga/desliga a IA do escritorio (#77 — gate master por escritorio). */
  @Patch('tenants/:id/ai')
  setAi(@Param('id') id: string, @Body() body: { enabled?: boolean }) {
    return this.svc.setAiEnabled(id, body?.enabled === true);
  }
}
