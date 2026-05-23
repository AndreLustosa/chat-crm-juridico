import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubscriptionService } from './subscription.service';
import { SignupDto } from './dto/signup.dto';
import { Public } from '../auth/decorators/public.decorator';
import { SubscriptionExempt } from './subscription-exempt.decorator';

@Controller()
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /**
   * Cadastro público — cria escritório + admin + trial de 15 dias e já devolve
   * o token (auto-login). Mesmo shape de /auth/login mais { tenant, subscription }.
   *
   * - @Public(): rota aberta (usuário ainda não tem token ao se cadastrar).
   * - @Throttle: 5/min por IP (anti-abuso; o e-mail @unique cobre duplicatas).
   * - Flag-gated no service (SAAS_SIGNUP_ENABLED) → 403 enquanto desligado.
   */
  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signup(@Body() dto: SignupDto) {
    return this.subscriptionService.signup(dto);
  }

  /**
   * Estado da assinatura do tenant logado (banner de trial / tela de bloqueio).
   * Autenticado (JwtAuthGuard global) mas ISENTO da trava — precisa responder
   * mesmo com a assinatura vencida.
   */
  @SubscriptionExempt()
  @Get('me/subscription')
  async mySubscription(@Request() req: any) {
    return this.subscriptionService.getForTenant(req.user?.tenant_id);
  }
}
