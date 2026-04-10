import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { LegalCasesService } from './legal-cases.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('legal-cases')
export class LegalCasesController {
  constructor(private readonly service: LegalCasesService) {}

  @Get('stages')
  getStages() {
    return this.service.getStages();
  }

  @Get('tracking-stages')
  getTrackingStages() {
    return this.service.getTrackingStages();
  }

  @Get('incoming')
  findIncoming(@Request() req: any) {
    return this.service.findIncoming(req.user.id);
  }

  @Get()
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  findAll(
    @Request() req: any,
    @Query('stage') stage?: string,
    @Query('archived') archived?: string,
    @Query('inTracking') inTracking?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('caseNumber') caseNumber?: string,
  ) {
    const isAdmin = req.user.roles?.includes('ADMIN');
    const lawyerId = isAdmin ? undefined : req.user.id;
    const archivedBool = archived === 'true' ? true : archived === 'false' ? false : undefined;
    const inTrackingBool = inTracking === 'true' ? true : inTracking === 'false' ? false : undefined;
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    return this.service.findAll(lawyerId, stage, archivedBool, inTrackingBool, p, l, req.user?.tenant_id, leadId, caseNumber);
  }

  @Get('encerrados-pendentes')
  @Roles('ADMIN')
  findPendingClosure(@Request() req: any) {
    return this.service.findPendingClosure(req.user?.tenant_id);
  }

  @Get(':id/workspace')
  getWorkspace(@Param('id') id: string, @Request() req: any) {
    return this.service.getWorkspaceData(id, req.user?.tenant_id);
  }

  @Get(':id/communications')
  getCommunications(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Request() req?: any,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const l = limit ? parseInt(limit, 10) : 50;
    return this.service.getCommunications(id, p, l, req.user?.tenant_id);
  }

  @Patch(':id/details')
  updateDetails(
    @Param('id') id: string,
    @Body() body: {
      action_type?: string;
      claim_value?: number;
      opposing_party?: string;
      judge?: string;
      notes?: string;
      court?: string;
      legal_area?: string;
      priority?: string;
    },
    @Request() req?: any,
  ) {
    return this.service.updateDetails(id, body, req.user?.tenant_id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.service.findOne(id, req.user?.tenant_id);
  }

  @Post()
  @Roles('ADMIN', 'ADVOGADO')
  create(@Body() body: { lead_id: string; conversation_id?: string; legal_area?: string }, @Request() req: any) {
    return this.service.create({
      lead_id: body.lead_id,
      conversation_id: body.conversation_id,
      lawyer_id: req.user.id,
      legal_area: body.legal_area,
      tenant_id: req.user.tenant_id,
    });
  }

  /** Cadastro direto de processo já em andamento (sem conversa WhatsApp) */
  @Post('direct')
  @Roles('ADMIN', 'ADVOGADO')
  createDirect(
    @Body() body: {
      case_number: string;
      legal_area?: string;
      action_type?: string;
      opposing_party?: string;
      claim_value?: number;
      court?: string;
      judge?: string;
      tracking_stage?: string;
      priority?: string;
      notes?: string;
      filed_at?: string;
      // Integração lead
      lead_id?: string;
      lead_name?: string;
      lead_phone?: string;
      lead_email?: string;
      // ADMIN pode escolher o advogado responsável
      lawyer_id?: string;
      // ADMIN pode escolher o atendente responsável
      assigned_user_id?: string;
    },
    @Request() req: any,
  ) {
    const isAdmin = req.user.roles?.includes('ADMIN');
    return this.service.createDirect({
      ...body,
      lawyer_id: req.user.id,
      // Apenas ADMIN pode substituir o advogado responsável
      override_lawyer_id: isAdmin && body.lawyer_id ? body.lawyer_id : undefined,
      // Qualquer usuário autenticado pode informar o atendente responsável
      assigned_user_id: body.assigned_user_id || undefined,
      tenant_id: req.user.tenant_id,
    });
  }

  @Patch(':id/lawyer')
  @Roles('ADMIN', 'ADVOGADO')
  updateLawyer(
    @Param('id') id: string,
    @Body('lawyerId') lawyerId: string,
    @Request() req: any,
  ) {
    return this.service.updateLawyer(id, lawyerId, req.user?.tenant_id);
  }

  @Patch(':id/lead')
  updateLead(
    @Param('id') id: string,
    @Body() body: { lead_id?: string; lead_phone?: string; lead_name?: string; lead_email?: string },
    @Request() req: any,
  ) {
    return this.service.updateLead(id, { ...body, tenant_id: req.user?.tenant_id });
  }

  @Patch(':id/stage')
  updateStage(@Param('id') id: string, @Body('stage') stage: string, @Request() req: any) {
    return this.service.updateStage(id, stage, req.user.id, req.user?.tenant_id);
  }

  @Patch(':id/archive')
  @Roles('ADMIN')
  archive(
    @Param('id') id: string,
    @Body() body: { reason: string; notifyLead?: boolean },
    @Request() req: any,
  ) {
    return this.service.archive(id, body.reason, body.notifyLead ?? false, req.user?.tenant_id);
  }

  @Patch(':id/unarchive')
  @Roles('ADMIN')
  unarchive(@Param('id') id: string, @Request() req: any) {
    return this.service.unarchive(id, req.user?.tenant_id);
  }

  @Patch(':id/renounce')
  renounce(@Param('id') id: string, @Request() req: any) {
    return this.service.renounce(id, req.user?.tenant_id);
  }

  @Patch(':id/unrenounce')
  unrenounce(@Param('id') id: string, @Request() req: any) {
    return this.service.unrenounce(id, req.user?.tenant_id);
  }

  @Patch(':id/case-number')
  setCaseNumber(@Param('id') id: string, @Body() body: { caseNumber: string; court?: string }, @Request() req: any) {
    return this.service.setCaseNumber(id, body.caseNumber, body.court, req.user?.tenant_id);
  }

  @Patch(':id/send-to-tracking')
  sendToTracking(@Param('id') id: string, @Body() body: { caseNumber: string; court?: string }, @Request() req: any) {
    return this.service.sendToTracking(id, body.caseNumber, body.court, req.user?.tenant_id);
  }

  /** Concluir todas as tarefas pendentes de um caso (ao avançar estágio) */
  @Patch(':id/complete-stage-tasks')
  completeStageTasks(@Param('id') id: string, @Request() req: any) {
    return this.service.completeStageTasks(id, req.user?.tenant_id).then(count => ({ completed: count }));
  }

  @Patch(':id/tracking-stage')
  updateTrackingStage(
    @Param('id') id: string,
    @Body() body: {
      trackingStage: string;
      sentence_value?: number;
      sentence_date?: string;
      sentence_type?: string;
    },
    @Request() req: any,
  ) {
    return this.service.updateTrackingStage(id, body.trackingStage, req.user?.tenant_id, {
      sentence_value: body.sentence_value,
      sentence_date: body.sentence_date,
      sentence_type: body.sentence_type,
    });
  }

  @Patch(':id/notes')
  updateNotes(@Param('id') id: string, @Body('notes') notes: string, @Request() req: any) {
    return this.service.updateNotes(id, notes, req.user?.tenant_id);
  }

  @Patch(':id/court')
  updateCourt(@Param('id') id: string, @Body('court') court: string, @Request() req: any) {
    return this.service.updateCourt(id, court, req.user?.tenant_id);
  }

  @Post(':id/events')
  addEvent(
    @Param('id') id: string,
    @Body() body: {
      type: string;
      title: string;
      description?: string;
      source?: string;
      reference_url?: string;
      event_date?: Date;
    },
    @Request() req: any,
  ) {
    return this.service.addEvent(id, body, req.user?.tenant_id);
  }

  @Get(':id/events')
  findEvents(@Param('id') id: string, @Request() req: any) {
    return this.service.findEvents(id, req.user?.tenant_id);
  }

  @Post(':id/briefing')
  generateBriefing(@Param('id') id: string, @Request() req: any) {
    return this.service.generateBriefing(id, req.user?.tenant_id);
  }

  @Delete('events/:eventId')
  deleteEvent(@Param('eventId') eventId: string, @Request() req: any) {
    return this.service.deleteEvent(eventId, req.user?.tenant_id);
  }

  /** Corrige leads com processo ativo que não estão marcados como cliente */
  @Post('admin/sync-clients')
  @Roles('ADMIN')
  syncClients(@Request() req: any) {
    return this.service.syncClientsFromActiveCases(req.user?.tenant_id);
  }
}
