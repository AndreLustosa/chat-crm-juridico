import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationSettingsService } from './notification-settings.service';

@Controller('users/me/notification-settings')
@UseGuards(JwtAuthGuard)
export class NotificationSettingsController {
  constructor(private readonly service: NotificationSettingsService) {}

  /** Retorna as preferências de notificação do usuário autenticado */
  @Get()
  async get(@Request() req: any) {
    return this.service.getOrCreate(req.user.sub || req.user.id);
  }

  /** Atualiza preferências (merge parcial), sound_id e/ou muted_until */
  @Patch()
  async update(
    @Request() req: any,
    @Body() body: {
      preferences?: Record<string, { sound?: boolean; desktop?: boolean; email?: boolean }>;
      sound_id?: string;
      muted_until?: string | null;
    },
  ) {
    return this.service.update(req.user.sub || req.user.id, body);
  }
}
