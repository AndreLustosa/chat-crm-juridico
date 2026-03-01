import { Controller, Get, Param, Patch, Body, Post, Query, UseGuards, Request } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Prisma } from '@crm/shared';

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  findAll(
    @Query('status') status?: string, 
    @Query('inboxId') inboxId?: string,
    @Request() req?: any
  ) {
    const userId = req.user?.id;
    return this.conversationsService.findAll(status, userId, inboxId);
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

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.conversationsService.close(id);
  }
}
