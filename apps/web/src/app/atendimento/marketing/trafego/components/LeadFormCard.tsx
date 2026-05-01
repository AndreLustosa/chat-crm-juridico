'use client';

import { useEffect, useState } from 'react';
import {
  ClipboardList,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
  RefreshCw,
  EyeOff,
  Eye,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface Submission {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: 'PENDING' | 'PROCESSED' | 'DUPLICATE' | 'REJECTED' | 'ERROR';
  error_message: string | null;
  lead_id: string | null;
  gclid: string | null;
  campaign_id: string | null;
  google_asset_id: string | null;
  submitted_at: string;
  created_at: string;
}

interface LeadFormSettings {
  lead_form_webhook_secret: string | null;
  lead_form_auto_create_lead: boolean;
  lead_form_default_stage: string;
}

const STATUS_BADGE: Record<string, { color: string; icon: any; label: string }> = {
  PENDING: { color: 'bg-amber-500/15 text-amber-600', icon: Clock, label: 'Pendente' },
  PROCESSED: { color: 'bg-emerald-500/15 text-emerald-600', icon: CheckCircle2, label: 'Lead criado' },
  DUPLICATE: { color: 'bg-sky-500/15 text-sky-600', icon: CheckCircle2, label: 'Duplicado' },
  REJECTED: { color: 'bg-zinc-500/15 text-zinc-600', icon: AlertCircle, label: 'Rejeitado' },
  ERROR: { color: 'bg-red-500/15 text-red-600', icon: AlertCircle, label: 'Erro' },
};

export function LeadFormCard({ canManage }: { canManage: boolean }) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [settings, setSettings] = useState<LeadFormSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [secretInput, setSecretInput] = useState('');

  async function load() {
    setLoading(true);
    // Carregamentos isolados — uma falha não derruba a outra. Se settings
    // falhar, ainda dá pra ver as submissions (e vice-versa).
    const [subsRes, settingsRes] = await Promise.allSettled([
      api.get<Submission[]>('/trafego/lead-form-submissions', {
        params: { limit: 20 },
      }),
      api.get<LeadFormSettings>('/trafego/settings'),
    ]);

    if (subsRes.status === 'fulfilled') {
      setSubs(Array.isArray(subsRes.value.data) ? subsRes.value.data : []);
    } else {
      const msg =
        (subsRes.reason as any)?.response?.data?.message ??
        (subsRes.reason as any)?.message ??
        'desconhecido';
      showError(`Erro ao listar submissions: ${msg}`);
    }

    if (settingsRes.status === 'fulfilled') {
      const data = settingsRes.value.data as any;
      setSettings({
        lead_form_webhook_secret:
          typeof data?.lead_form_webhook_secret === 'string'
            ? data.lead_form_webhook_secret
            : null,
        lead_form_auto_create_lead:
          typeof data?.lead_form_auto_create_lead === 'boolean'
            ? data.lead_form_auto_create_lead
            : true,
        lead_form_default_stage:
          typeof data?.lead_form_default_stage === 'string' &&
          data.lead_form_default_stage.length > 0
            ? data.lead_form_default_stage
            : 'INTERESSADO',
      });
    } else {
      const msg =
        (settingsRes.reason as any)?.response?.data?.message ??
        (settingsRes.reason as any)?.message ??
        'desconhecido';
      showError(`Erro ao carregar settings de Lead Form: ${msg}`);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(patchData: Partial<LeadFormSettings>) {
    if (!canManage) return;
    setSaving(true);
    try {
      const { data } = await api.patch<any>('/trafego/lead-form-settings', patchData);
      setSettings({
        lead_form_webhook_secret: data.lead_form_webhook_secret ?? null,
        lead_form_auto_create_lead: data.lead_form_auto_create_lead ?? true,
        lead_form_default_stage: data.lead_form_default_stage ?? 'INTERESSADO',
      });
      showSuccess('Configuração salva.');
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro salvando configuração.');
    } finally {
      setSaving(false);
    }
  }

  function generateSecret() {
    // Cliente gera 32 chars hex — o servidor armazena como veio
    const arr = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    }
    const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    setSecretInput(hex);
    setShowSecret(true);
  }

  function buildWebhookUrl(): string {
    const apiBase =
      typeof window !== 'undefined'
        ? window.location.origin.replace('://app.', '://api.').replace(':3000', ':3001')
        : 'https://api.example.com';
    const secret = settings?.lead_form_webhook_secret ?? '<configure o secret>';
    return `${apiBase}/trafego/lead-form-webhook?google_key=${encodeURIComponent(secret)}`;
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Copiado!');
    } catch {
      showError('Falha ao copiar.');
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-primary" />
          <h3 className="text-base font-bold text-foreground">
            Lead Form Asset (Google Ads)
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Submissions vindas direto do anúncio (sem precisar de landing page).
          Configure a URL abaixo no asset do Google Ads.
        </p>
      </div>

      {/* Configuração */}
      {settings && canManage && (
        <div className="p-4 border-b border-border space-y-3 bg-muted/20">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Webhook URL (cole no Lead Form Asset)
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={settings.lead_form_webhook_secret ? buildWebhookUrl() : '— configure o secret abaixo —'}
                className="flex-1 px-3 py-2 text-xs font-mono rounded-md bg-card border border-border"
              />
              <button
                onClick={() => copyToClipboard(buildWebhookUrl())}
                disabled={!settings.lead_form_webhook_secret}
                className="px-3 py-2 text-xs font-medium rounded-md bg-card hover:bg-accent border border-border disabled:opacity-50"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Webhook Secret (google_key)
            </label>
            <div className="flex gap-2">
              <input
                type={showSecret ? 'text' : 'password'}
                value={
                  secretInput || settings.lead_form_webhook_secret || ''
                }
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder="Clique em 'Gerar' ou cole o seu"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-md bg-card border border-border"
              />
              <button
                onClick={() => setShowSecret((v) => !v)}
                className="px-3 py-2 text-xs font-medium rounded-md bg-card hover:bg-accent border border-border"
                title={showSecret ? 'Ocultar' : 'Mostrar'}
              >
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                onClick={generateSecret}
                className="px-3 py-2 text-xs font-medium rounded-md bg-card hover:bg-accent border border-border"
              >
                <RefreshCw size={13} />
              </button>
              <button
                onClick={() =>
                  patch({
                    lead_form_webhook_secret: secretInput.trim() || null,
                  })
                }
                disabled={saving || !secretInput.trim()}
                className="px-3 py-2 text-xs font-bold rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Esse secret valida cada submission. Cole exatamente no campo
              "Webhook key" do Lead Form Asset no Google Ads.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
            <div>
              <p className="text-sm text-foreground">
                Criar Lead automaticamente
              </p>
              <p className="text-[11px] text-muted-foreground">
                Se desligado, submissions ficam pendentes pra revisão manual.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.lead_form_auto_create_lead}
              onClick={() =>
                patch({
                  lead_form_auto_create_lead: !settings.lead_form_auto_create_lead,
                })
              }
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                settings.lead_form_auto_create_lead
                  ? 'bg-violet-500'
                  : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  settings.lead_form_auto_create_lead
                    ? 'translate-x-5'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {/* Lista de submissions */}
      {loading ? (
        <div className="p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando submissions...</p>
        </div>
      ) : subs.length === 0 ? (
        <div className="p-10 text-center">
          <ClipboardList size={36} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhuma submission ainda. Submissions aparecerão aqui em tempo real
            quando alguém preencher um Lead Form do seu anúncio.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">Contato</th>
              <th className="text-left px-4 py-3">gclid</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Quando</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => {
              const st = STATUS_BADGE[s.status] ?? STATUS_BADGE.PENDING;
              const Icon = st.icon;
              return (
                <tr
                  key={s.id}
                  className="border-t border-border hover:bg-accent/30"
                >
                  <td className="px-4 py-3 font-medium">{s.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div>{s.email ?? '—'}</div>
                    <div className="text-[11px]">{s.phone ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-[11px] font-mono text-muted-foreground">
                    {s.gclid ? `${s.gclid.slice(0, 12)}…` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md ${st.color}`}
                    >
                      <Icon size={11} />
                      {st.label}
                    </span>
                    {s.error_message && (
                      <div className="text-[10px] text-red-600 mt-0.5">
                        {s.error_message.slice(0, 60)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">
                    {new Date(s.submitted_at).toLocaleString('pt-BR')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
