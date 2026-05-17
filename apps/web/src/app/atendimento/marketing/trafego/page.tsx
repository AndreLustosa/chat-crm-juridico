"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  TrendingUp,
  LayoutDashboard,
  Megaphone,
  FileText,
  Bell,
  Settings as SettingsIcon,
  Loader2,
  RefreshCw,
  Activity,
} from "lucide-react";
import api from "@/lib/api";
import { useRole } from "@/lib/useRole";
import { showError, showSuccess } from "@/lib/toast";

import { ConnectGoogleAdsCard } from "./components/ConnectGoogleAdsCard";
import { DashboardTab } from "./components/DashboardTab";
import { CampanhasTab } from "./components/CampanhasTab";
import { AlertasTab } from "./components/AlertasTab";
import { AtividadesTab } from "./components/AtividadesTab";
import { ConfiguracoesTab } from "./components/ConfiguracoesTab";
import { RelatoriosTab } from "./components/RelatoriosTab";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "campanhas", label: "Campanhas", icon: Megaphone },
  { id: "relatorios", label: "Relatórios", icon: FileText },
  { id: "alertas", label: "Alertas", icon: Bell },
  { id: "atividades", label: "Atividades", icon: Activity },
  { id: "configuracoes", label: "Configurações", icon: SettingsIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

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

/**
 * Wrapper com Suspense — exigido pelo Next.js 16 quando se usa
 * `useSearchParams()` durante prerender. Sem isso o build de producao quebra:
 *   "useSearchParams() should be wrapped in a suspense boundary"
 */
export default function TrafegoPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <TrafegoPageInner />
    </Suspense>
  );
}

function PageLoading() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-sm">Carregando...</p>
      </div>
    </div>
  );
}

function TrafegoPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const perms = useRole();

  const [tab, setTab] = useState<TabId>("dashboard");
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [, setDefaultTabSet] = useState(false);
  const [openAlertsCount, setOpenAlertsCount] = useState(0);

  const setActiveTab = useCallback(
    (next: TabId) => {
      setTab(next);
      router.replace(`/atendimento/marketing/trafego?tab=${next}`);
    },
    [router],
  );

  useEffect(() => {
    const tabParam = search.get("tab");
    if (tabParam && TABS.some((t) => t.id === tabParam)) {
      setTab(tabParam as TabId);
    }
  }, [search]);

  // ─── Trata callback OAuth ────────────────────────────────────────────────
  useEffect(() => {
    const oauthStatus = search.get("oauth");
    if (!oauthStatus) return;

    if (oauthStatus === "success") {
      showSuccess("Conta Google Ads conectada com sucesso!");
    } else if (oauthStatus === "error") {
      const reason = search.get("reason") || "Erro desconhecido";
      showError(`Falha ao conectar: ${decodeURIComponent(reason)}`);
    }

    // Limpa querystring sem recarregar a pagina
    router.replace("/atendimento/marketing/trafego");
  }, [search, router]);

  // ─── Carrega estado da conta ────────────────────────────────────────────
  const loadAccount = useCallback(async () => {
    try {
      const { data } = await api.get<AccountState>("/trafego/account");
      setAccount(data);
      // No primeiro load: se nao tem conta, abre direto em Configuracoes
      // (onde o admin precisa preencher credenciais antes de poder conectar).
      setDefaultTabSet((prev) => {
        if (prev) return prev;
        if (!data.connected) setActiveTab("configuracoes");
        return true;
      });
    } catch {
      setAccount({ connected: false, account: null });
      setDefaultTabSet((prev) => {
        if (prev) return prev;
        setActiveTab("configuracoes");
        return true;
      });
    } finally {
      setLoading(false);
    }
  }, [setActiveTab]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  // Polling do contador de alertas OPEN — atualiza a cada 60s.
  // So conta se conta esta conectada (pra evitar 503 em loop).
  useEffect(() => {
    if (!account?.connected) return;

    let cancelled = false;
    const fetchCount = async () => {
      try {
        const { data } = await api.get<{ id: string }[]>(
          "/trafego/alerts?status=OPEN&limit=100",
        );
        if (!cancelled) setOpenAlertsCount(data.length);
      } catch {
        // silencioso — contador eh nice-to-have
      }
    };
    fetchCount();
    const t = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [account?.connected]);

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

  // ─── Sync manual ─────────────────────────────────────────────────────────
  async function syncNow() {
    setSyncing(true);
    try {
      await api.post("/trafego/sync");
      showSuccess("Sync iniciado. Os dados aparecerão em alguns minutos.");
      // Recarrega estado da conta
      await loadAccount();
    } catch (err: unknown) {
      const msg =
        typeof err === "object" &&
        err !== null &&
        "response" in err &&
        typeof (err as { response?: { data?: { message?: unknown } } }).response
          ?.data?.message === "string"
          ? (err as { response: { data: { message: string } } }).response.data
              .message
          : "Erro ao iniciar sync";
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
      <div className="mt-6 mb-6 flex flex-wrap gap-1 border-b border-border pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const showAlertsBadge = t.id === "alertas" && openAlertsCount > 0;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Icon size={16} />
              {t.label}
              {showAlertsBadge && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center">
                  {openAlertsCount > 99 ? "99+" : openAlertsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Aviso fixo no topo quando ainda nao conectou */}
      {!account?.connected && tab !== "configuracoes" && (
        <div className="mb-6">
          <ConnectGoogleAdsCard
            canManage={perms.canManageTrafego}
            onConnected={loadAccount}
          />
        </div>
      )}

      {/* Banner persistente quando conta esta connected mas com erro
          (ex: refresh_token revogado). Mostra em QUALQUER tab pra que
          admin nao precise caçar o caminho de reconectar — clicar no
          botao abre o fluxo OAuth do Google direto. */}
      {account?.connected && account.account?.last_error && (
        <ReconnectBanner
          lastError={account.account.last_error}
          canManage={perms.canManageTrafego}
        />
      )}

      {/* Tab content — Configuracoes sempre acessivel pra preencher credenciais */}
      <div>
        {tab === "dashboard" && account?.connected && <DashboardTab />}
        {tab === "campanhas" && account?.connected && (
          <CampanhasTab canManage={perms.canManageTrafego} />
        )}
        {tab === "relatorios" && account?.connected && (
          <RelatoriosTab canManage={perms.canManageTrafego} />
        )}
        {tab === "alertas" && account?.connected && (
          <AlertasTab canManage={perms.canManageTrafego} />
        )}
        {tab === "atividades" && account?.connected && <AtividadesTab />}
        {/* Configuracoes: SEMPRE acessivel — eh aqui que admin preenche
            credenciais antes de poder conectar a conta. */}
        {tab === "configuracoes" && (
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
              "Google Ads — central de monitoramento"}
            {account?.account?.last_sync_at && (
              <span className="ml-2 text-[11px]">
                · último sync{" "}
                {new Date(account.account.last_sync_at).toLocaleString("pt-BR")}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <a
          href="/atendimento/marketing/trafego/termos-busca"
          className="text-xs font-semibold px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          Termos de busca
        </a>
        <a
          href="/atendimento/marketing/trafego/alertas"
          className="text-xs font-semibold px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          Alertas
        </a>
        <a
          href="/atendimento/marketing/trafego/configuracoes"
          className="text-xs font-semibold px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          Config.
        </a>
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
    </div>
  );
}

/**
 * Banner persistente que aparece em QUALQUER tab quando a conta Google
 * Ads esta connected mas com last_error setado (tipico: refresh_token
 * revogado/expirado). Sem isso, admin ficava sem caminho UI claro pra
 * reconectar — precisava ir em Configuracoes > Conexao ou usar Console
 * do DevTools.
 *
 * Achado durante onboarding ao Claude.ai em 2026-05-16: user reportou
 * "nao apareceu o botao" depois que tentei mostrar so em /configuracoes.
 */
function ReconnectBanner({
  lastError,
  canManage,
}: {
  lastError: string;
  canManage: boolean;
}) {
  const [redirecting, setRedirecting] = useState(false);

  async function reconnect() {
    if (!canManage || redirecting) return;
    setRedirecting(true);
    try {
      const { data } = await api.get<{ authorize_url: string }>(
        "/trafego/oauth/start",
      );
      window.location.href = data.authorize_url;
    } catch (err: any) {
      showError(
        err?.response?.data?.message ?? "Falha ao iniciar OAuth do Google.",
      );
      setRedirecting(false);
    }
  }

  return (
    <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <Bell size={18} className="text-red-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-[260px]">
          <h3 className="text-sm font-bold text-red-700 dark:text-red-400 mb-1">
            Conexão Google Ads com problema
          </h3>
          <p className="text-xs text-red-700/90 dark:text-red-400/90 mb-2">
            {lastError}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Sem reconectar, novos sincronismos vão falhar e os dados ficarão
            congelados.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={reconnect}
            disabled={redirecting}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
          >
            {redirecting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {redirecting ? "Redirecionando..." : "Reconectar via OAuth"}
          </button>
        )}
      </div>
    </div>
  );
}
