import { Controller, Get, Post, Delete, Body, UseGuards, Request, Headers } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PushService } from './push.service';

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly service: PushService) {}

  /** Retorna a VAPID public key para o frontend configurar o Service Worker */
  @Get('vapid-key')
  async getVapidKey() {
    const key = await this.service.getPublicKey();
    return { publicKey: key };
  }

  /** Registra uma subscription de Web Push do navegador */
  @Post('subscribe')
  async subscribe(
    @Request() req: any,
    @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.service.subscribe(req.user.sub, body, userAgent);
    return { ok: true };
  }

  /** Remove uma subscription */
  @Delete('subscribe')
  async unsubscribe(
    @Request() req: any,
    @Body() body: { endpoint: string },
  ) {
    await this.service.unsubscribe(req.user.sub, body.endpoint);
    return { ok: true };
  }
}
