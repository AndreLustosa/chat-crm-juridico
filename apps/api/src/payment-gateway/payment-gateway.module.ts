import { Module, forwardRef } from '@nestjs/common';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentGatewayController } from './payment-gateway.controller';
import { PaymentGatewayWebhookController } from './payment-gateway-webhook.controller';
import { AsaasClient } from './asaas/asaas-client';
import { SettingsModule } from '../settings/settings.module';
import { GatewayModule } from '../gateway/gateway.module';
import { HonorariosModule } from '../honorarios/honorarios.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    GatewayModule,
    forwardRef(() => HonorariosModule),
    forwardRef(() => FinanceiroModule),
    forwardRef(() => WhatsappModule),
  ],
  controllers: [PaymentGatewayController, PaymentGatewayWebhookController],
  providers: [PaymentGatewayService, AsaasClient],
  exports: [PaymentGatewayService],
})
export class PaymentGatewayModule {}
