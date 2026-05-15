# Conectar o `traffic-mcp-server` ao Claude Cowork

Este guia parte do ambiente atual: o `traffic-mcp-server` já está deployado em `https://andrelustosaadvogados.com.br/traffic-mcp/mcp` e funciona com o ChatGPT. Adicionar o Cowork é só configurar mais um cliente OAuth.

## Pré-requisitos

- Cowork da Anthropic ativo na sua conta (workspace).
- Token MCP gerado no CRM (`Configurações > Integração MCP`).
- Permissão de admin no Cowork pra adicionar Custom Connector.

## Passos

### 1. Confirmar que o servidor aceita o redirect do Cowork

Por padrão, o servidor já aceita os prefixes:

- `https://chatgpt.com/connector/oauth/`
- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`
- `https://cowork.anthropic.com/api/mcp/auth_callback`

Se o redirect do Cowork no seu workspace for diferente, adicione via env:

```env
MCP_OAUTH_REDIRECT_PREFIXES=https://chatgpt.com/connector/oauth/,https://claude.ai/api/mcp/auth_callback,https://cowork.anthropic.com/api/mcp/auth_callback,https://seu-redirect-customizado/
```

(CSV — vírgula separa, sem espaços.)

Reiniciar o container `traffic-mcp-server` após a mudança.

### 2. Gerar o token MCP no CRM

1. Logar no CRM como admin.
2. Ir em **Configurações > Integração MCP**.
3. Clicar em **Gerar novo token**.
4. Copiar o token (formato opaco).

> O mesmo token funciona para ChatGPT, Claude.ai e Cowork — não precisa gerar separadamente.

### 3. Registrar o Custom Connector no Cowork

No Cowork, criar Custom Connector com:

| Campo | Valor |
|---|---|
| **MCP server URL** | `https://andrelustosaadvogados.com.br/traffic-mcp/mcp` |
| **Authentication** | OAuth |
| **Client registration** | "User-defined OAuth client" (ou equivalente — Anthropic pode chamar de "Manual") |
| **Client ID** | `traffic-chatgpt` (mesmo ID que o ChatGPT — é o `MCP_OAUTH_STATIC_CLIENT_ID` configurado no servidor) |
| **Client Secret** | cole o token gerado no passo 2 |
| **Token endpoint auth method** | `client_secret_post` |
| **Authorization URL** | `https://andrelustosaadvogados.com.br/traffic-mcp/oauth/authorize` |
| **Token URL** | `https://andrelustosaadvogados.com.br/traffic-mcp/oauth/token` |
| **Registration URL** | (deixar vazio) |
| **Resource** | `https://andrelustosaadvogados.com.br/traffic-mcp/mcp` |
| **Scopes** | `mcp:tools` |

### 4. Confirmar a conexão

No Cowork, ao adicionar o connector:

1. O Cowork redireciona o admin para a página de autorização (`/oauth/authorize`).
2. A página mostra "Autorizar Gestor de Tráfego" com campo de token MCP.
3. Cole o mesmo token do passo 2 e confirme.
4. O fluxo retorna ao Cowork com `code → access_token`.
5. Cowork lista as 29 tools disponíveis.

### 5. Validar com uma tool de leitura

No Claude (via Cowork), tente:

> Liste as campanhas ativas usando o connector de Tráfego.

Resposta esperada: tabela markdown com as campanhas + JSON estruturado em background.

## Diagnóstico

### "redirect_uri nao registrado"

O prefix do Cowork não está na lista aceita. Veja `MCP_OAUTH_REDIRECT_PREFIXES` ou os defaults na seção 1.

### "Token MCP invalido" na página de autorização

- O token expirou — gere outro no CRM.
- O `MCP_AUTH_TOKEN` (segredo interno) e o `TRAFFIC_MCP_AUTH_TOKEN` no Portainer não casam — confira.

### Tools listam mas falham com `auth`

O CRM rejeitou o token Bearer. Verifique se `CRM_API_KEY` no env do `traffic-mcp-server` é um token MCP válido com permissão de chamar `/trafego/*`.

### "Limite de mutates/hora atingido"

O guard-rail está agindo. Configurações:

- `MCP_MUTATE_RATE_LIMIT_PER_HOUR` (default 60) — mutates por janela rolante de 1h.

### Quero desligar tudo de mutate (parar o Claude)

Setar `MCP_KILL_SWITCH=true` no Portainer e reiniciar o container. Read continua funcionando.

## Rotação de credenciais

| Credencial | Onde | Como rotacionar |
|---|---|---|
| Token MCP do usuário (Cowork client_secret) | CRM > Integração MCP | Gerar novo, atualizar no Cowork, revogar o antigo |
| `MCP_AUTH_TOKEN` (segredo administrativo) | Portainer | Trocar env, reiniciar container |
| `TRAFEGO_ENCRYPTION_KEY` | Portainer | **NÃO ROTACIONAR sem ler `feedback_minio_fs_migration_residue.md`** — invalidaria refresh tokens criptografados |
| OAuth Google Ads (developer token, client secret) | CRM > Configurações > Trafego > Credenciais | Atualizar via UI; campos secretos têm cripto |

## Arquitetura

```
Cowork (Anthropic)
   ↓ OAuth Bearer token
traffic-mcp-server  (https://.../traffic-mcp/mcp)
   ↓ HTTP + token CRM
crm-api (NestJS)
   ↓ BullMQ
crm-worker
   ↓ google-ads-api SDK (OAuth refresh token criptografado em TrafficAccount)
Google Ads
```

Detalhe completo da arquitetura e justificativa em [fase-0-descoberta.md](fase-0-descoberta.md) §9-§11.
