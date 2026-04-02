'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Save, Loader2, Check, AlertTriangle, ExternalLink, ToggleLeft, ToggleRight } from 'lucide-react';
import api from '@/lib/api';

export default function PaymentGatewaySettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [sandbox, setSandbox] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [status, setStatus] = useState<{ configured: boolean; sandbox: boolean; provider: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }

    // Buscar configuração atual
    api.get('/payment-gateway/settings')
      .then(r => {
        setStatus(r.data);
        setSandbox(r.data?.sandbox ?? true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Construir URL do webhook
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    setWebhookUrl(`${apiUrl}/webhooks/asaas`);
  }, [router]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (apiKey.trim()) await api.put('/settings', { key: 'asaas_api_key', value: apiKey.trim() });
      if (webhookToken.trim()) await api.put('/settings', { key: 'asaas_webhook_token', value: webhookToken.trim() });
      await api.put('/settings', { key: 'asaas_sandbox', value: sandbox ? 'true' : 'false' });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      // Refresh status
      const res = await api.get('/payment-gateway/settings');
      setStatus(res.data);
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
          <CreditCard className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Gateway de Pagamento</h1>
          <p className="text-sm text-muted-foreground">Integração com Asaas para cobranças PIX, boleto e cartão</p>
        </div>
      </div>

      {/* Status */}
      <div className={`p-4 rounded-xl border ${status?.configured ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
        <div className="flex items-center gap-2">
          {status?.configured ? (
            <Check className="h-5 w-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          )}
          <span className="font-semibold text-sm">
            {status?.configured ? 'Configurado' : 'Não configurado'}
          </span>
          {status?.sandbox && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">Sandbox</span>
          )}
        </div>
        {status?.configured && (
          <p className="text-xs text-muted-foreground mt-1">
            Provider: {status.provider} | Modo: {status.sandbox ? 'Sandbox (testes)' : 'Produção'}
          </p>
        )}
      </div>

      {/* Form */}
      <div className="space-y-5">
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">API Key do Asaas</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={status?.configured ? '••••••••••• (já configurada)' : 'Cole sua API key do Asaas aqui'}
            className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Encontre em: <a href="https://www.asaas.com/config/api" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
              Asaas &gt; Configurações &gt; Integrações <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Modo</label>
          <button
            onClick={() => setSandbox(!sandbox)}
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border hover:bg-accent/30 transition-colors w-full"
          >
            {sandbox ? <ToggleLeft className="h-5 w-5 text-amber-400" /> : <ToggleRight className="h-5 w-5 text-emerald-400" />}
            <div className="text-left">
              <p className="text-sm font-medium">{sandbox ? 'Sandbox (Testes)' : 'Produção'}</p>
              <p className="text-xs text-muted-foreground">
                {sandbox ? 'Cobranças não são reais — ideal para testes' : 'Cobranças reais — dinheiro de verdade'}
              </p>
            </div>
          </button>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Token do Webhook (Asaas)</label>
          <input
            type="text"
            value={webhookToken}
            onChange={e => setWebhookToken(e.target.value)}
            placeholder={status?.configured ? '••••••••••• (já configurado)' : 'Cole o token do webhook do Asaas (whsec_...)'}
            className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Token gerado no painel Asaas ao configurar o webhook. Usado para validar a autenticidade dos eventos.
          </p>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">URL do Webhook</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={webhookUrl}
              className="flex-1 px-4 py-2.5 text-sm bg-background border border-border rounded-xl font-mono text-xs"
            />
            <button
              onClick={() => { navigator.clipboard.writeText(webhookUrl); }}
              className="px-3 py-2.5 text-sm border border-border rounded-xl hover:bg-accent/30 transition-colors"
            >
              Copiar
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Configure esta URL no painel Asaas em Configurações &gt; Integrações &gt; Webhook
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim()}
          className="w-full py-3 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? 'Salvo!' : 'Salvar Configuração'}
        </button>
      </div>
    </div>
  );
}
