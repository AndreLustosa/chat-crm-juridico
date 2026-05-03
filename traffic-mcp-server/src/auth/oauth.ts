import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config.js';

type RegisteredClient = {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  scope?: string;
};

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
};

type StoredToken = {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
};

const crmTokenVerificationCache = new Map<string, number>();

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function requestedScopes(scope: unknown) {
  if (typeof scope !== 'string' || scope.trim().length === 0) {
    return [...config.oauth.scopes];
  }
  return scope.split(/\s+/).filter(Boolean);
}

function oauthError(res: Response, status: number, error: string, description: string) {
  return res.status(status).json({ error, error_description: description });
}

function crmUrl(path: string) {
  const base = config.crm.apiUrl?.replace(/\/+$/, '');
  if (!base) {
    return undefined;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

async function verifyCrmMcpToken(token: string) {
  if (config.runtimeMode !== 'crm' || !config.crm.apiUrl) {
    return false;
  }

  const cachedUntil = crmTokenVerificationCache.get(token);
  if (cachedUntil && cachedUntil > Date.now()) {
    return true;
  }

  const url = crmUrl('/auth/mcp-token/verify');
  if (!url) {
    return false;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json().catch(() => null);
    if (data && typeof data === 'object' && (data as { active?: unknown }).active === true) {
      crmTokenVerificationCache.set(token, Date.now() + 5 * 60 * 1000);
      return true;
    }
  } catch (error) {
    console.error('[traffic-mcp-server] falha ao validar token MCP no CRM', error);
  }

  return false;
}

function clientCredentials(req: Request) {
  const body = req.body ?? {};
  if (typeof body.client_id === 'string') {
    return {
      clientId: body.client_id,
      clientSecret: typeof body.client_secret === 'string' ? body.client_secret : undefined,
    };
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) {
    return undefined;
  }

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return undefined;
  }

  return {
    clientId: decodeURIComponent(decoded.slice(0, separator)),
    clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
  };
}

function redirectWithError(redirectUri: string, error: string, description: string, state?: string) {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error);
  target.searchParams.set('error_description', description);
  if (state) {
    target.searchParams.set('state', state);
  }
  return target.toString();
}

function metadata() {
  const base = config.publicBaseUrl;
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: config.oauth.scopes,
    client_id_metadata_document_supported: false,
    service_documentation: `${base}/health`,
  };
}

function protectedResourceMetadata() {
  return {
    resource: config.publicMcpUrl,
    authorization_servers: [config.publicBaseUrl],
    scopes_supported: config.oauth.scopes,
    bearer_methods_supported: ['header'],
    resource_name: 'Gestor de Trafego Google Ads',
    resource_documentation: `${config.publicBaseUrl}/health`,
  };
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAuthorizePage(params: Record<string, string>) {
  const hiddenInputs = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${htmlEscape(key)}" value="${htmlEscape(value)}" />`)
    .join('\n');

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Autorizar Gestor de Trafego</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f7f7f8; color: #171717; margin: 0; padding: 40px 16px; }
      main { max-width: 520px; margin: 0 auto; background: white; border: 1px solid #ddd; border-radius: 12px; padding: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      p { color: #555; line-height: 1.5; }
      label { display: block; font-weight: 700; margin: 20px 0 8px; }
      input[type="password"] { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #bbb; border-radius: 8px; font-size: 14px; }
      button { margin-top: 18px; width: 100%; padding: 12px 14px; border: 0; border-radius: 8px; background: #9a6a2f; color: white; font-weight: 700; cursor: pointer; }
      small { display: block; color: #777; margin-top: 12px; line-height: 1.4; }
    </style>
  </head>
  <body>
    <main>
      <h1>Autorizar Gestor de Trafego</h1>
      <p>O ChatGPT esta solicitando acesso as ferramentas MCP do Gestor de Trafego. Cole o token MCP gerado na tela de Integracao MCP do CRM para autorizar esta conexao.</p>
      <form method="post" action="${htmlEscape(config.publicBaseUrl)}/oauth/authorize">
        ${hiddenInputs}
        <label for="authorization_token">Token MCP gerado no CRM</label>
        <input id="authorization_token" name="authorization_token" type="password" autocomplete="one-time-code" required autofocus />
        <button type="submit">Autorizar ChatGPT</button>
      </form>
      <small>Use o token gerado no menu Configuracoes > Integracao MCP. O segredo interno TRAFFIC_MCP_AUTH_TOKEN continua aceito, mas nao e mais necessario para conectar o ChatGPT.</small>
    </main>
  </body>
</html>`;
}

class TrafficOAuthProvider {
  private clients = new Map<string, RegisteredClient>();
  private codes = new Map<string, AuthorizationCode>();
  private accessTokens = new Map<string, StoredToken>();
  private refreshTokens = new Map<string, StoredToken>();

  registerClient(body: Record<string, unknown>) {
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((uri): uri is string => typeof uri === 'string' && URL.canParse(uri))
      : [];

    if (redirectUris.length === 0) {
      throw new Error('redirect_uris e obrigatorio');
    }

    const client: RegisteredClient = {
      client_id: `traffic_${randomToken(18)}`,
      client_secret: randomToken(32),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      redirect_uris: redirectUris,
      token_endpoint_auth_method:
        typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none',
      grant_types: Array.isArray(body.grant_types) ? body.grant_types.filter((item): item is string => typeof item === 'string') : ['authorization_code', 'refresh_token'],
      response_types: Array.isArray(body.response_types) ? body.response_types.filter((item): item is string => typeof item === 'string') : ['code'],
      client_name: typeof body.client_name === 'string' ? body.client_name : 'ChatGPT',
      scope: typeof body.scope === 'string' ? body.scope : config.oauth.scopes.join(' '),
    };

    this.clients.set(client.client_id, client);
    return client;
  }

  getClient(clientId: unknown) {
    return typeof clientId === 'string' ? this.clients.get(clientId) : undefined;
  }

  getAuthorizationCodeClientId(code: unknown) {
    return typeof code === 'string' ? this.codes.get(code)?.clientId : undefined;
  }

  getRefreshTokenClientId(refreshToken: unknown) {
    return typeof refreshToken === 'string' ? this.refreshTokens.get(refreshToken)?.clientId : undefined;
  }

  getOrCreateStaticClient(clientId: unknown, redirectUri: string | undefined) {
    if (
      typeof clientId !== 'string' ||
      clientId !== config.oauth.staticClientId ||
      !redirectUri?.startsWith(config.oauth.staticClientRedirectPrefix)
    ) {
      return undefined;
    }

    const existing = this.clients.get(clientId);
    if (existing) {
      if (!existing.redirect_uris.includes(redirectUri)) {
        existing.redirect_uris.push(redirectUri);
      }
      return existing;
    }

    const client: RegisteredClient = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'ChatGPT',
      scope: config.oauth.scopes.join(' '),
    };

    this.clients.set(client.client_id, client);
    return client;
  }

  createAuthorizationCode(params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: string[];
    resource?: string;
  }) {
    const code = randomToken(32);
    this.codes.set(code, {
      ...params,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return code;
  }

  async exchangeAuthorizationCode(params: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri?: string;
    resource?: string;
  }) {
    const codeData = this.codes.get(params.code);
    if (!codeData || codeData.expiresAt < Date.now()) {
      throw new Error('authorization code invalido ou expirado');
    }
    if (codeData.clientId !== params.clientId) {
      throw new Error('authorization code emitido para outro cliente');
    }
    if (params.redirectUri && params.redirectUri !== codeData.redirectUri) {
      throw new Error('redirect_uri divergente');
    }
    if (params.resource && codeData.resource && params.resource !== codeData.resource) {
      throw new Error('resource divergente');
    }

    const actualChallenge = pkceChallenge(params.codeVerifier);
    if (actualChallenge !== codeData.codeChallenge) {
      throw new Error('PKCE code_verifier invalido');
    }

    this.codes.delete(params.code);
    return this.issueTokens(codeData.clientId, codeData.scopes, codeData.resource);
  }

  exchangeRefreshToken(clientId: string, refreshToken: string, scope?: string) {
    const tokenData = this.refreshTokens.get(refreshToken);
    if (!tokenData || tokenData.expiresAt < Date.now()) {
      throw new Error('refresh token invalido ou expirado');
    }
    if (tokenData.clientId !== clientId) {
      throw new Error('refresh token emitido para outro cliente');
    }

    const scopes = scope ? requestedScopes(scope) : tokenData.scopes;
    return this.issueTokens(clientId, scopes, tokenData.resource);
  }

  issueTokens(clientId: string, scopes: string[], resource?: string) {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    const now = Date.now();
    const accessExpiresAt = now + config.oauth.accessTokenTtlSeconds * 1000;
    const refreshExpiresAt = now + config.oauth.refreshTokenTtlSeconds * 1000;

    this.accessTokens.set(accessToken, { clientId, scopes, resource, expiresAt: accessExpiresAt });
    this.refreshTokens.set(refreshToken, { clientId, scopes, resource, expiresAt: refreshExpiresAt });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.oauth.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  verifyAccessToken(token: string) {
    const tokenData = this.accessTokens.get(token);
    if (!tokenData || tokenData.expiresAt < Date.now()) {
      return undefined;
    }
    return tokenData;
  }

  revoke(token: string) {
    this.accessTokens.delete(token);
    this.refreshTokens.delete(token);
  }
}

export const trafficOAuthProvider = new TrafficOAuthProvider();

export function oauthMetadataHandler(_req: Request, res: Response) {
  res.json(metadata());
}

export function protectedResourceMetadataHandler(_req: Request, res: Response) {
  res.json(protectedResourceMetadata());
}

export function registerClientHandler(req: Request, res: Response) {
  try {
    const client = trafficOAuthProvider.registerClient(req.body ?? {});
    res.status(201).json(client);
  } catch (error) {
    oauthError(res, 400, 'invalid_client_metadata', error instanceof Error ? error.message : 'metadata invalida');
  }
}

export async function authorizeHandler(req: Request, res: Response) {
  const input = req.method === 'POST' ? req.body : req.query;
  const redirectUri = typeof input.redirect_uri === 'string' ? input.redirect_uri : undefined;
  const client =
    trafficOAuthProvider.getOrCreateStaticClient(input.client_id, redirectUri) ||
    trafficOAuthProvider.getClient(input.client_id);
  const state = typeof input.state === 'string' ? input.state : undefined;

  if (!client) {
    return oauthError(res, 400, 'invalid_client', 'client_id invalido');
  }
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return oauthError(res, 400, 'invalid_request', 'redirect_uri nao registrado');
  }
  if (input.response_type !== 'code') {
    return res.redirect(302, redirectWithError(redirectUri, 'unsupported_response_type', 'response_type deve ser code', state));
  }
  if (input.code_challenge_method !== 'S256' || typeof input.code_challenge !== 'string') {
    return res.redirect(302, redirectWithError(redirectUri, 'invalid_request', 'PKCE S256 e obrigatorio', state));
  }

  if (req.method === 'GET') {
    const formParams = Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, value as string]),
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderAuthorizePage(formParams));
  }

  const providedToken = typeof input.authorization_token === 'string' ? input.authorization_token : '';
  const tokenIsValid =
    safeEqual(providedToken, config.oauth.authorizationToken) || await verifyCrmMcpToken(providedToken);
  if (!tokenIsValid) {
    return res.status(401).send('Token MCP invalido.');
  }

  const code = trafficOAuthProvider.createAuthorizationCode({
    clientId: client.client_id,
    redirectUri,
    codeChallenge: input.code_challenge,
    scopes: requestedScopes(input.scope),
    resource: typeof input.resource === 'string' ? input.resource : config.publicMcpUrl,
  });
  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  if (state) {
    target.searchParams.set('state', state);
  }
  return res.redirect(302, target.toString());
}

export async function tokenHandler(req: Request, res: Response) {
  try {
    const body = req.body ?? {};
    const credentials =
      clientCredentials(req) ||
      (body.grant_type === 'authorization_code'
        ? { clientId: trafficOAuthProvider.getAuthorizationCodeClientId(body.code), clientSecret: undefined }
        : undefined) ||
      (body.grant_type === 'refresh_token'
        ? { clientId: trafficOAuthProvider.getRefreshTokenClientId(body.refresh_token), clientSecret: undefined }
        : undefined);
    const client = credentials ? trafficOAuthProvider.getClient(credentials.clientId) : undefined;
    if (!credentials || !client) {
      return oauthError(res, 401, 'invalid_client', 'client_id invalido');
    }
    if (credentials.clientSecret && client.client_secret && credentials.clientSecret !== client.client_secret) {
      return oauthError(res, 401, 'invalid_client', 'client_secret invalido');
    }

    if (body.grant_type === 'authorization_code') {
      if (typeof body.code !== 'string' || typeof body.code_verifier !== 'string') {
        return oauthError(res, 400, 'invalid_request', 'code e code_verifier sao obrigatorios');
      }
      const tokens = await trafficOAuthProvider.exchangeAuthorizationCode({
        clientId: credentials.clientId,
        code: body.code,
        codeVerifier: body.code_verifier,
        redirectUri: typeof body.redirect_uri === 'string' ? body.redirect_uri : undefined,
        resource: typeof body.resource === 'string' ? body.resource : undefined,
      });
      return res.json(tokens);
    }

    if (body.grant_type === 'refresh_token') {
      if (typeof body.refresh_token !== 'string') {
        return oauthError(res, 400, 'invalid_request', 'refresh_token e obrigatorio');
      }
      return res.json(trafficOAuthProvider.exchangeRefreshToken(credentials.clientId, body.refresh_token, body.scope));
    }

    return oauthError(res, 400, 'unsupported_grant_type', 'grant_type nao suportado');
  } catch (error) {
    return oauthError(res, 400, 'invalid_grant', error instanceof Error ? error.message : 'grant invalido');
  }
}

export function revokeHandler(req: Request, res: Response) {
  const token = req.body?.token;
  if (typeof token === 'string') {
    trafficOAuthProvider.revoke(token);
  }
  res.status(200).send('');
}

export async function verifyMcpBearerToken(token: string) {
  if (safeEqual(token, config.authToken)) {
    return true;
  }
  if (trafficOAuthProvider.verifyAccessToken(token) !== undefined) {
    return true;
  }
  return verifyCrmMcpToken(token);
}

export function protectedResourceMetadataUrl() {
  const url = new URL(config.publicMcpUrl);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}
