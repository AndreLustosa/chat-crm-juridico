'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Scale } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import type { CasesByAreaData } from '../../types';

interface Props {
  data: CasesByAreaData | null;
  loading: boolean;
}

// Paleta com boa acessibilidade — até 10 áreas
const PALETTE = [
  '#3b82f6', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

function formatArea(area: string): string {
  // Normaliza nomes comuns; título-case simples
  return area
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function CasesByAreaChart({ data, loading }: Props) {
  if (loading) {
    return (
      <WidgetCard title="Processos por Área" icon={<Scale size={16} />}>
        <div className="space-y-2 py-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-6 bg-muted/40 rounded animate-pulse" />
          ))}
        </div>
      </WidgetCard>
    );
  }

  if (!data || data.areas.length === 0) {
    return (
      <WidgetCard title="Processos por Área" icon={<Scale size={16} />}>
        <p className="text-xs text-muted-foreground py-8 text-center">
          Sem processos para exibir.
        </p>
      </WidgetCard>
    );
  }

  const chartData = data.areas.map((a, i) => ({
    area: formatArea(a.area),
    count: a.count,
    percentage: a.percentage,
    fill: PALETTE[i % PALETTE.length],
  }));

  // Altura dinâmica: 28px por linha + padding
  const chartHeight = Math.max(180, chartData.length * 32 + 20);

  return (
    <WidgetCard
      title="Processos por Área"
      icon={<Scale size={16} />}
      badge={`${data.total} total`}
    >
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="area"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={110}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              contentStyle={{
                fontSize: 11,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(15,23,42,0.95)',
                border: 'none',
                color: '#f8fafc',
              }}
              formatter={(v, _name, item) => {
                const pct = (item?.payload as { percentage?: number })?.percentage;
                return [`${v} (${pct}%)`, 'Processos'] as [string, string];
              }}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              label={{
                position: 'right',
                fill: '#94a3b8',
                fontSize: 11,
                formatter: (v: unknown) => `${v}`,
              }}
            >
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  );
}
