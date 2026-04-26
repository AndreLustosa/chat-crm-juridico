import { Body, Controller, Get, Post, Req, Res, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PortalAuthService } from './portal-auth.service';
import { ClientJwtAuthGuard } from './client-jwt-auth.guard';
import { CurrentClient } from './current-client.decorator';
import type { ClientUser } from './current-client.decorator';
import { Throttle } from '@nestjs/throttler';

const COOKIE_NAME = 'portal_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/**
 * Endpoints de auth do portal do cliente — montado em /portal/auth.
 *
 * Rate limit (Throttler):
 *   - request-code: max 3 por minuto / IP (alem do cooldown 60s por phone)
 *   - verify-code:  max 10 por minuto / IP
 */
@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly authService: PortalAuthService) {}

  @Post('request-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async requestCode(
    @Body() body: { phone: string },
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || undefined;
    return this.authService.requestCode(body.phone, ip);
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyCode(
    @Body() body: { phone: string; code: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyCode(body.phone, body.code);

    // Set cookie httpOnly. Configuracao em prod:
    //   - secure: true (so HTTPS)
    //   - sameSite: 'lax' (permite navegacao entre subpaginas, bloqueia CSRF basico)
    //   - domain ausente: cookie restrito ao dominio que serve a API
    res.cookie(COOKIE_NAME, result.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });

    // Nao retorna access_token no body (esta no cookie). Mas devolve dados
    // basicos do lead pra UI mostrar saudacao imediatamente.
    return { ok: true, lead: result.lead };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(ClientJwtAuthGuard)
  async getMe(@CurrentClient() client: ClientUser) {
    return {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      is_client: client.is_client,
    };
  }
}
