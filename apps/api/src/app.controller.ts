import { Body, Controller, Get, HttpCode, Logger, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { ChatGateway } from './gateway/chat.gateway';
import { Public } from './auth/decorators/public.decorator';

@Public()
@Controller()
export class AppController {
  private readonly logger = new Logger('AppController');

  constructor(
    private readonly appService: AppService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('debug/socket')
  debugSocket() {
    const server = this.chatGateway?.server;
    const engine = (server as any)?.engine;
    return {
      initialized: !!server,
      engineAttached: !!engine,
      path: (server as any)?._opts?.path || (server as any)?.opts?.path || 'unknown',
      connectedClients: engine?.clientsCount ?? -1,
      transports: (server as any)?._opts?.transports || (server as any)?.opts?.transports || 'unknown',
      httpServerAttached: !!(server as any)?.httpServer,
    };
  }

  /**
   * Beacon diagnostico enviado pelo SocketProvider quando o cleanup do
   * socket acontece por causa de logout automatico (token removido +
   * auth_logout_reason setado no localStorage).
   *
   * Sem este endpoint, todo logout vira um `client namespace disconnect`
   * anonimo no log — impossivel distinguir de uma navegacao normal ou
   * mudanca de token. Aqui registramos a causa real antes do socket
   * cair, para que a raiz fique visivel no log da API.
   *
   * Publico (sem auth): no momento deste beacon o token ja foi removido.
   * Rate-limit natural: so dispara 1x por logout por usuario.
   */
  @Post('diagnostics/socket-logout')
  @HttpCode(204)
  socketLogoutDiagnostic(
    @Body() body: {
      reason?: string;
      userId?: string | null;
      socketId?: string;
      tokenExp?: number | null;
      now?: number;
      path?: string;
    },
  ) {
    const exp = body?.tokenExp;
    const now = body?.now ?? Math.floor(Date.now() / 1000);
    const expIso = exp ? new Date(exp * 1000).toISOString() : 'n/a';
    const expired = exp ? exp < now : 'unknown';
    const ageDays = exp ? Math.round((now - exp) / 86400) : null;
    this.logger.warn(
      `[SOCKET] Logout client-side: reason="${body?.reason ?? 'unknown'}" ` +
      `user=${body?.userId ?? 'n/a'} socket=${body?.socketId ?? 'n/a'} ` +
      `tokenExp=${expIso} expired=${expired} ageDays=${ageDays ?? 'n/a'} ` +
      `path=${body?.path ?? 'n/a'}`,
    );
    return;
  }
}
