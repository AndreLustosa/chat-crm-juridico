'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Settings as SettingsIcon,
  Target,
  Bell,
  Plug,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { showError, showSuccess } from '@/lib/toast';

interface Settings {
  target_cpl_brl: number | null;
  target_ctr: string | number;
  target_roas: string | number;
  target_daily_budget_brl: number | null;
  cpl_alert_threshold: string | number;
  ctr_alert_threshold: string | number;
  alert_window_days: number;
  notify_email: boolean;
  notify_whatsapp: boolean;
  notify_inapp: boolean;
  sync_hour_local: number;
  sync_enabled: boolean;
}

interface AccountState {
  connected: boolean;
  account: {
    id: string;
    customer_id: string;
    account_name: string | null;
    last_sync_at: string | null;
    last_error: string | null;
    status: string;
  } | null;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(v || 0);

/**
 * Página dedicada de configurações do Tráfego, organizada em 3 seções:
 *   1. Metas (CPL, ROAS, CTR, orçamento mensal)
 *   2. Alertas (toggle global, canais, intervalo)
 *   3. Conexão (status Google Ads + último sync + reconectar)
 */
export default function ConfiguracoesPage() {
  const router = useRouter();
  const perms = useRole();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMetas, setSavingMetas] = useState(false);
  const [savingAlertas, setSavingAlertas] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Form state — separado pra permitir cancelar
  const [targetCpl, setTargetCpl] = useState('');
  const [targetCtr, setTargetCtr] = useState('');
  const [targetRoas, setTargetRoas] = useState('');
  const [targetMonthly, setTargetMonthly] = useState('');
  const [cplThreshold, setCplThreshold] = useState('');
  const [ctrThreshold, setCtrThreshold] = useState('');
  const [windowDays, setWindowDays] = useState('7');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyWA, setNotifyWA] = useState(false);
  const [notifyInapp, setNotifyInapp] = useState(true);
  const [syncEnabled, setSyncEnabled] = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        api.get<Settings>('/trafego/settings'),
        api.get<AccountState>('/trafego/account'),
      ]);
      setSettings(s.data);
      setAccount(a.data);
      // Hidrata form
      setTargetCpl(s.data.target_cpl_brl?.toString() ?? '');
      setTargetCtr(((Number(s.data.target_ctr) ?? 0) * 100).toString());
      setTargetRoas(Number(s.data.target_roas)?.toString() ?? '');
      setTargetMonthly(
        s.data.target_daily_budget_brl
          ? (s.data.target_daily_budget_brl * 30).toFixed(0)
          : '',
      );
      setCplThreshold(((Number(s.data.cpl_alert_threshold) ?? 0) * 100).toString());
      setCtrThreshold(((Number(s.data.ctr_alert_threshold) ?? 0) * 100).toString());
      setWindowDays(String(s.data.alert_window_days ?? 7));
      setNotifyEmail(s.data.notify_email);
      setNotifyWA(s.data.notify_whatsapp);
      setNotifyInapp(s.data.notify_inapp);
      setSyncEnabled(s.data.sync_enabled);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveMetas() {
    if (!perms.canManageTrafego) return;
    setSavingMetas(true);
    try {
      const body: Record<string, any> = {};
      const cpl = parseFloat(targetCpl.replace(',', '.'));
      const ctr = parseFloat(targetCtr.replace(',', '.'));
      const roas = parseFloat(targetRoas.replace(',', '.'));
      const monthly = parseFloat(targetMonthly.replace(',', '.'));
      if (Number.isFinite(cpl)) body.target_cpl_brl = cpl;
      if (Number.isFinite(ctr)) body.target_ctr = ctr / 100;
      if (Number.isFinite(roas)) body.target_roas = roas;
      if (Number.isFinite(monthly)) body.target_daily_budget_brl = monthly / 30;
      await api.patch('/trafego/settings', body);
      showSuccess('Metas salvas.');
      await loadAll();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha.');
    } finally {
      setSavingMetas(false);
    }
  }

  async function saveAlertas() {
    if (!perms.canManageTrafego) return;
    setSavingAlertas(true);
    try {
      const body: Record<string, any> = {
        notify_email: notifyEmail,
        notify_whatsapp: notifyWA,
        notify_inapp: notifyInapp,
        sync_enabled: syncEnabled,
      };
      const wd = parseInt(windowDays, 10);
      if (Number.isFinite(wd) && wd >= 1 && wd <= 90) {
        body.alert_window_days = wd;
      }
      const cplT = parseFloat(cplThreshold.replace(',', '.'));
      const ctrT = parseFloat(ctrThreshold.replace(',', '.'));
      if (Number.isFinite(cplT)) body.cpl_alert_threshold = cplT / 100;
      if (Number.isFinite(ctrT)) body.ctr_alert_threshold = ctrT / 100;
      await api.patch('/trafego/settings', body);
      showSuccess('Configurações de alertas salvas.');
      await loadAll();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha.');
    } finally {
      setSavingAlertas(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await api.post('/trafego/sync');
      showSuccess('Sync iniciado. Dados aparecerão em alguns minutos.');
      setTimeout(loadAll, 8000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha.');
    } finally {
      setSyncing(false);
    }
  }

  /**
   * Dispara o fluxo OAuth do Google quando admin precisa reconectar uma
   * conta cujo refresh_token foi revogado/expirou. Sem isso, o usuario
   * ficava sem botao na UI (ConnectGoogleAdsCard so renderiza quando
   * account.connected === false, mas conta com erro continua connected=true).
   */
  async function reconnectOAuth() {
    try {
      const { data } = await api.get<{ authorize_url: string }>(
        '/trafego/oauth/start',
      );
      window.location.href = data.authorize_url;
    } catch (err: any) {
      showError(
        err?.response?.data?.message ?? 'Falha ao iniciar OAuth do Google.',
      );
    }
  }

  if (!perms.canViewTrafego) {
    return (
      <div className="p-8">
        <div className="bg-card border border-border rounded-xl p-8 text-center max-w-md mx-auto">
          <h2 className="text-base font-bold text-foreground mb-2">
            Acesso restrito
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8">
      <button
        type="button"
        onClick={() => router.push('/atendimento/marketing/trafego')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={14} />
        Voltar para Tráfego
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center">
          <SettingsIcon size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Configurações
          </h1>
          <p className="text-sm text-muted-foreground">
            Metas, alertas e conexão Google Ads.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
        </div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          {/* Seção 1: Metas */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Target size={16} className="text-violet-500" />
              <h3 className="text-base font-bold text-foreground">
                Metas de performance
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Quando definidas, os KPI cards do dashboard mudam de cor
              (verde quando atinge, vermelho quando não).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Meta de CPL (R$)"
                hint="Custo por lead alvo"
                value={targetCpl}
                onChange={setTargetCpl}
                disabled={!perms.canManageTrafego}
                placeholder="80"
              />
              <Field
                label="Meta de CTR (%)"
                hint="Click-through rate alvo"
                value={targetCtr}
                onChange={setTargetCtr}
                disabled={!perms.canManageTrafego}
                placeholder="3"
              />
              <Field
                label="Meta de ROAS (multiplicador)"
                hint="Retorno × gasto. Ex: 3 = 300%"
                value={targetRoas}
                onChange={setTargetRoas}
                disabled={!perms.canManageTrafego}
                placeholder="3"
              />
              <Field
                label="Orçamento mensal (R$)"
                hint="Soma desejada de gasto no mês"
                value={targetMonthly}
                onChange={setTargetMonthly}
                disabled={!perms.canManageTrafego}
                placeholder="3000"
              />
            </div>

            {perms.canManageTrafego && (
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={saveMetas}
                  disabled={savingMetas}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
                >
                  {savingMetas && <Loader2 size={14} className="animate-spin" />}
                  Salvar metas
                </button>
              </div>
            )}
          </div>

          {/* Seção 2: Alertas */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Bell size={16} className="text-amber-500" />
              <h3 className="text-base font-bold text-foreground">
                Configuração de alertas
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              O AlertEvaluator roda a cada sync (06h Maceió + manual). Aqui
              você define os thresholds e canais.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <Field
                label="Threshold CPL (%)"
                hint="Dispara HIGH_CPL se CPL > meta × (1 + threshold)"
                value={cplThreshold}
                onChange={setCplThreshold}
                disabled={!perms.canManageTrafego}
                placeholder="30"
              />
              <Field
                label="Threshold CTR (%)"
                hint="Dispara LOW_CTR se CTR < meta × (1 - threshold)"
                value={ctrThreshold}
                onChange={setCtrThreshold}
                disabled={!perms.canManageTrafego}
                placeholder="30"
              />
              <Field
                label="Janela de avaliação (dias)"
                hint="1-90"
                value={windowDays}
                onChange={setWindowDays}
                disabled={!perms.canManageTrafego}
                placeholder="7"
              />
            </div>

            <div className="space-y-2 pt-3 border-t border-border">
              <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                Canais de notificação
              </h4>
              <Toggle
                label="In-app (sino do CRM)"
                value={notifyInapp}
                disabled={!perms.canManageTrafego}
                onChange={setNotifyInapp}
              />
              <Toggle
                label="WhatsApp (via Evolution API)"
                hint="Recomendado — alertas chegam direto"
                value={notifyWA}
                disabled={!perms.canManageTrafego}
                onChange={setNotifyWA}
              />
              <Toggle
                label="Email"
                hint="Backup. Risco de cair em spam"
                value={notifyEmail}
                disabled={!perms.canManageTrafego}
                onChange={setNotifyEmail}
              />
            </div>

            <div className="space-y-2 pt-3 border-t border-border mt-3">
              <Toggle
                label="Sync automático ativado"
                hint="Cron diário às 06h Maceió. Desligue só pra debug"
                value={syncEnabled}
                disabled={!perms.canManageTrafego}
                onChange={setSyncEnabled}
              />
            </div>

            {perms.canManageTrafego && (
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={saveAlertas}
                  disabled={savingAlertas}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
                >
                  {savingAlertas && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  Salvar configuração
                </button>
              </div>
            )}
          </div>

          {/* Seção 3: Conexão */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Plug size={16} className="text-emerald-500" />
              <h3 className="text-base font-bold text-foreground">
                Conexão Google Ads
              </h3>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {account?.connected ? (
                  <>
                    <CheckCircle2 size={16} className="text-emerald-500" />
                    <span className="text-foreground">
                      <strong>Conectado</strong>
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="text-red-500" />
                    <span className="text-foreground">
                      <strong>Desconectado</strong>
                    </span>
                  </>
                )}
              </div>

              {account?.account && (
                <>
                  <div className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Conta:</strong>{' '}
                    {account.account.account_name ?? '—'} (
                    {account.account.customer_id})
                  </div>
                  {account.account.last_sync_at && (
                    <div className="text-xs text-muted-foreground">
                      <strong className="text-foreground">Último sync:</strong>{' '}
                      {new Date(account.account.last_sync_at).toLocaleString(
                        'pt-BR',
                      )}
                    </div>
                  )}
                  {account.account.last_error && (
                    <div className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2 mt-2">
                      <strong>Último erro:</strong> {account.account.last_error}
                    </div>
                  )}
                </>
              )}
            </div>

            {perms.canManageTrafego && (
              <div className="flex gap-2 mt-4 flex-wrap">
                {/* Mostra Reconectar em destaque quando ha last_error —
                    cobre o caso de refresh_token revogado, em que a UI
                    antiga deixava admin sem caminho de recuperacao
                    porque ConnectGoogleAdsCard so aparece com
                    connected=false. */}
                {account?.account?.last_error && (
                  <button
                    type="button"
                    onClick={reconnectOAuth}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90"
                  >
                    <RefreshCw size={13} />
                    Reconectar via OAuth
                  </button>
                )}
                <button
                  type="button"
                  onClick={syncNow}
                  disabled={syncing || !account?.connected}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-md border border-border hover:bg-accent disabled:opacity-50"
                >
                  {syncing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  Sincronizar agora
                </button>
                <button
                  type="button"
                  onClick={() =>
                    router.push('/atendimento/marketing/trafego?tab=configuracoes')
                  }
                  className="px-3 py-2 text-xs font-semibold rounded-md border border-border hover:bg-accent"
                >
                  Gerenciar credenciais →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-foreground mb-1">
        {label}
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm disabled:opacity-50"
      />
      {hint && (
        <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
      )}
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 py-1.5 ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && (
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => !disabled && onChange(!value)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          value ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-700'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            value ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  );
}
