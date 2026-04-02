'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import { fmtBRL } from '../../utils';
import type { FinancialAgingData } from '../../types';

interface Props {
  data: FinancialAgingData | null;
  loading: boolean;
}

const BUCKET_COLORS = ['#10b981', '#f59e0b', '#f97316', '#ef4444'];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs">
      <p className="font-bold text-foreground">{d.range}</p>
      <p className="text-muted-foreground">{d.count} parcela(s)</p>
      <p className="font-semibold" style={{ color: payload[0].fill }}>{fmtBRL(d.total)}</p>
    </div>
  );
};

export function FinancialAgingChart({ data, loading }: Props) {
  return (
    <WidgetCard
      title="Aging de Recebiveis"
      icon={<AlertTriangle size={15} className="text-amber-500" />}
      loading={loading}
      badge={data ? fmtBRL(data.grandTotal) : undefined}
    >
      {!data || data.buckets.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Nenhum recebivel em atraso
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.buckets} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="range" tick={{ fontSize: 10 }} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} className="text-muted-foreground" />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]} barSize={40}>
                {data.buckets.map((_, i) => (
                  <Cell key={i} fill={BUCKET_COLORS[i] || '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
