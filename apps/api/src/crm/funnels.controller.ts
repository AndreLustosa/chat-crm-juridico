import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FunnelsService } from './funnels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { StageType } from '@prisma/client';

const VALID_TYPES: StageType[] = ['ATIVO', 'GANHO', 'PERDIDO', 'ARQUIVADO'];

@UseGuards(JwtAuthGuard)
@Controller('funnels')
export class FunnelsController {
  constructor(private readonly funnels: FunnelsService) {}

  /** Lista funis do escritorio logado. */
  @Get()
  list(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    return this.funnels.list(req.user.tenant_id, includeInactive === 'true');
  }

  /** Detalhe de um funil com etapas ordenadas. */
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.funnels.get(id, req.user.tenant_id);
  }

  /** Cria novo funil (ADMIN only). */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(
    @Req() req: any,
    @Body() body: { name: string; description?: string; color?: string; area?: string; is_default?: boolean },
  ) {
    return this.funnels.create(req.user.tenant_id, body);
  }

  /** Atualiza metadados do funil (ADMIN only). */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Put(':id')
  update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: {
      name?: string;
      description?: string | null;
      color?: string | null;
      area?: string | null;
      active?: boolean;
      is_default?: boolean;
    },
  ) {
    return this.funnels.update(id, req.user.tenant_id, body);
  }

  /** Soft delete (active=false) por padrao; ?hard=true pra remover de vez (so se sem deals). */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any, @Query('hard') hard?: string) {
    return this.funnels.remove(id, req.user.tenant_id, hard === 'true');
  }

  // ─── Etapas ───────────────────────────────────────────────────────────

  /** Adiciona uma nova etapa ao funil (ADMIN). */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post(':id/stages')
  addStage(
    @Param('id') funnelId: string,
    @Req() req: any,
    @Body() body: {
      name: string;
      type?: StageType;
      color?: string;
      win_probability?: number;
      ai_hint?: string;
      sla_hours?: number;
    },
  ) {
    if (body.type && !VALID_TYPES.includes(body.type)) {
      throw new BadRequestException(`type deve ser um de: ${VALID_TYPES.join(', ')}`);
    }
    return this.funnels.addStage(funnelId, req.user.tenant_id, body);
  }

  /** Atualiza nome/tipo/cor/hint da etapa (ADMIN). */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Put(':id/stages/:stageId')
  updateStage(
    @Param('id') funnelId: string,
    @Param('stageId') stageId: string,
    @Req() req: any,
    @Body() body: {
      name?: string;
      type?: StageType;
      color?: string;
      win_probability?: number | null;
      ai_hint?: string | null;
      sla_hours?: number | null;
    },
  ) {
    if (body.type && !VALID_TYPES.includes(body.type)) {
      throw new BadRequestException(`type deve ser um de: ${VALID_TYPES.join(', ')}`);
    }
    return this.funnels.updateStage(funnelId, stageId, req.user.tenant_id, body);
  }

  /** Remove etapa (ADMIN). Bloqueia se houver deals. */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id/stages/:stageId')
  removeStage(
    @Param('id') funnelId: string,
    @Param('stageId') stageId: string,
    @Req() req: any,
  ) {
    return this.funnels.removeStage(funnelId, stageId, req.user.tenant_id);
  }

  /** Reordena etapas em batch (lista de IDs na nova ordem). */
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/stages/reorder')
  reorderStages(
    @Param('id') funnelId: string,
    @Req() req: any,
    @Body() body: { stageIds: string[] },
  ) {
    if (!Array.isArray(body?.stageIds) || body.stageIds.length === 0) {
      throw new BadRequestException('stageIds obrigatorio (array)');
    }
    return this.funnels.reorderStages(funnelId, req.user.tenant_id, body.stageIds);
  }
}
