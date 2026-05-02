import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { registerCrmTrafficTools } from './tools/crm.js';

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
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'traffic-mcp-server', mode: config.runtimeMode });
});

app.use('/mcp', (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || token !== config.authToken) {
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
