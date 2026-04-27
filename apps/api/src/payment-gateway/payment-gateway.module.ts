import { Module, forwardRef } from '@nestjs/common';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentReminderService } from './payment-reminder.service';
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
  // PaymentReminderService eh registrado aqui pra ter acesso ao
  // PaymentGatewayService no construtor — alem dos crons (@Cron sao
  // descobertos automaticamente pelo @nestjs/schedule). Nao exportado
  // porque so eh chamado via cron + via PaymentGatewayService internamente.
  providers: [PaymentGatewayService, PaymentReminderService, AsaasClient],
  exports: [PaymentGatewayService],
})
export class PaymentGatewayModule {}
