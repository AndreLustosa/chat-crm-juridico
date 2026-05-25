import { Controller, Post, Req, Headers, HttpCode, Logger, BadRequestException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { StripeBillingService } from './stripe-billing.service';

/**
 * Receptor de webhook do Stripe (assinatura SaaS). Rota PÚBLICA — o Stripe não
 * manda token; a autenticidade vem da ASSINATURA do payload (header
 * Stripe-Signature), verificada com o STRIPE_WEBHOOK_SECRET via constructEvent.
 *
 * Requer RAW BODY (main.ts: NestFactory.create(..., { rawBody: true })) — a
 * verificação HMAC é sobre os bytes crus, não sobre o JSON re-serializado.
 */
@Public()
@SkipThrottle()
@Controller('webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger('StripeWebhook');

  constructor(private readonly stripeBilling: StripeBillingService) {}

  @Post('stripe')
  @HttpCode(200)
  async handle(@Req() req: any, @Headers('stripe-signature') signature: string) {
    // main.ts já captura o corpo CRU (string) via `verify` do express.json
    // (o bodyParser default é desligado e configurado manualmente lá).
    const raw: string | undefined = req?.rawBody;
    if (!raw || !signature) {
      throw new BadRequestException('Webhook Stripe inválido (sem corpo cru ou assinatura).');
    }

    let event;
    try {
      event = await this.stripeBilling.constructEvent(raw, signature);
    } catch (e: any) {
      this.logger.warn(`[STRIPE-WEBHOOK] Assinatura inválida: ${e?.message}`);
      throw new BadRequestException('Assinatura do webhook inválida.');
    }

    this.logger.log(`[STRIPE-WEBHOOK] Evento: ${event.type}`);
    try {
      await this.stripeBilling.handleEvent(event);
    } catch (e: any) {
      this.logger.error(`[STRIPE-WEBHOOK] Erro ao processar ${event.type}: ${e?.message}`);
    }
    return { received: true };
  }
}
