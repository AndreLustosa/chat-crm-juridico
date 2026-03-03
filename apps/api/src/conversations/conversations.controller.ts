import { Controller, Get, Param, Patch, Body, Post, Query, UseGuards, Request } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Prisma } from '@crm/shared';

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async findAll(
    @Query('inboxId') inboxId: string | undefined,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    return this.conversationsService.findAll(undefined, userId, inboxId);
  }

  @Get('pending-transfers')
  getPendingTransfers(@Request() req: any) {
    return this.conversationsService.findPendingTransfers(req.user.id);
  }

  @Get('open-count')
  getOpenCount(@Request() req: any) {
    return this.conversationsService.countOpen(req.user?.id).then(count => ({ count }));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(id);
  }

  @Get('lead/:leadId')
  findAllByLead(@Param('leadId') leadId: string) {
    return this.conversationsService.findAllByLead(leadId);
  }

  @Post()
  create(@Body() data: Prisma.ConversationCreateInput) {
    return this.conversationsService.create(data);
  }

  @Patch(':id/ai-mode')
  setAiMode(@Param('id') id: string, @Body('ai_mode') ai_mode: boolean) {
    return this.conversationsService.setAiMode(id, ai_mode);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.assign(id, req.user.id);
  }

  @Patch(':id/transfer')
  transfer(@Param('id') id: string, @Body('userId') userId: string) {
    return this.conversationsService.assign(id, userId);
  }

  @Post(':id/transfer-request')
  transferRequest(
    @Param('id') id: string,
    @Body() body: { toUserId: string; reason?: string; audioIds?: string[] },
    @Request() req: any,
  ) {
    return this.conversationsService.requestTransfer(id, body.toUserId, req.user.id, body.reason || null, body.audioIds);
  }

  @Patch(':id/transfer-accept')
  transferAccept(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.acceptTransfer(id, req.user.id);
  }

  @Patch(':id/transfer-decline')
  transferDecline(@Param('id') id: string, @Body('reason') reason: string) {
    return this.conversationsService.declineTransfer(id, reason || null);
  }

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.conversationsService.close(id);
  }

  @Post(':id/transfer-to-lawyer')
  transferToLawyer(
    @Param('id') id: string,
    @Body() body: { reason?: string; audioIds?: string[] },
    @Request() req: any,
  ) {
    return this.conversationsService.transferToAssignedLawyer(id, req.user.id, body.reason, body.audioIds);
  }

  @Patch(':id/return-to-origin')
  returnToOrigin(
    @Param('id') id: string,
    @Body() body: { reason?: string; audioIds?: string[] },
    @Request() req: any,
  ) {
    return this.conversationsService.returnToOrigin(id, body.reason, body.audioIds, req.user?.id);
  }

  @Patch(':id/keep-in-inbox')
  keepInInbox(@Param('id') id: string) {
    return this.conversationsService.keepInInbox(id);
  }

  @Patch(':id/assign-lawyer')
  assignLawyer(
    @Param('id') id: string,
    @Body('lawyerId') lawyerId: string | null,
  ) {
    return this.conversationsService.setAssignedLawyer(id, lawyerId ?? null);
  }
}
