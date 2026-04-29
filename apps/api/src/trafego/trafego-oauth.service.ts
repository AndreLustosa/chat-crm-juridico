import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrafegoCryptoService } from './trafego-crypto.service';

/**
 * OAuth 2.0 helper para Google Ads API.
 *
 * Fluxo:
 *   1. GET  /trafego/oauth/start     -> redireciona pro Google com state aleatorio
 *   2. GET  /trafego/oauth/callback  -> Google volta com ?code=...&state=...
 *      service troca code por refresh_token, criptografa, salva em TrafficAccount
 *   3. Worker pega refresh_token, decripta, troca por access_token (1h TTL)
 *
 * Envs necessarias:
 *   - GOOGLE_OAUTH_CLIENT_ID
 *   - GOOGLE_OAUTH_CLIENT_SECRET
 *   - GOOGLE_OAUTH_REDIRECT_URI (ex: https://crm.example.com/api/trafego/oauth/callback)
 *   - GOOGLE_ADS_DEVELOPER_TOKEN
 *   - GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC, sem tracos)
 */
@Injectable()
export class TrafegoOAuthService {
  private readonly logger = new Logger(TrafegoOAuthService.name);

  // Estado em memoria pra validar callback. Em prod multi-instancia, mover pra Redis.
  // TTL: 10 minutos.
  private readonly pendingStates = new Map<
    string,
    { tenantId: string; createdAt: number }
  >();

  constructor(
    private prisma: PrismaService,
    private crypto: TrafegoCryptoService,
  ) {
    // Limpa estados expirados a cada 5min
    setInterval(() => this.cleanupExpiredStates(), 5 * 60 * 1000).unref();
  }

  private cleanupExpiredStates() {
    const TTL_MS = 10 * 60 * 1000;
    const now = Date.now();
    for (const [state, data] of this.pendingStates.entries()) {
      if (now - data.createdAt > TTL_MS) this.pendingStates.delete(state);
    }
  }

  /** Gera URL de autorizacao Google + grava state pendente. */
  buildAuthUrl(tenantId: string): string {
    // Falha cedo se cripto nao tiver chave — evita usuario ir pro Google
    // e voltar pra um erro no callback.
    if (!this.crypto.isAvailable()) {
      throw new ServiceUnavailableException(
        'Modulo de trafego desabilitado: TRAFEGO_ENCRYPTION_KEY nao configurada no servidor.',
      );
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new ServiceUnavailableException(
        'OAuth Google nao configurado no servidor. Defina GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_REDIRECT_URI.',
      );
    }

    const state = this.generateState();
    this.pendingStates.set(state, { tenantId, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/adwords',
      access_type: 'offline',
      prompt: 'consent', // forca novo refresh_token mesmo se ja autorizou
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /** Troca code por refresh_token, criptografa e persiste TrafficAccount. */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ tenantId: string; customerId: string | null }> {
    const pending = this.pendingStates.get(state);
    if (!pending) {
      throw new BadRequestException('State invalido ou expirado');
    }
    this.pendingStates.delete(state);

    const tokens = await this.exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google nao retornou refresh_token. Revogue o app em https://myaccount.google.com/permissions e tente novamente.',
      );
    }

    const encrypted = this.crypto.encrypt(tokens.refresh_token);
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null;

    // Pega email autorizado via tokeninfo
    const authorizedEmail = await this.fetchAuthorizedEmail(
      tokens.access_token,
    );

    // Customer ID alvo: na Fase 1 vem da env. Multi-account: o usuario seleciona.
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || null;

    await this.prisma.trafficAccount.upsert({
      where: { tenant_id: pending.tenantId },
      update: {
        refresh_token_enc: encrypted,
        login_customer_id: loginCustomerId,
        customer_id: customerId || '',
        authorized_email: authorizedEmail,
        status: 'ACTIVE',
        last_error: null,
      },
      create: {
        tenant_id: pending.tenantId,
        customer_id: customerId || '',
        login_customer_id: loginCustomerId,
        authorized_email: authorizedEmail,
        refresh_token_enc: encrypted,
        status: customerId ? 'ACTIVE' : 'PENDING',
      },
    });

    return { tenantId: pending.tenantId, customerId };
  }

  /** Troca refresh_token por access_token (chamado pelo worker em cada sync). */
  async getAccessToken(refreshTokenEnc: string): Promise<string> {
    const refreshToken = this.crypto.decrypt(refreshTokenEnc);
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('OAuth Google nao configurado');
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`[OAUTH] refresh_token falhou: ${res.status} ${body}`);
      throw new InternalServerErrorException(
        `Falha ao renovar access_token (${res.status})`,
      );
    }

    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  }

  // ─── Internos ───────────────────────────────────────────────────────────

  private generateState(): string {
    // 32 bytes random base64url-safe
    return Buffer.from(
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)),
    )
      .toString('base64')
      .replace(/[+/=]/g, '_');
  }

  private async exchangeCodeForTokens(
    code: string,
  ): Promise<{ access_token: string; refresh_token?: string }> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI!;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException(`Google OAuth retornou ${res.status}: ${body}`);
    }

    return res.json();
  }

  private async fetchAuthorizedEmail(accessToken: string): Promise<string | null> {
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { email?: string };
      return data.email ?? null;
    } catch {
      return null;
    }
  }
}
