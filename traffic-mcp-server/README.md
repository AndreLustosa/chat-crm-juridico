# Traffic MCP Server

Servidor MCP standalone para expor o Gestor de Trafego Google Ads ao Claude (Cowork, Claude.ai, Claude Desktop) e ao ChatGPT, via Streamable HTTP stateless com resposta JSON.

> **Nota:** este servidor eh a Fase 1 da especificacao [docs/mcp-server/fase-0-descoberta.md](../docs/mcp-server/fase-0-descoberta.md). Toda a gestao de trafego esta sendo delegada ao Claude — o painel CRM passa a ser apenas acompanhamento.

Modo recomendado: **CRM** — o servico chama a API interna do CRM (`/trafego/*`) e deixa o CRM continuar cuidando de credenciais Google Ads criptografadas, fila de mutate (BullMQ), auditoria (`TrafficMutateLog`), validacao OAB e atribuicao gclid→Lead. O modo direto com `google-ads-api` continua disponivel como fallback.

## Configuracao

```bash
cp .env.example .env
npm install
npm run build
npm start
```

### Endpoints

- `GET /health` — health check
- `POST /mcp` — Streamable HTTP do MCP (auth: `Authorization: Bearer <token>`)
- `GET /.well-known/oauth-authorization-server` — metadata OAuth (descoberta automatica)
- `GET /.well-known/oauth-protected-resource` — metadata do resource

## Variaveis de ambiente

### Obrigatorias

```env
MCP_AUTH_TOKEN=<segredo administrativo, fallback>
CRM_API_URL=http://crm-api:3001
CRM_API_KEY=<token MCP gerado no CRM>
TRAFFIC_MCP_MODE=crm
```

### URLs publicas (defaults cobrem prod do escritorio)

```env
MCP_PUBLIC_BASE_URL=https://andrelustosaadvogados.com.br/traffic-mcp
MCP_PUBLIC_URL=https://andrelustosaadvogados.com.br/traffic-mcp/mcp
```

### OAuth multi-cliente (Cowork + Claude.ai + ChatGPT)

```env
# CSV de prefixes aceitos. Vazio = defaults (ChatGPT + Claude.ai/com + Cowork).
MCP_OAUTH_REDIRECT_PREFIXES=

# CSV de origins aceitos pelo CORS. Vazio = defaults.
MCP_CORS_ALLOWED_ORIGINS=

# Client ID do cliente OAuth estatico (mesmo para todos os clientes externos).
MCP_OAUTH_STATIC_CLIENT_ID=traffic-chatgpt
```

### Guard-rails operacionais (Fase 1)

```env
# Bloqueia toda mutate quando true. Read continua funcionando.
MCP_KILL_SWITCH=false

# Rate limit por janela rolante de 1h (in-memory, per-instance).
MCP_MUTATE_RATE_LIMIT_PER_HOUR=60

# Hard cap absoluto em BRL/dia para budgets.
MCP_BUDGET_DAILY_HARD_CAP_BRL=1000

# Delta percentual maximo em update_budget (rejeita acima).
MCP_BUDGET_CHANGE_MAX_PERCENT=50

# Delta acima do qual exige confirm=true do Claude.
MCP_BUDGET_REQUIRE_CONFIRM_PERCENT=30

# Cache TTL para GETs (in-memory). Default 5min.
CACHE_TTL_MS=300000

# Nivel de log estruturado (debug | info | warn | error).
LOG_LEVEL=info
```

### Modo `google_ads` direto (fallback — nao recomendado)

```env
TRAFFIC_MCP_MODE=google_ads
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=4464129633
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
```

> No modo `crm` voce nao precisa preencher credenciais Google Ads aqui — o CRM cuida disso. As credenciais ficam no banco (TrafficSettings) criptografadas com `TRAFEGO_ENCRYPTION_KEY`.

## Tools

29 tools disponiveis na Fase 1 — 15 leitura + 14 escrita. Catalogo completo com inputs, outputs, mapeamento e exemplos: [docs/mcp-server/tools.md](../docs/mcp-server/tools.md).

Resumo:

**Leitura**: `traffic_list_accounts`, `traffic_list_campaigns`, `traffic_get_dashboard`, `traffic_compare_periods`, `traffic_get_account_health_summary`, `traffic_list_ad_groups`, `traffic_list_keywords`, `traffic_list_ads`, `traffic_list_search_terms`, `traffic_list_budgets`, `traffic_list_conversion_actions`, `traffic_list_alerts`, `traffic_list_sync_logs`, `traffic_list_mutate_logs`, `traffic_list_recommendations`.

**Escrita** (sujeitas a guard-rails): `traffic_pause_campaign`, `traffic_enable_campaign`, `traffic_update_campaign_budget`, `traffic_pause_ad_group`, `traffic_enable_ad_group`, `traffic_add_keywords`, `traffic_add_negative_to_campaign`, `traffic_add_negative_to_ad_group`, `traffic_remove_keyword`, `traffic_update_schedule`, `traffic_create_search_campaign`, `traffic_create_rsa`, `traffic_apply_recommendation`, `traffic_trigger_sync`.

Erros viajam dentro de `structuredContent.error.kind` ∈ `auth | not_found | validation | rate_limit | guard_rail | upstream | network | google_ads_quota | google_ads_permission | unknown`.

## Conectar no Cowork (Anthropic)

Passo-a-passo: [docs/mcp-server/setup-cowork.md](../docs/mcp-server/setup-cowork.md).

Resumo: criar Custom Connector apontando para `https://andrelustosaadvogados.com.br/traffic-mcp/mcp`, autenticacao OAuth, client ID `traffic-chatgpt` (mesmo para todos os clientes), client secret = token MCP gerado no CRM em `Configuracoes > Integracao MCP`.

## Conectar no ChatGPT

Mesmo fluxo, mesmo client ID (`traffic-chatgpt`). Detalhes preservados da v0:

- URL do servidor MCP: `https://andrelustosaadvogados.com.br/traffic-mcp/mcp`
- Autenticacao: OAuth ou Mista
- Cliente OAuth: definido pelo usuario
- Authorization URL: `https://andrelustosaadvogados.com.br/traffic-mcp/oauth/authorize`
- Token URL: `https://andrelustosaadvogados.com.br/traffic-mcp/oauth/token`
- Token endpoint auth method: `client_secret_post`
- Scopes: `mcp:tools`

## Testar localmente

### Com MCP Inspector (oficial Anthropic)

```bash
npx @modelcontextprotocol/inspector
```

URL: `http://localhost:3100/mcp`. Header: `Authorization: Bearer <MCP_AUTH_TOKEN>`.

### Com curl

```bash
# Listar tools
curl -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Chamar uma tool
curl -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"traffic_list_campaigns","arguments":{"days":7}}}'
```

## Testes automatizados

```bash
npm test           # vitest run
npm run test:watch # modo watch
```

Cobertura atual: `services/crm.ts` (8 testes — happy path, cache, error mapping) + `utils/guard-rails.ts` (11 testes — kill switch, rate limit, budget caps).

## Logs

Cada chamada produz NDJSON em stdout (`docker logs traffic-mcp-server -f` mostra ao vivo):

```json
{"ts":"2026-05-15T17:00:00.000Z","level":"info","event":"tool_call_start","tool":"traffic_pause_campaign","tool_call_id":"tc_xxx"}
{"ts":"2026-05-15T17:00:00.342Z","level":"info","event":"tool_call_end","tool":"traffic_pause_campaign","tool_call_id":"tc_xxx","duration_ms":342,"status":"ok"}
```

Bloqueios de guard-rail: `event: "guard_rail_block"`. Erros: `level: "error"`. PII (tokens, telefones, emails, CPF/CNPJ, etc) eh redacted automaticamente.

Filtre por nivel ajustando `LOG_LEVEL`.

## Docker Compose

Exemplo em [docker-compose.example.yml](docker-compose.example.yml). Em prod usamos [infra/portainer-stack.yml](../infra/portainer-stack.yml) que ja define todas as envs novas com defaults sensatos.

## Notas de seguranca

- **Auditoria**: toda mutate gera registro em `TrafficMutateLog` no Postgres do CRM com initiator marcado. `traffic_list_mutate_logs` permite ao Claude revisar proprio historico.
- **Validacao OAB**: `traffic_add_keywords` e `traffic_create_rsa` passam pelo `GoogleAdsMutateService` no worker, que aplica a lista de termos vetados. Falha aborta o batch inteiro.
- **PII em logs**: redacted automaticamente. Verifique `src/utils/logger.ts` PII_KEYS pra adicionar chaves.
- **Concurrency**: o worker do CRM aplica `concurrency:1` por conta na fila `trafego-mutate` — race conditions ficam impossiveis ao nivel da Google Ads API.
- **Kill switch**: `MCP_KILL_SWITCH=true` para parar Claude sem derrubar o servico (read continua).
