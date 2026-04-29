import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrafegoCryptoService } from './trafego-crypto.service';

/**
 * Resolve credenciais do modulo de trafego (DB-first, env-fallback).
 *
 * Versao "leve" do worker: apenas leitura. Mutate/masking estao na API
 * (apps/api/src/trafego/trafego-config.service.ts).
 *
 * Mantem mesma logica de fallback que a API pra garantir consistencia:
 *   1. TrafficSettings (DB) — admin configurou via UI
 *   2. process.env — fallback (legado / setup novo)
 */
@Injectable()
export class TrafegoConfigService {
  private readonly logger = new Logger(TrafegoConfigService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: TrafegoCryptoService,
  ) {}

  /** Developer Token do Google Ads — secreto, retorna plaintext (uso interno). */
  async getDeveloperToken(tenantId: string): Promise<string | null> {
    const settings = await this.getSettings(tenantId);
    if (settings?.google_ads_developer_token_enc) {
      try {
        return this.crypto.decrypt(settings.google_ads_developer_token_enc);
      } catch (e: any) {
        this.logger.error(
          `[CONFIG] Falha decriptando developer_token (tenant=${tenantId}): ${e.message}`,
        );
      }
    }
    return process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null;
  }

  /** Login Customer ID (MCC) — nao secreto. */
  async getLoginCustomerId(tenantId: string): Promise<string | null> {
    const settings = await this.getSettings(tenantId);
    return (
      settings?.google_ads_login_customer_id ||
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
      null
    );
  }

  /** Customer ID da conta-alvo (anunciante) — nao secreto. */
  async getTargetCustomerId(tenantId: string): Promise<string | null> {
    const settings = await this.getSettings(tenantId);
    return (
      settings?.google_ads_customer_id ||
      process.env.GOOGLE_ADS_CUSTOMER_ID ||
      null
    );
  }

  /** OAuth Client ID — nao secreto. */
  async getOAuthClientId(tenantId: string): Promise<string | null> {
    const settings = await this.getSettings(tenantId);
    return settings?.oauth_client_id || process.env.GOOGLE_OAUTH_CLIENT_ID || null;
  }

  /** OAuth Client Secret — secreto, retorna plaintext (uso interno). */
  async getOAuthClientSecret(tenantId: string): Promise<string | null> {
    const settings = await this.getSettings(tenantId);
    if (settings?.oauth_client_secret_enc) {
      try {
        return this.crypto.decrypt(settings.oauth_client_secret_enc);
      } catch (e: any) {
        this.logger.error(
          `[CONFIG] Falha decriptando oauth_client_secret (tenant=${tenantId}): ${e.message}`,
        );
      }
    }
    return process.env.GOOGLE_OAUTH_CLIENT_SECRET || null;
  }

  private async getSettings(tenantId: string) {
    return this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantId },
    });
  }
}
