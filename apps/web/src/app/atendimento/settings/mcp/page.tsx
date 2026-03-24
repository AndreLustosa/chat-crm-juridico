'use client';

import { useState } from 'react';
import { Plug, RefreshCw, Copy, CheckCircle2, Terminal, Info } from 'lucide-react';
import api from '@/lib/api';

export default function McpSettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'token' | 'config' | null>(null);

  async function generateToken() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/mcp-token');
      setToken(res.data.mcp_token);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao gerar token');
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, type: 'token' | 'config') {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  const configJson = token
    ? JSON.stringify(
        {
          mcpServers: {
            'crm-juridico': {
              url: 'https://andrelustosaadvogados.com.br/api/mcp',
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      )
    : '';

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <Plug className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Integração MCP — Claude Desktop</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        Conecte o Claude Desktop (Cowork) diretamente ao CRM. Sem instalação local — basta gerar o
        token e colar na configuração do Claude.
      </p>

      {/* Passo 1 — Gerar token */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Passo 1 — Gerar token de acesso
        </h2>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm text-muted-foreground mb-4">
            O token gerado é válido por <strong>1 ano</strong> e permite que o Claude acesse os
            dados do CRM em seu nome. Gere um novo token sempre que necessário.
          </p>
          <button
            onClick={generateToken}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Plug className="w-4 h-4" />
            )}
            {token ? 'Gerar novo token' : 'Gerar token MCP'}
          </button>

          {error && (
            <p className="mt-3 text-sm text-destructive">{error}</p>
          )}

          {token && (
            <div className="mt-4">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Seu token
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-xs font-mono break-all select-all">
                  {token}
                </code>
                <button
                  onClick={() => copy(token, 'token')}
                  className="shrink-0 p-2 rounded-lg border border-border hover:bg-muted/50 transition"
                  title="Copiar token"
                >
                  {copied === 'token' ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Passo 2 — Configurar Claude Desktop */}
      {token && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Passo 2 — Configurar o Claude Desktop
          </h2>
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Abra o arquivo <code className="text-xs bg-muted px-1 py-0.5 rounded">claude_desktop_config.json</code> no seu computador e cole o conteúdo abaixo.
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

            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground/70">Onde fica o arquivo:</p>
              <p>
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded">Windows</span>{' '}
                <code>%APPDATA%\Claude\claude_desktop_config.json</code>
              </p>
              <p>
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded">Mac</span>{' '}
                <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Passo 3 */}
      {token && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Passo 3 — Reiniciar o Claude Desktop
          </h2>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground">
              Feche o Claude Desktop completamente e abra novamente. O CRM aparecerá como ferramenta
              disponível (ícone 🔧) com 14 ferramentas: clientes, processos, documentos e
              honorários.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
