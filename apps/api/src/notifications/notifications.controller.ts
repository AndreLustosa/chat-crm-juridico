import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /** Lista notificações do usuário autenticado */
  @Get()
  async list(
    @Request() req: any,
    @Query('type') type?: string,
    @Query('unread') unread?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findByUser(req.user.sub, {
      type,
      unreadOnly: unread === 'true',
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  /** Contagem de não-lidas */
  @Get('unread-count')
  async unreadCount(@Request() req: any) {
    const count = await this.service.unreadCount(req.user.sub);
    return { count };
  }

  /** Marca uma notificação como lida */
  @Patch(':id/read')
  async markRead(@Request() req: any, @Param('id') id: string) {
    await this.service.markRead(req.user.sub, id);
    return { ok: true };
  }

  /** Marca todas como lidas */
  @Post('mark-all-read')
  async markAllRead(@Request() req: any) {
    await this.service.markAllRead(req.user.sub);
    return { ok: true };
  }

  // ─── ConversationMute ──────────────────────────────────────────

  /** Muta uma conversa */
  @Post('conversations/:id/mute')
  async mute(
    @Request() req: any,
    @Param('id') conversationId: string,
    @Body() body?: { until?: string },
  ) {
    return this.service.muteConversation(req.user.sub, conversationId, body?.until);
  }

  /** Desmuta uma conversa */
  @Delete('conversations/:id/mute')
  async unmute(@Request() req: any, @Param('id') conversationId: string) {
    await this.service.unmuteConversation(req.user.sub, conversationId);
    return { ok: true };
  }

  /** Lista conversas mutadas */
  @Get('muted-conversations')
  async mutedConversations(@Request() req: any) {
    const ids = await this.service.getMutedConversations(req.user.sub);
    return { conversationIds: ids };
  }
}
