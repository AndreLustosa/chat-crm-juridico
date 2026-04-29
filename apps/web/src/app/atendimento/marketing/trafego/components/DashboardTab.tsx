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
  timeseries?: { date: string; spend: number; leads: number }[];
  top_campaigns?: { id: string; name: string; cpl: number }[];
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
          accent="success"
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

      {/* ─── Gráficos (placeholders Fase 3) ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-1">
            Evolução diária
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Gasto vs. leads nos últimos 30 dias
          </p>
          <div className="h-48 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
            (gráfico será implementado na Fase 3)
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-1">
            Top campanhas
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Por menor CPL no período
          </p>
          <div className="h-48 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
            (lista será implementada na Fase 3)
          </div>
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
