import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OrganicTrafficService } from './organic-traffic.service';
import {
  CreateOrganicLandingPageDto,
  SaveOrganicSearchConfigDto,
  SyncOrganicTrafficDto,
  UpdateOrganicLandingPageDto,
} from './organic-traffic.dto';

@Controller('organic-traffic')
@UseGuards(JwtAuthGuard)
export class OrganicTrafficController {
  constructor(private readonly service: OrganicTrafficService) {}

  @Get('summary')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  summary(@Req() req: any) {
    return this.service.getSummary(req.user.tenant_id);
  }

  @Get('config')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  config(@Req() req: any) {
    return this.service.getConfig(req.user.tenant_id);
  }

  @Post('config')
  @Roles('ADMIN')
  saveConfig(@Req() req: any, @Body() dto: SaveOrganicSearchConfigDto) {
    return this.service.saveConfig(req.user.tenant_id, dto);
  }

  @Post('config/test')
  @Roles('ADMIN')
  testConfig(@Req() req: any) {
    return this.service.testConfig(req.user.tenant_id);
  }

  @Get('sitemaps')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  sitemaps(@Req() req: any) {
    return this.service.listSitemaps(req.user.tenant_id);
  }

  @Get('pages')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  pages(@Req() req: any) {
    return this.service.listPages(req.user.tenant_id);
  }

  @Post('pages/seed-defaults')
  @Roles('ADMIN', 'ADVOGADO')
  seedDefaults(@Req() req: any) {
    return this.service.seedDefaultPages(req.user.tenant_id);
  }

  @Get('pages/:id')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  page(@Req() req: any, @Param('id') id: string) {
    return this.service.getPage(req.user.tenant_id, id);
  }

  @Post('pages')
  @Roles('ADMIN', 'ADVOGADO')
  createPage(@Req() req: any, @Body() dto: CreateOrganicLandingPageDto) {
    return this.service.createPage(req.user.tenant_id, dto);
  }

  @Patch('pages/:id')
  @Roles('ADMIN', 'ADVOGADO')
  updatePage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrganicLandingPageDto,
  ) {
    return this.service.updatePage(req.user.tenant_id, id, dto);
  }

  @Delete('pages/:id')
  @Roles('ADMIN')
  deletePage(@Req() req: any, @Param('id') id: string) {
    return this.service.deletePage(req.user.tenant_id, id);
  }

  @Post('pages/:id/inspect')
  @Roles('ADMIN', 'ADVOGADO')
  inspect(@Req() req: any, @Param('id') id: string) {
    return this.service.inspectPage(req.user.tenant_id, id);
  }

  @Get('queries')
  @Roles('ADMIN', 'ADVOGADO', 'OPERADOR')
  queries(
    @Req() req: any,
    @Query('page_id') pageId?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getQueries(req.user.tenant_id, {
      pageId: pageId || undefined,
      days: days ? parseInt(days, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('sync')
  @Roles('ADMIN', 'ADVOGADO')
  sync(@Req() req: any, @Body() dto: SyncOrganicTrafficDto) {
    return this.service.syncSearchAnalytics(req.user.tenant_id, 'MANUAL', dto);
  }
}
