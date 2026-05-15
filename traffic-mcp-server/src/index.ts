import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { registerCrmTrafficTools } from './tools/crm.js';
import {
  authorizeHandler,
  oauthMetadataHandler,
  protectedResourceMetadataHandler,
  protectedResourceMetadataUrl,
  registerClientHandler,
  revokeHandler,
  tokenHandler,
  verifyMcpBearerToken,
} from './auth/oauth.js';

async function buildServer() {
  const server = new McpServer({
    name: 'traffic-mcp-server',
    version: '1.0.0',
  });

  if (config.runtimeMode === 'crm') {
    registerCrmTrafficTools(server);
    return server;
  }

  const [
    { registerCampaignTools },
    { registerKeywordTools },
    { registerSearchTermTools },
    { registerNegativeTools },
    { registerAdTools },
    { registerScheduleTools },
    { registerAnalyticsTools },
    { registerAccountTools },
  ] = await Promise.all([
    import('./tools/campaigns.js'),
    import('./tools/keywords.js'),
    import('./tools/search-terms.js'),
    import('./tools/negatives.js'),
    import('./tools/ads.js'),
    import('./tools/schedule.js'),
    import('./tools/analytics.js'),
    import('./tools/account.js'),
  ]);

  registerCampaignTools(server);
  registerKeywordTools(server);
  registerSearchTermTools(server);
  registerNegativeTools(server);
  registerAdTools(server);
  registerScheduleTools(server);
  registerAnalyticsTools(server);
  registerAccountTools(server);

  return server;
}

const app = express();

/**
 * CORS dinamico — permite qualquer origin que case com prefix conhecido
 * (ChatGPT, Claude.ai, Claude.com, Cowork). Sem isso o browser bloqueia
 * preflight do connector OAuth durante registro e refresh de token.
 *
 * Override: MCP_CORS_ALLOWED_ORIGINS=https://foo,https://bar (CSV).
 */
const ALLOWED_ORIGINS_DEFAULT = [
  'https://chatgpt.com',
  'https://claude.ai',
  'https://claude.com',
  'https://cowork.anthropic.com',
];
const ALLOWED_ORIGINS = (process.env.MCP_CORS_ALLOWED_ORIGINS ?? '').trim().length > 0
  ? process.env.MCP_CORS_ALLOWED_ORIGINS!.split(',').map((s) => s.trim()).filter(Boolean)
  : ALLOWED_ORIGINS_DEFAULT;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }

  return next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'traffic-mcp-server', mode: config.runtimeMode });
});

app.get('/.well-known/oauth-authorization-server', oauthMetadataHandler);
app.get('/.well-known/oauth-authorization-server/traffic-mcp', oauthMetadataHandler);
app.get('/.well-known/oauth-protected-resource', protectedResourceMetadataHandler);
app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadataHandler);
app.get('/.well-known/oauth-protected-resource/traffic-mcp/mcp', protectedResourceMetadataHandler);
app.get('/oauth/authorize', authorizeHandler);
app.post('/oauth/authorize', authorizeHandler);
app.post('/oauth/register', registerClientHandler);
app.post('/oauth/token', tokenHandler);
app.post('/oauth/revoke', revokeHandler);

app.use('/mcp', async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !(await verifyMcpBearerToken(token))) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${protectedResourceMetadataUrl()}"`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
});

app.post('/mcp', async (req, res) => {
  const server = await buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[traffic-mcp-server] request error', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro interno no MCP Server' });
    }
  }
});

app.all('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed. Use POST /mcp.' });
});

app.listen(config.port, () => {
  console.log(`Traffic MCP Server running on port ${config.port}`);
});
