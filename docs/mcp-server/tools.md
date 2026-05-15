# Catálogo de tools — traffic-mcp-server (Fase 1)

29 tools expostas pelo MCP `traffic-mcp-server`, todas no modo `crm` (passa pela API NestJS, mantém auditoria, validação OAB, atribuição gclid→Lead).

- **Leitura**: 15 tools — `readOnlyHint: true`
- **Escrita**: 14 tools — todas vão pela fila `trafego-mutate` do BullMQ; sujeitas a guard-rails (rate limit, budget cap, kill switch)

Todas retornam `structuredContent.data` com JSON tipado e `content[0].text` com markdown legível. Erros viram `structuredContent.error.kind` ∈ `auth | not_found | validation | rate_limit | guard_rail | upstream | network | google_ads_quota | google_ads_permission | unknown`.

---

## 1. Leitura

### `traffic_list_accounts`

Lista a(s) conta(s) Google Ads conectadas ao CRM.

- **Input**: nenhum
- **Output**: `{ connected: boolean, account: { customer_id, login_customer_id, account_name, status, last_sync_at } | null }`
- **Endpoint**: `GET /trafego/account`

### `traffic_list_campaigns`

Lista campanhas com métricas agregadas da janela.

- **Input**:
  - `include_archived?: boolean` — default false
  - `days?: number` (1-90) — janela de métricas, default 30
  - `status_filter?: 'ENABLED' | 'PAUSED' | 'ALL'`
  - `limit?, page?` — paginação
- **Output**: array de `{ id, google_campaign_id, name, status, channel_type, daily_budget_brl, bidding_strategy, metrics_window: { ... } }`
- **Endpoint**: `GET /trafego/campaigns?include_archived=&days=`

### `traffic_get_dashboard`

KPIs agregados do dashboard de tráfego.

- **Input**:
  - `date_from?: YYYY-MM-DD` ou `date_preset?: TODAY | YESTERDAY | LAST_7_DAYS | LAST_30_DAYS | THIS_MONTH | LAST_MONTH`
  - `date_to?: YYYY-MM-DD`
  - `channel_type?: string`
- **Output**: `{ kpis: { spend_today_brl, spend_month_brl, cpl_brl, ctr, avg_cpc_brl }, top_campaigns: [...], timeseries: [...] }`
- **Endpoint**: `GET /trafego/dashboard`

### `traffic_compare_periods`

Compara KPIs entre dois períodos com cálculo determinístico de delta.

- **Input**: `period_a_from`, `period_a_to`, `period_b_from`, `period_b_to`, `channel_type?`
- **Output**: `{ period_a: { range, kpis }, period_b: {...}, delta: { spend_today_brl: { abs, pct }, ... } }`
- **Endpoint**: composição 2× `GET /trafego/dashboard`
- **Nota**: delta é aritmético, não opinião — Claude interpreta.

### `traffic_get_account_health_summary`

Visão agregada da saúde da conta. Use como primeira leitura ao iniciar uma sessão.

- **Input**: `days?: number (default 30)`
- **Output**: `{ connected, account, last_sync_at, last_sync_error, window_kpis, open_alerts_count, recent_sync_failures, recent_sync_logs }`
- **Endpoint**: composição (`/account` + `/dashboard` + `/sync-logs?limit=5` + `/alerts?status=OPEN`)

### `traffic_list_ad_groups`

- **Input**: `campaign_id?: string`, `status?: string`, `limit?, page?`
- **Output**: array de ad groups
- **Endpoint**: `GET /trafego/ad-groups`

### `traffic_list_keywords`

- **Input**: `ad_group_id: string`, `negative?: boolean`, `limit?, page?`
- **Output**: array de keywords
- **Endpoint**: `GET /trafego/ad-groups/:adGroupId/keywords`

### `traffic_list_ads`

- **Input**: `ad_group_id: string`, `limit?, page?`
- **Output**: array de ads
- **Endpoint**: `GET /trafego/ad-groups/:adGroupId/ads`

### `traffic_list_search_terms`

Substituiu `traffic_find_wasted_terms` da v0 — heurística movida pra Claude (filtros parametrizados).

- **Input**:
  - `campaign_id?, ad_group_id?: string`
  - `min_spend_brl?: number` — gasto mínimo em BRL
  - `zero_conv_only?: boolean` — apenas termos com 0 conversão
  - `search?: string` — busca textual
  - `limit?: number` (≤500, default 50)
- **Output**: array de search terms
- **Endpoint**: `GET /trafego/search-terms`

### `traffic_list_budgets`

- **Input**: nenhum
- **Output**: array de budgets
- **Endpoint**: `GET /trafego/budgets`

### `traffic_list_conversion_actions`

ConversionActions configuradas no Google Ads + mapeamento atual pra eventos do CRM.

- **Input**: nenhum
- **Output**: array
- **Endpoint**: `GET /trafego/conversion-actions`

### `traffic_list_alerts`

- **Input**: `status?: 'OPEN' | 'ACKED' | 'RESOLVED'`, `limit?: number`
- **Output**: array de alertas
- **Endpoint**: `GET /trafego/alerts`

### `traffic_list_sync_logs`

Logs de sync com a Google Ads API. Use pra avaliar freshness.

- **Input**: `limit?: number` (default 20)
- **Output**: array
- **Endpoint**: `GET /trafego/sync-logs`

### `traffic_list_mutate_logs`

**Audit trail das escritas via CRM.** Permite ao Claude revisar próprio histórico antes de novas alterações (auto-correção).

- **Input**:
  - `limit?: number` (default 50, max 200)
  - `initiator?: string` — filtra por initiator (ex: `mcp:cowork:user-id`)
  - `status?: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'VALIDATED'`
- **Output**: array
- **Endpoint**: `GET /trafego/mutate-logs`

### `traffic_list_recommendations`

Recomendações do **próprio Google Ads** (sincronizadas via API). Insumo pro Claude decidir o que aplicar.

- **Input**: `type?: string`, `status?: 'ACTIVE' | 'APPLIED' | 'DISMISSED'`, `limit?: number`
- **Output**: array
- **Endpoint**: `GET /trafego/recommendations`

---

## 2. Escrita

> Toda mutate honra três guard-rails antes de executar:
>
> 1. **Kill switch global** — `MCP_KILL_SWITCH=true` bloqueia tudo (read continua funcionando).
> 2. **Rate limit** — `MCP_MUTATE_RATE_LIMIT_PER_HOUR` (default 60) por janela rolante de 1h.
> 3. **Budget caps** (apenas update_budget e create_search_campaign):
>    - `MCP_BUDGET_DAILY_HARD_CAP_BRL` (default 1000) — teto absoluto
>    - `MCP_BUDGET_CHANGE_MAX_PERCENT` (default 50) — delta máximo por operação
>    - `MCP_BUDGET_REQUIRE_CONFIRM_PERCENT` (default 30) — exige `confirm: true` acima desse delta
>
> Bloqueio retorna `structuredContent.error.kind = 'guard_rail'` com `details.rule` indicando qual regra disparou.

### `traffic_pause_campaign`

- **Input**: `campaign_id`, `reason?`, `validate_only?`
- **Endpoint**: `POST /trafego/campaigns/:id/pause`

### `traffic_enable_campaign`

- **Input**: `campaign_id`, `reason?`, `validate_only?`
- **Endpoint**: `POST /trafego/campaigns/:id/resume`

### `traffic_update_campaign_budget`

Sujeita aos 3 guard-rails de budget acima. Quando `current_daily_budget_brl` é omitido, o MCP busca antes pra calcular delta.

- **Input**:
  - `campaign_id: string`
  - `new_daily_budget_brl: number > 0`
  - `current_daily_budget_brl?: number > 0`
  - `reason?: string`
  - `confirm?: boolean` — required quando delta > confirm threshold
  - `validate_only?: boolean`
- **Endpoint**: `PATCH /trafego/campaigns/:id/budget`

### `traffic_pause_ad_group`

- **Input**: `ad_group_id`, `reason?`, `validate_only?`
- **Endpoint**: `POST /trafego/ad-groups/:id/pause`

### `traffic_enable_ad_group`

- **Input**: `ad_group_id`, `reason?`, `validate_only?`
- **Endpoint**: `POST /trafego/ad-groups/:id/resume`

### `traffic_add_keywords`

Validação OAB roda automaticamente no CRM (qualquer termo vetado aborta o batch).

- **Input**:
  - `ad_group_id: string`
  - `keywords: Array<{ text: string (1-80), match_type: 'BROAD'|'PHRASE'|'EXACT', cpc_bid_brl?: number }>` (1-50)
  - `validate_only?: boolean`
- **Endpoint**: `POST /trafego/ad-groups/:id/keywords`

### `traffic_add_negative_to_campaign`

- **Input**: `campaign_id`, `keywords: string[]` (1-50), `match_type`, `validate_only?`
- **Endpoint**: `POST /trafego/campaigns/:id/negatives`

### `traffic_add_negative_to_ad_group`

- **Input**: `ad_group_id`, `keywords: string[]` (1-50), `match_type`, `validate_only?`
- **Endpoint**: `POST /trafego/ad-groups/:id/negatives`

### `traffic_remove_keyword`

**Destrutivo** — Google não reconcilia; reverter exige re-adicionar.

- **Input**: `keyword_id`, `reason?`, `validate_only?`
- **Endpoint**: `DELETE /trafego/keywords/:id`

### `traffic_update_schedule`

- **Input**:
  - `campaign_id: string`
  - `schedule: Array<{ day_of_week: 'MONDAY'..'SUNDAY', start_hour: 0-23, end_hour: 1-24, bid_modifier?: number }>` (1-168)
  - `validate_only?: boolean`
- **Endpoint**: `PUT /trafego/campaigns/:id/schedule`

### `traffic_create_search_campaign`

Default **PAUSED** — chame `traffic_enable_campaign` explicitamente após revisar. Exige `confirm: true`.

- **Input**:
  - `name: string` (3-120)
  - `daily_budget_brl: number > 0` — sujeita a hard cap
  - `bidding_strategy: 'MAXIMIZE_CONVERSIONS' | 'TARGET_CPA' | 'MAXIMIZE_CLICKS' | 'TARGET_IMPRESSION_SHARE'`
  - `target_cpa_brl?: number` — required se bidding=TARGET_CPA
  - `geo_targets?: string[]`
  - `language_codes?: string[]`
  - `confirm: boolean` — **required**
- **Endpoint**: `POST /trafego/campaigns`

### `traffic_create_rsa`

Cria Responsive Search Ad. Validação OAB no CRM.

- **Input**:
  - `ad_group_id: string`
  - `headlines: string[]` (3-15, max 30 chars cada)
  - `descriptions: string[]` (2-4, max 90 chars cada)
  - `final_urls: string[]` (1-10, URL valida)
  - `path1?, path2?: string` (max 15 cada)
  - `validate_only?: boolean`
- **Endpoint**: `POST /trafego/ad-groups/:id/ads/rsa`

### `traffic_apply_recommendation`

**Destrutivo** dependendo do tipo. Use ID obtido em `traffic_list_recommendations`.

- **Input**: `recommendation_id`, `validate_only?`
- **Endpoint**: `POST /trafego/recommendations/:id/apply`

### `traffic_trigger_sync`

Refresh dos dados (não conta no rate limit de mutate, mas honra kill switch).

- **Input**: nenhum
- **Endpoint**: `POST /trafego/sync`

---

## 3. Códigos de erro

Todo erro retorna `structuredContent.error = { kind, message, details? }`:

| `kind` | Quando | Resposta sugerida do Claude |
|---|---|---|
| `auth` | Token inválido/expirado, permissão negada (401/403) | Avisar humano — token MCP precisa renovar |
| `not_found` | Recurso inexistente (404) | Reconfirmar IDs com tools de leitura |
| `validation` | Input malformado (4xx) | Corrigir input e tentar de novo |
| `rate_limit` | 429 do CRM | Esperar e tentar de novo |
| `guard_rail` | Bloqueado por kill-switch / cap / falta de confirm | Conferir `details.rule` e ajustar input ou recuar |
| `upstream` | 5xx do CRM ou erro do Google Ads | Tentar de novo após delay; se persistir, escalar |
| `network` | Timeout/falha de transporte | Retry com backoff |
| `google_ads_quota` | Quota Google atingida | Esperar reset (tipicamente diário) |
| `google_ads_permission` | OAuth revogado, MCC perdeu acesso | Avisar humano para reautorizar |
| `unknown` | Outros | Logar e escalar |

---

## 4. Convenções

- Toda mutate aceita `validate_only: true` (dry-run no Google Ads) — útil para Claude verificar viabilidade antes de aplicar.
- IDs aceitos: tanto o **ID interno UUID** do CRM quanto o **google_campaign_id** numérico funcionam em `campaign_id` (a tool resolve internamente).
- **Datas** sempre em `YYYY-MM-DD`. Para conveniência, `date_preset` aceita `TODAY | YESTERDAY | LAST_7_DAYS | LAST_30_DAYS | THIS_MONTH | LAST_MONTH`.
- **Valores monetários**: sempre BRL (não micros). Conversão para micros acontece no CRM.

---

## 5. Logs estruturados

Cada chamada produz duas linhas NDJSON em stdout do container:

```json
{"ts":"2026-05-15T17:00:00.000Z","level":"info","event":"tool_call_start","tool":"traffic_pause_campaign","tool_call_id":"tc_lqxxx_xxxxx"}
{"ts":"2026-05-15T17:00:00.342Z","level":"info","event":"tool_call_end","tool":"traffic_pause_campaign","tool_call_id":"tc_lqxxx_xxxxx","duration_ms":342,"status":"ok"}
```

Erros adicionam `error_kind` e `error_message`. Bloqueios de guard-rail logam separadamente com `event: "guard_rail_block"` antes do `tool_call_end`.

PII (tokens, telefones, emails, CPF/CNPJ, etc) é redacted automaticamente pelo logger.
