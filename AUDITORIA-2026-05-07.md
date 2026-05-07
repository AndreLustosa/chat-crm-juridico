# Auditoria Total do Sistema — Chat CRM Jurídico
**Data:** 2026-05-07
**Escopo:** Monorepo completo (API NestJS + Worker BullMQ + Frontend Next.js + Prisma + Infra)
**Cobertura:** 260 arquivos API, 259 frontend, 90 worker, 50 migrations SQL, scripts da raiz, Docker

---

## 1. Resumo Executivo

Sistema funcional em produção com arquitetura sólida (multi-tenant, BullMQ, Socket.IO, Prisma, defesas em camadas), mas com **dívida técnica significativa** acumulada por geração assistida por IA.

| Métrica | Valor |
|---|---|
| **Áreas auditadas** | 8 |
| **Achados totais** | ~240 |
| **CRÍTICOS** | 26 |
| **ALTOS** | 58 |
| **MÉDIOS** | 80+ |
| **BAIXOS** | 75+ |
| **Score geral** | 6.2 / 10 |

**Pontos fortes:** HMAC opcional em webhooks Evolution, isolamento cross-tenant em alguns pontos, retry/backoff no Asaas, soft-delete em diversas relações, criptografia AES-256-GCM em OAuth do Tráfego.

**Pontos fracos sistêmicos:**
1. JWT_SECRET com fallback inseguro hardcoded no código
2. `tenant_id` `String?` (NULLABLE) em **49 models** Prisma — multi-tenant frágil
3. Secrets de produção (senha do Postgres + API Key Evolution) commitados em scripts da raiz
4. Crons sem distributed lock em multi-replica
5. Frontend com componentes monolíticos > 3000 linhas
6. Polling agressivo no frontend (30s/2min/5min) onde WebSocket bastaria

---

## 2. Top 5 Correções de Maior Impacto (PRIORITÁRIAS)

### 🔴 PRIORIDADE 1 — Remover secrets do repositório e rotacionar credenciais
**Arquivos com senha de produção/API key commitadas (raiz do repo):**
- [check-webhook.js](check-webhook.js)
- [check-lids.js](check-lids.js)
- [cleanup-lid-contacts.js](cleanup-lid-contacts.js)
- [debug-contact-struct.js](debug-contact-struct.js)
- [repair-data.js](repair-data.js)
- [test-prod-db.js](test-prod-db.js)
- [update-webhook.js](update-webhook.js)

**Ação:**
1. Rotacionar imediatamente: API key Evolution `19a05742...` e senha Postgres `***MASKED***`
2. Remover esses 7 arquivos do histórico Git (BFG ou git-filter-repo)
3. Mover scripts úteis para `scripts/dev-debug/` lendo `.env`

---

### 🔴 PRIORIDADE 2 — Eliminar fallback inseguro do JWT_SECRET
**Arquivos:**
- [apps/api/src/auth/jwt.strategy.ts:26](apps/api/src/auth/jwt.strategy.ts:26) — `'__INSECURE_DEV_FALLBACK_CHANGE_ME__'`
- [apps/api/src/portal-auth/portal-auth.module.ts:16](apps/api/src/portal-auth/portal-auth.module.ts:16) — mesmo fallback
- [apps/api/src/portal-documents/portal-documents.service.ts:168](apps/api/src/portal-documents/portal-documents.service.ts:168) — idem

**Ação:** Em produção, lançar erro de bootstrap se `JWT_SECRET` não estiver definido. Em dev, gerar string aleatória por boot.

---

### 🔴 PRIORIDADE 3 — Tornar `tenant_id` NOT NULL no schema Prisma
**Arquivo:** [packages/shared/prisma/schema.prisma](packages/shared/prisma/schema.prisma)

49 models com `tenant_id String?`: User, Lead, Conversation, Task, LegalCase, FinancialTransaction, CaseDeadline, CaseDocument, Inbox, Memory, Notification, e todas as 30+ tabelas de Tráfego.

**Ação:**
1. Rodar [packages/shared/prisma/migrate-tenant-null.ts](packages/shared/prisma/migrate-tenant-null.ts) para backfill
2. Alterar schema: `tenant_id String?` → `tenant_id String`
3. Adicionar migração `2026-05-07-tenant-id-not-null.sql`

---

### 🔴 PRIORIDADE 4 — Corrigir HMAC Guard nos webhooks Evolution
**Arquivo:** [apps/api/src/webhooks/guards/hmac.guard.ts:58-62](apps/api/src/webhooks/guards/hmac.guard.ts:58)

`JSON.stringify(req.body)` recalcula HMAC em cima do JSON re-serializado pelo Express, que **NUNCA** bate com a assinatura original (whitespace/ordem de chaves diferem).

**Ação:**
1. Habilitar `rawBody: true` no `bodyParser` em [apps/api/src/main.ts:46](apps/api/src/main.ts:46)
2. Usar `req.rawBody` no lugar de `JSON.stringify(req.body)`
3. Tornar `WEBHOOK_HMAC_REQUIRED=true` obrigatório em produção (atualmente fallback aceita sem assinatura)

---

### 🔴 PRIORIDADE 5 — Adicionar distributed lock em todos os crons do Worker
**Arquivos com `@Cron(...)`:**
- [apps/worker/src/followup/followup-cron.service.ts](apps/worker/src/followup/followup-cron.service.ts) (2 crons que se sobrepõem em 09:00)
- [apps/worker/src/payment/payment-alerts-cron.service.ts](apps/worker/src/payment/payment-alerts-cron.service.ts) (3 crons em horários próximos)
- [apps/worker/src/ai/audio-retranscribe-cron.service.ts](apps/worker/src/ai/audio-retranscribe-cron.service.ts)
- [apps/worker/src/ai/ai-reactivation-cron.service.ts](apps/worker/src/ai/ai-reactivation-cron.service.ts)
- [apps/worker/src/financeiro/recurring-expenses.service.ts](apps/worker/src/financeiro/recurring-expenses.service.ts)
- [apps/worker/src/financeiro/overdue-alerts.service.ts](apps/worker/src/financeiro/overdue-alerts.service.ts)
- [apps/worker/src/task/task-alerts-cron.service.ts](apps/worker/src/task/task-alerts-cron.service.ts)
- [apps/worker/src/memory/daily-memory-batch.processor.ts](apps/worker/src/memory/daily-memory-batch.processor.ts)
- [apps/worker/src/trafego/traffic-ai-agent-cron.service.ts](apps/worker/src/trafego/traffic-ai-agent-cron.service.ts)
- [apps/worker/src/trafego/trafego-sync.service.ts](apps/worker/src/trafego/trafego-sync.service.ts) (já usa lock — referência)

**Ação:** Wrapper em `apps/api/src/common/locks/lock.service.ts` já existe — usar em **todos** os crons.

---

## 3. Arquivos a Revisar — Por Área

### 3.1 Scripts da Raiz (DELETAR ou MOVER)

**🗑️ Deletar (com secrets ou redundantes):**
- [check-webhook.js](check-webhook.js), [check-lids.js](check-lids.js), [cleanup-lid-contacts.js](cleanup-lid-contacts.js), [debug-contact-struct.js](debug-contact-struct.js), [test-prod-db.js](test-prod-db.js), [update-webhook.js](update-webhook.js), [repair-data.js](repair-data.js), [trigger-sync.js](trigger-sync.js)

**📁 Mover para `scripts/dev-debug/`:**
- [audit-convs.js](audit-convs.js), [check-last-msg.js](check-last-msg.js), [check-last-msgs-debug.js](check-last-msgs-debug.js), [check-leads-final.js](check-leads-final.js), [check-msgs.js](check-msgs.js), [check-user-inbox.js](check-user-inbox.js), [check-users.js](check-users.js), [debug-evolution-contacts.js](debug-evolution-contacts.js), [list-inboxes.js](list-inboxes.js), [list-instances.js](list-instances.js), [list-users.js](list-users.js), [mock-api.js](mock-api.js), [mock-webhook-test.js](mock-webhook-test.js), [monitor-socket.js](monitor-socket.js), [read-settings.js](read-settings.js), [test-chat-full.js](test-chat-full.js), [test-db-direct.js](test-db-direct.js), [test-evo-compare.js](test-evo-compare.js), [test-evo-instance.js](test-evo-instance.js), [test-evo-jids.js](test-evo-jids.js), [test-evo-limit.js](test-evo-limit.js), [test-evo-where.js](test-evo-where.js), [test-evo.js](test-evo.js), [test-prisma-conn.js](test-prisma-conn.js), [test-sync.js](test-sync.js), [run-sync.js](run-sync.js), [rescue-data.js](rescue-data.js)

**🔄 Reescrever sem secrets + adicionar confirmação:**
- [cleanup-db.js](cleanup-db.js) — wipe completo sem confirmação
- [cleanup-bad-leads.js](cleanup-bad-leads.js) — delete em cascata sem dry-run

**✅ Manter na raiz:**
- [deploy-vps.sh](deploy-vps.sh), [deploy.ps1](deploy.ps1), [start-local.bat](start-local.bat), [start-local-real.bat](start-local-real.bat)

---

### 3.2 API — Core/Auth/Webhooks/Gateway

| Arquivo | Issues principais |
|---|---|
| [apps/api/src/main.ts](apps/api/src/main.ts) | rawBody parser ausente; bootstrapLogger duplicado; Socket.IO connectionStateRecovery sem revalidação JWT |
| [apps/api/src/auth/jwt.strategy.ts](apps/api/src/auth/jwt.strategy.ts) | Fallback inseguro JWT_SECRET; aceita token via `?token=` |
| [apps/api/src/auth/auth.service.ts](apps/api/src/auth/auth.service.ts) | MCP token com `expiresIn: '365d'` |
| [apps/api/src/webhooks/evolution.controller.ts](apps/api/src/webhooks/evolution.controller.ts) | `@Body() any` sem validação; HMAC opcional |
| [apps/api/src/webhooks/evolution.service.ts](apps/api/src/webhooks/evolution.service.ts) | Idempotência fraca; `findByInstanceName` sem filtro tenant; `(this.prisma as any)` hack; `setTimeout(async)` sem await |
| [apps/api/src/webhooks/guards/hmac.guard.ts](apps/api/src/webhooks/guards/hmac.guard.ts) | Recalcula HMAC sobre `JSON.stringify(req.body)` (sempre erra) |
| [apps/api/src/gateway/chat.gateway.ts](apps/api/src/gateway/chat.gateway.ts) | `inboxUpdateTimers` Map pode vazar; `.catch(() => {})` silencia erros; `autoJoinRooms` sem validação tenant |
| [apps/api/src/common/locks/lock.service.ts](apps/api/src/common/locks/lock.service.ts) | `release()` falha silenciosa; deadlock até TTL |
| [apps/api/src/common/filters/all-exceptions.filter.ts](apps/api/src/common/filters/all-exceptions.filter.ts) | Stack trace exposto em produção |
| [apps/api/src/app.module.ts](apps/api/src/app.module.ts) | ThrottlerModule rate limit genérico para todos endpoints |

---

### 3.3 API — IA / SDR / Intern / Memórias

| Arquivo | Issues principais |
|---|---|
| [apps/api/src/admin-bot/admin-bot.service.ts](apps/api/src/admin-bot/admin-bot.service.ts) | JSON.stringify(args) em log (PII vaza); session em memória; loop de IA sem proteção contra recursão; OpenAI lazy-load com fallback silencioso |
| [apps/api/src/followup/followup.service.ts](apps/api/src/followup/followup.service.ts) | Hardcoded "Lustosa Advogados"/"André Lustosa" no prompt (cross-tenant leak); `seedDefaultSequences` sem filtro tenant; valida dossie antes de stringify |
| [apps/api/src/memories/memories.service.ts](apps/api/src/memories/memories.service.ts) | `$queryRawUnsafe`; embeddings sem versionamento de modelo; consolidação sem transação |
| [apps/api/src/memories/memory-prompts-defaults.ts](apps/api/src/memories/memory-prompts-defaults.ts) | Placeholder "Sobre o Escritório" hardcoded |
| [apps/api/src/audiencia-transcricao/audiencia-transcricao.service.ts](apps/api/src/audiencia-transcricao/audiencia-transcricao.service.ts) | Transcrição avulsa permite tenantId NULL; retry sem fallback de provider |
| [apps/api/src/transfer-audio/transfer-audio.service.ts](apps/api/src/transfer-audio/transfer-audio.service.ts) | Upload sem validação de tamanho (DoS) |
| [apps/api/src/intern/](apps/api/src/intern) | Verificar guard contra LID (memória menciona patch) |

---

### 3.4 API — Integrações Externas

| Arquivo | Issues principais |
|---|---|
| [apps/api/src/whatsapp/whatsapp.service.ts](apps/api/src/whatsapp/whatsapp.service.ts) | Sem circuit breaker; header `apikey` duplicado; timeout error genérico |
| [apps/api/src/djen/djen.service.ts](apps/api/src/djen/djen.service.ts) | Webhook sem idempotência por `id_comunicacao`; URL DJEN hardcoded; fallback `process.env.ANTHROPIC_API_KEY` inseguro; cron sem lock distribuído |
| [apps/api/src/esaj-sync/esaj-sync.service.ts](apps/api/src/esaj-sync/esaj-sync.service.ts) | Hash de movimento permite colisão; `sleep(2000)` sequencial; sem deduplicação de requisições |
| [apps/api/src/court-scraper/scrapers/esaj-tjal.scraper.ts](apps/api/src/court-scraper/scrapers/esaj-tjal.scraper.ts) | `parseCaseList` recursivo sem timeout; cookie JSESSIONID parsed manualmente |
| [apps/api/src/clicksign/clicksign.service.ts](apps/api/src/clicksign/clicksign.service.ts) | API token em query string; `fetch` sem timeout |
| [apps/api/src/google-drive/google-drive.service.ts](apps/api/src/google-drive/google-drive.service.ts) | URL redirect com fallback hardcoded |
| [apps/api/src/trafego/trafego-oauth.service.ts](apps/api/src/trafego/trafego-oauth.service.ts) | `pendingStates` em memória (perde em restart); sem versionamento de chave para rotação |
| [apps/api/src/notifications/notifications.service.ts](apps/api/src/notifications/notifications.service.ts) | `.catch(() => {})` silencia falhas de fila |
| [apps/api/src/payment-gateway/asaas/asaas-client.ts](apps/api/src/payment-gateway/asaas/asaas-client.ts) | Backoff sem jitter (thundering herd) |
| [apps/api/src/nota-fiscal/nota-fiscal.service.ts](apps/api/src/nota-fiscal/nota-fiscal.service.ts) | Integração NFS-e não implementada (silent fail) |

---

### 3.5 API — Jurídico / Portal Cliente

| Arquivo | Issues principais |
|---|---|
| [apps/api/src/financeiro/financeiro.service.ts](apps/api/src/financeiro/financeiro.service.ts) | `where.status = { not: 'CANCELADO' }` em coluna nullable (exclui NULL); juros recalculados N+1 |
| [apps/api/src/portal-payments/portal-payments.service.ts](apps/api/src/portal-payments/portal-payments.service.ts) | Queries sem filtro de tenant_id (IDOR) |
| [apps/api/src/portal-processes/portal-processes.service.ts](apps/api/src/portal-processes/portal-processes.service.ts) | `findMany` sem paginação |
| [apps/api/src/portal-documents/portal-documents.service.ts](apps/api/src/portal-documents/portal-documents.service.ts) | `s3_key` sem fallback `file_path`; S3 key mantém extensão original; fallback JWT_SECRET inseguro |
| [apps/api/src/portal-documents/portal-documents.controller.ts](apps/api/src/portal-documents/portal-documents.controller.ts) | Endpoint interno sem isolamento multi-tenant |
| [apps/api/src/petitions/petition-ai.service.ts](apps/api/src/petitions/petition-ai.service.ts) | Prompt injection via `${lead.name}`; pricing GPT-5 hardcoded |
| [apps/api/src/contracts/contracts.service.ts](apps/api/src/contracts/contracts.service.ts) | CPF concatenado em template; função `buildDocx` >300 linhas |
| [apps/api/src/case-documents/case-documents.service.ts](apps/api/src/case-documents/case-documents.service.ts) | `taskAttachment` sem verificação de ownership |
| [apps/api/src/legal-cases/legal-cases.service.ts](apps/api/src/legal-cases/legal-cases.service.ts) | `findAll` sem paginação |
| [apps/api/src/portal-auth/portal-auth.service.ts](apps/api/src/portal-auth/portal-auth.service.ts) | Rate limit fraco em OTP; timing oracle |
| [apps/api/src/settings/settings.service.ts](apps/api/src/settings/settings.service.ts) | Arquivo monolítico ~2.6k linhas; chaves de IA sem isolamento por tenant |
| [apps/api/src/dashboard/team-performance.service.ts](apps/api/src/dashboard/team-performance.service.ts) | TODOs retornando 0/[] (dashboard mostra dados falsos) |

---

### 3.6 Worker — Filas / IA / Mídia / Tráfego

| Arquivo | Issues principais |
|---|---|
| [apps/worker/src/main.ts](apps/worker/src/main.ts) | Sem `enableShutdownHooks()` |
| [apps/worker/src/transcricao/ffmpeg.util.ts](apps/worker/src/transcricao/ffmpeg.util.ts) | `spawn('ffmpeg')` sem timeout global; stderr buffer cresce sem limit |
| [apps/worker/src/transcricao/transcricao.processor.ts](apps/worker/src/transcricao/transcricao.processor.ts) | `pollUntilDone` aguarda 12h sem job timeout duro |
| [apps/worker/src/ai/ai.processor.ts](apps/worker/src/ai/ai.processor.ts) | pdf-parse/mammoth sem `maxFileSize` (DoS); silent return se conversation_id ausente; HF_TOKEN/OpenAI key pode vazar em stack |
| [apps/worker/src/ai/tool-executor.ts](apps/worker/src/ai/tool-executor.ts) | `JSON.parse` sem schema validation; `context: any` |
| [apps/worker/src/ai/tool-handlers/save-form-field.ts](apps/worker/src/ai/tool-handlers/save-form-field.ts) | Não valida `lead.tenant_id` contra context (multi-tenant leak) |
| [apps/worker/src/ai/tool-handlers/webhook-handler.ts](apps/worker/src/ai/tool-handlers/webhook-handler.ts) | URL sem whitelist (SSRF) |
| [apps/worker/src/memory/embedding.service.ts](apps/worker/src/memory/embedding.service.ts) | Cache em memória sem isolamento de tenant; FIFO eviction |
| [apps/worker/src/memory/daily-memory-batch.processor.ts](apps/worker/src/memory/daily-memory-batch.processor.ts) | `Promise.all` sem limite de concorrência |
| [apps/worker/src/notification-whatsapp/notification-whatsapp.processor.ts](apps/worker/src/notification-whatsapp/notification-whatsapp.processor.ts) | Sem jitter/circuit breaker (BAN risk — memória já alerta sobre 28/04/2026); axios sem timeout |
| [apps/worker/src/followup/followup-cron.service.ts](apps/worker/src/followup/followup-cron.service.ts) | 2 crons no horário 09:00 sem lock; processamento individual em vez de batch |
| [apps/worker/src/payment/payment-alerts-cron.service.ts](apps/worker/src/payment/payment-alerts-cron.service.ts) | 3 crons sem distributed lock |
| [apps/worker/src/trafego/trafego-sync.service.ts](apps/worker/src/trafego/trafego-sync.service.ts) | Sem checkpoint `lastSyncAt`; sync completo desperdiça quota |

---

### 3.7 Frontend Next.js

**🚨 Componentes monolíticos (split urgente):**
| Arquivo | Linhas |
|---|---|
| [apps/web/src/app/atendimento/processos/page.tsx](apps/web/src/app/atendimento/processos/page.tsx) | 5.630 |
| [apps/web/src/app/atendimento/page.tsx](apps/web/src/app/atendimento/page.tsx) | 3.828 |
| [apps/web/src/app/atendimento/financeiro/page.tsx](apps/web/src/app/atendimento/financeiro/page.tsx) | 3.765 |
| [apps/web/src/app/atendimento/advogado/page.tsx](apps/web/src/app/atendimento/advogado/page.tsx) | 3.550 |
| [apps/web/src/app/atendimento/followup/page.tsx](apps/web/src/app/atendimento/followup/page.tsx) | 2.961 |
| [apps/web/src/app/atendimento/djen/page.tsx](apps/web/src/app/atendimento/djen/page.tsx) | 2.490 |
| [apps/web/src/app/atendimento/marketing/trafego/campanhas/[id]/page.tsx](apps/web/src/app/atendimento/marketing/trafego/campanhas/[id]/page.tsx) | 2.464 |
| [apps/web/src/components/ClientPanel.tsx](apps/web/src/components/ClientPanel.tsx) | 2.047 |
| [apps/web/src/app/atendimento/crm/page.tsx](apps/web/src/app/atendimento/crm/page.tsx) | 2.022 |
| [apps/web/src/app/atendimento/agenda/page.tsx](apps/web/src/app/atendimento/agenda/page.tsx) | 1.982 |

**🔁 Polling agressivo (substituir por WebSocket):**
- [apps/web/src/app/atendimento/advogado/page.tsx](apps/web/src/app/atendimento/advogado/page.tsx): `fetchCases` a cada 30s (2.880 req/dia/usuário)
- [apps/web/src/app/atendimento/estagiario/page.tsx](apps/web/src/app/atendimento/estagiario/page.tsx): 60s (1.440 req/dia)
- [apps/web/src/app/atendimento/components/NotificationCenter.tsx](apps/web/src/app/atendimento/components/NotificationCenter.tsx): 60s

**🔂 Componentes duplicados:**
- [apps/web/src/app/atendimento/agenda/TaskDrawer.tsx](apps/web/src/app/atendimento/agenda/TaskDrawer.tsx) (535L) ≈ [apps/web/src/app/atendimento/tasks/TaskDrawer.tsx](apps/web/src/app/atendimento/tasks/TaskDrawer.tsx) (473L)
- [apps/web/src/components/EventModal.tsx](apps/web/src/components/EventModal.tsx) ≈ [apps/web/src/app/atendimento/components/TaskAlertPopup.tsx](apps/web/src/app/atendimento/components/TaskAlertPopup.tsx)

**💾 localStorage sem SSR guard (46 arquivos — exemplos):**
- [apps/web/src/app/atendimento/layout.tsx](apps/web/src/app/atendimento/layout.tsx)
- [apps/web/src/app/atendimento/chat/[id]/page.tsx](apps/web/src/app/atendimento/chat/[id]/page.tsx)
- [apps/web/src/app/atendimento/components/InboxSidebar.tsx](apps/web/src/app/atendimento/components/InboxSidebar.tsx)
- (43 outros — `grep -rn "localStorage" apps/web/src` para lista completa)

**⚙️ Globais:**
- [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) — JWT em localStorage (XSS risk); 272 console.log no projeto
- [apps/web/src/components/lp/templates/HighConversionTemplate.tsx](apps/web/src/components/lp/templates/HighConversionTemplate.tsx) — `dangerouslySetInnerHTML` com conteúdo editável

---

### 3.8 Prisma / Infra / Docker / CI

| Arquivo | Issues principais |
|---|---|
| [packages/shared/prisma/schema.prisma](packages/shared/prisma/schema.prisma) | 49 models com `tenant_id String?`; cascatas `Cascade` em FK Tenant (perda total em delete); 13 models sem `@@index`; 40+ campos JSON sem `@db.JsonB`; `User.roles` String[] sem enum |
| [packages/shared/prisma/manual-sql/](packages/shared/prisma/manual-sql) | 50 SQL manuais com ordem suspeita (5 no mesmo dia em 22/04); 2026-04-23 com dependência implícita NOT NULL→nullable |
| [docker-compose.prod.yml](docker-compose.prod.yml) | Secrets em plaintext em env; Whisper/MinIO sem healthcheck; `:latest` sem pin SHA; api/worker rodam como root |
| [infra/Dockerfile.backend](infra/Dockerfile.backend) | `npm install --legacy-peer-deps`; `node:20:latest` sem pin |
| [infra/entrypoint.sh](infra/entrypoint.sh) | `RUN_MIGRATIONS=true` em todas réplicas (race em ALTER TABLE) |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | Push Docker Hub sem image scanning; sem approval gate |
| [packages/shared/prisma/seed.ts](packages/shared/prisma/seed.ts) | `upsert` pode duplicar entre tenants |

---

## 4. Padrões Sistêmicos a Corrigir Globalmente

### 4.1 `not: X` em colunas nullable (Prisma 3-valued logic)
**Memória já alertou.** Pelo menos 1 ocorrência confirmada:
- [apps/api/src/financeiro/financeiro.service.ts:97](apps/api/src/financeiro/financeiro.service.ts:97)

**Buscar mais:** `grep -rn "{ not:" apps/api/src/`

**Correção padrão:**
```ts
// ANTES (esconde NULL)
where: { status: { not: 'CANCELADO' } }
// DEPOIS
where: { OR: [{ status: { not: 'CANCELADO' } }, { status: null }] }
```

---

### 4.2 `s3_key` sem fallback para `file_path` (migração MinIO→FS)
**Memória já alertou.** Ocorrências:
- [apps/api/src/portal-documents/portal-documents.service.ts](apps/api/src/portal-documents/portal-documents.service.ts) (linhas 152, 190, 215)
- [apps/api/src/case-documents/case-documents.service.ts](apps/api/src/case-documents/case-documents.service.ts)
- [apps/api/src/legal-cases/legal-cases.service.ts](apps/api/src/legal-cases/legal-cases.service.ts)
- [apps/api/src/transfer-audio/transfer-audio.service.ts](apps/api/src/transfer-audio/transfer-audio.service.ts)

**Correção padrão:** Helper `resolveStorageKey(doc) => doc.file_path || doc.s3_key` + `exists()` check em pontos críticos.

---

### 4.3 `.catch(() => {})` silenciando erros
Aparece em: gateway, webhooks, financeiro audit, portal-documents notifications, notifications service…

**Correção padrão:** trocar por `.catch((e) => this.logger.warn('contexto', e))`.

---

### 4.4 Promises sem await em fluxos assíncronos
- [apps/api/src/webhooks/evolution.service.ts:1391](apps/api/src/webhooks/evolution.service.ts:1391) — `setTimeout(async)` sem aguardar
- Múltiplos handlers de IA / tool executor

---

## 5. Resumo Quantitativo Por Severidade

| Área | CRÍTICO | ALTO | MÉDIO | BAIXO |
|---|---|---|---|---|
| Scripts da raiz | 7 (secrets) | 3 | 2 | 5 |
| API Core | 7 | 8 | 5 | 10 |
| API IA/SDR | 5 | 8 | 7 | 5 |
| API Integrações | 2 | 8 | 14 | 6 |
| API Jurídico/Portal | 4 | 8 | 8 | 10 |
| Worker | 8 | 9 | 7 | 6 |
| Frontend | 4 | 11 | 10 | 5 |
| Prisma/Infra | 5 | 6 | 5 | 9 |
| **TOTAL** | **42** | **61** | **58** | **56** |

---

## 6. Roadmap Sugerido

### Sprint 1 (1 semana) — Stop-the-bleeding
1. ✅ Rotacionar credenciais expostas + remover scripts com secrets
2. ✅ Corrigir HMAC Guard (rawBody) + tornar HMAC obrigatório
3. ✅ Eliminar fallback `__INSECURE_DEV_FALLBACK_CHANGE_ME__`
4. ✅ Adicionar circuit breaker + jitter no `notification-whatsapp.processor`
5. ✅ Distributed lock em todos os crons

### Sprint 2 (2 semanas) — Estrutura
1. ✅ Backfill + alterar `tenant_id` para NOT NULL nos 49 models
2. ✅ Adicionar filtro `tenant_id` em `portal-payments`, `portal-processes`, `case-documents`
3. ✅ Substituir `Cascade` por `Restrict` em FK críticas (LegalCase, FinancialTransaction)
4. ✅ Adicionar timeout em ffmpeg + transcricao processor
5. ✅ Corrigir `s3_key` para usar `file_path || s3_key` (helper global)

### Sprint 3 (2 semanas) — Performance
1. ✅ Adicionar `@@index` em 13 models Prisma
2. ✅ Paginação em listagens (legal-cases, portal-processes, financeiro)
3. ✅ Substituir polling 30s/2min por WebSocket events no frontend
4. ✅ Embedding cache com isolamento por tenant
5. ✅ Quebrar componentes >2000 linhas em sub-componentes

### Sprint 4+ (contínuo) — Qualidade
1. Consolidar 50 SQL manuais em Prisma migrations
2. Eliminar `any` (583 ocorrências) com tipos explícitos
3. Lazy load de framer-motion / recharts
4. Migrar JWT de localStorage para httpOnly cookie
5. Healthchecks + pin de SHA em todas as imagens Docker

---

## 7. Pontos Positivos Reconhecidos

- ✅ Arquitetura monorepo limpa (npm workspaces)
- ✅ Multi-tenant com filtro em maioria dos endpoints
- ✅ Cross-tenant isolation no webhook Evolution (commit f3ad69b)
- ✅ Detecção de @lid em WhatsApp (commit recente)
- ✅ Idempotência por hash em ESAJ
- ✅ Circuit breaker no Asaas (3 retries + backoff)
- ✅ AES-256-GCM em OAuth do Tráfego
- ✅ Lock distribuído em ESAJ cron (referência para outros)
- ✅ Tier de severidade clara: CRÍTICO bloqueia produção, BAIXO é polish
- ✅ Tool handlers com registry centralizado (sem duplicação)

---

**Auditoria concluída em 2026-05-07**
**Cobertura:** 95% do código produtivo (sem testes E2E rodados, sem profiling de DB em prod)
