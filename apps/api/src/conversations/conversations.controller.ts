import { Controller, Get, Param, Patch, Body, Post, Query, UseGuards, Request, Req, ForbiddenException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireCapability } from '../permissions/require-capability.decorator';
import { TransferRequestDto, TransferToLawyerDto, ReturnToOriginDto } from './dto/transfer-request.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendPresenceDto } from './dto/presence.dto';
import { CreateNoteDto } from './dto/create-note.dto';

@UseGuards(JwtAuthGuard)
@RequireCapability('atendimento')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async findAll(
    @Query('inboxId') inboxId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('clientMode') clientMode: string | undefined,
    @Request() req?: any,
  ) {
    const userId = req?.user?.id;
    const clientModeBool = clientMode === 'true' ? true : clientMode === 'false' ? false : undefined;
    return this.conversationsService.findAll(status, userId, inboxId, req?.user?.tenant_id, clientModeBool);
  }

  @Get('pending-transfers')
  getPendingTransfers(@Request() req: any) {
    return this.conversationsService.findPendingTransfers(req.user.id);
  }

  @Get('unread-counts')
  getUnreadCounts(@Request() req: any) {
    return this.conversationsService.getUnreadCounts(req.user?.tenant_id, req.user?.id);
  }

  @Get('unread-summary')
  getUnreadSummary(@Request() req: any) {
    return this.conversationsService.getUnreadSummary(req.user?.tenant_id, req.user?.id);
  }

  @Get('open-count')
  getOpenCount(@Request() req: any) {
    return this.conversationsService.countOpen(req.user?.id).then(count => ({ count }));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.findOne(id, req.user?.tenant_id);
  }

  @Get('lead/:leadId')
  findAllByLead(@Param('leadId') leadId: string, @Request() req: any) {
    return this.conversationsService.findAllByLead(leadId, req.user?.tenant_id);
  }

  @Post()
  create(@Body() dto: CreateConversationDto, @Request() req: any) {
    return this.conversationsService.create({
      lead: { connect: { id: dto.lead_id } },
      channel: dto.channel || 'whatsapp',
      external_id: dto.external_id,
      inbox: dto.inbox_id ? { connect: { id: dto.inbox_id } } : undefined,
      instance_name: dto.instance_name,
      ai_mode: dto.ai_mode ?? true,
      tenant: req.user?.tenant_id ? { connect: { id: req.user.tenant_id } } : undefined,
    });
  }

  @Patch(':id/ai-mode')
  setAiMode(@Param('id') id: string, @Body('ai_mode') ai_mode: boolean) {
    return this.conversationsService.setAiMode(id, ai_mode);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.assign(id, req.user.id, req.user?.tenant_id);
  }

  // Reatribuição DIRETA (sem aceite) — privilégio de ADMIN/SUPER_ADMIN: o
  // admin redistribui carga tirando o lead de um atendente e passando a outro.
  // Operador comum NÃO reatribui à força — ele usa /transfer-request (com
  // aceite do destinatário). Sem este gate, qualquer um com a capability
  // 'atendimento' roubaria conversa de outro sem consentimento.
  @Patch(':id/transfer')
  transfer(@Param('id') id: string, @Body('userId') userId: string, @Request() req: any) {
    const isAdmin = (req.user?.roles ?? []).some(
      (r: string) => r === 'ADMIN' || r === 'SUPER_ADMIN',
    );
    if (!isAdmin) {
      throw new ForbiddenException(
        'Apenas administradores reatribuem diretamente. Use a transferência com aceite.',
      );
    }
    return this.conversationsService.assign(id, userId, req.user?.tenant_id);
  }

  @Post(':id/transfer-request')
  transferRequest(
    @Param('id') id: string,
    @Body() body: TransferRequestDto,
    @Request() req: any,
  ) {
    // ADMIN / SUPER_ADMIN podem transferir conversa de QUALQUER operador;
    // operador comum só as atribuídas a ele.
    const isAdmin = (req.user?.roles ?? []).some(
      (r: string) => r === 'ADMIN' || r === 'SUPER_ADMIN',
    );
    return this.conversationsService.requestTransfer(
      id,
      body.toUserId,
      req.user.id,
      body.reason || null,
      body.audioIds,
      isAdmin,
    );
  }

  @Patch(':id/transfer-accept')
  transferAccept(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.acceptTransfer(id, req.user.id);
  }

  @Patch(':id/transfer-decline')
  transferDecline(@Param('id') id: string, @Body('reason') reason: string, @Request() req: any) {
    return this.conversationsService.declineTransfer(id, reason || null, req.user.id);
  }

  @Patch(':id/transfer-cancel')
  transferCancel(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.cancelTransfer(id, req.user.id);
  }

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.conversationsService.close(id);
  }

  @Patch(':id/defer')
  defer(@Param('id') id: string) {
    return this.conversationsService.defer(id);
  }

  /** Adia (snooze) a conversa: cria tarefa de retorno + ela volta sozinha no prazo. */
  @Post(':id/snooze')
  snooze(
    @Param('id') id: string,
    @Body() body: { dueAt: string; note?: string; title?: string },
    @Request() req: any,
  ) {
    return this.conversationsService.snooze(id, req.user.id, req.user?.tenant_id, body.dueAt, body.note, body.title);
  }

  @Post(':id/transfer-to-lawyer')
  transferToLawyer(
    @Param('id') id: string,
    @Body() body: TransferToLawyerDto,
    @Request() req: any,
  ) {
    return this.conversationsService.transferToAssignedLawyer(id, req.user.id, body.reason, body.audioIds);
  }

  @Patch(':id/return-to-origin')
  returnToOrigin(
    @Param('id') id: string,
    @Body() body: ReturnToOriginDto,
    @Request() req: any,
  ) {
    return this.conversationsService.returnToOrigin(id, body.reason, body.audioIds, req.user?.id);
  }

  @Patch(':id/keep-in-inbox')
  keepInInbox(@Param('id') id: string) {
    return this.conversationsService.keepInInbox(id);
  }

  // Aviso "Cliente sem processo" (caixa Clientes): arquivar ou adiar a decisão.
  @Patch(':id/archive-client')
  archiveClient(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.archiveClient(id, req.user?.tenant_id);
  }

  @Post(':id/defer-decision')
  deferDecision(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.deferClientDecision(id, req.user?.tenant_id);
  }

  @Post(':id/mark-read')
  markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.markAsRead(id, req.user?.id);
  }

  @Post(':id/presence')
  sendPresence(@Param('id') id: string, @Body() dto: SendPresenceDto) {
    return this.conversationsService.sendPresence(id, dto.presence);
  }

  @Patch(':id/assign-lawyer')
  assignLawyer(
    @Param('id') id: string,
    @Body('lawyerId') lawyerId: string | null,
    @Request() req: any,
  ) {
    return this.conversationsService.setAssignedLawyer(id, lawyerId ?? null, req.user?.tenant_id);
  }

  @Patch(':id/legal-area')
  setLegalArea(
    @Param('id') id: string,
    @Body('legalArea') legalArea: string | null,
  ) {
    return this.conversationsService.setLegalArea(id, legalArea ?? null);
  }

  // ── Notas internas fixas ──────────────────────────────────────

  @Get(':id/notes')
  listNotes(@Param('id') id: string, @Req() req: any) {
    return this.conversationsService.listNotes(id, req.user?.tenant_id);
  }

  @Post(':id/notes')
  createNote(@Param('id') id: string, @Body() dto: CreateNoteDto, @Req() req: any) {
    return this.conversationsService.createNote(id, req.user.id, dto.text, req.user?.tenant_id);
  }

  @Patch(':id/notes/:noteId')
  updateNote(@Param('noteId') noteId: string, @Body() dto: CreateNoteDto, @Req() req: any) {
    return this.conversationsService.updateNote(noteId, req.user.id, dto.text);
  }
}
