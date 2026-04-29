'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  TrendingUp,
  LayoutDashboard,
  Megaphone,
  Users,
  FileText,
  Bell,
  Settings as SettingsIcon,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { showError, showSuccess } from '@/lib/toast';

import { ConnectGoogleAdsCard } from './components/ConnectGoogleAdsCard';
import { DashboardTab } from './components/DashboardTab';
import { CampanhasTab } from './components/CampanhasTab';
import { AlertasTab } from './components/AlertasTab';
import { ConfiguracoesTab } from './components/ConfiguracoesTab';
import { PlaceholderTab } from './components/PlaceholderTab';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'campanhas', label: 'Campanhas', icon: Megaphone },
  { id: 'leads', label: 'Leads', icon: Users },
  { id: 'relatorios', label: 'Relatórios', icon: FileText },
  { id: 'alertas', label: 'Alertas', icon: Bell },
  { id: 'ia', label: 'IA Otimizadora', icon: Sparkles },
  { id: 'configuracoes', label: 'Configurações', icon: SettingsIcon },
] as const;

type TabId = (typeof TABS)[number]['id'];

interface AccountState {
  connected: boolean;
  account: {
    id: string;
    customer_id: string;
    account_name: string | null;
    authorized_email: string | null;
    status: string;
    last_sync_at: string | null;
    last_error: string | null;
  } | null;
}

export default function TrafegoPage() {
  const router = useRouter();
  const search = useSearchParams();
  const perms = useRole();

  const [tab, setTab] = useState<TabId>('dashboard');
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // ─── Trata callback OAuth ────────────────────────────────────────────────
  useEffect(() => {
    const oauthStatus = search.get('oauth');
    if (!oauthStatus) return;

    if (oauthStatus === 'success') {
      showSuccess('Conta Google Ads conectada com sucesso!');
    } else if (oauthStatus === 'error') {
      const reason = search.get('reason') || 'Erro desconhecido';
      showError(`Falha ao conectar: ${decodeURIComponent(reason)}`);
    }

    // Limpa querystring sem recarregar a pagina
    router.replace('/atendimento/marketing/trafego');
  }, [search, router]);

  // ─── Carrega estado da conta ────────────────────────────────────────────
  const loadAccount = useCallback(async () => {
    try {
      const { data } = await api.get<AccountState>('/trafego/account');
      setAccount(data);
    } catch {
      setAccount({ connected: false, account: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  // ─── Permissao ───────────────────────────────────────────────────────────
  if (!perms.canViewTrafego) {
    return (
      <div className="p-8">
        <div className="bg-card border border-border rounded-xl p-8 text-center max-w-md mx-auto">
          <h2 className="text-base font-bold text-foreground mb-2">
            Acesso restrito
          </h2>
          <p className="text-sm text-muted-foreground">
            Você não tem permissão para visualizar o módulo de Tráfego.
          </p>
        </div>
      </div>
    );
  }

  // ─── Loading inicial ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 size={28} className="animate-spin" />
          <p className="text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  // ─── Sem conta conectada → tela de conexão ──────────────────────────────
  if (!account?.connected) {
    return (
      <div className="h-full overflow-y-auto p-6 lg:p-8">
        <Header onSyncNow={null} syncing={false} account={null} />
        <div className="mt-8">
          <ConnectGoogleAdsCard
            canManage={perms.canManageTrafego}
            onConnected={loadAccount}
          />
        </div>
      </div>
    );
  }

  // ─── Sync manual ─────────────────────────────────────────────────────────
  async function syncNow() {
    setSyncing(true);
    try {
      await api.post('/trafego/sync');
      showSuccess('Sync iniciado. Os dados aparecerão em alguns minutos.');
      // Recarrega estado da conta
      await loadAccount();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao iniciar sync';
      showError(msg);
    } finally {
      setSyncing(false);
    }
  }

  // ─── Render principal com tabs ──────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8">
      <Header
        onSyncNow={perms.canManageTrafego ? syncNow : null}
        syncing={syncing}
        account={account}
      />

      {/* Tabs */}
      <div className="mt-6 mb-6 flex gap-1 border-b border-border overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'campanhas' && (
          <CampanhasTab canManage={perms.canManageTrafego} />
        )}
        {tab === 'leads' && (
          <PlaceholderTab
            icon={Users}
            title="Leads atribuídos a campanhas"
            description="Em breve: cada lead vindo do Google Ads (UTM/gclid) aparecerá aqui vinculado à campanha originária, com funil até venda."
            phase="Fase 3"
          />
        )}
        {tab === 'relatorios' && (
          <PlaceholderTab
            icon={FileText}
            title="Relatórios em PDF"
            description="Em breve: exportação mensal/semanal de performance com gráficos, evolução e comparativo de períodos."
            phase="Fase 4"
          />
        )}
        {tab === 'alertas' && <AlertasTab canManage={perms.canManageTrafego} />}
        {tab === 'ia' && (
          <PlaceholderTab
            icon={Sparkles}
            title="IA Otimizadora"
            description="Em breve: pergunte 'onde cortar verba?', 'por que CPL subiu?', 'palavras com desperdício?' — análise feita sobre os dados internos."
            phase="Fase 5"
          />
        )}
        {tab === 'configuracoes' && (
          <ConfiguracoesTab canManage={perms.canManageTrafego} />
        )}
      </div>
    </div>
  );
}

// ─── Header (compartilhado entre estados) ────────────────────────────────────

function Header({
  onSyncNow,
  syncing,
  account,
}: {
  onSyncNow: (() => void) | null;
  syncing: boolean;
  account: AccountState | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shrink-0">
          <TrendingUp size={22} className="text-white" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Gestão de Tráfego
          </h1>
          <p className="text-sm text-muted-foreground">
            {account?.account?.account_name ??
              account?.account?.customer_id ??
              'Google Ads — central de monitoramento'}
            {account?.account?.last_sync_at && (
              <span className="ml-2 text-[11px]">
                · último sync{' '}
                {new Date(account.account.last_sync_at).toLocaleString('pt-BR')}
              </span>
            )}
          </p>
        </div>
      </div>

      {onSyncNow && (
        <button
          onClick={onSyncNow}
          disabled={syncing}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          Sincronizar agora
        </button>
      )}
    </div>
  );
}
