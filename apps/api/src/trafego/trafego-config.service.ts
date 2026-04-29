import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrafegoCryptoService } from './trafego-crypto.service';

/**
 * Resolve credenciais e configs do modulo de trafego.
 *
 * Estrategia: DB-first com env fallback.
 *   - Le primeiro de TrafficSettings (configurado via UI pelo admin)
 *   - Se null, fallback pra env var (mantem compat com setup atual)
 *
 * Secrets sao criptografados em repouso com TrafegoCryptoService (AES-256-GCM)
 * usando a mesma chave dos refresh_tokens (TRAFEGO_ENCRYPTION_KEY).
 *
 * Mascaramento: getCredentialsMasked() retorna apenas metadata (configurado/nao,
 * ultimos 4 chars) — NUNCA expoe os secrets em plaintext na API publica.
 */
@Injectable()
export class TrafegoConfigService {
  private readonly logger = new Logger(TrafegoConfigService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: TrafegoCryptoService,
  ) {}

  // ─── Credenciais (DB-first, env fallback) ───────────────────────────────

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

  /** OAuth Redirect URI — nao secreto. */
  async getOAuthRedirectUri(tenantId: string): Promise<string | null> {
    const settings = await this.getSettings(tenantId);
    return (
      settings?.oauth_redirect_uri ||
      process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      null
    );
  }

  /**
   * Frontend base URL pra redirect pos-OAuth — nao secreto.
   *
   * Resolucao em ordem:
   *   1. Configurado em TrafficSettings (UI admin)
   *   2. Env FRONTEND_BASE_URL
   *   3. Derivado do oauth_redirect_uri (mesmo host) — fallback robusto:
   *      se admin configurou redirect_uri, eh seguro assumir mesmo dominio.
   *   4. localhost:3000 — apenas como ultimo recurso pra dev local.
   */
  async getFrontendBaseUrl(tenantId: string): Promise<string> {
    const settings = await this.getSettings(tenantId);
    if (settings?.frontend_base_url) return settings.frontend_base_url;
    if (process.env.FRONTEND_BASE_URL) return process.env.FRONTEND_BASE_URL;

    // Fallback inteligente: deriva do redirect_uri (sempre configurado)
    const redirectUri = await this.getOAuthRedirectUri(tenantId);
    if (redirectUri) {
      try {
        const url = new URL(redirectUri);
        return `${url.protocol}//${url.host}`;
      } catch {
        // url malformada — cai no localhost
      }
    }
    return 'http://localhost:3000';
  }

  // ─── API publica (mascarada) ────────────────────────────────────────────

  /**
   * Retorna credenciais com secrets mascarados, pra UI de admin exibir
   * "configurado / nao configurado / ultimos 4 chars".
   *
   * NUNCA retorna plaintext de secret. UI usa esse endpoint pra mostrar status.
   */
  async getCredentialsMasked(tenantId: string) {
    const settings = await this.getSettings(tenantId);

    const dbDevToken = settings?.google_ads_developer_token_enc;
    const envDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null;
    const dbClientSecret = settings?.oauth_client_secret_enc;
    const envClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || null;

    return {
      // Source: 'db' (configurado via UI), 'env' (vem de env), 'none' (nao configurado)
      developer_token: {
        source: dbDevToken ? 'db' : envDevToken ? 'env' : 'none',
        masked: this.maskSecret(
          dbDevToken
            ? this.tryDecrypt(dbDevToken)
            : envDevToken,
        ),
      },
      oauth_client_secret: {
        source: dbClientSecret ? 'db' : envClientSecret ? 'env' : 'none',
        masked: this.maskSecret(
          dbClientSecret
            ? this.tryDecrypt(dbClientSecret)
            : envClientSecret,
        ),
      },
      // Nao secretos — retorna em claro
      google_ads_login_customer_id:
        settings?.google_ads_login_customer_id ||
        process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
        null,
      google_ads_customer_id:
        settings?.google_ads_customer_id ||
        process.env.GOOGLE_ADS_CUSTOMER_ID ||
        null,
      oauth_client_id:
        settings?.oauth_client_id || process.env.GOOGLE_OAUTH_CLIENT_ID || null,
      oauth_redirect_uri:
        settings?.oauth_redirect_uri ||
        process.env.GOOGLE_OAUTH_REDIRECT_URI ||
        null,
      frontend_base_url:
        settings?.frontend_base_url || process.env.FRONTEND_BASE_URL || null,
      // Indica se o sistema todo de cripto esta operavel
      crypto_available: this.crypto.isAvailable(),
    };
  }

  /**
   * Atualiza credenciais. Campos undefined sao preservados.
   * Para apagar um valor, enviar null explicitamente.
   * Secrets passam por criptografia antes de persistir.
   */
  async updateCredentials(
    tenantId: string,
    dto: {
      google_ads_developer_token?: string | null;
      google_ads_login_customer_id?: string | null;
      google_ads_customer_id?: string | null;
      oauth_client_id?: string | null;
      oauth_client_secret?: string | null;
      oauth_redirect_uri?: string | null;
      frontend_base_url?: string | null;
    },
  ) {
    const data: any = {};

    // Secretos: se enviado, criptografa; se null, apaga; se undefined, mantem
    if (dto.google_ads_developer_token !== undefined) {
      data.google_ads_developer_token_enc =
        dto.google_ads_developer_token === null
          ? null
          : this.crypto.encrypt(dto.google_ads_developer_token);
    }
    if (dto.oauth_client_secret !== undefined) {
      data.oauth_client_secret_enc =
        dto.oauth_client_secret === null
          ? null
          : this.crypto.encrypt(dto.oauth_client_secret);
    }

    // Nao secretos: copia direto. Customer IDs: limpa nao-digitos.
    if (dto.google_ads_login_customer_id !== undefined) {
      data.google_ads_login_customer_id = dto.google_ads_login_customer_id
        ? dto.google_ads_login_customer_id.replace(/\D/g, '')
        : null;
    }
    if (dto.google_ads_customer_id !== undefined) {
      data.google_ads_customer_id = dto.google_ads_customer_id
        ? dto.google_ads_customer_id.replace(/\D/g, '')
        : null;
    }
    if (dto.oauth_client_id !== undefined) {
      data.oauth_client_id = dto.oauth_client_id;
    }
    if (dto.oauth_redirect_uri !== undefined) {
      data.oauth_redirect_uri = dto.oauth_redirect_uri;
    }
    if (dto.frontend_base_url !== undefined) {
      data.frontend_base_url = dto.frontend_base_url;
    }

    await this.prisma.trafficSettings.upsert({
      where: { tenant_id: tenantId },
      update: data,
      create: { tenant_id: tenantId, ...data },
    });

    // Sincroniza customer_id pra TrafficAccount existente (single-account
    // scope). Sem isso, conta criada via OAuth continua com customer_id
    // vazio e sync falha com "conta sem customer_id alvo configurado".
    if (data.google_ads_customer_id || data.google_ads_login_customer_id) {
      await this.prisma.trafficAccount.updateMany({
        where: { tenant_id: tenantId },
        data: {
          ...(data.google_ads_customer_id !== undefined && {
            customer_id: data.google_ads_customer_id || '',
          }),
          ...(data.google_ads_login_customer_id !== undefined && {
            login_customer_id: data.google_ads_login_customer_id,
          }),
          // Se a conta estava PENDING (sem customer_id) e agora tem,
          // ativa pra worker pegar no proximo sync
          ...(data.google_ads_customer_id && { status: 'ACTIVE' }),
        },
      });
    }

    return this.getCredentialsMasked(tenantId);
  }

  // ─── Internos ───────────────────────────────────────────────────────────

  private async getSettings(tenantId: string) {
    return this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantId },
    });
  }

  private tryDecrypt(enc: string): string | null {
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return null;
    }
  }

  /**
   * Mascara um secret retornando apenas os ultimos 4 chars com padding.
   * Ex: "GOCSPX-abcdef123456" -> "•••••3456"
   * Ex: null/empty -> null
   */
  private maskSecret(value: string | null | undefined): string | null {
    if (!value) return null;
    const last4 = value.slice(-4);
    return `•••••${last4}`;
  }
}
