import { Body, Controller, Delete, Get, Param, Post, Request } from '@nestjs/common';
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

  // ─── Multi-departamento (Fase 1): cada departamento = 1 Inbox + 1 número ──────

  /** Lista os departamentos (inboxes) do escritório + status do WhatsApp de cada um. */
  @Get('me/whatsapp/departments')
  listDepartments(@Request() req: any) {
    return this.svc.listDepartments(req.user?.tenant_id);
  }

  /** Cria um departamento (Inbox). */
  @Post('me/whatsapp/departments')
  @Roles('ADMIN')
  createDepartment(@Body() body: { name: string }, @Request() req: any) {
    return this.svc.createDepartment(req.user?.tenant_id, body?.name);
  }

  /** Conecta (QR/pairing) o número de um departamento. */
  @Post('me/whatsapp/departments/:inboxId/connect')
  @Roles('ADMIN')
  connectInbox(@Param('inboxId') inboxId: string, @Request() req: any) {
    return this.svc.connectInbox(req.user?.tenant_id, inboxId);
  }

  /** Estado da conexão do número de um departamento. */
  @Get('me/whatsapp/departments/:inboxId/status')
  statusInbox(@Param('inboxId') inboxId: string, @Request() req: any) {
    return this.svc.statusInbox(req.user?.tenant_id, inboxId);
  }

  /** Desconecta (logout) o número de um departamento. */
  @Post('me/whatsapp/departments/:inboxId/disconnect')
  @Roles('ADMIN')
  disconnectInbox(@Param('inboxId') inboxId: string, @Request() req: any) {
    return this.svc.disconnectInbox(req.user?.tenant_id, inboxId);
  }

  /** Exclui o departamento (apaga a instância na Evolution + remove o Inbox). */
  @Delete('me/whatsapp/departments/:inboxId')
  @Roles('ADMIN')
  deleteDepartment(@Param('inboxId') inboxId: string, @Request() req: any) {
    return this.svc.deleteDepartment(req.user?.tenant_id, inboxId);
  }
}
