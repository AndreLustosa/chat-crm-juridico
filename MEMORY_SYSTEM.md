# Sistema de Memória Inteligente

Documento técnico do sistema de memória de longo prazo da IA do CRM jurídico. Cobre arquitetura, operação, troubleshooting e gotchas.

**Última atualização:** 2026-04-18 (deploy inicial em produção)

---

## 1. Visão geral

A IA precisa lembrar duas coisas entre conversas:

- **Quem é cada cliente** — nome, caso, documentos enviados, preferências, histórico.
- **Como o escritório funciona** — endereço, honorários, equipe, regras que valem para qualquer atendimento.

Todo dia à meia-noite (`America/Maceio`), um cron analisa as conversas do dia e extrai fatos relevantes em duas categorias:

| Escopo         | Vai para                                       | Exemplo                                    |
| -------------- | ---------------------------------------------- | ------------------------------------------ |
| `lead`         | `Memory` (scope=lead) + `LeadProfile` resumido | "João é trabalhista, demitido em 03/2026" |
| `organization` | `Memory` (scope=organization)                  | "Escritório em Arapiraca, Rua X"          |

Na próxima conversa, a IA recebe automaticamente:

1. **Memórias do escritório** (`{{office_memories}}`) — agrupadas por categoria
2. **Perfil consolidado do cliente** (`{{lead_profile}}`) — texto corrido natural
3. **Últimas 5 interações** (`{{recent_episodes}}`)

Além disso, a IA tem a tool `search_memory` para buscar sob demanda em memórias e mensagens antigas quando o cliente faz referência a algo fora do contexto atual.

---

## 2. Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                      Fluxo diário (00h)                         │
│                                                                 │
│  DailyMemoryBatchProcessor                                      │
│    ↓ pega todas conversas com msg nas últimas 24h               │
│    ↓ agrupa em lotes de 30 msgs                                 │
│    ↓ chama GPT-4.1 com BATCH_EXTRACTION_PROMPT                  │
│    ↓ LLM retorna memories[] + superseded[]                      │
│    ↓ EmbeddingService gera vetor 1536d (text-embedding-3-small) │
│    ↓ MemoryRetrievalService.findDuplicate (cosine > 0.90)       │
│    ↓ INSERT em Memory (via $executeRawUnsafe por causa do vector)│
│                                                                 │
│  ProfileConsolidationProcessor (delay 5s)                       │
│    ↓ para cada lead que ganhou memoria no dia                   │
│    ↓ GPT-4.1 gera summary (~300 palavras) + facts JSON          │
│    ↓ upsert em LeadProfile                                      │
│    ↓ dedup de memorias proximas (cosine > 0.95)                 │
│                                                                 │
│  MemoryDedupService (03h)                                       │
│    ↓ memorias organizacionais com cosine > 0.93 → superseded    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  Fluxo de resposta da IA                        │
│                                                                 │
│  ai.processor recebe msg do cliente                             │
│    ↓                                                            │
│  Carrega em paralelo:                                           │
│    - Memory.findMany(scope=organization)                        │
│    - LeadProfile.findUnique(lead_id)                            │
│    - Memory.findMany(scope=lead, type=episodic, take=5)         │
│    ↓                                                            │
│  PromptBuilder monta vars + memoryBlock                         │
│    ↓                                                            │
│  vars.office_memories, vars.lead_profile, vars.recent_episodes, │
│  vars.memory_block → substituem {{...}} no system prompt        │
│    ↓                                                            │
│  Skill que NÃO usar {{...}} recebe memoryBlock no final (auto)  │
│    ↓                                                            │
│  Tool search_memory disponível para busca sob demanda           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Modelos de dados

### `Memory` — unidade atômica de fato

```prisma
model Memory {
  id            String    @id @default(uuid())
  tenant_id     String
  scope         String    // "lead" | "organization"
  scope_id      String    // lead.id ou tenant.id
  type          String    // "semantic" | "episodic" | "procedural"
  subcategory   String?   // só para scope=organization
  content       String    @db.Text
  embedding     Unsupported("vector(1536)")?  // pgvector
  source_type   String    // "batch" | "manual" | "system" | "retroactive"
  source_id     String?   // conversation_id quando batch
  confidence    Float     @default(1.0)
  status        String    @default("active")  // active | superseded | archived
  superseded_by String?
  access_count  Int       @default(0)
  last_accessed DateTime?
  expires_at    DateTime?
  // + created_at, updated_at
}
```

**Subcategorias válidas (scope=organization):**

| Subcategory       | Exemplos                                       |
| ----------------- | ---------------------------------------------- |
| `office_info`     | endereço, telefone, horário                    |
| `team`            | advogados e especialidades                     |
| `fees`            | honorários e formas de pagamento               |
| `procedures`      | documentos exigidos, fluxo de atendimento      |
| `court_info`      | endereços de fóruns, tendências de juízes      |
| `legal_knowledge` | prazos típicos, jurisprudência local           |
| `contacts`        | peritos, parceiros                             |
| `rules`           | o que aceita/não aceita (ex: "não pega TRF2")  |

### `LeadProfile` — resumo consolidado do cliente

```prisma
model LeadProfile {
  id            String    @id @default(uuid())
  tenant_id     String
  lead_id       String    @unique
  summary       String    @db.Text   // ~300 palavras, texto corrido
  facts         Json      @default("{}")   // name, cases[], preferences, pending, sentiment...
  generated_at  DateTime  @default(now())
  message_count Int       @default(0)
  version       Int       @default(1)
}
```

`facts` tem estrutura:

```ts
{
  name, phone, email, cpf, is_client, occupation, address,
  cases: [{ number, type, status, role, summary }],
  preferences: { channel, time, tone, language_level },
  key_dates: [{ date, description }],
  pending: [...],
  sentiment: "satisfeito|neutro|ansioso|insatisfeito",
  risk_flags: [...]
}
```

---

## 4. Variáveis template para skills

Skill writers podem usar nas skills (`system_prompt`):

| Variável                 | Conteúdo                                      |
| ------------------------ | --------------------------------------------- |
| `{{office_memories}}`    | Memórias organizacionais agrupadas por cat.   |
| `{{lead_profile}}`       | Perfil consolidado (LeadProfile.summary)      |
| `{{recent_episodes}}`    | Últimos 5 episódios do lead (bullets)         |
| `{{memory_block}}`       | As 3 acima concatenadas com cabeçalhos        |
| `{{lead_memory}}` (legacy) | Memória antiga via AiMemory/case_state       |

**Regra do auto-anexo:** se a skill **não** referenciar nenhuma variável nova, o bloco completo é anexado no final do prompt automaticamente (retrocompat). Se a skill usar qualquer `{{...}}` nova, só aparece onde ela colocou.

---

## 5. Operação

### 5.1 Para o admin (CRM)

Tela `/atendimento/settings/knowledge`:

- **Ativar/desativar** extração automática (toggle)
- **Rodar agora** — dispara extração sem esperar meia-noite
- **CRUD manual** de memórias por categoria
- Ver última extração e total de memórias

No painel do lead (`ClientPanel`), seção "Memórias da IA":

- Ver perfil consolidado
- Regenerar perfil sob demanda
- Adicionar memória manual (fato ou episódio)
- Limpar todas as memórias do lead (LGPD)

### 5.2 Para desenvolvedores

**Endpoints:**

```
GET    /memories/organization             — lista agrupada
GET    /memories/organization/stats       — total, por categoria, última extração
POST   /memories/organization             — adicionar manual (ADMIN, ADVOGADO)
PUT    /memories/:id                      — editar
DELETE /memories/:id                      — remover
POST   /memories/extract-now              — forçar extração (ADMIN)

GET    /memories/lead/:leadId             — memórias do lead
GET    /memories/lead/:leadId/profile     — LeadProfile
POST   /memories/lead/:leadId             — adicionar manual
POST   /memories/lead/:leadId/regenerate  — reconsolidar perfil
DELETE /memories/lead/:leadId/all         — LGPD
```

**Tool disponível para a IA:**

```json
{
  "name": "search_memory",
  "parameters": { "query": "string" }
}
```

Retorna:
- `lead_memories[]` — memórias semânticas do lead (similaridade)
- `office_memories[]` — memórias organizacionais (similaridade)
- `messages[]` — mensagens históricas fulltext

Usar quando o cliente faz referência a algo não presente no contexto ("lembra do documento que mandei?").

### 5.3 Para DevOps

**Variáveis de ambiente relevantes:**

- `OPENAI_API_KEY` — necessário no worker container (o script retroativo lê direto do env, não da GlobalSetting encriptada)

**GlobalSettings (banco):**

| Key                         | Default                    | Efeito                                  |
| --------------------------- | -------------------------- | --------------------------------------- |
| `MEMORY_BATCH_ENABLED`      | `true`                     | Liga/desliga cron noturno + dedup cron  |
| `MEMORY_BATCH_HOUR`         | `00:00`                    | Informativo (cron está hardcoded em 00) |
| `MEMORY_EMBEDDING_MODEL`    | `text-embedding-3-small`   | Reservado para uso futuro               |
| `MEMORY_EXTRACTION_MODEL`   | `gpt-4.1`                  | Modelo usado pelo extrator + consolidador |

**Filas BullMQ:** `memory-jobs`

- `daily-batch-extract` — 1 job por tenant por dia
- `consolidate-profiles-after-batch` — 1 job por tenant, delay 5s após batch
- `consolidate-profile` — sob demanda (botão Regenerar)
- `manual-extract` — sob demanda (botão Rodar agora)

---

## 6. Setup em ambiente novo

**Ordem obrigatória** (pgvector precisa existir antes do Prisma):

```bash
# 1) Postgres com imagem que suporte pgvector
#    Usar: pgvector/pgvector:pg15 (ou pg16, pg17 conforme versão)
#    NÃO usar: postgres:15-alpine (não tem a extensão)

# 2) Habilitar extensão + criar coluna vector + índices + defaults
psql "$DATABASE_URL" -f packages/shared/prisma/manual-sql/2026-04-18-memory-system.sql

# 3) Só depois: sync do schema Prisma (cria tabelas Memory + LeadProfile)
pnpm --filter @crm/shared db:push

# 4) (Opcional, one-shot) Popular memória organizacional do histórico
docker exec -it <worker> npx ts-node /app/apps/worker/src/memory/retroactive-extraction.ts <TENANT_ID>
```

---

## 7. Troubleshooting

### "extension vector is not available"

Imagem do Postgres não tem pgvector. Trocar para `pgvector/pgvector:pg15` e recrear container (volume persiste). Backup antes:

```bash
docker exec <pg> pg_dump -U <user> -d <db> | gzip > backup.sql.gz
```

### Coluna `embedding` sumiu após restart

Você está rodando `prisma db push` com schema **sem** a declaração `Unsupported("vector(1536)")`. Atualizar `packages/shared/prisma/schema.prisma` e fazer deploy. A declaração impede o db push de remover a coluna.

### Login Postgres falha com `SASL authentication failed`

Troca de imagem `postgres:*-alpine` → `pgvector/pgvector:*` muda o hash de `md5` para `scram-sha-256`. Recriar a senha:

```sql
ALTER USER crm_user WITH PASSWORD '<mesma_senha>';
```

E atualizar o `pg_hba.conf` se necessário para aceitar `scram-sha-256`.

### IA não está usando as memórias

Checklist:

1. `Memory.embedding IS NOT NULL` — se todas NULL, embedding não está sendo gerado (OPENAI_API_KEY? rate limit?)
2. `LeadProfile` existe para o lead? Se não, aguardar extração noturna ou clicar "Regenerar"
3. No log do worker, procurar `[AI] memoryBlock: org=X profile=Y episodes=Z chars=W` — se `chars=0`, busca retornou vazio
4. Skill usa `{{lead_profile}}` etc.? Se sim, só aparece onde está a variável; se não, deve aparecer no final automaticamente

### Cron das 00h não rodou

```bash
# Verificar se o worker está ativo e se o cron está habilitado
docker logs <worker> 2>&1 | grep "scheduleDailyExtraction\|MemoryBatch"

# Verificar flag
psql "$DATABASE_URL" -c "SELECT value FROM \"GlobalSetting\" WHERE key='MEMORY_BATCH_ENABLED';"

# Forçar manualmente para um tenant (via API, ADMIN)
curl -X POST -H "Authorization: Bearer $TOKEN" $API_URL/memories/extract-now
```

### Memórias duplicadas aparecendo

1. Dedup só roda às 03h — esperar
2. Se persistir, threshold cosine está em `0.90` para batch, `0.93` para dedup org, `0.95` para dedup lead. Pode ajustar nos services se ficar muito permissivo
3. Rodar manualmente:

```sql
-- Dedup manual (cuidado, destrói duplicatas)
UPDATE "Memory" a SET status = 'superseded', superseded_by = b.id
FROM "Memory" b
WHERE a.id < b.id
  AND a.tenant_id = b.tenant_id
  AND a.scope = b.scope AND a.scope_id = b.scope_id
  AND a.status = 'active' AND b.status = 'active'
  AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
  AND 1 - (a.embedding <=> b.embedding) > 0.93;
```

---

## 8. Custos (estimativa)

| Componente              | Modelo                 | Custo/dia (100 interações) |
| ----------------------- | ---------------------- | --------------------------- |
| Extração batch          | GPT-4.1                | ~$0.05                      |
| Consolidação perfis     | GPT-4.1                | ~$0.04                      |
| Embeddings              | text-embedding-3-small | ~$0.0004                    |
| Busca vetorial (HNSW)   | pgvector (local)       | $0                          |
| **Total estimado**      |                        | **~$0.09/dia (~R$ 14/mês)** |

Extração retroativa (one-shot, até 500 mensagens): ~$0.50 a $2 por tenant.

---

## 9. Gotchas importantes

### 9.1 Tipos Prisma vs Postgres

`String @id @default(uuid())` no Prisma gera coluna **TEXT** com UUID como string, **não tipo UUID nativo**. Qualquer FK para essas tabelas deve usar `TEXT`, não `UUID`.

### 9.2 Embedding só via raw SQL

Prisma Client não lê/escreve `Unsupported`. Todo INSERT/UPDATE de `embedding` usa `$executeRawUnsafe(..., vector::vector)`. Todo SELECT que envolve similaridade usa `$queryRawUnsafe` com operador `<=>`.

### 9.3 Ordem de setup importa

Se rodar `prisma db push` **antes** de `CREATE EXTENSION vector`, Prisma vai falhar com "type vector does not exist". Sempre SQL manual primeiro.

### 9.4 Multi-tenancy obrigatório

Toda query em Memory/LeadProfile **precisa** filtrar por `tenant_id`. Sem exceção. No ai.processor, quando `tenant_id` vem vazio ou é UUID dummy, o sistema de memória é pulado (graceful degradation).

### 9.5 Graceful degradation

Se a busca de memórias falhar, a IA continua respondendo sem elas. Memória nunca deve bloquear atendimento. O try/catch ao redor da montagem do `memoryBlock` garante isso.

### 9.6 Migração do sistema antigo

O sistema antigo (`AiMemory` + `case_state`) continua funcionando em paralelo. Plano de migração:

- Fase 1 (agora): ambos coexistem. `{{lead_memory}}` usa antigo, `{{lead_profile}}` usa novo.
- Fase 2 (+2 semanas): confirmar que LeadProfile está populado para leads ativos.
- Fase 3 (+1 mês): desativar update-memory legado. `AiMemory` vira backup somente-leitura por 3 meses.
- Fase 4: deletar `AiMemory` do schema.

---

## 10. Arquivos relevantes

**Backend (worker):**
- `apps/worker/src/memory/embedding.service.ts`
- `apps/worker/src/memory/memory-retrieval.service.ts`
- `apps/worker/src/memory/daily-memory-batch.processor.ts`
- `apps/worker/src/memory/profile-consolidation.processor.ts`
- `apps/worker/src/memory/memory-dedup.service.ts`
- `apps/worker/src/memory/memory-prompts.ts`
- `apps/worker/src/memory/retroactive-extraction.ts`
- `apps/worker/src/memory/memory.module.ts`
- `apps/worker/src/ai/prompt-builder.ts` (buildMemoryLayers, regra do auto-anexo)
- `apps/worker/src/ai/ai.processor.ts` (carrega + injeta memórias)
- `apps/worker/src/ai/tool-handlers/search-memory.ts`

**Backend (API):**
- `apps/api/src/memories/memories.service.ts`
- `apps/api/src/memories/memories.controller.ts`
- `apps/api/src/memories/memories.module.ts`

**Frontend:**
- `apps/web/src/app/atendimento/settings/knowledge/page.tsx` — Base de Conhecimento
- `apps/web/src/components/LeadMemoryPanel.tsx` — Painel do lead
- `apps/web/src/app/atendimento/settings/ai/page.tsx` — pills das variáveis no editor de skill

**Schema + migration:**
- `packages/shared/prisma/schema.prisma` (Memory, LeadProfile)
- `packages/shared/prisma/manual-sql/2026-04-18-memory-system.sql`
