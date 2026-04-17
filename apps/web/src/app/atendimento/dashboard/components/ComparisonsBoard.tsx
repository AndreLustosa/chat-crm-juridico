'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import type { ComparisonMetric, ComparisonsData } from '../types';

interface Props {
  data: ComparisonsData | null;
  loading: boolean;
}

function formatDelta(pct: number | null): { text: string; color: string; icon: typeof TrendingUp } {
  if (pct === null) return { text: '—', color: 'text-muted-foreground', icon: Minus };
  if (pct === 0) return { text: '0%', color: 'text-muted-foreground', icon: Minus };
  const sign = pct > 0 ? '+' : '';
  // Para "Leads Perdidos" e "Tarefas Atrasadas", variação positiva é RUIM.
  // Mas aqui usamos o padrão: positivo=verde, negativo=vermelho. A interpretação
  // fica com o usuário (o componente não sabe se a métrica é "quanto maior, melhor").
  const color = pct > 0 ? 'text-emerald-500' : 'text-rose-500';
  const icon = pct > 0 ? TrendingUp : TrendingDown;
  return { text: `${sign}${pct.toFixed(1)}%`, color, icon };
}

function formatValue(value: number, suffix?: string): string {
  const n = Math.round(value * 10) / 10;
  return suffix ? `${n}${suffix}` : n.toLocaleString('pt-BR');
}

function MetricCard({ m }: { m: ComparisonMetric }) {
  const dPrev = formatDelta(m.pctVsPrev);
  const dYear = formatDelta(m.pctVsYear);
  const DPrevIcon = dPrev.icon;
  const DYearIcon = dYear.icon;

  const chartData = [
    { label: 'Ano passado', value: m.previousYear, fill: '#94a3b8' },
    { label: 'Ant.', value: m.previousPeriod, fill: '#cbd5e1' },
    { label: 'Atual', value: m.current, fill: '#3b82f6' },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground leading-tight">
          {m.label}
        </p>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-foreground tabular-nums">
          {formatValue(m.current, m.suffix)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="flex items-center gap-1">
          <DPrevIcon size={11} className={dPrev.color} />
          <span className={`font-bold ${dPrev.color}`}>{dPrev.text}</span>
          <span className="text-muted-foreground">ant.</span>
        </div>
        <div className="flex items-center gap-1">
          <DYearIcon size={11} className={dYear.color} />
          <span className={`font-bold ${dYear.color}`}>{dYear.text}</span>
          <span className="text-muted-foreground">ano</span>
        </div>
      </div>

      <div className="h-16 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.1)' }}
              contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'rgba(15,23,42,0.95)', border: 'none', color: '#f8fafc' }}
              formatter={(v) => [formatValue(Number(v) || 0, m.suffix), m.label] as [string, string]}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ComparisonsBoard({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="h-5 w-48 bg-muted rounded animate-pulse mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-44 bg-muted/40 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || !data.metrics.length) return null;

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="mb-3">
        <h3 className="text-[13px] font-bold text-foreground">Comparações</h3>
        <p className="text-[11px] text-muted-foreground">
          Período atual × período anterior × mesmo período do ano passado
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.metrics.map((m) => <MetricCard key={m.key} m={m} />)}
      </div>
    </div>
  );
}
