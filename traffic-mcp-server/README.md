# Traffic MCP Server

Servidor MCP standalone para expor o Gestor de Trafego Google Ads ao Claude.ai por Streamable HTTP stateless com resposta JSON.

Modo recomendado: o servico chama a API interna do CRM (`/trafego/*`) e deixa o
CRM continuar cuidando das credenciais Google Ads criptografadas, filas de
mutate, auditoria e permissoes. O modo direto com `google-ads-api` continua
disponivel como fallback.

## Configuracao

```bash
cp .env.example .env
npm install
npm run build
npm start
```

Endpoint:

- Health: `GET /health`
- MCP: `POST /mcp`
- Auth: `Authorization: Bearer <MCP_AUTH_TOKEN>`

## Variaveis

Preencha no `.env` usando o modo CRM:

```env
MCP_PORT=3100
MCP_AUTH_TOKEN=troque-este-token
TRAFFIC_MCP_MODE=crm
CRM_API_URL=https://andrelustosaadvogados.com.br/api
CRM_API_KEY=token-do-crm-com-acesso-ao-trafego
```

`MCP_AUTH_TOKEN` e o token que o Claude/Codex usara para acessar este novo MCP.
`CRM_API_KEY` e o token usado por este MCP para chamar a API do CRM.

Modo alternativo, com acesso direto ao Google Ads:

```env
TRAFFIC_MCP_MODE=google_ads
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
# ou GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=446-412-9633
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
```

### Onde encontrar as credenciais

No modo CRM, voce nao precisa preencher credenciais do Google Ads neste servico.
Use um token do CRM com permissao para chamar os endpoints `/trafego/*`.

No modo direto, o modulo de Trafego do CRM guarda as credenciais primeiro no
banco, na tabela `TrafficSettings`, e usa o `.env` apenas como fallback. Os
segredos salvos no banco ficam criptografados com `TRAFEGO_ENCRYPTION_KEY`,
entao eles nao aparecem em texto puro.

- `GOOGLE_ADS_CUSTOMER_ID`: ID da conta de anuncios. No seu caso, `446-412-9633`.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`: ID do MCC/conta gerente, se houver.
- `GOOGLE_ADS_DEVELOPER_TOKEN`: token da API no Google Ads.
- `GOOGLE_ADS_CLIENT_ID` ou `GOOGLE_OAUTH_CLIENT_ID`: OAuth Client ID do Google Cloud.
- `GOOGLE_ADS_CLIENT_SECRET` ou `GOOGLE_OAUTH_CLIENT_SECRET`: OAuth Client Secret do Google Cloud.
- `GOOGLE_ADS_REFRESH_TOKEN`: token gerado quando o usuario autorizou acesso ao Google Ads.

Se o CRM ja esta sincronizando metricas, mantenha `TRAFFIC_MCP_MODE=crm`.

## Tools

Leitura:

- `traffic_list_campaigns`
- `traffic_get_campaign`
- `traffic_compare_periods`
- `traffic_list_keywords`
- `traffic_get_keyword_performance`
- `traffic_list_search_terms`
- `traffic_find_wasted_terms`
- `traffic_list_negatives`
- `traffic_list_ads`
- `traffic_get_ad_strength`
- `traffic_get_schedule`
- `traffic_hourly_performance`
- `traffic_daily_performance`
- `traffic_device_performance`
- `traffic_daily_timeseries`
- `traffic_account_status`
- `traffic_health_check`

Escrita:

- `traffic_pause_campaign`
- `traffic_enable_campaign`
- `traffic_update_budget`
- `traffic_add_negative`
- `traffic_remove_negative`
- `traffic_add_negative_all_campaigns`
- `traffic_update_schedule`

Todas as respostas retornam `content` em Markdown e `structuredContent` em JSON.

No modo CRM, algumas ferramentas dependem de endpoints que ainda nao existem no
CRM (`search terms`, agendamento e breakdown por hora/dispositivo). Elas ficam
registradas no MCP, mas retornam uma mensagem orientando a criar o endpoint
interno antes de automatizar essa acao.

## Docker Compose

Ha um exemplo pronto em `docker-compose.example.yml`.

```yaml
traffic-mcp-server:
  build:
    context: ./traffic-mcp-server
    dockerfile: Dockerfile
  container_name: traffic-mcp-server
  restart: unless-stopped
  ports:
    - "3100:3100"
  env_file:
    - ./traffic-mcp-server/.env
  networks:
    - app-network
```

## Teste com MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Use a URL `http://localhost:3100/mcp` e configure o header:

```text
Authorization: Bearer <MCP_AUTH_TOKEN>
```

## Notas de seguranca

- Ferramentas de escrita limpam cache e gravam auditoria em `WRITE_AUDIT_LOG`.
- O contador `REPORT_DAILY_LIMIT` protege a quota de relatorios.
- O servidor e stateless: cada request MCP cria um transporte novo.
