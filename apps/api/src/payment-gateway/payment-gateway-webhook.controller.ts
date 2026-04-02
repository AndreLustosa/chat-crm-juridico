import { Controller, Post, Body, Headers, Logger, HttpCode } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentGatewayService } from './payment-gateway.service';

@Public()
@SkipThrottle()
@Controller('webhooks')
export class PaymentGatewayWebhookController {
  private readonly logger = new Logger('AsaasWebhook');

  constructor(private service: PaymentGatewayService) {}

  @Post('asaas')
  @HttpCode(200)
  async handleAsaasWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') accessToken: string,
  ) {
    this.logger.log(
      `[ASAAS-WEBHOOK] Evento: ${body?.event} | Payment: ${body?.payment?.id}`,
    );

    try {
      await this.service.handleWebhook(body);
    } catch (e: any) {
      this.logger.error(`[ASAAS-WEBHOOK] Erro: ${e.message}`);
    }

    return { received: true };
  }
}
