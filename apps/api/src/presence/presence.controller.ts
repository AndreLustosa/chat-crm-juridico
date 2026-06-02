import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PresenceService } from './presence.service';

@Controller('presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private presence: PresenceService) {}

  /** Quem está online agora (qualquer usuário autenticado; escopo do tenant). */
  @Get('online')
  online(@Req() req: any) {
    return this.presence.getOnline(req.user.tenant_id);
  }

  /** Histórico de conexão/desconexão — só ADMIN (SUPER_ADMIN passa por padrão). */
  @Get('log')
  @Roles('ADMIN')
  log(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
  ) {
    return this.presence.getLog(req.user.tenant_id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      userId: userId || undefined,
    });
  }
}
