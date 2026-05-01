'use client';

import { useEffect, useState } from 'react';
import {
  DollarSign,
  Users,
  TrendingUp,
  Target,
  MousePointerClick,
  PauseCircle,
  PlayCircle,
  Activity,
} from 'lucide-react';
import api from '@/lib/api';
import { KpiCard } from './KpiCard';

interface DashboardData {
  connected: boolean;
  synced?: boolean;
  message?: string;
  account?: {
    customer_id: string;
    account_name: string | null;
    last_sync_at: string | null;
  } | null;
  kpis?: {
    spend_today_brl: number;
    spend_month_brl: number;
    leads_today: number;
    cpl_brl: number;
    ctr: number;
    avg_cpc_brl: number;
    roas_estimated: number;
    active_campaigns: number;
    paused_campaigns: number;
  };
  timeseries?: { date: string; spend_brl: number; leads: number }[];
  top_campaigns?: {
    id: string;
    name: string;
    channel_type: string | null;
    cost_brl: number;
    conversions: number;
    cpl_brl: number;
  }[];
  at_risk_campaigns?: { id: string; name: string; reason: string }[];
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(v || 0);

const fmtPct = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);

/**
 * Cor do ROAS por faixa: vermelho (deficit), amarelo (perto do break-even),
 * verde (lucrativo), muted quando nao ha dados (sync sem conversions_value).
 */
function roasAccent(
  roas: number,
): 'danger' | 'warning' | 'success' | 'muted' {
  if (roas <= 0) return 'muted';
  if (roas < 1) return 'danger';
  if (roas < 2) return 'warning';
  return 'success';
}

function roasHint(roas: number): string | undefined {
  if (roas <= 0) {
    // ROAS depende de conversions_value > 0. Se for 0, normalmente eh
    // ConversionAction sem valor padrao configurado no Google.
    return 'Sem valor de conversão — defina default_value nas ConversionActions';
  }
  if (roas < 1) return 'Abaixo do break-even (1x)';
  if (roas < 2) return 'Próximo do break-even';
  return undefined;
}

export function DashboardTab() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<DashboardData>('/trafego/dashboard');
        if (!cancelled) setData(res.data);
      } catch {
        if (!cancelled) setData({ connected: false, message: 'Erro ao carregar dashboard.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Estado de "ainda nao sincronizou"
  if (!loading && data?.connected && !data.synced) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Activity size={40} className="mx-auto text-muted-foreground mb-3" />
        <h3 className="text-lg font-bold text-foreground mb-1">
          Aguardando primeiro sync
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          A conta foi conectada com sucesso. O primeiro sync acontece
          automaticamente às 06h, ou você pode disparar manualmente em
          Configurações.
        </p>
      </div>
    );
  }

  const k = data?.kpis;

  return (
    <div className="space-y-6">
      {/* ─── Linha 1: KPIs principais ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Gasto hoje"
          value={fmtBRL(k?.spend_today_brl ?? 0)}
          icon={DollarSign}
          accent="primary"
          loading={loading}
        />
        <KpiCard
          label="Gasto no mês"
          value={fmtBRL(k?.spend_month_brl ?? 0)}
          icon={TrendingUp}
          accent="primary"
          loading={loading}
        />
        <KpiCard
          label="Leads hoje"
          value={String(k?.leads_today ?? 0)}
          icon={Users}
          accent="success"
          loading={loading}
        />
        <KpiCard
          label="CPL médio"
          value={fmtBRL(k?.cpl_brl ?? 0)}
          icon={Target}
          accent="warning"
          loading={loading}
        />
      </div>

      {/* ─── Linha 2: KPIs secundários ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="CTR médio"
          value={fmtPct(k?.ctr ?? 0)}
          icon={MousePointerClick}
          accent="muted"
          loading={loading}
        />
        <KpiCard
          label="CPC médio"
          value={fmtBRL(k?.avg_cpc_brl ?? 0)}
          accent="muted"
          loading={loading}
        />
        <KpiCard
          label="ROAS estimado"
          value={`${(k?.roas_estimated ?? 0).toFixed(2)}x`}
          accent={roasAccent(k?.roas_estimated ?? 0)}
          hint={roasHint(k?.roas_estimated ?? 0)}
          loading={loading}
        />
        <KpiCard
          label="Campanhas ativas"
          value={String(k?.active_campaigns ?? 0)}
          icon={PlayCircle}
          accent="success"
          loading={loading}
        />
        <KpiCard
          label="Campanhas pausadas"
          value={String(k?.paused_campaigns ?? 0)}
          icon={PauseCircle}
          accent="muted"
          loading={loading}
        />
      </div>

      {/* ─── Gráficos ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-1">
            Evolução diária
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Gasto vs. leads nos últimos 30 dias
          </p>
          <Timeseries data={data?.timeseries ?? []} />
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-1">
            Top campanhas
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Menor gasto com conversões nos últimos 7 dias
          </p>
          <TopCampaigns data={data?.top_campaigns ?? []} />
        </div>
      </div>

      {/* Footer: ultimo sync */}
      {data?.account?.last_sync_at && (
        <p className="text-[11px] text-muted-foreground text-right">
          Último sync:{' '}
          {new Date(data.account.last_sync_at).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}

// ─── Componentes auxiliares ────────────────────────────────────────────────

/**
 * Gráfico de barras simples (sem dependência de lib) — barras verticais
 * com altura proporcional ao gasto. Tooltip via title nativo.
 */
function Timeseries({
  data,
}: {
  data: { date: string; spend_brl: number; leads: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="h-48 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
        Sem dados ainda — aguarde primeiro sync.
      </div>
    );
  }

  const maxSpend = Math.max(...data.map((d) => d.spend_brl), 1);
  const totalSpend = data.reduce((s, d) => s + d.spend_brl, 0);
  const totalLeads = data.reduce((s, d) => s + d.leads, 0);

  return (
    <div>
      <div className="flex items-end h-48 gap-px">
        {data.map((d) => {
          const heightPct = (d.spend_brl / maxSpend) * 100;
          const dayLabel = d.date.slice(8, 10) + '/' + d.date.slice(5, 7);
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col-reverse min-w-[8px]"
              title={`${dayLabel}: ${fmtBRL(d.spend_brl)} • ${d.leads} leads`}
            >
              <div
                className="bg-primary/70 hover:bg-primary rounded-t transition-colors"
                style={{ height: `${heightPct}%`, minHeight: d.spend_brl > 0 ? '2px' : '0' }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-muted-foreground tabular-nums">
        <span>{data[0]?.date.slice(8, 10) + '/' + data[0]?.date.slice(5, 7)}</span>
        <span>{data[data.length - 1]?.date.slice(8, 10) + '/' + data[data.length - 1]?.date.slice(5, 7)}</span>
      </div>
      <div className="flex justify-between mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground">
        <span>
          Total gasto: <strong className="text-foreground">{fmtBRL(totalSpend)}</strong>
        </span>
        <span>
          Total leads: <strong className="text-foreground">{totalLeads}</strong>
        </span>
      </div>
    </div>
  );
}

/**
 * Lista compacta de top 5 campanhas com CPL/gasto/conversões.
 */
function TopCampaigns({
  data,
}: {
  data: {
    id: string;
    name: string;
    channel_type: string | null;
    cost_brl: number;
    conversions: number;
    cpl_brl: number;
  }[];
}) {
  if (data.length === 0) {
    return (
      <div className="h-48 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground text-center px-4">
        Sem campanhas com conversões nos últimos 7 dias.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((c, i) => (
        <div
          key={c.id}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30"
        >
          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground truncate" title={c.name}>
              {c.name}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {c.channel_type ?? '—'} · {c.conversions} conv · {fmtBRL(c.cost_brl)} gasto
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-bold text-foreground tabular-nums">
              {fmtBRL(c.cpl_brl)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              CPL
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
