import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

// Bug fix 2026-05-10 (NotifService PR1 #1 — CRITICO): TODOS os endpoints
// estavam usando `req.user.sub`, mas JwtStrategy.validate() retorna
// `{ id: payload.sub, ... }` — ou seja, `req.user.sub` eh sempre undefined.
// Quando passado pra service.findByUser(undefined, ...), Prisma trata
// `where: { user_id: undefined }` como "filtro nao aplicado" e retorna
// TODAS as notificacoes do sistema (vazamento horizontal massivo).
// Mesmo padrao em unreadCount, markRead, markAllRead, mute, unmute,
// getMutedConversations. CORRIGIDO: req.user.id em todos.
//
// Helper requireUserId garante que se req.user.id for undefined (token
// malformado ou strategy falhou), endpoint retorna 401 em vez de
// silenciosamente vazar dados de outros tenants.

function requireUserId(req: any): string {
  const userId = req?.user?.id;
  if (!userId || typeof userId !== 'string') {
    throw new UnauthorizedException('Token sem user id valido');
  }
  return userId;
}

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
    return this.service.findByUser(requireUserId(req), {
      type,
      unreadOnly: unread === 'true',
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  /** Contagem de não-lidas */
  @Get('unread-count')
  async unreadCount(@Request() req: any) {
    const count = await this.service.unreadCount(requireUserId(req));
    return { count };
  }

  /** Marca uma notificação como lida */
  @Patch(':id/read')
  async markRead(@Request() req: any, @Param('id') id: string) {
    await this.service.markRead(requireUserId(req), id);
    return { ok: true };
  }

  /** Marca todas como lidas */
  @Post('mark-all-read')
  async markAllRead(@Request() req: any) {
    await this.service.markAllRead(requireUserId(req));
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
    return this.service.muteConversation(requireUserId(req), conversationId, body?.until);
  }

  /** Desmuta uma conversa */
  @Delete('conversations/:id/mute')
  async unmute(@Request() req: any, @Param('id') conversationId: string) {
    await this.service.unmuteConversation(requireUserId(req), conversationId);
    return { ok: true };
  }

  /** Lista conversas mutadas */
  @Get('muted-conversations')
  async mutedConversations(@Request() req: any) {
    const ids = await this.service.getMutedConversations(requireUserId(req));
    return { conversationIds: ids };
  }
}
