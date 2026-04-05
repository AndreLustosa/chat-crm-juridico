import { Controller, Get, Post, Patch, Body, Query, Param, UseGuards, Request } from '@nestjs/common';
import { DjenService } from './djen.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('djen')
export class DjenController {
  constructor(private readonly djenService: DjenService) {}

  /** Trigger manual do sync */
  @Post('sync')
  syncManual(@Body() body: { date?: string }) {
    const date = body?.date || new Date().toISOString().slice(0, 10);
    return this.djenService.syncForDate(date);
  }

  /** Reconcilia publicações não vinculadas com processos já cadastrados */
  @Post('reconcile')
  reconcile() {
    return this.djenService.reconcileUnlinkedPublications().then(count => ({ reconciled: count }));
  }

  /** Marcar todas as não visualizadas como vistas — deve vir ANTES de :id */
  @Patch('mark-all-viewed')
  markAllViewed() {
    return this.djenService.markAllViewed();
  }

  /** Lista completa com filtros — para a página dedicada DJEN */
  @Get('all')
  findAll(
    @Query('days') days?: string,
    @Query('viewed') viewed?: string,
    @Query('archived') archived?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.djenService.findAll({ days, viewed, archived, page, limit });
  }

  /** Lista publicações recentes (widget / painel) */
  @Get()
  findRecent(@Query('days') days?: string) {
    return this.djenService.findRecent(days ? parseInt(days) : 7);
  }

  /** Publicações de um processo específico */
  @Get('case/:caseId')
  findByCase(@Param('caseId') caseId: string) {
    return this.djenService.findByCase(caseId);
  }

  /** Marcar como visualizada */
  @Patch(':id/viewed')
  markViewed(@Param('id') id: string) {
    return this.djenService.markViewed(id);
  }

  /** Arquivar */
  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.djenService.archive(id);
  }

  /** Desarquivar */
  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.djenService.unarchive(id);
  }

  /** Criar processo a partir de uma publicação */
  @Post(':id/create-process')
  createProcess(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { leadId?: string; leadName?: string; leadPhone?: string; trackingStage?: string; legalArea?: string; lawyerId?: string },
  ) {
    // ADMIN pode escolher outro advogado; demais usuários sempre recebem o processo
    const isAdmin = req.user?.role === 'ADMIN';
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

  /** Análise por IA da publicação */
  @Post(':id/analyze')
  analyze(@Param('id') id: string) {
    return this.djenService.analyzePublication(id);
  }

  /** Sugerir leads que correspondam às partes da publicação */
  @Get(':id/suggest-leads')
  suggestLeads(@Param('id') id: string, @Request() req: any) {
    return this.djenService.suggestLeads(id, req.user?.tenant_id);
  }
}
