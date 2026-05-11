"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  CircleOff,
  FileSearch,
  Globe2,
  LogIn,
  Loader2,
  MapPin,
  MousePointerClick,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Target,
  Unlink,
  X,
} from "lucide-react";
import api, { API_BASE_URL } from "@/lib/api";
import { showError, showSuccess } from "@/lib/toast";
import { useRole } from "@/lib/useRole";

interface OrganicConfig {
  configured: boolean;
  site_url: string | null;
  property_type: string | null;
  auth_method: string | null;
  oauth_configured: boolean;
  oauth_connected: boolean;
  oauth_user_email: string | null;
  oauth_connected_at: string | null;
  service_account_email: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_inspection_at: string | null;
  last_error: string | null;
}

interface OrganicPage {
  id: string;
  url: string;
  path: string;
  title: string;
  city: string | null;
  state: string | null;
  practice_area: string | null;
  target_keywords: string[];
  sitemap_url: string | null;
  is_active: boolean;
  clicks_30d: number;
  impressions_30d: number;
  ctr_30d: number;
  position_30d: number;
  lp_views_30d: number;
  whatsapp_clicks_30d: number;
  index_verdict: string | null;
  coverage_state: string | null;
  google_canonical: string | null;
  last_crawl_time: string | null;
  last_search_sync_at: string | null;
  last_inspected_at: string | null;
}

interface OrganicQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface OrganicSummary {
  config: OrganicConfig;
  totals: {
    clicks: number;
    impressions: number;
    whatsapp_clicks: number;
    lp_views: number;
    indexed: number;
    ctr: number;
    position: number;
    pages: number;
    active_pages: number;
  };
  top_queries: OrganicQuery[];
  recent_logs: {
    id: string;
    trigger: string;
    status: string;
    rows_upserted: number;
    pages_seen: number;
    inspected: number;
    started_at: string;
    error_message: string | null;
  }[];
}

type TabId = "visao" | "paginas" | "consultas" | "indexacao" | "config";

const TABS: { id: TabId; label: string; icon: typeof Globe2 }[] = [
  { id: "visao", label: "Visao geral", icon: Globe2 },
  { id: "paginas", label: "Landing pages", icon: MapPin },
  { id: "consultas", label: "Consultas", icon: Search },
  { id: "indexacao", label: "Indexacao", icon: FileSearch },
  { id: "config", label: "Configuracoes", icon: Settings },
];

const INPUT_CLASS =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/60 disabled:opacity-60";

const DEFAULT_FORM = {
  url: "",
  title: "",
  city: "Arapiraca",
  state: "AL",
  practiceArea: "",
  targetKeywords: "",
  sitemapUrl: "https://andrelustosaadvogados.com.br/sitemap.xml",
};

const ORGANIC_OAUTH_REDIRECT_URI = `${API_BASE_URL}/organic-traffic/oauth/callback`;

function fmtNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function fmtPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtPosition(value: number): string {
  return value > 0 ? value.toFixed(1) : "-";
}

function fmtDate(value?: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getApiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: unknown } } })?.response
    ?.data;
  return typeof data?.message === "string" && data.message.trim()
    ? data.message
    : fallback;
}

function verdictLabel(verdict: string | null): {
  label: string;
  className: string;
  icon: typeof CheckCircle2;
} {
  if (verdict === "PASS") {
    return {
      label: "Indexada",
      className: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
      icon: CheckCircle2,
    };
  }
  if (verdict === "FAIL") {
    return {
      label: "Nao indexada",
      className: "text-red-600 bg-red-500/10 border-red-500/20",
      icon: AlertCircle,
    };
  }
  return {
    label: "Pendente",
    className: "text-amber-600 bg-amber-500/10 border-amber-500/20",
    icon: CircleOff,
  };
}

export default function TrafegoOrganicoPage() {
  const perms = useRole();
  const [tab, setTab] = useState<TabId>("visao");
  const [summary, setSummary] = useState<OrganicSummary | null>(null);
  const [pages, setPages] = useState<OrganicPage[]>([]);
  const [queries, setQueries] = useState<OrganicQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [showPageForm, setShowPageForm] = useState(false);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [pageForm, setPageForm] = useState(DEFAULT_FORM);
  const [configForm, setConfigForm] = useState({
    siteUrl: "sc-domain:andrelustosaadvogados.com.br",
    oauthClientId: "",
    oauthClientSecret: "",
    serviceAccountJson: "",
  });

  async function load() {
    setLoading(true);
    try {
      const [summaryRes, pagesRes, queriesRes] = await Promise.all([
        api.get<OrganicSummary>("/organic-traffic/summary"),
        api.get<OrganicPage[]>("/organic-traffic/pages"),
        api.get<OrganicQuery[]>("/organic-traffic/queries?limit=50"),
      ]);
      setSummary(summaryRes.data);
      setPages(pagesRes.data);
      setQueries(queriesRes.data);
      setConfigForm((prev) => ({
        ...prev,
        siteUrl: summaryRes.data.config.site_url || prev.siteUrl,
      }));
    } catch (err) {
      showError(getApiErrorMessage(err, "Erro ao carregar trafego organico."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (perms.canViewOrganicTraffic) {
      load();
    }
  }, [perms.canViewOrganicTraffic]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (!oauth) return;

    if (oauth === "success") {
      showSuccess("Google Search Console conectado.");
    } else {
      showError(params.get("reason") || "Falha ao conectar Google Search Console.");
    }

    params.delete("oauth");
    params.delete("reason");
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`,
    );
  }, []);

  const areas = useMemo(
    () =>
      [...new Set(pages.map((p) => p.practice_area).filter(Boolean))].sort() as string[],
    [pages],
  );
  const cities = useMemo(
    () => [...new Set(pages.map((p) => p.city).filter(Boolean))].sort() as string[],
    [pages],
  );

  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pages.filter((page) => {
      if (areaFilter && page.practice_area !== areaFilter) return false;
      if (cityFilter && page.city !== cityFilter) return false;
      if (!q) return true;
      return [
        page.title,
        page.path,
        page.url,
        page.city ?? "",
        page.practice_area ?? "",
        page.target_keywords.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [pages, search, areaFilter, cityFilter]);

  async function syncNow() {
    setActing("sync");
    try {
      await api.post("/organic-traffic/sync", { inspect: false });
      showSuccess("Sync do Search Console iniciado.");
      await load();
    } catch (err) {
      showError(getApiErrorMessage(err, "Falha ao sincronizar Search Console."));
    } finally {
      setActing(null);
    }
  }

  async function seedDefaults() {
    setActing("seed");
    try {
      await api.post("/organic-traffic/pages/seed-defaults");
      showSuccess("Landing pages padrao cadastradas.");
      await load();
    } catch (err) {
      showError(getApiErrorMessage(err, "Falha ao cadastrar paginas padrao."));
    } finally {
      setActing(null);
    }
  }

  async function inspectPage(page: OrganicPage) {
    setActing(`inspect:${page.id}`);
    try {
      await api.post(`/organic-traffic/pages/${page.id}/inspect`);
      showSuccess("Inspecao atualizada.");
      await load();
    } catch (err) {
      showError(getApiErrorMessage(err, "Falha ao inspecionar URL."));
    } finally {
      setActing(null);
    }
  }

  async function savePage() {
    if (!pageForm.url.trim() || !pageForm.title.trim()) {
      showError("Informe URL e titulo.");
      return;
    }
    setActing("save-page");
    try {
      await api.post("/organic-traffic/pages", {
        url: pageForm.url.trim(),
        title: pageForm.title.trim(),
        city: pageForm.city.trim() || undefined,
        state: pageForm.state.trim() || undefined,
        practiceArea: pageForm.practiceArea.trim() || undefined,
        sitemapUrl: pageForm.sitemapUrl.trim() || undefined,
        targetKeywords: pageForm.targetKeywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setPageForm(DEFAULT_FORM);
      setShowPageForm(false);
      showSuccess("Landing page cadastrada.");
      await load();
    } catch (err) {
      showError(getApiErrorMessage(err, "Falha ao cadastrar landing page."));
    } finally {
      setActing(null);
    }
  }

  async function saveConfig() {
    setActing("save-config");
    try {
      await api.post("/organic-traffic/config", {
        siteUrl: configForm.siteUrl.trim(),
        oauthClientId: configForm.oauthClientId.trim() || undefined,
        oauthClientSecret: configForm.oauthClientSecret.trim() || undefined,
        oauthRedirectUri: ORGANIC_OAUTH_REDIRECT_URI,
        serviceAccountJson: configForm.serviceAccountJson.trim() || undefined,
      });
      setConfigForm((prev) => ({
        ...prev,
        oauthClientId: "",
        oauthClientSecret: "",
        serviceAccountJson: "",
      }));
      setShowConfigForm(false);
      showSuccess("Configuracao do Search Console salva.");
      await load();
    } catch (err) {
      showError(getApiErrorMessage(err, "Falha ao salvar configuracao."));
    } finally {
      setActing(null);
    }
  }

  async function connectOAuth() {
    const hasSavedOAuth = !!summary?.config.oauth_configured;
    if (
      !hasSavedOAuth &&
      (!configForm.oauthClientId.trim() || !configForm.oauthClientSecret.trim())
    ) {
      showError("Informe Client ID e Client Secret para conectar com Google.");
      return;
    }

    setActing("connect-oauth");
    try {
      await api.post("/organic-traffic/config", {
        siteUrl: configForm.siteUrl.trim(),
        oauthClientId: configForm.oauthClientId.trim() || undefined,
        oauthClientSecret: configForm.oauthClientSecret.trim() || undefined,
        oauthRedirectUri: ORGANIC_OAUTH_REDIRECT_URI,
      });
      const res = await api.get<{ authorize_url: string }>(
        "/organic-traffic/oauth/start",
      );
      window.location.href = res.data.authorize_url;
    } catch (err) {
      showError(getApiErrorMessage(err, "Falha ao iniciar conexao com Google."));
      setActing(null);
    }
  }

  async function disconnectOAuth() {
    setActing("disconnect-oauth");
    try {
      await api.post("/organic-traffic/oauth/disconnect");
      showSuccess("Google Search Console desconectado.");
      await load();
    } catch (err) {
      showError(getApiErrorMessage(err, "Falha ao desconectar Google."));
    } finally {
      setActing(null);
    }
  }

  if (!perms.canViewOrganicTraffic) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-base font-bold text-foreground">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Voce nao tem permissao para visualizar Trafego Organico.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          Carregando Trafego Organico...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-7xl space-y-6 p-5 lg:p-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Search size={20} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-foreground">
                  Trafego Organico
                </h1>
                <p className="text-sm text-muted-foreground">
                  Google Search Console, landing pages e conversoes do site.
                </p>
              </div>
            </div>
            {summary?.config.last_error && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                <AlertCircle size={14} />
                {summary.config.last_error}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowConfigForm(true)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <Settings size={16} />
              Configurar
            </button>
            <button
              onClick={seedDefaults}
              disabled={acting === "seed"}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
            >
              {acting === "seed" ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              Padroes
            </button>
            <button
              onClick={syncNow}
              disabled={acting === "sync" || !summary?.config.configured}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {acting === "sync" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              Sincronizar
            </button>
          </div>
        </header>

        <nav className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {tab === "visao" && summary && (
          <OverviewTab summary={summary} pages={pages} onOpenPages={() => setTab("paginas")} />
        )}

        {tab === "paginas" && (
          <PagesTab
            pages={filteredPages}
            areas={areas}
            cities={cities}
            search={search}
            areaFilter={areaFilter}
            cityFilter={cityFilter}
            acting={acting}
            onSearch={setSearch}
            onAreaFilter={setAreaFilter}
            onCityFilter={setCityFilter}
            onCreate={() => setShowPageForm(true)}
            onInspect={inspectPage}
          />
        )}

        {tab === "consultas" && <QueriesTab queries={queries} />}

        {tab === "indexacao" && (
          <IndexingTab pages={filteredPages} acting={acting} onInspect={inspectPage} />
        )}

        {tab === "config" && summary && (
          <ConfigTab
            config={summary.config}
            onOpenConfig={() => setShowConfigForm(true)}
            onSync={syncNow}
            onDisconnectOAuth={disconnectOAuth}
            syncing={acting === "sync"}
            disconnecting={acting === "disconnect-oauth"}
          />
        )}
      </div>

      {showPageForm && (
        <Modal title="Nova landing page" onClose={() => setShowPageForm(false)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="URL" className="sm:col-span-2">
              <input
                value={pageForm.url}
                onChange={(e) => setPageForm((p) => ({ ...p, url: e.target.value }))}
                className={INPUT_CLASS}
                placeholder="https://andrelustosaadvogados.com.br/arapiraca/criminal"
              />
            </Field>
            <Field label="Titulo" className="sm:col-span-2">
              <input
                value={pageForm.title}
                onChange={(e) => setPageForm((p) => ({ ...p, title: e.target.value }))}
                className={INPUT_CLASS}
                placeholder="Arapiraca - Criminal"
              />
            </Field>
            <Field label="Cidade">
              <input
                value={pageForm.city}
                onChange={(e) => setPageForm((p) => ({ ...p, city: e.target.value }))}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="UF">
              <input
                value={pageForm.state}
                onChange={(e) => setPageForm((p) => ({ ...p, state: e.target.value }))}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Area de atuacao">
              <input
                value={pageForm.practiceArea}
                onChange={(e) =>
                  setPageForm((p) => ({ ...p, practiceArea: e.target.value }))
                }
                className={INPUT_CLASS}
                placeholder="Criminal"
              />
            </Field>
            <Field label="Sitemap">
              <input
                value={pageForm.sitemapUrl}
                onChange={(e) =>
                  setPageForm((p) => ({ ...p, sitemapUrl: e.target.value }))
                }
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Keywords alvo" className="sm:col-span-2">
              <input
                value={pageForm.targetKeywords}
                onChange={(e) =>
                  setPageForm((p) => ({ ...p, targetKeywords: e.target.value }))
                }
                className={INPUT_CLASS}
                placeholder="advogado criminal arapiraca, advogado criminalista arapiraca"
              />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setShowPageForm(false)}
              className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={savePage}
              disabled={acting === "save-page"}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60"
            >
              {acting === "save-page" && <Loader2 className="animate-spin" size={15} />}
              Salvar
            </button>
          </div>
        </Modal>
      )}

      {showConfigForm && (
        <Modal title="Search Console" onClose={() => setShowConfigForm(false)}>
          <div className="space-y-3">
            <Field label="Propriedade">
              <input
                value={configForm.siteUrl}
                onChange={(e) =>
                  setConfigForm((p) => ({ ...p, siteUrl: e.target.value }))
                }
                className={INPUT_CLASS}
                placeholder="sc-domain:andrelustosaadvogados.com.br"
              />
            </Field>
            <Field label="URI de redirecionamento">
              <input
                value={ORGANIC_OAUTH_REDIRECT_URI}
                readOnly
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
            </Field>
            <Field label="Client ID">
              <input
                value={configForm.oauthClientId}
                onChange={(e) =>
                  setConfigForm((p) => ({ ...p, oauthClientId: e.target.value }))
                }
                className={`${INPUT_CLASS} font-mono text-xs`}
                placeholder={
                  summary?.config.oauth_configured
                    ? "Ja configurado, cole outro para substituir"
                    : "Client ID do OAuth 2.0"
                }
              />
            </Field>
            <Field label="Client Secret">
              <input
                type="password"
                value={configForm.oauthClientSecret}
                onChange={(e) =>
                  setConfigForm((p) => ({
                    ...p,
                    oauthClientSecret: e.target.value,
                  }))
                }
                className={`${INPUT_CLASS} font-mono text-xs`}
                placeholder={
                  summary?.config.oauth_configured
                    ? "Ja configurado, cole outro para substituir"
                    : "Client Secret do OAuth 2.0"
                }
              />
            </Field>
            {summary?.config.oauth_user_email && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
                Conectado como {summary.config.oauth_user_email}
              </div>
            )}
            {summary?.config.service_account_email && !summary.config.oauth_connected && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                Fallback antigo: {summary.config.service_account_email}
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setShowConfigForm(false)}
              className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={saveConfig}
              disabled={acting === "save-config"}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60"
            >
              {acting === "save-config" && <Loader2 className="animate-spin" size={15} />}
              Salvar
            </button>
            <button
              onClick={connectOAuth}
              disabled={acting === "connect-oauth"}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              {acting === "connect-oauth" ? (
                <Loader2 className="animate-spin" size={15} />
              ) : (
                <LogIn size={15} />
              )}
              Conectar Google
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OverviewTab({
  summary,
  pages,
  onOpenPages,
}: {
  summary: OrganicSummary;
  pages: OrganicPage[];
  onOpenPages: () => void;
}) {
  const indexedRate =
    summary.totals.pages > 0 ? summary.totals.indexed / summary.totals.pages : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Cliques organicos"
          value={fmtNumber(summary.totals.clicks)}
          icon={MousePointerClick}
          tone="text-emerald-500 bg-emerald-500/10"
        />
        <KpiCard
          label="Impressoes"
          value={fmtNumber(summary.totals.impressions)}
          icon={Globe2}
          tone="text-sky-500 bg-sky-500/10"
        />
        <KpiCard
          label="CTR medio"
          value={fmtPercent(summary.totals.ctr)}
          icon={Target}
          tone="text-amber-500 bg-amber-500/10"
        />
        <KpiCard
          label="Posicao media"
          value={fmtPosition(summary.totals.position)}
          icon={ShieldCheck}
          tone="text-violet-500 bg-violet-500/10"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Landing pages monitoradas
              </h2>
              <p className="text-xs text-muted-foreground">
                {summary.totals.active_pages} ativas, {summary.totals.indexed} indexadas
              </p>
            </div>
            <button
              onClick={onOpenPages}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted"
            >
              Ver paginas
              <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="space-y-3">
            {pages.slice(0, 6).map((page) => (
              <div
                key={page.id}
                className="grid gap-3 rounded-lg border border-border/70 p-3 sm:grid-cols-[1fr_120px_90px]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">
                    {page.title}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {page.path}
                  </p>
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-foreground">
                    {fmtNumber(page.impressions_30d)}
                  </p>
                  <p className="text-muted-foreground">impressoes</p>
                </div>
                <StatusBadge verdict={page.index_verdict} />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-bold text-foreground">Saude organica</h2>
          <div className="mt-5 space-y-5">
            <ProgressRow label="Indexacao" value={indexedRate} />
            <ProgressRow
              label="Conversao WhatsApp"
              value={
                summary.totals.lp_views > 0
                  ? summary.totals.whatsapp_clicks / summary.totals.lp_views
                  : 0
              }
            />
            <div className="rounded-lg bg-muted/40 p-4">
              <p className="text-sm font-bold text-foreground">
                {fmtNumber(summary.totals.whatsapp_clicks)} cliques no WhatsApp
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtNumber(summary.totals.lp_views)} visitas rastreadas pelo LPTracker nos ultimos 30 dias.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-bold text-foreground">Principais consultas</h2>
        <QueriesTable queries={summary.top_queries} compact />
      </section>
    </div>
  );
}

function PagesTab({
  pages,
  areas,
  cities,
  search,
  areaFilter,
  cityFilter,
  acting,
  onSearch,
  onAreaFilter,
  onCityFilter,
  onCreate,
  onInspect,
}: {
  pages: OrganicPage[];
  areas: string[];
  cities: string[];
  search: string;
  areaFilter: string;
  cityFilter: string;
  acting: string | null;
  onSearch: (value: string) => void;
  onAreaFilter: (value: string) => void;
  onCityFilter: (value: string) => void;
  onCreate: () => void;
  onInspect: (page: OrganicPage) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className={`${INPUT_CLASS} pl-9`}
              placeholder="Buscar por cidade, area, URL ou keyword"
            />
          </div>
          <select
            value={cityFilter}
            onChange={(e) => onCityFilter(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Todas as cidades</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <select
            value={areaFilter}
            onChange={(e) => onAreaFilter(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Todas as areas</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={onCreate}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground"
        >
          <Plus size={16} />
          Nova pagina
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Pagina</th>
              <th className="px-4 py-3 text-left">Cidade/area</th>
              <th className="px-4 py-3 text-right">Impressoes</th>
              <th className="px-4 py-3 text-right">Cliques</th>
              <th className="px-4 py-3 text-right">CTR</th>
              <th className="px-4 py-3 text-right">Pos.</th>
              <th className="px-4 py-3 text-right">WA</th>
              <th className="px-4 py-3 text-left">Indexacao</th>
              <th className="px-4 py-3 text-right">Acao</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pages.map((page) => (
              <tr key={page.id} className="hover:bg-muted/25">
                <td className="px-4 py-3">
                  <div className="max-w-xs">
                    <p className="truncate font-bold text-foreground">{page.title}</p>
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 truncate font-mono text-[11px] text-primary"
                    >
                      {page.path}
                      <ArrowUpRight size={11} />
                    </a>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">
                    {page.city || "-"} {page.state ? `/${page.state}` : ""}
                  </p>
                  <p>{page.practice_area || "-"}</p>
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  {fmtNumber(page.impressions_30d)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                  {fmtNumber(page.clicks_30d)}
                </td>
                <td className="px-4 py-3 text-right">{fmtPercent(page.ctr_30d)}</td>
                <td className="px-4 py-3 text-right">{fmtPosition(page.position_30d)}</td>
                <td className="px-4 py-3 text-right text-emerald-600">
                  {fmtNumber(page.whatsapp_clicks_30d)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge verdict={page.index_verdict} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onInspect(page)}
                    disabled={acting === `inspect:${page.id}`}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60"
                  >
                    {acting === `inspect:${page.id}` ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <FileSearch size={14} />
                    )}
                    Inspecionar
                  </button>
                </td>
              </tr>
            ))}
            {pages.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  Nenhuma pagina encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QueriesTab({ queries }: { queries: OrganicQuery[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-foreground">Consultas organicas</h2>
        <p className="text-sm text-muted-foreground">
          Termos reais exibidos pelo Google Search Console.
        </p>
      </div>
      <QueriesTable queries={queries} />
    </section>
  );
}

function IndexingTab({
  pages,
  acting,
  onInspect,
}: {
  pages: OrganicPage[];
  acting: string | null;
  onInspect: (page: OrganicPage) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-5">
        <h2 className="text-lg font-bold text-foreground">Indexacao</h2>
        <p className="text-sm text-muted-foreground">
          Status retornado pela URL Inspection API.
        </p>
      </div>
      <div className="divide-y divide-border">
        {pages.map((page) => (
          <div key={page.id} className="grid gap-4 p-4 lg:grid-cols-[1fr_180px_1fr_150px] lg:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">{page.title}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{page.url}</p>
            </div>
            <StatusBadge verdict={page.index_verdict} />
            <div className="min-w-0 text-xs text-muted-foreground">
              <p className="truncate">
                <span className="font-semibold text-foreground">Cobertura:</span>{" "}
                {page.coverage_state || "-"}
              </p>
              <p className="truncate">
                <span className="font-semibold text-foreground">Canonical:</span>{" "}
                {page.google_canonical || "-"}
              </p>
              <p>
                <span className="font-semibold text-foreground">Ultimo crawl:</span>{" "}
                {fmtDate(page.last_crawl_time)}
              </p>
            </div>
            <button
              onClick={() => onInspect(page)}
              disabled={acting === `inspect:${page.id}`}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60"
            >
              {acting === `inspect:${page.id}` ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <FileSearch size={14} />
              )}
              Atualizar
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConfigTab({
  config,
  onOpenConfig,
  onSync,
  onDisconnectOAuth,
  syncing,
  disconnecting,
}: {
  config: OrganicConfig;
  onOpenConfig: () => void;
  onSync: () => void;
  onDisconnectOAuth: () => void;
  syncing: boolean;
  disconnecting: boolean;
}) {
  const connectionLabel = config.oauth_connected
    ? config.oauth_user_email || "Conta Google conectada"
    : config.service_account_email || "-";

  return (
    <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${config.configured ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
            {config.configured ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">
              {config.configured ? "Search Console conectado" : "Search Console pendente"}
            </h2>
            <p className="text-xs text-muted-foreground">{config.site_url || "Sem propriedade"}</p>
          </div>
        </div>
        <div className="mt-5 space-y-3 text-sm">
          <InfoRow label="Tipo" value={config.property_type || "-"} />
          <InfoRow label="Metodo" value={config.oauth_connected ? "OAuth Google" : config.auth_method || "-"} />
          <InfoRow label="Conta" value={connectionLabel} />
          <InfoRow label="Ultimo sync" value={fmtDate(config.last_sync_at)} />
          <InfoRow label="Ultima inspecao" value={fmtDate(config.last_inspection_at)} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={onOpenConfig}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
          >
            <Settings size={16} />
            Editar
          </button>
          {config.oauth_connected && (
            <button
              onClick={onDisconnectOAuth}
              disabled={disconnecting}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-500/20 px-4 text-sm font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-60"
            >
              {disconnecting ? <Loader2 className="animate-spin" size={16} /> : <Unlink size={16} />}
              Desconectar
            </button>
          )}
          <button
            onClick={onSync}
            disabled={!config.configured || syncing}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {syncing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            Sincronizar
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-bold text-foreground">Checklist de conexao</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            "Search Console API ativa no Google Cloud",
            "OAuth 2.0 Client ID configurado",
            "Conta Google proprietaria autorizada",
            "Propriedade informada como sc-domain ou URL-prefix",
            "Landing pages cadastradas por cidade e area",
          ].map((item) => (
            <div key={item} className="flex gap-3 rounded-lg border border-border p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-sm text-foreground">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function QueriesTable({
  queries,
  compact = false,
}: {
  queries: OrganicQuery[];
  compact?: boolean;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-4 text-left">Consulta</th>
            <th className="px-4 py-2 text-right">Impressoes</th>
            <th className="px-4 py-2 text-right">Cliques</th>
            <th className="px-4 py-2 text-right">CTR</th>
            <th className="py-2 pl-4 text-right">Posicao</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {queries.slice(0, compact ? 8 : 50).map((query) => (
            <tr key={query.query}>
              <td className="max-w-md truncate py-3 pr-4 font-medium text-foreground">
                {query.query}
              </td>
              <td className="px-4 py-3 text-right">{fmtNumber(query.impressions)}</td>
              <td className="px-4 py-3 text-right text-emerald-600">{fmtNumber(query.clicks)}</td>
              <td className="px-4 py-3 text-right">{fmtPercent(query.ctr)}</td>
              <td className="py-3 pl-4 text-right">{fmtPosition(query.position)}</td>
            </tr>
          ))}
          {queries.length === 0 && (
            <tr>
              <td colSpan={5} className="py-10 text-center text-muted-foreground">
                Nenhuma consulta sincronizada ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Globe2;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
        <Icon size={18} />
      </div>
      <p className="text-2xl font-black text-foreground">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function StatusBadge({ verdict }: { verdict: string | null }) {
  const status = verdictLabel(verdict);
  const Icon = status.icon;
  return (
    <span className={`inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold ${status.className}`}>
      <Icon size={13} />
      {status.label}
    </span>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[260px] truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`space-y-1.5 ${className || ""}`}>
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
