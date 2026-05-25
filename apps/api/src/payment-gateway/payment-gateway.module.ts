import { Module, forwardRef } from '@nestjs/common';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentReminderService } from './payment-reminder.service';
import { PaymentGatewayController } from './payment-gateway.controller';
import { PaymentGatewayWebhookController } from './payment-gateway-webhook.controller';
import { AsaasClient } from './asaas/asaas-client';
import { SaasBillingService } from './saas-billing.service';
import { StripeBillingService } from './stripe-billing.service';
import { StripeWebhookController } from './stripe-webhook.controller';
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
  controllers: [PaymentGatewayController, PaymentGatewayWebhookController, StripeWebhookController],
  // PaymentReminderService eh registrado aqui pra ter acesso ao
  // PaymentGatewayService no construtor — alem dos crons (@Cron sao
  // descobertos automaticamente pelo @nestjs/schedule). Nao exportado
  // porque so eh chamado via cron + via PaymentGatewayService internamente.
  // SaasBillingService: billing da assinatura SaaS (reusa AsaasClient). Exportado
  // pro SubscriptionModule chamar o checkout. O webhook (controller deste módulo)
  // roteia eventos "saas:" pra ele — ver isSaasWebhookEvent.
  providers: [PaymentGatewayService, PaymentReminderService, AsaasClient, SaasBillingService, StripeBillingService],
  exports: [PaymentGatewayService, SaasBillingService, StripeBillingService],
})
export class PaymentGatewayModule {}
