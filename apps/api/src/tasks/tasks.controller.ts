import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus, UseInterceptors, UploadedFiles, Res, StreamableFile } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTaskDto, UpdateTaskDto } from './dto/tasks.dto';

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // Sprint 4: Carga de trabalho por usuário (deve vir ANTES de :id)
  @Get('workload')
  getWorkload(@Request() req: any) {
    return this.tasksService.getWorkload(req.user?.tenant_id);
  }

  /**
   * Diligencias que o advogado delegou pra outras pessoas. Painel pra
   * acompanhar progresso (vista/iniciada/concluida) com agregados de
   * status e contadores de comentarios + anexos.
   */
  @Get('delegated-by-me')
  findDelegatedByMe(@Request() req: any) {
    return this.tasksService.findDelegatedByMe(req.user?.id, req.user?.tenant_id);
  }

  // Sprint 4: Sugestão de próxima ação por IA
  @Post('next-action')
  @HttpCode(HttpStatus.OK)
  suggestNextAction(@Body() body: any) {
    return this.tasksService.suggestNextAction({
      title: body.title,
      description: body.description,
      leadName: body.leadName,
      caseSummary: body.caseSummary,
      recentTasks: body.recentTasks,
      assignedTo: body.assignedTo,
    });
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('assignedUserId') assignedUserId?: string,
    @Query('dueFilter') dueFilter?: string,
    @Query('search') search?: string,
    @Query('viewAll') viewAll?: string,
    @Request() req?: any,
  ) {
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    const roles = req?.user?.roles || [];
    const userId = req?.user?.id;
    const isAdmin = roles.includes('ADMIN');

    // RBAC:
    //   ADMIN → pode usar viewAll=true pra ver tudo, ou filtrar por
    //            assignedUserId especifico (supervisao).
    //   Nao-ADMIN (inclusive ADVOGADO) → SEMPRE filtra por req.user.id.
    //     viewAll e assignedUserId da query SAO IGNORADOS.
    //
    // Bug corrigido 2026-04-24: antes, ADVOGADO com ?viewAll=true via
    // todas as tarefas da empresa (de todos os operadores/estagiarios/
    // advogados). Equivalente ao bug de calendar/events (commit 1184efa).
    const effectiveAssignedUserId = isAdmin
      ? (viewAll === 'true' ? undefined : (assignedUserId || userId))
      : userId; // nao-admin: sempre o proprio

    return this.tasksService.findAll(req?.user?.tenant_id, p, l, {
      status,
      assignedUserId: effectiveAssignedUserId,
      dueFilter,
      search,
    });
  }

  @Get('legal-case/:caseId')
  findByLegalCase(@Param('caseId') caseId: string, @Request() req: any) {
    return this.tasksService.findByLegalCase(caseId, req.user?.tenant_id);
  }

  @Get('conversation/:conversationId/active')
  findActiveByConversation(@Param('conversationId') conversationId: string, @Request() req: any) {
    return this.tasksService.findActiveByConversation(conversationId, req.user?.tenant_id);
  }

  @Post()
  create(@Body() data: CreateTaskDto, @Request() req: any) {
    return this.tasksService.create({
      ...data,
      tenant_id: req.user?.tenant_id,
      created_by_id: req.user?.id,
    });
  }

  @Post(':id/complete-reopen')
  completeAndReopen(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.completeAndReopen(id, req.user?.tenant_id);
  }

  /**
   * Marca Task como vista pelo responsavel atual. Idempotente (chamado
   * pelo useEffect do card no frontend toda vez que renderiza, mas
   * service no-ops se ja tem viewed_at). Pula se quem ve nao eh o
   * assigned_user_id — advogado abrir painel nao conta como visualizada.
   */
  @Post(':id/mark-viewed')
  @HttpCode(HttpStatus.OK)
  markViewed(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.markViewed(id, req.user?.id, req.user?.tenant_id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id') id: string, @Body() body: { note?: string }, @Request() req: any) {
    return this.tasksService.complete(id, body.note || '', req.user?.id, req.user?.tenant_id);
  }

  @Post(':id/postpone')
  @HttpCode(HttpStatus.OK)
  postpone(
    @Param('id') id: string,
    @Body() body: { new_due_at: string; reason: string },
    @Request() req: any,
  ) {
    return this.tasksService.postpone(id, body.new_due_at, body.reason, req.user?.id, req.user?.tenant_id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Request() req: any) {
    return this.tasksService.updateStatus(id, status, req.user?.tenant_id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateTaskDto, @Request() req: any) {
    return this.tasksService.update(id, data, req.user?.tenant_id);
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body('text') text: string, @Request() req: any) {
    return this.tasksService.addComment(id, req.user?.id, text, req.user?.tenant_id);
  }

  @Get(':id/comments')
  findComments(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.findComments(id, req.user?.tenant_id);
  }

  // Sprint 5: Task detail
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.findOne(id, req.user?.tenant_id);
  }

  // Sprint 5: Checklist CRUD
  @Post(':id/checklist')
  addChecklistItem(@Param('id') id: string, @Body('text') text: string, @Request() req: any) {
    return this.tasksService.addChecklistItem(id, text, req.user?.tenant_id);
  }

  @Patch(':id/checklist/:itemId')
  toggleChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body('done') done: boolean,
    @Request() req: any,
  ) {
    return this.tasksService.toggleChecklistItem(id, itemId, done, req.user?.tenant_id);
  }

  @Delete(':id/checklist/:itemId')
  deleteChecklistItem(@Param('id') id: string, @Param('itemId') itemId: string, @Request() req: any) {
    return this.tasksService.deleteChecklistItem(id, itemId, req.user?.tenant_id);
  }

  // ─── Attachments (anexos da diligência) ──────────────────────

  /**
   * Sugere pasta automatica baseada no titulo da Task. Frontend chama
   * antes de exibir o select de pasta no modal de conclusao pra ja vir
   * com a sugestao certa marcada.
   */
  @Get(':id/suggest-folder')
  suggestFolder(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.suggestFolderForTask(id, req.user?.tenant_id)
      .then(folder => ({ folder }));
  }

  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.listAttachments(id, req.user?.tenant_id);
  }

  /**
   * Sobe varios arquivos pra uma Task em uma chamada multipart. Aceita
   * `folder` opcional no body (override da sugestao automatica).
   * Maximo 10 arquivos por request — sem isso o nginx default de 8MB
   * poderia gargalar com 25MB cada x N arquivos.
   */
  @Post(':id/attachments')
  @UseInterceptors(FilesInterceptor('files', 10))
  uploadAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: any[],
    @Body('folder') folder: string | undefined,
    @Request() req: any,
  ) {
    return this.tasksService.addAttachments(
      id,
      files || [],
      req.user?.id,
      req.user?.tenant_id,
      folder,
    );
  }

  @Get('attachments/:attachmentId/download')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response,
    @Request() req: any,
  ) {
    const result = await this.tasksService.downloadAttachment(
      attachmentId,
      req.user?.tenant_id,
    );
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.fileName)}"`,
    );
    return new StreamableFile(result.stream);
  }

  @Delete('attachments/:attachmentId')
  removeAttachment(
    @Param('attachmentId') attachmentId: string,
    @Request() req: any,
  ) {
    return this.tasksService.removeAttachment(attachmentId, req.user?.tenant_id);
  }
}
