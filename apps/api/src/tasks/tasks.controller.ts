import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTaskDto, UpdateTaskDto } from './dto/tasks.dto';

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    return this.tasksService.findAll(p, l);
  }

  @Get('legal-case/:caseId')
  findByLegalCase(@Param('caseId') caseId: string) {
    return this.tasksService.findByLegalCase(caseId);
  }

  @Post()
  create(@Body() data: CreateTaskDto, @Request() req: any) {
    return this.tasksService.create({
      ...data,
      tenant_id: req.user?.tenant_id,
      created_by_id: req.user?.id,
    });
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.tasksService.updateStatus(id, status);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateTaskDto) {
    return this.tasksService.update(id, data);
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body('text') text: string, @Request() req: any) {
    return this.tasksService.addComment(id, req.user.id, text);
  }

  @Get(':id/comments')
  findComments(@Param('id') id: string) {
    return this.tasksService.findComments(id);
  }
}
