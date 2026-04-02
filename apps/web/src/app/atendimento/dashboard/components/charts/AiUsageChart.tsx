'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Activity } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import type { AiUsageData } from '../../types';

interface Props {
  data: AiUsageData | null;
  loading: boolean;
}

function formatMonth(m: string) {
  const [y, mo] = m.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(mo, 10) - 1]}/${y.slice(2)}`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs">
      <p className="font-bold text-foreground mb-1">{formatMonth(label)}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.dataKey === 'cost' ? `$${p.value.toFixed(2)}` : `${(p.value / 1000).toFixed(0)}k tokens`}
        </p>
      ))}
    </div>
  );
};

export function AiUsageChart({ data, loading }: Props) {
  return (
    <WidgetCard
      title="Uso de IA"
      icon={<Activity size={15} className="text-primary" />}
      loading={loading}
      badge={data ? `Total: $${data.totalCost.toFixed(2)}` : undefined}
    >
      {!data || data.byMonth.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de uso de IA
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.byMonth} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 10 }} className="text-muted-foreground" />
              <YAxis yAxisId="tokens" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} className="text-muted-foreground" />
              <YAxis yAxisId="cost" orientation="right" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 10 }} className="text-muted-foreground" />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
              <Area yAxisId="tokens" type="monotone" dataKey="tokens" name="Tokens" stroke="#8b5cf6" fill="url(#gradTokens)" strokeWidth={2} />
              <Area yAxisId="cost" type="monotone" dataKey="cost" name="Custo (USD)" stroke="#f59e0b" fill="url(#gradCost)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
