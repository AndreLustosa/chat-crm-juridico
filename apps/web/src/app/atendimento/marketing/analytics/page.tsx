'use client';

import { useEffect, useState } from 'react';
import { BarChart2, Globe, MousePointerClick, TrendingUp, ChevronRight, ChevronLeft, ArrowUpRight } from 'lucide-react';
import api from '@/lib/api';

interface PageStat {
  page_path: string;
  views: number;
  clicks: number;
  conversion_rate: string;
  top_source: string;
}

interface PageDetail {
  page_path: string;
  total_views: number;
  total_clicks: number;
  conversion_rate: string;
  by_source: { source: string; medium: string | null; campaign: string | null; views: number; clicks: number }[];
  by_day: { date: string; views: number; clicks: number }[];
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function DayChart({ data }: { data: PageDetail['by_day'] }) {
  const maxViews = Math.max(...data.map((d) => d.views), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.views} views, ${d.clicks} cliques`}>
          <div className="w-full flex flex-col justify-end" style={{ height: 52 }}>
            <div
              className="w-full bg-primary/30 rounded-sm relative group"
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

export default function AnalyticsDashboard() {
  const [pages, setPages] = useState<PageStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    api.get('/analytics/pages')
      .then((r) => setPages(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
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

  const totalViews = pages.reduce((s, p) => s + p.views, 0);
  const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
  const overallConversion = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) + '%' : '0%';
  const maxViews = Math.max(...pages.map((p) => p.views), 1);

  return (
    <div className="flex h-full bg-background overflow-hidden">

      {/* Lista de páginas */}
      <div className={`flex flex-col min-h-0 ${selected ? 'hidden md:flex md:w-96 border-r border-border' : 'flex-1'}`}>
        {/* Header */}
        <div className="p-6 border-b border-border bg-card/50 shrink-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <BarChart2 size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Analytics de Landing Pages</h1>
              <p className="text-xs text-muted-foreground">Últimos 30 dias · atualizado em tempo real</p>
            </div>
          </div>

          {/* Totais */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Visitas', value: totalViews.toLocaleString('pt-BR'), icon: Globe, color: 'text-blue-500 bg-blue-500/10' },
              { label: 'Cliques WA', value: totalClicks.toLocaleString('pt-BR'), icon: MousePointerClick, color: 'text-emerald-500 bg-emerald-500/10' },
              { label: 'Conversão', value: overallConversion, icon: TrendingUp, color: 'text-amber-500 bg-amber-500/10' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-3">
                <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center mb-2`}>
                  <Icon size={14} />
                </div>
                <p className="text-lg font-bold text-foreground leading-none">{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 uppercase font-semibold tracking-wide">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabela */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground text-sm">Carregando...</div>
          ) : pages.length === 0 ? (
            <div className="p-12 text-center">
              <Globe size={40} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground font-medium">Nenhuma visita registrada ainda.</p>
              <p className="text-xs text-muted-foreground mt-1">Adicione <code className="bg-muted px-1 rounded">&lt;LPTracker /&gt;</code> nas suas páginas.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  <th className="text-left px-4 py-2.5">Página</th>
                  <th className="text-right px-3 py-2.5">Visitas</th>
                  <th className="text-right px-3 py-2.5">Cliques</th>
                  <th className="text-right px-4 py-2.5">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr
                    key={p.page_path}
                    onClick={() => openDetail(p.page_path)}
                    className="border-b border-border/50 hover:bg-muted/40 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-foreground truncate max-w-[160px]">{p.page_path}</span>
                        <ArrowUpRight size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                      </div>
                      <div className="mt-1.5">
                        <MiniBar value={p.views} max={maxViews} />
                      </div>
                      <span className="text-[10px] text-muted-foreground capitalize mt-0.5 block">{p.top_source}</span>
                    </td>
                    <td className="text-right px-3 py-3 font-semibold tabular-nums">{p.views.toLocaleString('pt-BR')}</td>
                    <td className="text-right px-3 py-3 font-semibold tabular-nums text-emerald-500">{p.clicks.toLocaleString('pt-BR')}</td>
                    <td className="text-right px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold">{p.conversion_rate}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Painel de Detalhe */}
      {selected && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          <div className="p-6 border-b border-border bg-card/50 flex items-center gap-3 shrink-0">
            <button
              onClick={() => setSelected(null)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            >
              <ChevronLeft size={18} />
            </button>
            <code className="text-sm font-bold text-foreground bg-muted px-3 py-1 rounded-lg">{selected.page_path}</code>
          </div>

          {loadingDetail ? (
            <div className="p-12 text-center text-muted-foreground text-sm">Carregando...</div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Métricas */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Visitas (30d)', value: selected.total_views.toLocaleString('pt-BR') },
                  { label: 'Cliques WA (30d)', value: selected.total_clicks.toLocaleString('pt-BR') },
                  { label: 'Conversão', value: selected.conversion_rate },
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
                        const label = s.source === 'google_ads'
                          ? 'Google Ads'
                          : s.source === 'organico'
                          ? 'Orgânico'
                          : `${s.source}${s.medium ? ' / ' + s.medium : ''}`;
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
