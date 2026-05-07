import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SettingsService } from '../../settings/settings.service';

/**
 * Verifica assinatura HMAC-SHA256 dos webhooks da Evolution API.
 * Header esperado: `x-webhook-signature` ou `x-signature`.
 *
 * Comportamento por configuração:
 * - WEBHOOK_HMAC_REQUIRED=true  → rejeita qualquer webhook sem apiKey ou sem assinatura válida (fail-closed)
 * - WEBHOOK_HMAC_REQUIRED=false → permite webhooks quando apiKey não está configurada (compatibilidade)
 */
@Injectable()
export class HmacGuard implements CanActivate {
  private readonly logger = new Logger(HmacGuard.name);

  constructor(private readonly settings: SettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const hmacRequired = process.env.WEBHOOK_HMAC_REQUIRED === 'true';

    const { apiKey } = await this.settings.getWhatsAppConfig();
    if (!apiKey) {
      if (hmacRequired) {
        this.logger.warn(
          '[HMAC] WEBHOOK_HMAC_REQUIRED=true mas nenhuma API key configurada — rejeitando webhook. ' +
          'Configure a API key do WhatsApp em Ajustes > Integração.',
        );
        throw new UnauthorizedException('Webhook HMAC não configurado no servidor.');
      }
      // Sem apiKey e HMAC não obrigatório — permitir para compatibilidade com Evolution API
      return true;
    }

    // Header pode vir como `<hex>` ou `sha256=<hex>` (padrao GitHub/Stripe).
    // Descascar prefixo antes da comparacao.
    const rawSig =
      (req.headers['x-webhook-signature'] as string | undefined) ||
      (req.headers['x-signature'] as string | undefined) ||
      '';
    const signature = rawSig.startsWith('sha256=') ? rawSig.slice(7) : rawSig;

    if (!signature) {
      // Se WEBHOOK_HMAC_REQUIRED=true, rejeitar sem assinatura (fail-closed)
      if (hmacRequired) {
        this.logger.warn('[HMAC] Webhook sem assinatura — rejeitado (HMAC obrigatório)');
        throw new UnauthorizedException('Webhook signature required');
      }
      // Evolution API nao envia assinatura por padrao — permitir passagem (compat)
      return true;
    }

    // rawBody eh capturado em main.ts via verify do express.json (utf8 string).
    // NAO usar JSON.stringify(req.body): a re-serializacao difere da payload
    // original (whitespace, ordem de chaves) e a assinatura nunca bateria.
    const rawBody = (req as { rawBody?: string }).rawBody;
    if (!rawBody) {
      this.logger.error('[HMAC] req.rawBody ausente — verify do body parser nao rodou');
      throw new UnauthorizedException('Cannot verify signature');
    }
    const expected = crypto
      .createHmac('sha256', apiKey)
      .update(rawBody)
      .digest('hex');

    // timingSafeEqual exige buffers de mesmo tamanho — comparar tamanho antes
    // pra evitar TypeError (que viraria 500). Tamanho diferente ja eh sinal
    // de assinatura malformada.
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('[HMAC] Assinatura invalida no webhook — rejeitado');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
