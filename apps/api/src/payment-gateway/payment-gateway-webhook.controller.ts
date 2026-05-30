import { Controller, Post, Body, Headers, Logger, HttpCode, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentGatewayService } from './payment-gateway.service';
import { SaasBillingService, isSaasWebhookEvent } from './saas-billing.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Bug fix 2026-05-10 (Honorarios PR1 #1 — CRITICO):
 *
 * Antes endpoint estava aberto a QUALQUER POST sem autenticacao. Atacante
 * podia mandar:
 *   POST /webhooks/asaas
 *   { "event": "PAYMENT_RECEIVED", "payment": { "id": "pay_xxx", "status": "RECEIVED" } }
 * E o sistema marcava QUALQUER cobranca como paga sem verificar.
 *
 * Agora valida `asaas-access-token` contra:
 *   1. Settings.asaas_webhook_token (preferido — UI configura)
 *   2. ASAAS_WEBHOOK_TOKEN env var (fallback)
 *
 * Comportamento por ambiente (igual HmacGuard):
 *   - production: fail-CLOSED se nenhum token configurado (rejeita ate
 *     admin configurar). Override: ASAAS_WEBHOOK_REQUIRED=false (loga erro).
 *   - dev/staging: fail-OPEN (permite testes locais).
 *
 * Comparacao timing-safe pra prevenir timing attacks.
 */
@Public()
@SkipThrottle()
@Controller('webhooks')
export class PaymentGatewayWebhookController {
  private readonly logger = new Logger('AsaasWebhook');

  constructor(
    private service: PaymentGatewayService,
    private settings: SettingsService,
    private saasBilling: SaasBillingService,
  ) {}

  /** Resolve modo do guard — production fail-closed por default. */
  private resolveMode(): 'closed' | 'open' {
    const explicit = process.env.ASAAS_WEBHOOK_REQUIRED;
    if (explicit === 'true') return 'closed';
    if (explicit === 'false') return 'open';
    return process.env.NODE_ENV === 'production' ? 'closed' : 'open';
  }

  /** Carrega token esperado de Settings ou env. */
  private async getExpectedToken(): Promise<string | null> {
    const fromSettings = await this.settings.get('asaas_webhook_token').catch(() => null);
    if (fromSettings && typeof fromSettings === 'string' && fromSettings.trim()) {
      return fromSettings.trim();
    }
    const fromEnv = process.env.ASAAS_WEBHOOK_TOKEN;
    return fromEnv?.trim() || null;
  }

  /** Comparação timing-safe de tokens (tamanhos diferentes → inválido). */
  private timingSafeEq(provided: string, expected: string): boolean {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  @Post('asaas')
  @HttpCode(200)
  async handleAsaasWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') accessToken: string,
  ) {
    const mode = this.resolveMode();
    const globalToken = await this.getExpectedToken();

    // Multi-tenant: o token do PRÓPRIO escritório (resolvido pela cobrança via
    // external_id) é aceito além do global. Eventos SaaS rodam sempre na conta
    // da plataforma → só o token global. Assim cada escritório usa o seu token
    // no webhook do Asaas dele, sem precisar conhecer o segredo da plataforma.
    const isSaas = isSaasWebhookEvent(body);
    const tenantToken = isSaas
      ? null
      : await this.service.resolveWebhookTokenForPayment(body?.payment?.id).catch(() => null);
    const accepted = [tenantToken, globalToken].filter((t): t is string => !!t && !!t.trim());

    if (accepted.length === 0) {
      if (mode === 'closed') {
        this.logger.error(
          '[ASAAS-WEBHOOK] FAIL-CLOSED: nenhum token configurado em production. ' +
          'Configure o webhook do escritório (Configurações → Pagamentos), ' +
          'OU asaas_webhook_token global, OU ASAAS_WEBHOOK_TOKEN no env.',
        );
        throw new UnauthorizedException('Asaas webhook token nao configurado');
      }
      // Mode 'open' (dev/staging) — permite com warn
      this.logger.warn('[ASAAS-WEBHOOK] Sem token configurado (mode=open dev/staging) — aceitando');
    } else {
      if (!accessToken) {
        this.logger.warn(`[ASAAS-WEBHOOK] Sem header asaas-access-token — rejeitado`);
        throw new UnauthorizedException('Missing asaas-access-token header');
      }
      // Aceita se bater com o token do escritório OU o global (timing-safe).
      const ok = accepted.some((tok) => this.timingSafeEq(accessToken, tok));
      if (!ok) {
        this.logger.warn(`[ASAAS-WEBHOOK] Token invalido — rejeitado`);
        throw new UnauthorizedException('Invalid asaas-access-token');
      }
    }

    this.logger.log(
      `[ASAAS-WEBHOOK] Evento: ${body?.event} | Payment: ${body?.payment?.id}`,
    );

    try {
      // Desambigua: a MESMA conta Asaas recebe honorários (clientes) e a
      // assinatura SaaS (escritórios). Eventos "saas:" / SUBSCRIPTION_* vão pro
      // billing SaaS; o resto segue o fluxo de honorários intacto.
      if (isSaasWebhookEvent(body)) {
        await this.saasBilling.handleWebhook(body);
      } else {
        await this.service.handleWebhook(body);
      }
    } catch (e: any) {
      this.logger.error(`[ASAAS-WEBHOOK] Erro: ${e.message}`);
    }

    return { received: true };
  }
}
