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
  findAll(
    @Request() req: any,
    @Query('stage') stage?: string,
    @Query('archived') archived?: string,
    @Query('inTracking') inTracking?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isAdmin = req.user.role === 'ADMIN';
    const lawyerId = isAdmin ? undefined : req.user.id;
    const archivedBool = archived === 'true' ? true : archived === 'false' ? false : undefined;
    const inTrackingBool = inTracking === 'true' ? true : inTracking === 'false' ? false : undefined;
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    return this.service.findAll(lawyerId, stage, archivedBool, inTrackingBool, p, l);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() body: { lead_id: string; conversation_id?: string; legal_area?: string }, @Request() req: any) {
    return this.service.create({
      lead_id: body.lead_id,
      conversation_id: body.conversation_id,
      lawyer_id: req.user.id,
      legal_area: body.legal_area,
      tenant_id: req.user.tenant_id,
    });
  }

  @Patch(':id/stage')
  updateStage(@Param('id') id: string, @Body('stage') stage: string, @Request() req: any) {
    return this.service.updateStage(id, stage, req.user.id);
  }

  @Patch(':id/archive')
  archive(
    @Param('id') id: string,
    @Body() body: { reason: string; notifyLead?: boolean },
  ) {
    return this.service.archive(id, body.reason, body.notifyLead ?? false);
  }

  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.service.unarchive(id);
  }

  @Patch(':id/case-number')
  setCaseNumber(@Param('id') id: string, @Body() body: { caseNumber: string; court?: string }) {
    return this.service.setCaseNumber(id, body.caseNumber, body.court);
  }

  @Patch(':id/send-to-tracking')
  sendToTracking(@Param('id') id: string, @Body() body: { caseNumber: string; court?: string }) {
    return this.service.sendToTracking(id, body.caseNumber, body.court);
  }

  @Patch(':id/tracking-stage')
  updateTrackingStage(@Param('id') id: string, @Body('trackingStage') trackingStage: string) {
    return this.service.updateTrackingStage(id, trackingStage);
  }

  @Patch(':id/notes')
  updateNotes(@Param('id') id: string, @Body('notes') notes: string) {
    return this.service.updateNotes(id, notes);
  }

  @Patch(':id/court')
  updateCourt(@Param('id') id: string, @Body('court') court: string) {
    return this.service.updateCourt(id, court);
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
  ) {
    return this.service.addEvent(id, body);
  }

  @Get(':id/events')
  findEvents(@Param('id') id: string) {
    return this.service.findEvents(id);
  }

  @Delete('events/:eventId')
  deleteEvent(@Param('eventId') eventId: string) {
    return this.service.deleteEvent(eventId);
  }
}
