import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DealsService } from './deals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  /** Lista deals do escritorio com filtros. */
  @Get()
  list(
    @Req() req: any,
    @Query('funnelId') funnelId?: string,
    @Query('stageId') stageId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.deals.list(req.user.tenant_id, {
      funnelId,
      stageId,
      ownerId,
      leadId,
      status: status as any,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  /** KPIs agregados pra dashboard. */
  @Get('stats')
  stats(@Req() req: any, @Query('funnelId') funnelId?: string) {
    return this.deals.stats(req.user.tenant_id, funnelId);
  }

  /** Distribuicao por etapa + motivos de perda (agregado no banco). Evita o
   *  frontend carregar centenas de deals so pra montar o painel de analytics.
   *  DEVE vir antes de @Get(':id') pra a rota nao ser capturada pelo param. */
  @Get('stats-detailed')
  statsDetailed(@Req() req: any, @Query('funnelId') funnelId?: string) {
    return this.deals.statsByStage(req.user.tenant_id, funnelId);
  }

  /** Detalhe com histórico. */
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.deals.get(id, req.user.tenant_id);
  }

  /** Cria novo deal (entra na primeira etapa do funil por padrão). */
  @Post()
  create(
    @Req() req: any,
    @Body() body: {
      leadId: string;
      funnelId: string;
      stageId?: string;
      stageKey?: string;
      ownerUserId?: string;
      value?: number;
      expectedCloseAt?: string;
      source?: string;
      notes?: string;
    },
  ) {
    if (!body?.leadId || !body?.funnelId) {
      throw new BadRequestException('leadId e funnelId obrigatorios');
    }
    return this.deals.create(req.user.tenant_id, req.user?.id, body);
  }

  /** Atualiza metadados (NÃO move stage — use /move pra isso). */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: {
      ownerUserId?: string | null;
      value?: number | null;
      expectedCloseAt?: string | null;
      source?: string | null;
      notes?: string | null;
    },
  ) {
    return this.deals.update(id, req.user.tenant_id, body);
  }

  /** Move o deal pra outra etapa do MESMO funil. Cria entry em history. */
  @Post(':id/move')
  move(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: {
      toStageId?: string;
      toStageKey?: string;
      reason?: string;
      via?: 'manual' | 'ai' | 'automation';
      lostReason?: string;
    },
  ) {
    return this.deals.move(id, req.user.tenant_id, req.user?.id, body);
  }

  /** Deleta o deal (cascade history). */
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.deals.remove(id, req.user.tenant_id);
  }
}
