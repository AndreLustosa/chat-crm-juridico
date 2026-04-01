import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
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
    @Request() req?: any,
  ) {
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    return this.tasksService.findAll(req?.user?.tenant_id, p, l, {
      status,
      assignedUserId,
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
}
