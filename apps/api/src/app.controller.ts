import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ChatGateway } from './gateway/chat.gateway';

@Controller()
export class AppController {
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
    return {
      initialized: !!server,
      path: (server as any)?.opts?.path || 'unknown',
      connectedClients: (server as any)?.engine?.clientsCount ?? -1,
      transports: (server as any)?.opts?.transports || 'unknown',
    };
  }
}
