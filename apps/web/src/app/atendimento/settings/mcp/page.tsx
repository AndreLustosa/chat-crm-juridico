'use client';

import { useState } from 'react';
import { CheckCircle2, Copy, Info, Plug, RefreshCw, Terminal } from 'lucide-react';
import api from '@/lib/api';

type CopyTarget =
  | 'token'
  | 'crmUrl'
  | 'trafficUrl'
  | 'oauthMeta'
  | 'resourceMeta'
  | 'config'
  | 'oauthAuthUrl'
  | 'oauthTokenUrl'
  | 'oauthRegisterUrl'
  | 'oauthIssuer'
  | 'oauthResource'
  | 'oauthClientId'
  | 'oauthDefaultScopes'
  | 'oauthBaseScopes';

const crmMcpUrl = 'https://andrelustosaadvogados.com.br/api/mcp';
const trafficMcpUrl = 'https://andrelustosaadvogados.com.br/traffic-mcp/mcp';
const oauthIssuer = 'https://andrelustosaadvogados.com.br/traffic-mcp';
const oauthAuthorizationUrl = 'https://andrelustosaadvogados.com.br/traffic-mcp/oauth/authorize';
const oauthTokenUrl = 'https://andrelustosaadvogados.com.br/traffic-mcp/oauth/token';
const oauthMetadataUrl = 'https://andrelustosaadvogados.com.br/traffic-mcp/.well-known/oauth-authorization-server';
const resourceMetadataUrl = 'https://andrelustosaadvogados.com.br/traffic-mcp/.well-known/oauth-protected-resource';
const oauthStaticClientId = 'traffic-chatgpt';
const oauthDefaultScopes = 'mcp:tools';
const oauthBaseScopes = '';

export default function McpSettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  async function generateToken() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/mcp-token');
      setToken(res.data.mcp_token);
    } catch (e: unknown) {
      const message =
        typeof e === 'object' &&
        e !== null &&
        'response' in e &&
        typeof (e as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
          ? (e as { response: { data: { message: string } } }).response.data.message
          : 'Erro ao gerar token';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, type: CopyTarget) {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  const configJson = token
    ? JSON.stringify(
        {
          mcpServers: {
            'crm-juridico': {
              url: crmMcpUrl,
              headers: { Authorization: `Bearer ${token}` },
            },
            'trafego-google-ads': {
              url: trafficMcpUrl,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      )
    : '';

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Plug className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Integracao MCP</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        Gere um token unico no CRM e use a configuracao abaixo para conectar Claude Desktop ou
        ChatGPT ao CRM juridico e ao Gestor de Trafego.
      </p>

      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Passo 1 - Gerar token unico
        </h2>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm text-muted-foreground mb-4">
            Este token vale por <strong>1 ano</strong>. Ele autoriza o MCP principal do CRM e tambem
            o MCP de Trafego, entao voce nao precisa pedir o token secreto da VPS.
          </p>
          <button
            onClick={generateToken}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            {token ? 'Gerar novo token' : 'Gerar token MCP'}
          </button>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          {token && (
            <div className="mt-4">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Token para Claude e ChatGPT
              </label>
              <CopyableCode value={token} copied={copied === 'token'} onCopy={() => copy(token, 'token')} />
            </div>
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          URLs dos servidores
        </h2>
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <UrlRow label="CRM juridico" value={crmMcpUrl} copied={copied === 'crmUrl'} onCopy={() => copy(crmMcpUrl, 'crmUrl')} />
          <UrlRow label="Gestor de Trafego" value={trafficMcpUrl} copied={copied === 'trafficUrl'} onCopy={() => copy(trafficMcpUrl, 'trafficUrl')} />
          <UrlRow label="OAuth discovery" value={oauthMetadataUrl} copied={copied === 'oauthMeta'} onCopy={() => copy(oauthMetadataUrl, 'oauthMeta')} />
          <UrlRow label="Resource metadata" value={resourceMetadataUrl} copied={copied === 'resourceMeta'} onCopy={() => copy(resourceMetadataUrl, 'resourceMeta')} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          ChatGPT - Aplicativo MCP
        </h2>
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <InstructionLine label="Nome" value="Gestor de Trafego" />
          <InstructionLine label="Descricao" value="Analisa metricas e gerencia campanhas do Google Ads usando o CRM." />
          <InstructionLine label="URL do servidor MCP" value={trafficMcpUrl} />
          <InstructionLine label="Autenticacao" value="OAuth ou Mista" />
          <InstructionLine label="Tela de autorizacao" value="O ChatGPT nao deve pedir token em popup." />
          <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Use o token do Passo 1 como segredo OAuth nas configuracoes avancadas. Depois de
              conectado, o ChatGPT guarda a conexao.
            </span>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          ChatGPT - Configuracoes avancadas de OAuth
        </h2>
        <div className="bg-card border border-border rounded-xl p-5 space-y-5">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Registro de cliente</h3>
            <InstructionLine label="Metodo recomendado" value="Cliente OAuth definido pelo usuario" />
            <InstructionLine label="Registro Dinamico de Cliente (DCR)" value="Nao usar nesta conexao" />
            <UrlRow
              label="ID do cliente OAuth"
              value={oauthStaticClientId}
              copied={copied === 'oauthClientId'}
              onCopy={() => copy(oauthStaticClientId, 'oauthClientId')}
            />
            <InstructionLine label="Segredo do cliente OAuth" value="Cole o token MCP gerado no Passo 1" />
            <InstructionLine label="Metodo do token endpoint" value="client_secret_post" />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Escopos</h3>
            <UrlRow
              label="Escopos padrao"
              value={oauthDefaultScopes}
              copied={copied === 'oauthDefaultScopes'}
              onCopy={() => copy(oauthDefaultScopes, 'oauthDefaultScopes')}
            />
            <UrlRow
              label="Escopos basicos"
              value={oauthBaseScopes || '(deixe em branco)'}
              copied={copied === 'oauthBaseScopes'}
              onCopy={() => copy(oauthBaseScopes, 'oauthBaseScopes')}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Endpoints OAuth</h3>
            <UrlRow
              label="URL de autenticacao"
              value={oauthAuthorizationUrl}
              copied={copied === 'oauthAuthUrl'}
              onCopy={() => copy(oauthAuthorizationUrl, 'oauthAuthUrl')}
            />
            <UrlRow
              label="Token URL"
              value={oauthTokenUrl}
              copied={copied === 'oauthTokenUrl'}
              onCopy={() => copy(oauthTokenUrl, 'oauthTokenUrl')}
            />
            <UrlRow
              label="URL de registro"
              value="(deixe em branco)"
              copied={copied === 'oauthRegisterUrl'}
              onCopy={() => copy('', 'oauthRegisterUrl')}
            />
            <UrlRow
              label="Endereco base do servidor de autorizacao"
              value={oauthIssuer}
              copied={copied === 'oauthIssuer'}
              onCopy={() => copy(oauthIssuer, 'oauthIssuer')}
            />
            <UrlRow
              label="Recurso"
              value={trafficMcpUrl}
              copied={copied === 'oauthResource'}
              onCopy={() => copy(trafficMcpUrl, 'oauthResource')}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">OpenID</h3>
            <InstructionLine label="OIDC habilitado" value="Nao" />
            <InstructionLine label="URL de configuracao OIDC" value="Deixe em branco" />
            <InstructionLine label="Endpoint userinfo" value="Deixe em branco" />
            <InstructionLine label="Escopos OIDC" value="Deixe em branco" />
          </div>

          <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Se aparecer o erro de RFC 7591 Dynamic Client Registration, volte nesta tela do
              ChatGPT e escolha Cliente OAuth definido pelo usuario. Use o ID acima, cole o token
              do Passo 1 no segredo do cliente OAuth e deixe a URL de registro em branco.
            </span>
          </div>
        </div>
      </section>

      {token && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Claude Desktop
          </h2>
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Cole este conteudo em <code className="text-xs bg-muted px-1 py-0.5 rounded">claude_desktop_config.json</code>.
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Terminal className="w-3.5 h-3.5" />
                  claude_desktop_config.json
                </div>
                <button
                  onClick={() => copy(configJson, 'config')}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition font-medium"
                >
                  {copied === 'config' ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copiar
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-muted/50 border border-border rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre text-foreground/80">
                {configJson}
              </pre>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function UrlRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        {label}
      </div>
      <CopyableCode value={value} copied={copied} onCopy={onCopy} />
    </div>
  );
}

function InstructionLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[180px_1fr]">
      <span className="font-semibold text-foreground/80">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}

function CopyableCode({
  value,
  copied,
  onCopy,
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-xs font-mono break-all select-all">
        {value}
      </code>
      <button
        onClick={onCopy}
        className="shrink-0 p-2 rounded-lg border border-border hover:bg-muted/50 transition"
        title="Copiar"
      >
        {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
      </button>
    </div>
  );
}
