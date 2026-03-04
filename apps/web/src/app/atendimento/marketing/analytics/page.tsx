'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  BarChart2, Globe, MousePointerClick, TrendingUp, ChevronLeft, ArrowUpRight,
  Users, Activity, Clock, RefreshCw, Wifi, Settings, CheckCircle2, ChevronDown, ChevronUp,
  ExternalLink, AlertCircle, Search, SlidersHorizontal, MessageCircle, TrendingDown,
} from 'lucide-react';
import api from '@/lib/api';

/* ──────────────────────────────────────────────────────────────
   Tipos
────────────────────────────────────────────────────────────── */
interface PageStat {
  page_path: string;
  views: number;
  clicks: number;
  conversion_rate: string;
  top_source: string;
  by_day?: { date: string; views: number; clicks: number }[]; // opcional: API antiga pode não retornar
  trend?: number; // variação percentual visitas: semana atual vs anterior
}

interface PageDetail {
  page_path: string;
  total_views: number;
  total_clicks: number;
  conversion_rate: string;
  by_source: { source: string; medium: string | null; campaign: string | null; views: number; clicks: number }[];
  by_day: { date: string; views: number; clicks: number }[];
}

interface Ga4Summary {
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: string;
  avgDurationSec: number;
  pageViews: number;
  by_channel: { channel: string; sessions: number; users: number }[];
  by_day: { date: string; sessions: number; users: number }[];
}

type SortKey = 'views' | 'clicks' | 'conversion' | 'name';

/* ──────────────────────────────────────────────────────────────
   Utilitários
────────────────────────────────────────────────────────────── */
const PAGE_NAMES: Record<string, string> = {
  '/': 'Home — Página Principal',
  '/geral/arapiraca': 'Arapiraca — AL',
};

function getPageName(path: string): string {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  const lpMatch = path.match(/^\/lp\/(.+)$/);
  if (lpMatch) return lpMatch[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 0) return segments[segments.length - 1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return path;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function fmtChannel(ch: string): string {
  const map: Record<string, string> = {
    'Organic Search': 'Orgânico',
    'Paid Search': 'Google Ads',
    'Direct': 'Direto',
    'Social': 'Social',
    'Referral': 'Referência',
    'Email': 'E-mail',
    'Organic Social': 'Social Orgânico',
    'Unassigned': 'Não atrib.',
    'Other': 'Outro',
  };
  return map[ch] || ch;
}

function fmtSource(src: string): string {
  const map: Record<string, string> = {
    direto:          'Direto',
    organico:        'Orgânico',       // legado
    google_organico: '🔍 Google Orgânico',
    google_ads:      '📢 Google Ads',
    busca_organica:  '🔍 Busca Orgânica',
    facebook:        '📘 Facebook',
    instagram:       '📸 Instagram',
    linkedin:        '💼 LinkedIn',
    twitter:         '𝕏 Twitter/X',
    youtube:         '▶️ YouTube',
    whatsapp:        '💬 WhatsApp',
    referencia:      '🔗 Referência',
    google:          '🔍 Google',       // legado
  };
  return map[src] || src;
}

function conversionColor(rate: string): string {
  const n = parseFloat(rate);
  if (n >= 15) return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
  if (n >= 8)  return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
  if (n >= 3)  return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

/* ──────────────────────────────────────────────────────────────
   Componentes visuais
────────────────────────────────────────────────────────────── */
/** Mini gráfico de barras 7 dias — visitas (claro) + cliques WA (escuro) */
function MiniSparkline({ data }: { data: NonNullable<PageStat['by_day']> }) {
  if (!data || data.length === 0) return null;
  const maxV = Math.max(...data.map((d) => d.views), 1);
  return (
    <div className="flex items-end gap-0.5 h-9">
      {data.map((d, i) => (
        <div
          key={i}
          title={`${d.date.slice(5)}: ${d.views} visitas · ${d.clicks} cliques`}
          className="flex-1 flex flex-col justify-end h-full"
        >
          <div
            className="w-full bg-primary/20 rounded-[2px] relative"
            style={{ height: `${Math.max(3, (d.views / maxV) * 36)}px` }}
          >
            {d.clicks > 0 && (
              <div
                className="absolute bottom-0 left-0 right-0 bg-primary rounded-[2px]"
                style={{ height: `${Math.max(2, (d.clicks / Math.max(d.views, 1)) * 100)}%` }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Gráfico de barras no detalhe de LP */
function DayChart({ data }: { data: PageDetail['by_day'] }) {
  const maxViews = Math.max(...data.map((d) => d.views), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.views} views, ${d.clicks} cliques`}>
          <div className="w-full flex flex-col justify-end" style={{ height: 52 }}>
            <div
              className="w-full bg-primary/30 rounded-sm relative"
              style={{ height: `${Math.max(4, (d.views / maxViews) * 52)}px` }}
            >
              {d.clicks > 0 && (
                <div
                  className="absolute bottom-0 left-0 right-0 bg-primary rounded-sm"
                  style={{ height: `${Math.max(2, (d.clicks / d.views) * 100)}%` }}
                />
              )}
            </div>
          </div>
          <span className="text-[8px] text-muted-foreground">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/** Gráfico GA4 */
function Ga4DayChart({ data }: { data: Ga4Summary['by_day'] }) {
  const maxSessions = Math.max(...data.map((d) => d.sessions), 1);
  return (
    <div className="flex items-end gap-1 h-14">
      {data.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.sessions} sessões`}>
          <div className="w-full flex flex-col justify-end" style={{ height: 44 }}>
            <div
              className="w-full bg-violet-500/30 rounded-sm"
              style={{ height: `${Math.max(3, (d.sessions / maxSessions) * 44)}px` }}
            />
          </div>
          <span className="text-[8px] text-muted-foreground">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/** Card de uma Landing Page */
function LpCard({ page, onClick }: { page: PageStat; onClick: () => void }) {
  const convClass = conversionColor(page.conversion_rate);
  const hasTrend = page.trend !== undefined && page.trend !== 0;
  const trendUp = (page.trend ?? 0) > 0;

  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-2xl p-4 cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 group flex flex-col gap-3"
    >
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm text-foreground truncate leading-tight">{getPageName(page.page_path)}</p>
          <p className="font-mono text-[10px] text-muted-foreground truncate mt-0.5">{page.page_path}</p>
        </div>
        <a
          href={page.page_path}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all"
          title="Abrir LP"
        >
          <ArrowUpRight size={13} />
        </a>
      </div>

      {/* Conversão em destaque */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center px-3 py-1 rounded-xl text-2xl font-black border ${convClass}`}>
          {page.conversion_rate}
        </span>
        <span className="text-[10px] text-muted-foreground leading-tight">taxa de<br />conversão</span>
      </div>

      {/* Visitas + Cliques WA */}
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Globe size={11} />
          <span className="font-semibold text-foreground">{page.views.toLocaleString('pt-BR')}</span> visitas
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <MessageCircle size={11} className="text-emerald-500" />
          <span className="font-semibold text-emerald-500">{page.clicks.toLocaleString('pt-BR')}</span> WA
        </span>
      </div>

      {/* Sparkline 7 dias */}
      {page.by_day && page.by_day.length > 0 && <MiniSparkline data={page.by_day} />}

      {/* Rodapé: fonte + tendência */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground capitalize bg-muted/50 px-2 py-0.5 rounded-full">
          {fmtSource(page.top_source)}
        </span>
        {hasTrend ? (
          <span className={`flex items-center gap-0.5 text-[11px] font-bold ${trendUp ? 'text-emerald-500' : 'text-red-400'}`}>
            {trendUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trendUp ? '+' : ''}{page.trend ?? 0}% esta semana
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">→ sem variação</span>
        )}
      </div>
    </div>
  );
}

/** Painel GA4 (colapsável) */
function Ga4Panel({ data }: { data: Ga4Summary }) {
  const maxCh = Math.max(...data.by_channel.map((c) => c.sessions), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Sessões',   value: data.sessions.toLocaleString('pt-BR'),  icon: Activity,    color: 'text-violet-500 bg-violet-500/10' },
          { label: 'Usuários',  value: data.users.toLocaleString('pt-BR'),     icon: Users,       color: 'text-blue-500 bg-blue-500/10' },
          { label: 'Novos',     value: data.newUsers.toLocaleString('pt-BR'),  icon: TrendingUp,  color: 'text-emerald-500 bg-emerald-500/10' },
          { label: 'Bounce',    value: data.bounceRate,                         icon: RefreshCw,   color: 'text-amber-500 bg-amber-500/10' },
          { label: 'Duração',   value: fmtDuration(data.avgDurationSec),       icon: Clock,       color: 'text-rose-500 bg-rose-500/10' },
          { label: 'Pageviews', value: data.pageViews.toLocaleString('pt-BR'), icon: Globe,       color: 'text-sky-500 bg-sky-500/10' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-2.5">
            <div className={`w-6 h-6 rounded-lg ${color} flex items-center justify-center mb-1.5`}>
              <Icon size={12} />
            </div>
            <p className="text-sm font-bold text-foreground leading-none">{value}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5 uppercase font-semibold tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      {data.by_channel.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Canais de tráfego</p>
          {data.by_channel.slice(0, 5).map((ch) => {
            const pct = Math.round((ch.sessions / maxCh) * 100);
            return (
              <div key={ch.channel} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-foreground">{fmtChannel(ch.channel)}</span>
                  <span className="text-muted-foreground tabular-nums">{ch.sessions.toLocaleString('pt-BR')} sessões</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.by_day.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Sessões — últimos 7 dias</p>
          <Ga4DayChart data={data.by_day} />
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Página principal
────────────────────────────────────────────────────────────── */
export default function AnalyticsDashboard() {
  const [pages, setPages]               = useState<PageStat[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState<PageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [ga4, setGa4]                   = useState<Ga4Summary | null>(null);
  const [loadingGa4, setLoadingGa4]     = useState(true);

  // Busca e ordenação
  const [search, setSearch]   = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('views');

  // Painéis colapsáveis
  const [showGa4Panel,  setShowGa4Panel]  = useState(false);
  const [showGa4Config, setShowGa4Config] = useState(false);

  // GA4 Config
  const [ga4Configured,  setGa4Configured]  = useState(false);
  const [ga4PropertyId,  setGa4PropertyId]  = useState('');
  const [ga4JsonText,    setGa4JsonText]    = useState('');
  const [savingGa4Config, setSavingGa4Config] = useState(false);
  const [ga4ConfigSaved, setGa4ConfigSaved] = useState(false);
  const [ga4ConfigError, setGa4ConfigError] = useState('');

  const loadGa4Config = () =>
    api.get('/analytics/ga4-config')
      .then((r) => {
        setGa4Configured(r.data.isConfigured);
        if (r.data.propertyId) setGa4PropertyId(r.data.propertyId);
      })
      .catch(console.error);

  const handleSaveGa4Config = async () => {
    if (!ga4PropertyId.trim()) { setGa4ConfigError('Informe o Property ID.'); return; }
    if (!ga4JsonText.trim())   { setGa4ConfigError('Cole o JSON da Service Account.'); return; }
    try { JSON.parse(ga4JsonText); } catch { setGa4ConfigError('JSON inválido. Verifique o arquivo copiado.'); return; }
    setSavingGa4Config(true);
    setGa4ConfigError('');
    try {
      await api.post('/analytics/ga4-config', { propertyId: ga4PropertyId.trim(), serviceAccountJson: ga4JsonText.trim() });
      setGa4Configured(true);
      setGa4ConfigSaved(true);
      setGa4JsonText('');
      setShowGa4Config(false);
      setTimeout(() => setGa4ConfigSaved(false), 3000);
      setLoadingGa4(true);
      api.get('/analytics/ga4').then((r) => setGa4(r.data)).catch(console.error).finally(() => setLoadingGa4(false));
    } catch (e: any) {
      setGa4ConfigError(e?.response?.data?.message || 'Erro ao salvar. Verifique o JSON.');
    } finally {
      setSavingGa4Config(false);
    }
  };

  useEffect(() => {
    api.get('/analytics/pages').then((r) => setPages(r.data)).catch(console.error).finally(() => setLoading(false));
    api.get('/analytics/ga4').then((r) => setGa4(r.data)).catch(console.error).finally(() => setLoadingGa4(false));
    loadGa4Config();
  }, []);

  const openDetail = async (path: string) => {
    setLoadingDetail(true);
    try {
      const r = await api.get(`/analytics/detail?path=${encodeURIComponent(path)}`);
      setSelected(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Filtra e ordena LPs
  const filteredPages = useMemo(() => {
    const q = search.toLowerCase();
    let list = q
      ? pages.filter((p) => p.page_path.toLowerCase().includes(q) || getPageName(p.page_path).toLowerCase().includes(q))
      : [...pages];
    switch (sortKey) {
      case 'views':      list.sort((a, b) => b.views - a.views); break;
      case 'clicks':     list.sort((a, b) => b.clicks - a.clicks); break;
      case 'conversion': list.sort((a, b) => parseFloat(b.conversion_rate) - parseFloat(a.conversion_rate)); break;
      case 'name':       list.sort((a, b) => getPageName(a.page_path).localeCompare(getPageName(b.page_path))); break;
    }
    return list;
  }, [pages, search, sortKey]);

  const totalViews      = pages.reduce((s, p) => s + p.views, 0);
  const totalClicks     = pages.reduce((s, p) => s + p.clicks, 0);
  const overallConversion = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) + '%' : '0%';

  return (
    <div className="flex h-full bg-background overflow-hidden">

      {/* ── Coluna principal (lista de LPs) ── */}
      <div className={`flex flex-col min-h-0 ${selected ? 'hidden md:flex md:w-96 border-r border-border' : 'flex-1'}`}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-card/50 shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <BarChart2 size={17} />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground leading-tight">Analytics de Landing Pages</h1>
              <p className="text-[10px] text-muted-foreground">Últimos 30 dias · {pages.length} {pages.length === 1 ? 'página' : 'páginas'} rastreadas</p>
            </div>
          </div>

          {/* Totais globais compactos */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: 'Visitas',   value: totalViews.toLocaleString('pt-BR'),   icon: Globe,           color: 'text-blue-500 bg-blue-500/10' },
              { label: 'Cliques WA', value: totalClicks.toLocaleString('pt-BR'), icon: MousePointerClick, color: 'text-emerald-500 bg-emerald-500/10' },
              { label: 'Conversão', value: overallConversion,                    icon: TrendingUp,       color: 'text-amber-500 bg-amber-500/10' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-2.5">
                <div className={`w-5 h-5 rounded-lg ${color} flex items-center justify-center mb-1`}>
                  <Icon size={11} />
                </div>
                <p className="text-base font-bold text-foreground leading-none">{value}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5 uppercase font-semibold tracking-wide">{label}</p>
              </div>
            ))}
          </div>

          {/* Busca + Ordenação */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar LP por nome ou URL..."
                className="w-full bg-muted/50 border border-border rounded-xl pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary/40 transition-all"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-xl px-2.5 py-1.5">
              <SlidersHorizontal size={11} className="text-muted-foreground shrink-0" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="bg-transparent outline-none cursor-pointer text-foreground text-xs"
              >
                <option value="views">Mais visitadas</option>
                <option value="conversion">Mais conversão</option>
                <option value="clicks">Mais cliques</option>
                <option value="name">Nome A-Z</option>
              </select>
            </div>
          </div>
        </div>

        {/* Grid de cards de LP */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Carregando…</div>
          ) : filteredPages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Globe size={40} className="text-muted-foreground/30" />
              {search ? (
                <p className="text-muted-foreground text-sm">Nenhuma LP encontrada para &ldquo;<strong>{search}</strong>&rdquo;</p>
              ) : (
                <>
                  <p className="text-muted-foreground font-medium">Nenhuma visita registrada ainda.</p>
                  <p className="text-xs text-muted-foreground">Adicione <code className="bg-muted px-1 rounded">&lt;LPTracker /&gt;</code> nas suas páginas.</p>
                </>
              )}
            </div>
          ) : (
            <div className={`grid gap-3 ${selected ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'}`}>
              {filteredPages.map((p) => (
                <LpCard key={p.page_path} page={p} onClick={() => openDetail(p.page_path)} />
              ))}
            </div>
          )}
        </div>

        {/* Painel GA4 — colapsável, fechado por padrão */}
        <div className="shrink-0 border-t border-border">
          <button
            onClick={() => setShowGa4Panel((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold hover:bg-muted/30 transition-colors"
          >
            <span className="flex items-center gap-2 text-violet-500">
              <Wifi size={13} />
              Google Analytics · Site completo
              {!loadingGa4 && ga4 && (
                <span className="text-[10px] text-muted-foreground font-normal normal-case">
                  {ga4.sessions} sessões · {ga4.users} usuários
                </span>
              )}
              {!loadingGa4 && !ga4 && !ga4Configured && (
                <span className="text-[10px] text-amber-500 font-normal normal-case">NÃO CONFIGURADO</span>
              )}
            </span>
            {showGa4Panel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {showGa4Panel && (
            <div className="px-4 pb-4 bg-violet-500/5 border-t border-violet-500/10">
              <div className="pt-3">
                {loadingGa4 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                    <Wifi size={13} className="text-violet-400 animate-pulse" />
                    <span>Carregando Google Analytics…</span>
                  </div>
                ) : ga4 ? (
                  <Ga4Panel data={ga4} />
                ) : (
                  <p className="text-xs text-muted-foreground py-2">
                    Configure as credenciais GA4 abaixo para ver os dados do site.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Configuração GA4 — colapsável */}
        <div className="shrink-0 border-t border-border">
          <button
            onClick={() => setShowGa4Config((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Settings size={12} />
              Configurar Google Analytics (GA4)
              {ga4Configured && !ga4ConfigSaved && (
                <span className="flex items-center gap-1 text-emerald-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> CONECTADO
                </span>
              )}
              {ga4ConfigSaved && (
                <span className="flex items-center gap-1 text-emerald-500">
                  <CheckCircle2 size={12} /> Salvo!
                </span>
              )}
              {!ga4Configured && (
                <span className="text-amber-500">NÃO CONFIGURADO</span>
              )}
            </span>
            {showGa4Config ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showGa4Config && (
            <div className="px-4 pb-5 pt-1 space-y-4 bg-muted/20">
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-violet-500 uppercase tracking-wider">Como obter as credenciais</p>
                <div className="space-y-2 text-[11px] text-muted-foreground">
                  {[
                    <span key={1}><strong className="text-foreground">Property ID:</strong> acesse <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline inline-flex items-center gap-0.5">analytics.google.com <ExternalLink size={9} /></a> → ⚙ Admin → Property Settings → copie o número em &ldquo;Property ID&rdquo;.</span>,
                    <span key={2}><strong className="text-foreground">Service Account:</strong> acesse <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline inline-flex items-center gap-0.5">console.cloud.google.com <ExternalLink size={9} /></a> → APIs &amp; Services → Library → ative <strong className="text-foreground">&ldquo;Google Analytics Data API&rdquo;</strong>.</span>,
                    <span key={3}>Cloud Console → APIs &amp; Services → <strong className="text-foreground">Credentials</strong> → + Create Credentials → <strong className="text-foreground">Service Account</strong>. Dê um nome (ex: &ldquo;analytics-reader&rdquo;) e finalize.</span>,
                    <span key={4}>Clique na service account → aba <strong className="text-foreground">Keys</strong> → Add Key → Create New Key → <strong className="text-foreground">JSON</strong>. Copie todo o conteúdo do .json baixado e cole abaixo.</span>,
                    <span key={5}>GA4 → ⚙ Admin → <strong className="text-foreground">Property Access Management</strong> → + → cole o email da service account (campo <code className="font-mono bg-muted px-0.5 rounded">client_email</code>) → Permissão: <strong className="text-foreground">Viewer</strong>.</span>,
                  ].map((content, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 w-4 h-4 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-[9px] font-bold">{i + 1}</span>
                      {content}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                    Property ID <span className="normal-case font-normal text-muted-foreground/60">(somente o número, ex: 484715478)</span>
                  </label>
                  <input
                    value={ga4PropertyId}
                    onChange={(e) => setGa4PropertyId(e.target.value.replace('properties/', ''))}
                    placeholder="484715478"
                    className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500/50 transition-all font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                    Service Account JSON <span className="normal-case font-normal text-muted-foreground/60">(conteúdo completo do .json)</span>
                  </label>
                  <textarea
                    value={ga4JsonText}
                    onChange={(e) => { setGa4JsonText(e.target.value); setGa4ConfigError(''); }}
                    placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
                    rows={6}
                    className="w-full font-mono text-[11px] bg-card border border-border rounded-xl px-3 py-2 resize-y outline-none focus:border-violet-500/50 transition-all leading-relaxed"
                  />
                  {ga4Configured && !ga4JsonText && (
                    <p className="text-[11px] text-emerald-500">✓ Credenciais já configuradas. Cole um novo JSON para substituir.</p>
                  )}
                </div>

                {ga4ConfigError && (
                  <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertCircle size={12} /> {ga4ConfigError}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveGa4Config}
                    disabled={savingGa4Config}
                    className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2 rounded-xl font-bold text-sm transition-all disabled:opacity-50 shadow-lg shadow-violet-500/20"
                  >
                    {savingGa4Config ? <RefreshCw className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                    Salvar e Conectar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Painel de Detalhe da LP selecionada ── */}
      {selected && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          <div className="p-5 border-b border-border bg-card/50 flex items-center gap-3 shrink-0">
            <button
              onClick={() => setSelected(null)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{getPageName(selected.page_path)}</p>
              <code className="text-[11px] text-muted-foreground">{selected.page_path}</code>
            </div>
            <a
              href={selected.page_path}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-primary shrink-0"
              title="Abrir landing page"
            >
              <ArrowUpRight size={16} />
            </a>
          </div>

          {loadingDetail ? (
            <div className="p-12 text-center text-muted-foreground text-sm">Carregando…</div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Métricas */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Visitas (30d)',   value: selected.total_views.toLocaleString('pt-BR') },
                  { label: 'Cliques WA (30d)', value: selected.total_clicks.toLocaleString('pt-BR') },
                  { label: 'Conversão',        value: selected.conversion_rate },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card border border-border rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{value}</p>
                    <p className="text-xs text-muted-foreground mt-1 uppercase font-semibold tracking-wide">{label}</p>
                  </div>
                ))}
              </div>

              {/* Gráfico 7 dias */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-bold text-foreground mb-4">Últimos 7 dias</h3>
                <DayChart data={selected.by_day} />
                <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-primary/30 rounded-sm inline-block" /> Visitas</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-primary rounded-sm inline-block" /> Cliques WA</span>
                </div>
              </div>

              {/* Por fonte */}
              {selected.by_source.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5">
                  <h3 className="text-sm font-bold text-foreground mb-4">Por Fonte de Tráfego</h3>
                  <div className="space-y-3">
                    {selected.by_source
                      .sort((a, b) => b.views - a.views)
                      .map((s, i) => {
                        const total = selected.by_source.reduce((acc, x) => acc + x.views, 0);
                        const pct = total > 0 ? Math.round((s.views / total) * 100) : 0;
                        const label = fmtSource(s.source) + (s.medium && !s.source.startsWith('google') ? ` / ${s.medium}` : '');
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground capitalize">{label}</span>
                              <span className="text-muted-foreground tabular-nums">{s.views} views · {s.clicks} cliques</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            {s.campaign && (
                              <p className="text-[10px] text-muted-foreground">Campanha: {s.campaign}</p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
