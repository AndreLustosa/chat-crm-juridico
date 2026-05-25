import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { InviteService } from './invite.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Convite de novo escritorio — rotas PUBLICAS (o admin convidado ainda nao tem
 * senha/token de login). A geracao do convite e feita no PlatformController
 * (SUPER_ADMIN); aqui o convidado valida e resgata.
 */
@Controller('invite')
export class InviteController {
  constructor(private readonly svc: InviteService) {}

  /** Valida o convite (pra tela "definir senha" saber nome/escritorio). */
  @Public()
  @Get(':token')
  validate(@Param('token') token: string) {
    return this.svc.validate(token);
  }

  /** Define a senha e ativa a conta. */
  @Public()
  @Post(':token')
  redeem(@Param('token') token: string, @Body() body: { password?: string }) {
    return this.svc.redeem(token, body?.password ?? '');
  }
}
