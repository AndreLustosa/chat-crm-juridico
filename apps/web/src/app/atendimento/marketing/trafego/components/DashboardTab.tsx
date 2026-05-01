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
  Gauge,
} from 'lucide-react';
import api from '@/lib/api';
import { KpiCard } from './KpiCard';

type Period = 'today' | '7d' | '30d' | 'month' | 'prev_month';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  month: 'Mês atual',
  prev_month: 'Mês anterior',
};

interface DashboardData {
  connected: boolean;
  synced?: boolean;
  message?: string;
  account?: {
    customer_id: string;
    account_name: string | null;
    last_sync_at: string | null;
  } | null;
  period?: Period;
  kpis?: {
    spend_today_brl: number;
    spend_month_brl: number;
    spend_range_brl: number;
    leads_today: number;
    leads_avg_7d: number;
    leads_range: number;
    cpl_brl: number;
    ctr: number;
    avg_cpc_brl: number;
    roas_estimated: number;
    active_campaigns: number;
    paused_campaigns: number;
  };
  pacing?: {
    target_monthly_brl: number;
    target_to_date_brl: number;
    spent_brl: number;
    pct_used: number;
    pct_expected: number;
    status: 'AHEAD' | 'ON_TRACK' | 'BEHIND';
  } | null;
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
  const [period, setPeriod] = useState<Period>('7d');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get<DashboardData>('/trafego/dashboard', {
          params: { period },
        });
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
  }, [period]);

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
  const isToday = period === 'today';
  const isPrevMonth = period === 'prev_month';
  const periodLabel = PERIOD_LABELS[period];

  // Spend label do KPI principal muda conforme período: hoje/mês são
  // valores instantâneos; 7d/30d/prev_month são totais da janela.
  const primarySpendLabel = isToday
    ? 'Gasto hoje'
    : period === 'month'
      ? 'Gasto no mês'
      : isPrevMonth
        ? 'Gasto mês ant.'
        : `Gasto ${periodLabel.toLowerCase()}`;
  const primarySpendValue =
    isToday
      ? k?.spend_today_brl ?? 0
      : period === 'month'
        ? k?.spend_month_brl ?? 0
        : k?.spend_range_brl ?? 0;

  return (
    <div className="space-y-6">
      {/* ─── Seletor de período ─────────────────────────────────────────── */}
      <PeriodSelector value={period} onChange={setPeriod} disabled={loading} />

      {/* ─── Linha 1: KPIs principais ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={primarySpendLabel}
          value={fmtBRL(primarySpendValue)}
          icon={DollarSign}
          accent="primary"
          loading={loading}
        />
        <KpiCard
          label="Gasto no mês"
          value={fmtBRL(k?.spend_month_brl ?? 0)}
          icon={TrendingUp}
          accent="primary"
          hint={
            data?.pacing
              ? `meta R$ ${(data.pacing.target_monthly_brl ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : 'configure meta em Settings p/ pacing'
          }
          loading={loading}
        />
        <KpiCard
          label={isToday ? 'Leads hoje' : `Leads ${periodLabel.toLowerCase()}`}
          value={String(
            isToday ? k?.leads_today ?? 0 : k?.leads_range ?? 0,
          )}
          icon={Users}
          accent={
            isToday && (k?.leads_today ?? 0) === 0 && (k?.leads_avg_7d ?? 0) > 0
              ? 'warning'
              : 'success'
          }
          hint={
            isToday
              ? `média 7d: ${(k?.leads_avg_7d ?? 0).toFixed(1)}/dia`
              : undefined
          }
          loading={loading}
        />
        <KpiCard
          label={`CPL médio · ${periodLabel.toLowerCase()}`}
          value={fmtBRL(k?.cpl_brl ?? 0)}
          icon={Target}
          accent="warning"
          loading={loading}
        />
      </div>

      {/* ─── Pacing card (só renderiza com meta configurada) ────────────── */}
      {data?.pacing && <PacingCard pacing={data.pacing} loading={loading} />}

      {/* ─── Linha 2: KPIs secundários ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label={`CTR · ${periodLabel.toLowerCase()}`}
          value={fmtPct(k?.ctr ?? 0)}
          icon={MousePointerClick}
          accent="muted"
          loading={loading}
        />
        <KpiCard
          label={`CPC · ${periodLabel.toLowerCase()}`}
          value={fmtBRL(k?.avg_cpc_brl ?? 0)}
          accent="muted"
          loading={loading}
        />
        <KpiCard
          label="ROAS estimado · 30d"
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

// ─── Seletor de período ────────────────────────────────────────────────────

function PeriodSelector({
  value,
  onChange,
  disabled,
}: {
  value: Period;
  onChange: (p: Period) => void;
  disabled?: boolean;
}) {
  const options: Period[] = ['today', '7d', '30d', 'month', 'prev_month'];
  return (
    <div
      role="tablist"
      aria-label="Selecionar período"
      className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border"
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {PERIOD_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}

// ─── Card de Pacing mensal ────────────────────────────────────────────────

function PacingCard({
  pacing,
  loading,
}: {
  pacing: NonNullable<DashboardData['pacing']>;
  loading: boolean;
}) {
  const accent =
    pacing.status === 'AHEAD'
      ? 'text-red-500 bg-red-500/10 border-red-500/30'
      : pacing.status === 'BEHIND'
        ? 'text-amber-500 bg-amber-500/10 border-amber-500/30'
        : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
  const statusLabel =
    pacing.status === 'AHEAD'
      ? 'Acelerando'
      : pacing.status === 'BEHIND'
        ? 'Atrasado'
        : 'No ritmo';

  // Larguras das barras (clamp 0..100 — display)
  const usedPct = Math.min(100, Math.max(0, pacing.pct_used * 100));
  const expectedPct = Math.min(100, Math.max(0, pacing.pct_expected * 100));

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Gauge size={18} className="text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Pacing mensal
          </h3>
        </div>
        <span
          className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${accent}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="relative h-3 rounded-full bg-muted overflow-hidden mb-2">
        {/* Linha tracejada da meta esperada (até hoje) */}
        <div
          aria-label={`Meta até hoje: ${expectedPct.toFixed(0)}%`}
          className="absolute top-0 bottom-0 w-px bg-foreground/40"
          style={{ left: `${expectedPct}%` }}
        />
        {/* Barra do realizado */}
        <div
          aria-label={`Usado: ${usedPct.toFixed(0)}%`}
          className={`absolute top-0 bottom-0 left-0 transition-all ${
            pacing.status === 'AHEAD'
              ? 'bg-red-500/70'
              : pacing.status === 'BEHIND'
                ? 'bg-amber-500/70'
                : 'bg-emerald-500/70'
          }`}
          style={{ width: `${usedPct}%` }}
        />
      </div>

      {loading ? (
        <div className="h-4 w-40 rounded bg-muted/50 animate-pulse" />
      ) : (
        <div className="flex justify-between items-center text-[11px] text-muted-foreground tabular-nums flex-wrap gap-1">
          <span>
            Gasto:{' '}
            <strong className="text-foreground">
              {fmtBRL(pacing.spent_brl)}
            </strong>{' '}
            ({usedPct.toFixed(0)}%)
          </span>
          <span>
            Meta até hoje:{' '}
            <strong className="text-foreground">
              {fmtBRL(pacing.target_to_date_brl)}
            </strong>{' '}
            ({expectedPct.toFixed(0)}%)
          </span>
          <span>
            Meta mensal:{' '}
            <strong className="text-foreground">
              {fmtBRL(pacing.target_monthly_brl)}
            </strong>
          </span>
        </div>
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
