'use client';

import { useEffect, useState } from 'react';
import {
  Loader2,
  Save,
  KeyRound,
  ShieldAlert,
  Eye,
  EyeOff,
  Info,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface CredentialsState {
  developer_token: { source: 'db' | 'env' | 'none'; masked: string | null };
  oauth_client_secret: { source: 'db' | 'env' | 'none'; masked: string | null };
  google_ads_login_customer_id: string | null;
  google_ads_customer_id: string | null;
  oauth_client_id: string | null;
  oauth_redirect_uri: string | null;
  frontend_base_url: string | null;
  crypto_available: boolean;
}

const INPUT_CLS =
  'bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 w-full';

const SOURCE_BADGE: Record<'db' | 'env' | 'none', { label: string; color: string }> = {
  db: { label: 'configurado via UI', color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  env: { label: 'vindo de env (legado)', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  none: { label: 'não configurado', color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
};

export function CredentialsSection({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<CredentialsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Inputs do formulario (separados do state remoto pra distinguir vazio = mantem)
  const [devToken, setDevToken] = useState('');
  const [showDevToken, setShowDevToken] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');
  const [loginCustomerId, setLoginCustomerId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [frontendBaseUrl, setFrontendBaseUrl] = useState('');

  async function load() {
    try {
      const { data } = await api.get<CredentialsState>('/trafego/credentials');
      setState(data);
      // Pre-preenche os campos nao-secretos com valor atual (vem em claro)
      setClientId(data.oauth_client_id ?? '');
      setRedirectUri(data.oauth_redirect_uri ?? '');
      setLoginCustomerId(data.google_ads_login_customer_id ?? '');
      setCustomerId(data.google_ads_customer_id ?? '');
      setFrontendBaseUrl(data.frontend_base_url ?? '');
      // Secretos: NUNCA preenche — vazio significa "nao mexer"
      setDevToken('');
      setClientSecret('');
    } catch {
      showError('Erro ao carregar credenciais.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!canManage) return;
    setSaving(true);
    try {
      const payload: Record<string, string | null | undefined> = {
        oauth_client_id: clientId || null,
        oauth_redirect_uri: redirectUri || null,
        google_ads_login_customer_id: loginCustomerId || null,
        google_ads_customer_id: customerId || null,
        frontend_base_url: frontendBaseUrl || null,
      };
      // Secretos: so envia se foi preenchido. Vazio = mantem o atual.
      if (devToken) payload.google_ads_developer_token = devToken;
      if (clientSecret) payload.oauth_client_secret = clientSecret;

      const { data } = await api.patch<CredentialsState>(
        '/trafego/credentials',
        payload,
      );
      setState(data);
      // Limpa apenas os campos secretos, mantem os nao-secretos visiveis
      setDevToken('');
      setClientSecret('');
      showSuccess('Credenciais salvas.');
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Erro ao salvar credenciais.';
      showError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !state) {
    return (
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={16} className="animate-spin" />
          Carregando credenciais...
        </div>
      </section>
    );
  }

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start gap-3 mb-2">
        <KeyRound size={18} className="text-primary mt-0.5 shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">
            Credenciais Google Ads API
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Configurar aqui evita precisar mexer em código/env do servidor.
            Secrets ficam criptografados (AES-256) no banco.
          </p>
        </div>
      </div>

      {!state.crypto_available && (
        <div className="my-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Cripto desabilitada no servidor.</strong> Configure{' '}
            <code className="px-1 bg-muted rounded">TRAFEGO_ENCRYPTION_KEY</code>{' '}
            antes de salvar secrets aqui (ou eles voltarão a ler de env).
          </span>
        </div>
      )}

      {state.developer_token.source === 'env' || state.oauth_client_secret.source === 'env' ? (
        <div className="my-3 flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-400">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Algum secret está sendo lido de env var (legado). Salve aqui pra
            migrar pro banco e poder editar sem deploy.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* ─── Developer Token (secret) ─────────────────────────── */}
        <div className="md:col-span-2">
          <FieldLabel
            label="Developer Token"
            hint="Da MCC do escritório (Google Ads → Adm → Central de API)"
            sourceBadge={state.developer_token.source}
            maskedValue={state.developer_token.masked}
          />
          <div className="relative">
            <input
              type={showDevToken ? 'text' : 'password'}
              value={devToken}
              onChange={(e) => setDevToken(e.target.value)}
              disabled={!canManage}
              placeholder={
                state.developer_token.source !== 'none'
                  ? '(deixe vazio para manter o atual)'
                  : 'cole o developer token...'
              }
              className={INPUT_CLS + ' pr-10 font-mono'}
            />
            <button
              type="button"
              onClick={() => setShowDevToken(!showDevToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showDevToken ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {/* ─── Login Customer ID ────────────────────────────────── */}
        <div>
          <FieldLabel
            label="Login Customer ID (MCC)"
            hint="Sem traços. Ex: 2736107831"
          />
          <input
            type="text"
            value={loginCustomerId}
            onChange={(e) => setLoginCustomerId(e.target.value.replace(/\D/g, ''))}
            disabled={!canManage}
            placeholder="2736107831"
            className={INPUT_CLS + ' font-mono'}
          />
        </div>

        {/* ─── Customer ID Alvo (anunciante) ────────────────────── */}
        <div>
          <FieldLabel
            label="Customer ID Alvo (anunciante)"
            hint="Conta com as campanhas. Sem traços. Ex: 4464129633"
          />
          <input
            type="text"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value.replace(/\D/g, ''))}
            disabled={!canManage}
            placeholder="4464129633"
            className={INPUT_CLS + ' font-mono'}
          />
        </div>

        {/* ─── OAuth Client ID ──────────────────────────────────── */}
        <div className="md:col-span-2">
          <FieldLabel
            label="OAuth Client ID"
            hint="Cloud Console → Credenciais"
          />
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={!canManage}
            placeholder="123456-xxx.apps.googleusercontent.com"
            className={INPUT_CLS + ' font-mono text-xs'}
          />
        </div>

        {/* ─── OAuth Client Secret (secret) ─────────────────────── */}
        <div className="md:col-span-2">
          <FieldLabel
            label="OAuth Client Secret"
            hint="Começa com GOCSPX-"
            sourceBadge={state.oauth_client_secret.source}
            maskedValue={state.oauth_client_secret.masked}
          />
          <div className="relative">
            <input
              type={showClientSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={!canManage}
              placeholder={
                state.oauth_client_secret.source !== 'none'
                  ? '(deixe vazio para manter o atual)'
                  : 'cole o client secret...'
              }
              className={INPUT_CLS + ' pr-10 font-mono'}
            />
            <button
              type="button"
              onClick={() => setShowClientSecret(!showClientSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showClientSecret ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {/* ─── Redirect URI ─────────────────────────────────────── */}
        <div className="md:col-span-2">
          <FieldLabel
            label="OAuth Redirect URI"
            hint="Mesma URL registrada no Cloud Console"
          />
          <input
            type="text"
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            disabled={!canManage}
            placeholder="https://crm.example.com/api/trafego/oauth/callback"
            className={INPUT_CLS + ' font-mono text-xs'}
          />
        </div>

        {/* ─── Frontend Base URL ────────────────────────────────── */}
        <div className="md:col-span-2">
          <FieldLabel
            label="Frontend Base URL"
            hint="Para onde redirecionar após callback OAuth"
          />
          <input
            type="text"
            value={frontendBaseUrl}
            onChange={(e) => setFrontendBaseUrl(e.target.value)}
            disabled={!canManage}
            placeholder="https://crm.example.com"
            className={INPUT_CLS + ' font-mono text-xs'}
          />
        </div>
      </div>

      {canManage && (
        <div className="flex justify-end mt-4">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-4 py-2 rounded-lg shadow-md hover:opacity-90 disabled:opacity-50 text-sm"
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            Salvar credenciais
          </button>
        </div>
      )}
    </section>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function FieldLabel({
  label,
  hint,
  sourceBadge,
  maskedValue,
}: {
  label: string;
  hint?: string;
  sourceBadge?: 'db' | 'env' | 'none';
  maskedValue?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {sourceBadge && (
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${SOURCE_BADGE[sourceBadge].color}`}
          >
            {SOURCE_BADGE[sourceBadge].label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {maskedValue && (
          <span className="text-[11px] text-muted-foreground font-mono">
            atual: {maskedValue}
          </span>
        )}
        {hint && (
          <span className="text-[11px] text-muted-foreground italic hidden sm:inline">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
