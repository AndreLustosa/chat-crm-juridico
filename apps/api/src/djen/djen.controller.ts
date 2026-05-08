import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { DjenService } from './djen.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('djen')
export class DjenController {
  constructor(private readonly djenService: DjenService) {}

  /** Trigger manual do sync */
  @Post('sync')
  @Roles('ADMIN', 'ADVOGADO')
  syncManual(@Body() body: { date?: string }) {
    const date = body?.date || new Date().toISOString().slice(0, 10);
    return this.djenService.syncForDate(date);
  }


  /** Reconcilia publicações não vinculadas com processos já cadastrados */
  @Post('reconcile')
  @Roles('ADMIN', 'ADVOGADO')
  reconcile() {
    return this.djenService.reconcileUnlinkedPublications().then(count => ({ reconciled: count }));
  }

  /** Marcar todas as não visualizadas como vistas — deve vir ANTES de :id */
  @Patch('mark-all-viewed')
  @Roles('ADMIN', 'ADVOGADO')
  markAllViewed(@Request() req: any) {
    if (!req.user?.tenant_id) throw new BadRequestException('tenant_id ausente');
    return this.djenService.markAllViewed(req.user.tenant_id);
  }

  /** Lista completa com filtros — para a página dedicada DJEN */
  @Get('all')
  findAll(
    @Request() req: any,
    @Query('days') days?: string,
    @Query('viewed') viewed?: string,
    @Query('archived') archived?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.djenService.findAll({ days, viewed, archived, page, limit, tenantId: req.user?.tenant_id });
  }

  /** Lista publicações recentes (widget / painel) */
  @Get()
  findRecent(@Request() req: any, @Query('days') days?: string) {
    return this.djenService.findRecent(days ? parseInt(days) : 7, req.user?.tenant_id);
  }

  /** Publicações de um processo específico */
  @Get('case/:caseId')
  findByCase(@Param('caseId') caseId: string, @Request() req: any) {
    return this.djenService.findByCase(caseId, req.user?.tenant_id);
  }

  /** Marcar como visualizada */
  @Patch(':id/viewed')
  markViewed(@Param('id') id: string, @Request() req: any) {
    return this.djenService.markViewed(id, req.user?.tenant_id);
  }

  /** Arquivar */
  @Patch(':id/archive')
  @Roles('ADMIN', 'ADVOGADO')
  archive(@Param('id') id: string, @Request() req: any) {
    return this.djenService.archive(id, req.user?.tenant_id);
  }

  /** Desarquivar */
  @Patch(':id/unarchive')
  @Roles('ADMIN', 'ADVOGADO')
  unarchive(@Param('id') id: string, @Request() req: any) {
    return this.djenService.unarchive(id, req.user?.tenant_id);
  }

  /** Criar processo a partir de uma publicação */
  @Post(':id/create-process')
  @Roles('ADMIN', 'ADVOGADO')
  createProcess(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { leadId?: string; leadName?: string; leadPhone?: string; trackingStage?: string; legalArea?: string; lawyerId?: string },
  ) {
    // ADMIN pode escolher outro advogado; demais usuários sempre recebem o processo
    const isAdmin = req.user?.roles?.includes('ADMIN');
    const effectiveLawyerId = (isAdmin && body?.lawyerId) ? body.lawyerId : req.user.id;

    return this.djenService.createProcessFromPublication(
      id,
      effectiveLawyerId,
      req.user?.tenant_id,
      body?.leadId,
      body?.trackingStage,
      body?.leadName,
      body?.leadPhone,
      body?.legalArea,
    );
  }

  /** Análise por IA da publicação (usa cache; force=true para reanalisar) */
  @Post(':id/analyze')
  @Roles('ADMIN', 'ADVOGADO')
  analyze(@Param('id') id: string, @Request() req: any, @Body() body?: { force?: boolean }) {
    return this.djenService.analyzePublication(id, body?.force ?? false, req.user?.tenant_id);
  }

  /** Sugerir leads que correspondam às partes da publicação */
  @Get(':id/suggest-leads')
  suggestLeads(@Param('id') id: string, @Request() req: any) {
    return this.djenService.suggestLeads(id, req.user?.tenant_id);
  }

  // ─── Ignorar processo (auto-arquivar publicações futuras) ─────

  /** Ignorar processo — publicações futuras serão auto-arquivadas */
  @Post('ignore-process')
  @Roles('ADMIN', 'ADVOGADO')
  ignoreProcess(@Body() body: { numero_processo: string; reason?: string }, @Request() req: any) {
    return this.djenService.ignoreProcess(body.numero_processo, req.user?.tenant_id, body.reason);
  }

  /** Remover processo da lista de ignorados */
  @Delete('ignore-process/:numero')
  @Roles('ADMIN', 'ADVOGADO')
  unignoreProcess(@Param('numero') numero: string, @Request() req: any) {
    return this.djenService.unignoreProcess(numero, req.user?.tenant_id);
  }

  /** Listar processos ignorados */
  @Get('ignored-processes')
  listIgnoredProcesses(@Request() req: any) {
    return this.djenService.listIgnoredProcesses(req.user?.tenant_id);
  }
}
