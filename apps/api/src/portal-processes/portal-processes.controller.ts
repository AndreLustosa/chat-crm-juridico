import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ClientJwtAuthGuard } from '../portal-auth/client-jwt-auth.guard';
import { CurrentClient } from '../portal-auth/current-client.decorator';
import type { ClientUser } from '../portal-auth/current-client.decorator';
import { PortalProcessesService } from './portal-processes.service';

/**
 * Endpoints de processos do portal do cliente. Rotas montadas em /portal/processes.
 *
 * Todas exigem ClientJwtAuthGuard (cookie portal_token). @Public() desliga
 * o JwtAuthGuard global do app — o ClientJwtAuthGuard especifico assume.
 *
 * Ownership eh validado dentro do service (lead_id = currentClient.id).
 */
@Controller('portal/processes')
export class PortalProcessesController {
  constructor(private readonly service: PortalProcessesService) {}

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get()
  async list(@CurrentClient() client: ClientUser) {
    return this.service.listProcesses(client.id);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get(':id')
  async detail(
    @CurrentClient() client: ClientUser,
    @Param('id') caseId: string,
  ) {
    return this.service.getProcessDetail(client.id, caseId);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get(':id/movements')
  async movements(
    @CurrentClient() client: ClientUser,
    @Param('id') caseId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const lim = Math.min(parseInt(limit || '30', 10) || 30, 100);
    return this.service.listMovements(client.id, caseId, lim, before);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get(':id/events')
  async events(
    @CurrentClient() client: ClientUser,
    @Param('id') caseId: string,
  ) {
    return this.service.listEvents(client.id, caseId);
  }
}
