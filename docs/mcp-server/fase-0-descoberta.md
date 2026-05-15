# Fase 0 — Descoberta: Servidor MCP para Gestão de Tráfego

**Status:** aguardando aprovação humana antes de qualquer escrita de código de produção.
**Data:** 2026-05-15
**Autor:** Claude (Opus 4.7) via Claude Code

---

## 0. TL;DR

Este documento mapeia o stack do CRM, o módulo de Tráfego e — descoberta crítica — **o servidor MCP de Tráfego que JÁ existe e roda em produção** (`traffic-mcp-server/`, deployado em `https://andrelustosaadvogados.com.br/traffic-mcp/mcp`).

A especificação pede para *construir do zero* a Fase 1. O código existente já vai além disso (10 tools de leitura + 7 de escrita, OAuth, ChatGPT-ready). **Conflito central**: prosseguir como spec literalmente determina exigiria reimplementar do zero, dentro do NestJS, algo que já funciona em prod.

Apresento três caminhos de resolução. Recomendo o caminho **C (refatoração alinhada à spec, sem rewrite)** com justificativa abaixo. Não tomei a decisão sozinho — está marcada como **questão aberta para aprovação**.

---

## 1. Stack identificado

Mapeamento via leitura direta de `package.json`s, `app.module.ts` e arquivos de schema/serviço.

| Camada | Tecnologia | Onde | Versão |
|---|---|---|---|
| Linguagem | TypeScript | monorepo inteiro | 5.7.x |
| Monorepo | npm workspaces | `package.json` raiz | — |
| Framework HTTP | NestJS 11 | [apps/api](apps/api/package.json) | 11.0.1 |
| ORM | Prisma | [packages/shared/prisma/schema.prisma](packages/shared/prisma/schema.prisma) | 6.4.1 |
| Banco | PostgreSQL (`lustosaadvogados`) | infra Docker/Portainer | — |
| Validação | class-validator + class-transformer (DTOs NestJS) | [trafego.dto.ts](apps/api/src/trafego/trafego.dto.ts) | 0.15.x / 0.5.x |
| Validação MCP atual | Zod 3.25 (no `traffic-mcp-server` standalone) | [traffic-mcp-server/src/tools](traffic-mcp-server/src/tools) | 3.25.76 |
| Cache | **inexistente para `/trafego/*`** — só Redis via BullMQ e LockService | [common/locks/lock.service.ts](apps/api/src/common/locks/lock.service.ts) | ioredis 5.4 |
| Jobs assíncronos | BullMQ (NestJS module) | [trafego.module.ts](apps/api/src/trafego/trafego.module.ts) | bullmq 5.70 |
| Auth | Passport-JWT global (`APP_GUARD`), `@Public()` para bypass, `@Roles()` para autorização | [auth/guards/jwt-auth.guard.ts](apps/api/src/auth/guards/jwt-auth.guard.ts) | passport-jwt 4.0 |
| Auth para MCP | endpoint dedicado `POST /auth/mcp-token` (gera) + `GET /auth/mcp-token/verify` (valida) | [auth.controller.ts:23-32](apps/api/src/auth/auth.controller.ts) | — |
| Logs | `Logger` do NestJS (`new Logger(NomeService.name)`) — **estruturado**, com tags e levels | toda API | — |
| Testes | Jest 30 + supertest 7 + @nestjs/testing 11 | `apps/api/jest config no package.json` | — |
| Workers | NestJS app separado (`apps/worker`) — consome BullMQ | [apps/worker](apps/worker/src/trafego) | — |
| Reverse proxy / TLS | **Traefik** (rede `OrionNet`) + Let's Encrypt | [infra/portainer-stack.yml](infra/portainer-stack.yml) | — |

### 1.1 Como auth atravessa a stack

- `apps/api` aplica `JwtAuthGuard` globalmente via `APP_GUARD` ([app.module.ts:163](apps/api/src/app.module.ts:163)).
- `RolesGuard` roda depois do JWT, lendo `@Roles('ADMIN' | 'ADVOGADO' | 'OPERADOR')`.
- O controller de Tráfego herda esse esquema; cada rota tem `@Roles(...)`.
- Para MCP: a API expõe `POST /auth/mcp-token` (precisa JWT humano) que devolve um token **MCP-only** assinado, e `GET /auth/mcp-token/verify` que aceita esse token e retorna `{ active: true }`. O `traffic-mcp-server` atual já usa esse endpoint para validar tokens vindos do Claude/ChatGPT.

### 1.2 Como secrets do Google Ads vivem hoje

- `TrafficSettings.google_ads_developer_token_enc`, `oauth_client_secret_enc` — criptografados com `TRAFEGO_ENCRYPTION_KEY`.
- `TrafficAccount.refresh_token_enc` — idem.
- Cripto e descrypto via [trafego-crypto.service.ts](apps/api/src/trafego/trafego-crypto.service.ts) (também duplicado no worker em [worker/.../trafego-crypto.service.ts](apps/worker/src/trafego/trafego-crypto.service.ts)).
- **Memória relevante (Portainer)**: `TRAFEGO_ENCRYPTION_KEY` no Portainer. Rotacionar invalida secrets antigos — qualquer setup novo precisa preservar essa chave.

---

## 2. Módulo de Tráfego — estrutura real

### 2.1 Pastas

- **API NestJS** (sem chamadas a Google Ads — só lê/escreve no Postgres e enfileira jobs):
  - [apps/api/src/trafego/](apps/api/src/trafego/) — 16 services, 1 controller (1369 linhas), 1 DTO file (933 linhas), 1 module.
- **Worker** (consumidor BullMQ, faz a chamada real ao Google):
  - [apps/worker/src/trafego/](apps/worker/src/trafego/) — sync, mutate, AI agent, OCI uploads, customer match, reach planner, recommendations.

### 2.2 Endpoints HTTP atuais — recorte de leitura

Tabela completa exige scroll do controller; abaixo os relevantes para Fase 1 do MCP:

| Método | Path | Roles | Service que chama | Reuso direto MCP? |
|---|---|---|---|---|
| GET | `/trafego/account` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.getAccount` | sim |
| GET | `/trafego/dashboard` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.getDashboard` | **sim** (KPIs agregados) |
| GET | `/trafego/campaigns?include_archived=&days=` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listCampaigns` | sim |
| GET | `/trafego/auction-insights?days=&start_date=&end_date=&campaign_id=` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.getAuctionInsights` | sim |
| GET | `/trafego/ad-groups?campaign_id=&status=` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listAdGroups` | sim |
| GET | `/trafego/ad-groups/:adGroupId/keywords?negative=` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listKeywords` | sim |
| GET | `/trafego/ad-groups/:adGroupId/ads` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listAds` | sim |
| GET | `/trafego/budgets` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listBudgets` | sim |
| GET | `/trafego/conversion-actions` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listConversionActions` | sim |
| GET | `/trafego/search-terms?campaign_id=&ad_group_id=&min_spend_brl=&zero_conv_only=&search=&limit=` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listSearchTerms` | sim |
| GET | `/trafego/campaigns/:id/hourly-metrics?days=` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.getCampaignHourlyMetrics` | sim |
| GET | `/trafego/campaigns/:id/device-metrics` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.getCampaignDeviceMetrics` | sim |
| GET | `/trafego/campaigns/:id/schedule` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.getCampaignSchedule` | sim |
| GET | `/trafego/alerts?status=&limit=` | ADMIN/ADVOGADO/OPERADOR | `TrafegoService.listAlerts` | sim |
| GET | `/trafego/sync-logs?limit=` | ADMIN/ADVOGADO | `TrafegoService.getSyncLogs` | sim (saúde) |
| GET | `/trafego/optimization/weekly-diagnosis` | ADMIN/ADVOGADO | `TrafegoOptimizationService.getWeeklyDiagnosis` | **⚠️ ver §6.1** |
| GET | `/trafego/optimization/keywords-to-pause` | ADMIN/ADVOGADO | `TrafegoOptimizationService.getKeywordsToPause` | **⚠️ ver §6.1** |
| GET | `/trafego/optimization/budget-suggestions` | ADMIN/ADVOGADO | `TrafegoOptimizationService.getBudgetSuggestions` | **⚠️ ver §6.1** |

⚠️ Faltam endpoints HTTP no CRM (mas existem no schema/worker): `search_terms` por janela arbitrária diretamente da Google Ads API (o endpoint atual lê só do cache `TrafficSearchTerm`), comparação A vs B agregada (cliente compõe via duas chamadas a `/dashboard`).

### 2.3 Models Prisma envolvidos (todos prefixo `Traffic*`)

`TrafficAccount`, `TrafficCampaign`, `TrafficMetricDaily`, `TrafficAuctionInsightDaily`, `TrafficMetricHourly`, `TrafficAdSchedule`, `TrafficMetricDevice`, `TrafficSyncLog`, `TrafficAlert`, `TrafficSettings`, `TrafficMutateLog`, `TrafficAdGroup`, `TrafficKeyword`, `TrafficAd`, `TrafficCampaignBudget`, `TrafficBulkJob`, `TrafficConversionAction`, `TrafficOCIUpload`, `TrafficLeadFormSubmission`, `TrafficIADecision`, `TrafficIAMemory`, `TrafficIAPolicy`, `TrafficUserList`, `TrafficUserListMember`, `TrafficRecommendation`, `TrafficAssetGroup`, `TrafficAssetGroupAsset`, `TrafficReachForecast`, `TrafficChatSession`, `TrafficChatMessage`, `TrafficSearchTerm`. Total: **31 models**.

Atribuição: `Lead.google_gclid`, `google_gbraid`, `google_wbraid`, `utm_*` — todos indexados ([schema.prisma:198-241](packages/shared/prisma/schema.prisma)). Helper [attribution.helper.ts](apps/api/src/trafego/attribution.helper.ts) extrai do payload de `POST /leads`. **Não há tabela de mapeamento `gclid → lead_id` separada** — vive na própria `Lead`.

### 2.4 Cliente Google Ads

- Package: `google-ads-api@23.x` ([apps/worker/package.json](apps/worker/package.json)).
- Wrapper: [google-ads-client.service.ts](apps/worker/src/trafego/google-ads-client.service.ts) — monta `Customer` por `tenantId + accountId`, decripta refresh_token, busca developer_token via `TrafegoConfigService` (`TrafficSettings` primeiro, env como fallback).
- **Quem chama o Google Ads diretamente: APENAS o worker.** A API NestJS nunca abre conexão com Google Ads — ela lê de `Traffic*` no Postgres (já populado pelo worker via cron 06h ou trigger manual via `/trafego/sync`).

### 2.5 Cache atual

**Não existe cache para o módulo de tráfego na API.** Confirmação por grep ampla:

- ioredis só aparece em `common/locks/lock.service.ts` e `common/controllers/health.controller.ts`.
- O service de Tráfego chama Prisma direto. Performance vem dos índices (`@@index([tenant_id, status])`, `@@index([is_favorite])`, `@@index([last_seen_at])`, etc).
- O `traffic-mcp-server` standalone tem cache **in-memory** (Map, TTL configurável via `CACHE_TTL_MS`, default 5min) — invalidado manualmente em qualquer mutate. Esse cache é local ao processo MCP, não compartilhado com a API.

---

## 3. Conflito principal — descoberta crítica

A especificação assume que o servidor MCP é greenfield. Não é.

### 3.1 O que existe

Três implementações de MCP coexistem hoje no repositório:

| Local | Tipo | Tools | Transport | Status | Comentário |
|---|---|---|---|---|---|
| [apps/mcp-server/](apps/mcp-server/) | Standalone Node | 14 tools genéricas de CRM (clientes, processos, honorários) | **stdio** | sem deploy de imagem visível em prod | wrapper HTTP do CRM, não toca em Tráfego |
| [apps/api/src/mcp/](apps/api/src/mcp/) | Dentro do NestJS, `POST /mcp` | mesmas 14 tools de CRM | JSON-RPC manual sobre HTTP (não usa o SDK MCP) | dentro do binário da API | duplicado com o item acima; NÃO usa `@modelcontextprotocol/sdk` |
| [traffic-mcp-server/](traffic-mcp-server/) | Standalone, **container Docker próprio** | **17 tools de Tráfego** (10 leitura + 7 escrita) | **Streamable HTTP** via `@modelcontextprotocol/sdk@1.27.1` | **deployado em prod** em `https://andrelustosaadvogados.com.br/traffic-mcp/mcp` via Traefik ([infra/portainer-stack.yml:261-293](infra/portainer-stack.yml)) | o assunto desta spec |

### 3.2 Como o `traffic-mcp-server` atual já cumpre (ou diverge de) cada princípio da spec

| Princípio da spec | Status atual | Detalhe |
|---|---|---|
| "Não modificar módulo de tráfego" | ✅ | Modo `crm` chama HTTP da NestJS API; modo `google_ads` é fallback isolado. |
| "Reaproveitar tudo o que já existe" | ⚠️ parcial | Reusa autenticação MCP (via `/auth/mcp-token/verify`), reusa endpoints HTTP. **Não reusa**: NestJS Logger (usa `console.log/error`), nenhum sistema de cache do CRM (rola Map in-memory próprio — coerente, já que CRM não tem cache de Tráfego). |
| "Tools burras — sem heurística" | ⚠️ violação parcial | A maioria é dumb-pass-through. Mas `traffic_find_wasted_terms` ([traffic-mcp-server/src/tools/crm.ts](traffic-mcp-server/src/tools/crm.ts)) e versões `analytics.ts` embutem filtros como "min_spend / zero conv = wasted" — fronteira borrada com heurística. **Precisa revisão tool a tool.** |
| "Erros propagam transparentes" | ⚠️ violação | [services/crm.ts:70-74](traffic-mcp-server/src/services/crm.ts) joga `Error` plano com string concatenada. Spec MCP pede `JSON-RPC error codes`. |
| "Logs estruturados + payload + duração + usuário" | ❌ | Atualmente apenas `console.error` em casos de erro. Sem audit log estruturado de tool calls (existe `WRITE_AUDIT_LOG` para mutate, mas é append flat-file, não estruturado). |
| Transport Streamable HTTP, não SSE/stdio | ✅ | Já é Streamable HTTP via SDK oficial. |
| "Nenhuma operação de escrita na Fase 1" | ❌ | Já tem 7 tools de mutate (pause, enable, update_budget, add_negative, etc.). |
| "Catálogo de 6–10 tools de leitura na Fase 1" | ⚠️ | Tem 10 de leitura — encaixa numericamente, mas algumas dependem de endpoints CRM ainda inexistentes e respondem com mensagem de erro orientando criação (`unavailable` em [crm.ts:182](traffic-mcp-server/src/tools/crm.ts)). |
| "Sem novas tabelas no banco" | ✅ | Não cria tabelas. |
| "Não criar novo cliente Google Ads" | ✅ no modo `crm`. ⚠️ no modo `google_ads` — cria `GoogleAdsApi` próprio em [services/google-ads.ts](traffic-mcp-server/src/services/google-ads.ts), duplicando a inicialização do worker. |

### 3.3 Resolução proposta para o conflito (não decidida)

Apresento 3 caminhos. **Aguardando decisão humana** — não vou escrever uma linha de código antes.

#### Caminho 1 — Greenfield literal (seguir a spec ao pé da letra)

Construir, dentro do NestJS (`apps/api/src/traffic-mcp/`), um servidor MCP novo. Apagar ou deprecar o `traffic-mcp-server/` standalone e o `apps/api/src/mcp/` JSON-RPC manual.

- ➕ Cumpre a spec sem ressalvas.
- ➕ Logger do NestJS, DI, jest e validação `class-validator` reutilizados nativamente.
- ➖ **Joga fora trabalho deployado em prod** — 17 tools, OAuth para ChatGPT, integração Traefik.
- ➖ Re-trabalho de OAuth (a spec só cita Bearer; ChatGPT exige DCR/OAuth — atual já resolve isso).
- ➖ Risco regressivo (algumas tools dependem de endpoints HTTP que ainda não existem no CRM — vide §6).

#### Caminho 2 — Status quo + alinhamento de spec mínimo

Manter `traffic-mcp-server/` standalone como está. Documentar formalmente. Corrigir só:
- Logs estruturados (substituir `console.*` por logger com payload/duração/user).
- Erros JSON-RPC tipados.
- Deprecar `apps/mcp-server/` e `apps/api/src/mcp/` (CRM genérico) — fora de escopo desta spec, mas o duplo MCP cria confusão.

- ➕ Zero downtime, zero re-trabalho.
- ➖ Continua violando a spec em pontos (mutate na "Fase 1", heurística em algumas tools, processo separado).

#### Caminho 3 (RECOMENDADO) — Refatoração alinhada à spec, sem rewrite

Manter o `traffic-mcp-server/` standalone (Opção B da §4 abaixo), mas:

1. **Reorganizar tools por fase**: separar leitura (Fase 1) de mutate (Fase 4+). Mutate fica em arquivo separado, registrado por flag `MCP_ENABLE_WRITES=false` por default. Em modo Fase 1, somente leitura é exposta.
2. **Identificar e mover heurística para o cliente** (Claude): tools como `traffic_find_wasted_terms` viram `traffic_list_search_terms` com filtros parametrizados. Toda decisão "isso é desperdício?" sai do servidor.
3. **Logs estruturados**: introduzir `pino` ou usar `process.stdout.write(JSON.stringify(...))` — registrar `tool_name`, `args` (com PII redacted), `duration_ms`, `user_id` extraído do token.
4. **Erros JSON-RPC**: trocar `Error` plano por mapeamento para códigos JSON-RPC (`-32602` invalid params, `-32000` server error com `data.kind`).
5. **Reusar `formatError` do worker** ([google-ads-client.service.ts:92](apps/worker/src/trafego/google-ads-client.service.ts)) — copiar/portar a função (ou exportar via `@crm/shared`) para coerência de mensagens de erro Google Ads.
6. **Catálogo de tools Fase 1 finalizado** (vide §5). Tudo que depende de endpoint inexistente é **adiado** — não fica no MCP retornando "unavailable".
7. **Cobertura de testes**: vitest/jest + nock para a camada `services/crm.ts` (hoje zero teste).

- ➕ Mantém prod estável.
- ➕ Cumpre o espírito da spec ("tools burras", "Fase 1 só leitura").
- ➕ Trabalho real é só de polimento, não de rewrite.
- ➖ Mantém o servidor fora do binário NestJS — perde o DI, perde reuso direto de Logger/PrismaService. Fica uma "arquitetura híbrida".

---

## 4. Proposta arquitetural — Opção A vs Opção B

A spec pede esta seção. As duas opções, calibradas para o stack real:

### Opção A — MCP integrado ao NestJS (`apps/api/src/traffic-mcp/`)

Modelo: novo módulo NestJS importando o SDK `@modelcontextprotocol/sdk`. Uma rota `POST /traffic-mcp/mcp` (ou similar) usa `StreamableHTTPServerTransport` adaptado para Express handler. Compartilha DI com `TrafegoService`.

- ➕ Reusa Logger, PrismaService, ConfigService, JwtService, ThrottlerGuard nativamente.
- ➕ Um único deploy, uma única imagem Docker (`crm-api`).
- ➕ DTO já validado pelo `class-validator`; Zod fica só no schema MCP.
- ➖ Atualmente o `traffic-mcp-server` standalone TEM rota Traefik dedicada `/traffic-mcp/*` (priority 110 + middleware strip-prefix). Migrar requer reconfigurar Traefik para apontar `/traffic-mcp/mcp` para `crm-api` em vez do container MCP. Risco de quebrar integração ChatGPT em produção durante o cutover.
- ➖ Aumenta superfície de ataque do API container (mais um endpoint público, mesmo processo que serve `/api/leads`).
- ➖ **NestJS request lifecycle não é amistoso a Streamable HTTP / chunked responses** — o SDK MCP espera escrever no `res` direto; `@nestjs/common` interceptors podem interferir. Exige `@Res({ passthrough: false })` e bypass de pipes globais — possível, mas com cuidado.

### Opção B — MCP standalone (mantém `traffic-mcp-server/`)

Modelo: o que já existe. Container Node + Express + SDK MCP, fala HTTP com a API NestJS via `CRM_API_URL`, valida tokens via `/auth/mcp-token/verify`.

- ➕ Isolamento de processo: crash do MCP não derruba o CRM; deploy independente.
- ➕ Já existe e roda em prod com OAuth para ChatGPT.
- ➕ Mais simples versionar/escalar separadamente.
- ➕ Permite linguagem/runtime futuro diferente (não que a spec permita — só vantagem teórica).
- ➖ Não reusa Logger/DI nativamente — duplica código de log e error mapping.
- ➖ Round-trip HTTP localhost adiciona latência (5–15ms) vs chamar service in-process.
- ➖ Validação de input acontece duas vezes: Zod no MCP, depois `class-validator` no NestJS.

### Recomendação

**Opção B + Caminho 3 da §3.3.**

Justificativa:
- Já está em produção e funciona com Claude/ChatGPT — quebra-cabeça OAuth resolvido.
- A spec lista como princípio "não introduzir novo framework/biblioteca" — Opção A introduziria Zod ao bundle do NestJS (hoje só usado pelo MCP standalone) e adaptação manual do `StreamableHTTPServerTransport` ao lifecycle Nest.
- Latência de round-trip HTTP localhost é desprezível em comparação ao critério de sucesso (1500ms com cache) — a maior parte do orçamento vai pra Prisma/aggregates pesadas.
- O acoplamento "MCP fala com CRM por HTTP" mantém a fronteira limpa que a spec exige ("não modificar módulo de tráfego").

⚠️ **Decisão pendente** — esta recomendação é uma proposta. Aguardo seu sinal verde antes de qualquer execução.

---

## 5. Catálogo de tools propostas para Fase 1 (somente leitura)

8 tools, todas mapeando para endpoints HTTP existentes da API NestJS. Nomenclatura em `traffic_*` para coerência com o standalone atual; renomear para `list_*` / `get_*` se o usuário preferir o padrão da spec (palavra final do usuário).

| # | Tool | Mapeia para | Inputs | Output (resumo) | Tipo de mapeamento |
|---|---|---|---|---|---|
| 1 | `traffic_list_accounts` | `GET /trafego/account` | nenhum | `{ connected, account: { customer_id, login_customer_id, account_name, status, last_sync_at } }` | 1:1 |
| 2 | `traffic_list_campaigns` | `GET /trafego/campaigns?include_archived=&days=` | `include_archived?: boolean`, `days?: number (1-90)` | array de `{ id, google_campaign_id, name, status, channel_type, daily_budget_brl, bidding_strategy, metrics_window: { impressions, clicks, cost_brl, conversions, ctr, cpl_brl } }` | 1:1 |
| 3 | `traffic_get_campaign_metrics` | `GET /trafego/dashboard?date_from=&date_to=&channel_type=` | `date_from: YYYY-MM-DD`, `date_to: YYYY-MM-DD`, `channel_type?: string` | `{ kpis: { spend_*, cpl_brl, ctr, avg_cpc_brl }, top_campaigns: [...] }` | 1:1 |
| 4 | `traffic_get_ad_group_metrics` | `GET /trafego/ad-groups?campaign_id=&status=` + foreach `GET /trafego/ad-groups/:id/keywords` | `campaign_id: string`, `include_keywords?: boolean (default false)` | array de ad_groups + opcionalmente keywords agregadas | composição (2 endpoints) |
| 5 | `traffic_get_keywords_performance` | `GET /trafego/ad-groups/:adGroupId/keywords?negative=` | `ad_group_id: string`, `negative?: boolean` | array de `{ id, text, match_type, status, cpc_bid_brl, quality_score?, metrics_30d?: { ... } }` | 1:1 (quality_score depende do schema TrafficKeyword — confirmar §6.2) |
| 6 | `traffic_get_search_terms_report` | `GET /trafego/search-terms?campaign_id=&ad_group_id=&min_spend_brl=&zero_conv_only=&search=&limit=` | `campaign_id?: string`, `ad_group_id?: string`, `min_spend_brl?: number`, `zero_conv_only?: boolean`, `search?: string`, `limit?: number (≤500)` | array de search terms com `{ term, match_type, impressions, clicks, cost_brl, conversions, status }` | 1:1 |
| 7 | `traffic_compare_periods` | 2× `GET /trafego/dashboard?date_from=&date_to=` | `period_a: { from, to }`, `period_b: { from, to }`, `campaign_id?: string` | `{ a: kpis, b: kpis, delta: { absolute, percent } }` | composição (2 endpoints) — **delta é cálculo aritmético determinístico, não é heurística** |
| 8 | `traffic_get_account_health_summary` | composição: `GET /trafego/account` + `GET /trafego/dashboard?days=30` + `GET /trafego/sync-logs?limit=5` + `GET /trafego/alerts?status=OPEN` | `days?: number (default 30)` | `{ account_status, last_sync_at, last_sync_error?, kpis_window, open_alerts_count, recent_sync_failures: [...] }` | composição (4 endpoints) — agregação **descritiva**, sem julgamento |

**Tools que estavam no MCP atual e ficam de FORA da Fase 1** (motivo entre parênteses):
- `traffic_find_wasted_terms` — heurística embutida; vira filtros de `traffic_get_search_terms_report` (Claude decide critério).
- `traffic_get_ad_strength` — não é métrica de leitura "burra" sob a definição estrita; depende de avaliação interna do Google.
- `traffic_get_schedule`, `traffic_hourly_performance`, `traffic_device_performance` — endpoints existem, podem entrar como extensão se o usuário quiser; deixei fora pra ficar nas 6–10 da spec.
- `traffic_health_check` — substituído por `traffic_get_account_health_summary` (mais útil ao Claude).
- Todas as 7 de mutate — Fase 4+ por princípio explícito da spec.

**Convenção de retorno**: `structuredContent` JSON tipado obrigatório; `content` markdown opcional (resumo legível). Spec preferiu "JSON estruturado tipado, não texto livre" — mantenho `content` apenas quando há tabela útil; nunca como única resposta.

---

## 6. Conflitos secundários e questões abertas

### 6.1 Tools de "otimização" no controller

O CRM atual expõe `GET /trafego/optimization/weekly-diagnosis`, `keywords-to-pause`, `budget-suggestions`. Esses endpoints **embutem heurística** (regras de "vale pausar?"). A spec é explícita: "tools entregam dados; o Claude julga".

**Decisão pendente**: expor esses endpoints como tools MCP (violando o princípio) ou ignorá-los e deixar o Claude fazer o cálculo a partir de `traffic_get_keywords_performance`?

Recomendação: **ignorar na Fase 1**. Se o usuário discordar, expô-los com nome explícito tipo `traffic_get_internal_optimization_report` (sinalizando que é opinião do CRM, não do Claude).

### 6.2 Quality score e cache de keywords

O endpoint `GET /trafego/ad-groups/:id/keywords` retorna o que está em `TrafficKeyword` — o sync popula esses registros, mas é preciso confirmar se o campo `quality_score` está presente no schema atual. Vi `TrafficKeyword` em [schema.prisma:2863](packages/shared/prisma/schema.prisma) mas não inspecionei todos os campos.

**Ação na Fase 1**: ler o model completo ANTES de assinar o contrato da tool e ajustar a output spec da tool 5.

### 6.3 Cache para latência

Critério de sucesso: < 1500ms médio. Hoje o CRM **não tem cache** para `/trafego/*`. Endpoints como `/trafego/dashboard` rodam aggregates pesadas via `prisma.trafficMetricDaily.groupBy`. A latência pode estourar dependendo do volume de `TrafficMetricDaily`.

**Opções** (decisão pendente):
- (a) Confiar nos índices Prisma — medir e ver. Se OK, nada a fazer.
- (b) Adicionar cache in-memory no MCP standalone (já existe — TTL 5min). É o que existe hoje.
- (c) Adicionar cache Redis no `TrafegoService` da API. Maior, exige cuidado com invalidação.

Recomendação: medir com chamadas reais antes de decidir. Cache in-memory atual cobre a maioria dos casos com TTL 5min.

### 6.4 Nomenclatura

Spec diz `list_campaigns`, `get_campaign_metrics`. Standalone atual usa `traffic_list_campaigns`, `traffic_get_campaign`. Prefixo evita colisão com tools de outros MCPs num mesmo cliente Claude (CRM genérico, etc.).

**Decisão pendente**: manter prefixo `traffic_` ou seguir nomes da spec? Prefixo é boa prática MCP quando há vários servidores conectados.

### 6.5 Multi-tenancy

Cada tool precisa do `tenant_id` para query. A API NestJS extrai do JWT (`req.user.tenant_id`). O MCP standalone hoje **não passa tenant_id explícito**: ele fala com a API usando o token MCP (que já é tenant-scoped na geração via `/auth/mcp-token`).

**Confirmar**: o token gerado por `/auth/mcp-token` carrega `tenant_id` no payload? Inspeção rápida em [auth.controller.ts:23-26](apps/api/src/auth/auth.controller.ts) sugere sim (`req.user` veio do JWT regular, e `generateMcpToken` reusa esses claims). Validar antes de assumir.

### 6.6 Os outros dois MCPs (`apps/mcp-server/` e `apps/api/src/mcp/`)

Fora do escopo desta spec, mas relevante: ter três implementações de MCP no mesmo repo é confusão acumulada. Recomendação: depois da Fase 0, abrir tarefa separada para deprecar pelo menos uma das duas implementações de "CRM genérico" — escolher uma e remover a outra.

---

## 7. Critério de sucesso — verificação ex-ante

| Critério | Veredicto antecipado | Comentário |
|---|---|---|
| Zero arquivos modificados em `apps/api/src/trafego/*` | ✅ atingível em qualquer caminho | Caminho 3 só toca em `traffic-mcp-server/`. |
| Tools Fase 1 funcionam contra conta Google Ads real | ✅ atingível | Já funciona hoje contra a conta real (modo `crm`). |
| Latência média < 1500ms com cache | ⚠️ sem medição | Ver §6.3. |
| MCP Inspector lista e invoca todas as tools | ✅ atingível | Já documentado no README atual. |
| Documentação para dev rodar local em <30min | ⚠️ parcial | README atual cobre prod; falta seção "rodar local com mock CRM ou contra dev API". |

---

## 8. Próximas ações pedidas ao humano

Antes de eu escrever uma única linha de código de Fase 1, preciso de decisão em três pontos:

1. **Caminho 1, 2 ou 3?** (recomendo 3.)
2. **Opção A (integrado NestJS) ou B (standalone)?** (recomendo B, dado o caminho 3.)
3. **Catálogo de 8 tools acima está OK** ou quer ajustar (adicionar `hourly_performance` / `device_performance` / `schedule` que estão no MCP atual, manter prefixo `traffic_`, etc.)?

Questões secundárias (podem ficar para Fase 1 se preferir):
- §6.1 (otimização heurística do CRM expor ou não)
- §6.5 (verificação do `tenant_id` no token MCP)
- §6.6 (limpar MCPs duplicados de CRM genérico)

**Não vou avançar para Fase 1 sem essas respostas.**

---

## 9. Pivô de escopo (registrado em 2026-05-15 após retorno do usuário)

> **Diretriz do usuário:** "Quero reaproveitar tudo que já temos. O Claude (via Cowork) se conecta direto ao Google Ads e faz a gestão. O menu de gestão de tráfego do sistema vira **apenas acompanhamento** — vejo o que foi feito. Toda a gestão é feita pelo Claude Cowork."

Isso reescreve a §3.3 e §5. Resumo do que muda:

### 9.1 Implicações imediatas

1. **Caminho 3 confirmado** (refatoração alinhada, não rewrite). Reaproveitar o `traffic-mcp-server` existente.
2. **Opção B confirmada** (standalone). Já é como está.
3. **Tools de escrita são essenciais, não Fase 4+**. As 7 tools de mutate atuais (`pause`, `enable`, `update_budget`, `add_negative`, `remove_negative`, `add_negative_all_campaigns`, `update_schedule`) entram na Fase 1, somadas às 10 de leitura.
4. **CRM vira read-only de fato**: a UI continua mostrando dados, mas as ações de mutate (botões de pausar/budget/etc) não precisam ser usadas pelo humano. Decisão: **manter botões existentes** (não vou remover) — são fallback emergencial; o fluxo principal é Claude → Cowork → MCP → CRM/Google.
5. **Camada de IA interna fica obsoleta**:
   - [trafego-ai.service.ts](apps/api/src/trafego/trafego-ai.service.ts) (301 linhas) — IA conselheira/agent loop
   - [trafego-mapping-ai.service.ts](apps/api/src/trafego/trafego-mapping-ai.service.ts) (371 linhas) — sugestões via Claude API embutida
   - [trafego-recommendations.service.ts](apps/api/src/trafego/trafego-recommendations.service.ts) (158 linhas) — recomendações Google Ads
   - [worker/.../traffic-ai-agent.service.ts](apps/worker/src/trafego/traffic-ai-agent.service.ts) e processor — loop de IA
   - [worker/.../traffic-llm.service.ts](apps/worker/src/trafego/traffic-llm.service.ts) — wrapper LLM
   - **Decisão pendente**: desativar (feature flag), apagar (limpar código), ou coexistir.

### 9.2 Caminho técnico recomendado

```
Claude Cowork
    ↓ (OAuth Bearer)
traffic-mcp-server  (https://andrelustosaadvogados.com.br/traffic-mcp/mcp)
    ↓ (HTTP, modo CRM)
CRM API (apps/api)
    ↓ (BullMQ)
Worker (apps/worker)
    ↓ (google-ads-api SDK)
Google Ads
```

Vantagens de manter o **modo CRM** vs ir direto Claude → Google Ads:

| Aspecto | Modo CRM (recomendado) | Modo google_ads direto |
|---|---|---|
| Auditoria automática (`TrafficMutateLog`) | ✅ | ❌ ou exige duplicar |
| Validação OAB pré-mutate | ✅ (já implementada no `GoogleAdsMutateService`) | ❌ |
| Concurrency:1 por conta (race conditions) | ✅ (BullMQ worker) | ❌ |
| Reuso de credenciais criptografadas (TRAFEGO_ENCRYPTION_KEY) | ✅ | ❌ duplica .env |
| Atribuição gclid → Lead automática | ✅ | ❌ Claude não tem visibilidade do CRM |
| CRM enxerga em tempo "quase-real" | ✅ (worker grava em Postgres ao mutate) | ⚠️ só após próximo sync (cron 06h ou manual) |
| Latência por chamada | +5–15ms localhost | menor |
| Risco se traffic-mcp-server cair | Claude perde gestão | idem |

### 9.3 Lacunas a fechar antes da Fase 1

1. **Confirmar conectividade Cowork → traffic-mcp-server**: hoje o OAuth está configurado para ChatGPT (`MCP_OAUTH_STATIC_CLIENT_REDIRECT_PREFIX=https://chatgpt.com/connector/oauth/`). Cowork da Anthropic exige redirect prefix diferente — precisa adicionar/parametrizar. Vou checar a documentação atual da Anthropic na Fase 1.
2. **Tools faltantes para gestão completa autônoma**: o catálogo atual cobre o básico, mas para o Claude *gerenciar de fato* talvez falte:
   - `traffic_create_campaign` (existe endpoint `POST /trafego/campaigns`, não exposta como tool)
   - `traffic_create_rsa` (anúncio responsivo — existe endpoint, não é tool)
   - `traffic_generate_rsa` (gera com Claude — duplica IA, **não expor**)
   - `traffic_list_alerts` + `traffic_acknowledge_alert`
   - `traffic_list_mutate_logs` (Claude consultar próprio histórico — útil pra auto-correção)
   - `traffic_list_conversion_actions` + `traffic_map_conversion_action`
   - `traffic_list_audiences` + CRUD básico
   - `traffic_list_recommendations` (do próprio Google Ads — útil pro Claude usar como insumo)
3. **Decidir destino da IA interna** (ver §9.1 item 5).
4. **Limites operacionais**: hoje `REPORT_DAILY_LIMIT` protege custo; precisa equivalente para mutate massivo via Claude (rate limit por hora, kill-switch global, dollar-amount cap em update_budget).

### 9.4 Próximas perguntas (substituem as da §8)

Vou perguntar via UI estruturada:

1. **Onde o Claude age**: modo CRM (escrita via fila, auditoria), modo direto (sem CRM no caminho), ou híbrido?
2. **IA interna**: desativar via flag, apagar código, ou manter coexistindo?
3. **Catálogo expandido de tools**: ficar nas 17 atuais, ou expandir com create_campaign/create_rsa/list_recommendations/audiences/etc.?

Depois das respostas, atualizo este documento com a §10 "Catálogo final aprovado da Fase 1" e só então sigo para escrita de código.

---

## 10. Decisões aprovadas (2026-05-15)

| Pergunta | Resposta |
|---|---|
| Caminho de escrita Claude → Google | **Via CRM** (modo `crm` do MCP). Claude → MCP → CRM API → BullMQ → worker → Google Ads. Mantém auditoria (`TrafficMutateLog`), validação OAB, atribuição gclid→Lead. |
| Tratamento da IA interna | **Desativar via feature flag** `TRAFEGO_IA_INTERNA_ENABLED=false`. Código fica, jobs e endpoints retornam 503 amigável quando flag desligada. |
| Catálogo de tools | **Expandido** (~29 tools). 15 leitura + 14 escrita. Detalhe abaixo. |

### 10.1 Catálogo final da Fase 1

Todas as tools mapeiam para endpoints já existentes em `apps/api/src/trafego/trafego.controller.ts`. Nenhuma exige código novo no módulo de tráfego.

**Leitura (15)**

| # | Tool | Mapeia para | Tipo |
|---|---|---|---|
| 1 | `traffic_list_accounts` | `GET /trafego/account` | 1:1 |
| 2 | `traffic_list_campaigns` | `GET /trafego/campaigns` | 1:1 |
| 3 | `traffic_get_dashboard` | `GET /trafego/dashboard` | 1:1 |
| 4 | `traffic_compare_periods` | 2× `GET /trafego/dashboard` | composição |
| 5 | `traffic_get_account_health_summary` | composição (account + dashboard 30d + sync-logs + alerts open) | composição |
| 6 | `traffic_list_ad_groups` | `GET /trafego/ad-groups` | 1:1 |
| 7 | `traffic_list_keywords` | `GET /trafego/ad-groups/:id/keywords` | 1:1 |
| 8 | `traffic_list_ads` | `GET /trafego/ad-groups/:id/ads` | 1:1 |
| 9 | `traffic_list_search_terms` | `GET /trafego/search-terms` (com filtros — substitui `find_wasted_terms`) | 1:1 |
| 10 | `traffic_list_budgets` | `GET /trafego/budgets` | 1:1 |
| 11 | `traffic_list_conversion_actions` | `GET /trafego/conversion-actions` | 1:1 |
| 12 | `traffic_list_alerts` | `GET /trafego/alerts` | 1:1 |
| 13 | `traffic_list_sync_logs` | `GET /trafego/sync-logs` | 1:1 |
| 14 | `traffic_list_mutate_logs` | `GET /trafego/mutate-logs` (Claude vê próprio histórico → auto-correção) | 1:1 |
| 15 | `traffic_list_recommendations` | `GET /trafego/recommendations` (do próprio Google Ads, insumo pro Claude) | 1:1 |

**Escrita (14)** — todas vão pra fila `trafego-mutate` com auditoria automática

| # | Tool | Mapeia para | Observação |
|---|---|---|---|
| 16 | `traffic_pause_campaign` | `POST /trafego/campaigns/:id/pause` | |
| 17 | `traffic_enable_campaign` | `POST /trafego/campaigns/:id/resume` | |
| 18 | `traffic_update_campaign_budget` | `PATCH /trafego/campaigns/:id/budget` | aplicar **dollar-cap** §10.3 |
| 19 | `traffic_pause_ad_group` | `POST /trafego/ad-groups/:id/pause` | |
| 20 | `traffic_enable_ad_group` | `POST /trafego/ad-groups/:id/resume` | |
| 21 | `traffic_add_keywords` | `POST /trafego/ad-groups/:id/keywords` | validação OAB já no service |
| 22 | `traffic_add_negative_to_campaign` | `POST /trafego/campaigns/:id/negatives` | |
| 23 | `traffic_add_negative_to_ad_group` | `POST /trafego/ad-groups/:id/negatives` | |
| 24 | `traffic_remove_keyword` | `DELETE /trafego/keywords/:id` | |
| 25 | `traffic_update_schedule` | `PUT /trafego/campaigns/:id/schedule` | |
| 26 | `traffic_create_search_campaign` | `POST /trafego/campaigns` | default PAUSED — Claude precisa habilitar explicitamente |
| 27 | `traffic_create_rsa` | `POST /trafego/ad-groups/:id/ads/rsa` | validação OAB já no service |
| 28 | `traffic_apply_recommendation` | `POST /trafego/recommendations/:id/apply` | |
| 29 | `traffic_trigger_sync` | `POST /trafego/sync` | force-refresh dos dados antes de uma análise |

**Fora desta fase** (anotado pra futuro): `update_bidding_strategy` (complexa), `remove_campaign` (perigosa, exige confirmação dupla), CRUD de `audiences` / `asset_groups` (Performance Max), `lead_form_submissions`, `auction_insights`, `acknowledge_alert` (não é ação de gestão, é de operação humana).

### 10.2 Convenções

- **Naming**: prefixo `traffic_` mantido (evita colisão se Cowork tiver outros MCPs ativos).
- **Retorno**: `structuredContent` JSON tipado obrigatório. `content` markdown opcional pra resumo legível.
- **Validação**: Zod no MCP (segurança da entrada) + `class-validator` no NestJS (segurança da camada de domínio). Defesa em camadas.
- **Erros**: mapear `Error` → JSON-RPC error code (`-32602` invalid params, `-32000` server error com `data.kind`). Fim do `Error('CRM retornou 500: ...')` cru.
- **Logs**: substituir `console.*` por structured logging (linha JSON por evento) — `tool_name`, `args` (PII redacted), `duration_ms`, `user_id`, `tenant_id`, `result_status`.
- **Idempotência**: para tools de mutate, propagar `request_id` opcional no DTO → vira chave de idempotência no `TrafficMutateLog`.

### 10.3 Limites operacionais (kill-switches)

Como o Claude vai atuar autonomamente, preciso adicionar guard-rails no `traffic-mcp-server`:

1. `MCP_MUTATE_RATE_LIMIT_PER_HOUR` (default 60) — por sessão MCP. Bloqueia explosão.
2. `MCP_BUDGET_CHANGE_MAX_PERCENT` (default 50) — `update_campaign_budget` rejeita mudança > X% do budget atual.
3. `MCP_BUDGET_DAILY_HARD_CAP_BRL` (default 1000) — não permite setar budget diário acima de X BRL via Claude.
4. `MCP_KILL_SWITCH=false` (default false) — quando true, todas as tools de escrita retornam 503 com mensagem ("gestão autônoma desativada — use o painel").
5. **Confirmação dupla** opcional via parâmetro `confirm: true` em `create_search_campaign` e `update_campaign_budget` quando delta > 30%.

Esses limites ficam configuráveis via env, defaults conservadores.

### 10.4 OAuth para Cowork

O OAuth atual está calibrado para ChatGPT (`MCP_OAUTH_STATIC_CLIENT_REDIRECT_PREFIX=https://chatgpt.com/connector/oauth/`). Cowork da Anthropic exige redirect prefix próprio. Na Fase 1 vou:

- Tornar o prefixo configurável aceitando lista de prefixos válidos (`MCP_OAUTH_REDIRECT_PREFIXES=https://chatgpt.com/connector/oauth/,https://cowork.anthropic.com/...`).
- Confirmar URL exata via documentação Anthropic atual (vou consultar antes de codar).
- Documentar o passo-a-passo de registrar o connector no Cowork no `traffic-mcp-server/README.md`.

---

## 11. Plano de execução da Fase 1

Apenas escrevo código depois do seu OK explícito nesta seção.

### 11.1 Mudanças por arquivo

**`traffic-mcp-server/`** (alvo principal — refatoração + expansão)

| Arquivo | Mudança | Risco |
|---|---|---|
| `src/index.ts` | Aceitar lista de redirect prefixes OAuth; manter compat com env atual. | baixo |
| `src/auth/oauth.ts` | Validar redirect contra lista; sem regressão pro ChatGPT. | médio |
| `src/services/crm.ts` | Mapear `Error` → JSON-RPC; tipar response shapes; structured logging em request/response. | baixo |
| `src/services/google-ads.ts` | **NÃO TOCAR** se ficarmos só no modo CRM. Decisão: deixar para fallback futuro. | — |
| `src/tools/crm.ts` | Adicionar tools 14, 15, 26, 27, 28, 29 (mutate_logs, recommendations, create_campaign, create_rsa, apply_recommendation, trigger_sync). Refatorar `find_wasted_terms` → filtros de `list_search_terms`. Aplicar guard-rails §10.3. | médio |
| `src/utils/format.ts` | Helpers para erro JSON-RPC tipado. | baixo |
| `src/utils/logger.ts` | **NOVO** — wrapper de `process.stdout.write(JSON.stringify(...))` com nível, evento, duração. Sem dependência nova (poderia ser `pino`, mas prefiro zero-dep). | baixo |
| `src/utils/guard-rails.ts` | **NOVO** — rate limit em memória, validação delta de budget, kill-switch. | baixo |
| `tests/crm.spec.ts` | **NOVO** — `vitest` + `nock` mockando CRM API. Cobre 3 happy-path + 2 error mappings. | baixo |
| `package.json` | Adicionar `vitest`, `nock`. Sem mudar produção. | baixo |
| `README.md` | Seção "Setup no Cowork", referência ao `docs/mcp-server/tools.md`. | nenhum |

**`apps/api/src/trafego/`** (apenas feature flag — zero alteração de lógica de Tráfego, conforme princípio da spec)

| Arquivo | Mudança | Risco |
|---|---|---|
| `trafego-config.service.ts` | Adicionar getter `isIaInternaEnabled()` lendo env `TRAFEGO_IA_INTERNA_ENABLED` (default `false` em prod, `true` se nada definido pra não quebrar dev). | baixo |
| `trafego.controller.ts` | Wrapper guard nos endpoints `/ai/*`, `/recommendations/*`, `/conversion-actions/ai-suggestions`, `/ai/generate-rsa`, `/chat/*`: se flag false → 503 `{ error: "ia_interna_desativada", message: "..." }`. | médio (toca controller) |
| `trafego-ai.service.ts` etc. | **NÃO TOCAR** — só ficam dormentes pelo bloqueio no controller. | — |

> ⚠️ **Princípio em conflito**: a spec disse "Zero arquivos modificados dentro do módulo de gestão de tráfego". Se você quer manter isso à risca, a alternativa é o guard ficar num **interceptor/middleware NestJS separado** em `apps/api/src/common/` que lê o decorator `@RequiresIaInterna()` aplicado nas rotas. **Decisão pendente**: tocar controller (mais simples, ~30 linhas) ou criar interceptor (mais limpo, zero modificação no controller). Aguardo seu sinal.

**`apps/worker/src/trafego/`**

| Arquivo | Mudança | Risco |
|---|---|---|
| `traffic-ai-agent-cron.service.ts` | Early return se flag false. Idem `traffic-recommendations.processor.ts` e `traffic-chat.processor.ts`. | baixo |
| Cron `@Cron()` da IA | Bypassa execução, log informativo. | baixo |

**`docs/mcp-server/`**

| Arquivo | Mudança |
|---|---|
| `tools.md` | **NOVO** — uma seção por tool com input schema, output schema, exemplo de invocação, mapeamento pro endpoint. |
| `setup-cowork.md` | **NOVO** — passo-a-passo de registrar connector no Cowork (depende de §10.4). |

**`infra/portainer-stack.yml`** — adicionar envs novos (`MCP_OAUTH_REDIRECT_PREFIXES`, kill-switches §10.3, `TRAFEGO_IA_INTERNA_ENABLED`).

### 11.2 Critérios de saída

A Fase 1 é considerada completa quando:

- [ ] Cowork conecta no MCP via OAuth e lista as 29 tools.
- [ ] Comando "pausa a campanha X" via Claude funciona end-to-end e aparece em `TrafficMutateLog` com initiator `mcp:cowork:<userId>`.
- [ ] Endpoint `POST /trafego/ai/trigger` retorna 503 com `TRAFEGO_IA_INTERNA_ENABLED=false`.
- [ ] `traffic_list_mutate_logs` retorna o histórico correto (Claude pode auto-revisar).
- [ ] Logs estruturados aparecem em stdout do container `traffic-mcp-server`.
- [ ] Pelo menos 1 teste de integração passando (`vitest`).
- [ ] `docs/mcp-server/tools.md` cobre todas as 29 tools.
- [ ] Painel CRM continua funcional (regression manual: dashboard abre, lista campanhas, abre detalhe).
- [ ] Latência média de tool call medida — registrar valor obtido vs. critério 1500ms.

### 11.3 Fora da Fase 1 (Fases futuras)

- Tools de update de bidding strategy
- CRUD de audiences / asset groups (Performance Max)
- Auto-aprovação Claude com gatilhos (Fase 4)
- Alertas via WhatsApp do Claude pro humano quando intervir
- Migração para 2FA / aprovação humana antes de mutates de alto risco

---

## 12. Pergunta única para destravar Fase 1

**Posso prosseguir com a Fase 1 exatamente como detalhado em §10 e §11 acima?**

Sub-decisão única que falta: §11.1 — guard de IA interna no controller (simples) ou via interceptor NestJS (limpo). Default que vou usar se você não responder: **interceptor**, porque honra o princípio "zero modificação no módulo de tráfego" da spec original.
