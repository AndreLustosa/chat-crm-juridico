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
 * COMPORTAMENTO POR AMBIENTE (Bug fix 2026-05-10 PR1 Webhooks #2 — CRITICO):
 *
 * Antes (FAIL-OPEN por default): se apiKey nao configurada E
 * WEBHOOK_HMAC_REQUIRED nao setado, retornava `true` aceitando QUALQUER
 * POST em /webhooks/evolution sem assinatura. Em prod (Evolution server
 * compartilhado entre Lexcon e lustosa), atacante que descobrisse o path
 * podia forjar payloads — injetar mensagens, alterar status, disparar
 * resync (DoS) sem nenhuma autenticacao.
 *
 * Agora (FAIL-CLOSED em production):
 * - NODE_ENV=production:
 *   * apiKey ausente → REJEITA com 401 + log error (deploy esta inseguro)
 *   * signature ausente quando apiKey configurada → REJEITA com 401
 *   * Override soft: WEBHOOK_HMAC_REQUIRED=false desativa explicitamente
 *     (pra cenarios de migracao gradual — registra warn alto)
 * - NODE_ENV=development/staging/test:
 *   * Mantem fail-open pra compat com testes locais sem apiKey
 *
 * Override hard: WEBHOOK_HMAC_REQUIRED=true forca fail-closed em qualquer
 * ambiente.
 */
@Injectable()
export class HmacGuard implements CanActivate {
  private readonly logger = new Logger(HmacGuard.name);

  constructor(private readonly settings: SettingsService) {}

  /**
   * Resolve o modo do guard:
   *   - 'closed': rejeita sem apiKey ou sem assinatura
   *   - 'open': permite passagem em ausencia de apiKey/assinatura
   * Default em production = 'closed' (Bug fix #2).
   */
  private resolveMode(): 'closed' | 'open' {
    const explicit = process.env.WEBHOOK_HMAC_REQUIRED;
    if (explicit === 'true') return 'closed';
    if (explicit === 'false') return 'open';
    // Default por NODE_ENV: production fail-closed, demais fail-open
    return process.env.NODE_ENV === 'production' ? 'closed' : 'open';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const mode = this.resolveMode();

    const { apiKey } = await this.settings.getWhatsAppConfig();
    if (!apiKey) {
      if (mode === 'closed') {
        // Production sem apiKey configurada eh deploy inseguro — recusa
        // ate que admin configure em Ajustes > Integracao.
        this.logger.error(
          '[HMAC] FAIL-CLOSED: nenhuma API key configurada em production. ' +
          'Configure em Ajustes > Integracao OU defina WEBHOOK_HMAC_REQUIRED=false ' +
          'pra desativar explicitamente (NAO RECOMENDADO em prod).',
        );
        throw new UnauthorizedException('Webhook HMAC nao configurado no servidor');
      }
      // Mode 'open' (dev/staging) — permite pra facilitar testes locais
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
      if (mode === 'closed') {
        // apiKey configurada + ambiente prod = obrigatoriamente exige assinatura
        this.logger.warn(
          `[HMAC] Webhook sem assinatura rejeitado (mode=closed). ` +
          `IP=${req.ip || 'unknown'}, UA=${req.headers['user-agent'] || 'none'}`,
        );
        throw new UnauthorizedException('Webhook signature required');
      }
      // Evolution API nao envia assinatura por padrao em modo dev — permitir
      this.logger.debug('[HMAC] Webhook sem assinatura aceito (mode=open, dev/staging)');
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
