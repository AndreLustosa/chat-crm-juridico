import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { FollowupService } from './followup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('followup')
export class FollowupController {
  constructor(private readonly svc: FollowupService) {}

  @Get('stats')
  getStats(@Request() req: any) { return this.svc.getStats(req.user?.tenant_id); }

  // ─── Sequências ──────────────────────────────────────────────────────────
  @Get('sequences')
  listSequences(@Query('tenant_id') tenantId?: string) {
    return this.svc.listSequences(tenantId);
  }

  @Post('sequences')
  createSequence(@Body() body: any) { return this.svc.createSequence(body); }

  @Patch('sequences/:id')
  updateSequence(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateSequence(id, body);
  }

  @Delete('sequences/:id')
  deleteSequence(@Param('id') id: string) { return this.svc.deleteSequence(id); }

  @Post('sequences/:id/steps')
  addStep(@Param('id') id: string, @Body() body: any) { return this.svc.addStep(id, body); }

  @Patch('steps/:id')
  updateStep(@Param('id') id: string, @Body() body: any) { return this.svc.updateStep(id, body); }

  @Delete('steps/:id')
  deleteStep(@Param('id') id: string) { return this.svc.deleteStep(id); }

  // ─── Enrollments ─────────────────────────────────────────────────────────
  @Get('enrollments')
  listEnrollments(@Query() q: { status?: string; sequence_id?: string; lead_id?: string }) {
    return this.svc.listEnrollments(q);
  }

  @Post('enrollments')
  enrollLead(@Body() body: { lead_id: string; sequence_id: string }) {
    return this.svc.enrollLead(body.lead_id, body.sequence_id);
  }

  @Patch('enrollments/:id/pause')
  pauseEnrollment(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.svc.pauseEnrollment(id, body.reason);
  }

  @Patch('enrollments/:id/resume')
  resumeEnrollment(@Param('id') id: string) { return this.svc.resumeEnrollment(id); }

  @Patch('enrollments/:id/cancel')
  cancelEnrollment(@Param('id') id: string) { return this.svc.cancelEnrollment(id); }

  @Patch('enrollments/:id/converted')
  markConverted(@Param('id') id: string) { return this.svc.markConverted(id); }

  // ─── Aprovações ──────────────────────────────────────────────────────────
  @Get('approvals')
  listPendingApprovals(@Request() req: any) { return this.svc.listPendingApprovals(req.user?.tenant_id); }

  @Patch('messages/:id/approve')
  approveMessage(@Param('id') id: string, @Body() body: { edited_text?: string }, @Request() req: any) {
    return this.svc.approveMessage(id, req.user?.name || 'Sistema', body.edited_text);
  }

  @Patch('messages/:id/reject')
  rejectMessage(@Param('id') id: string, @Request() req: any) {
    return this.svc.rejectMessage(id, req.user?.name || 'Sistema');
  }

  @Post('messages/:id/regenerate')
  regenerateMessage(@Param('id') id: string) { return this.svc.regenerateMessage(id); }

  // ─── Disparos em Massa (Broadcasts) ─────────────────────────────────────
  @Get('broadcasts/preview')
  previewBroadcast(@Query('type') type: string, @Query('days_ahead') daysAhead: string, @Request() req: any) {
    return this.svc.previewBroadcast(type || 'AUDIENCIA', parseInt(daysAhead) || 7, req.user?.tenant_id);
  }

  @Get('broadcasts')
  listBroadcasts(@Request() req: any) {
    return this.svc.listBroadcasts(req.user?.tenant_id);
  }

  @Get('broadcasts/:id')
  getBroadcast(@Param('id') id: string) {
    return this.svc.getBroadcast(id);
  }

  @Post('broadcasts')
  createBroadcast(@Body() body: { type: string; days_ahead: number; interval_ms: number; custom_prompt?: string }, @Request() req: any) {
    return this.svc.createBroadcast(body, req.user.id, req.user?.tenant_id);
  }

  @Patch('broadcasts/:id/cancel')
  cancelBroadcast(@Param('id') id: string) {
    return this.svc.cancelBroadcast(id);
  }

  // ─── Seed ────────────────────────────────────────────────────────────────
  @Post('seed-defaults')
  seedDefaultSequences() { return this.svc.seedDefaultSequences(); }
}
