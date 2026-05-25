import { Controller, Get, Post, Request } from '@nestjs/common';
import { MeWhatsappService } from './me-whatsapp.service';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Conexão self-service do WhatsApp do escritório logado (multi-tenant).
 * Rotas relativas (prefixo /api do Traefik). JwtAuthGuard global autentica;
 * connect/disconnect são só ADMIN. Tudo derivado de req.user.tenant_id.
 */
@Controller()
export class MeWhatsappController {
  constructor(private readonly svc: MeWhatsappService) {}

  /** Provisiona (inbox+instância) e devolve QR/pairing pra conectar. */
  @Post('me/whatsapp/connect')
  @Roles('ADMIN')
  connect(@Request() req: any) {
    return this.svc.connect(req.user?.tenant_id);
  }

  /** Estado da conexão (open|connecting|close|none). Qualquer usuário do tenant. */
  @Get('me/whatsapp/status')
  status(@Request() req: any) {
    return this.svc.status(req.user?.tenant_id);
  }

  /** Desconecta o WhatsApp do escritório (logout). */
  @Post('me/whatsapp/disconnect')
  @Roles('ADMIN')
  disconnect(@Request() req: any) {
    return this.svc.disconnect(req.user?.tenant_id);
  }
}
