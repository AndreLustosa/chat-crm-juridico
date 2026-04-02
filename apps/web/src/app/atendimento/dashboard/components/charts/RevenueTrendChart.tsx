'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import { fmtBRL } from '../../utils';
import type { RevenueTrendData } from '../../types';

interface Props {
  data: RevenueTrendData | null;
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
        <p key={p.dataKey} style={{ color: p.color }} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.name}: {fmtBRL(p.value)}
        </p>
      ))}
    </div>
  );
};

export function RevenueTrendChart({ data, loading }: Props) {
  return (
    <WidgetCard
      title="Evolucao Financeira"
      icon={<TrendingUp size={15} className="text-primary" />}
      loading={loading}
      linkLabel="Ver financeiro"
      linkHref="/atendimento/financeiro"
    >
      {!data || data.months.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de receita disponveis
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.months} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="gradContracted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradReceivable" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 10 }} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} className="text-muted-foreground" />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
              <Area type="monotone" dataKey="contracted" name="Contratado" stroke="#6366f1" fill="url(#gradContracted)" strokeWidth={2} />
              <Area type="monotone" dataKey="collected" name="Recebido" stroke="#10b981" fill="url(#gradCollected)" strokeWidth={2} />
              <Area type="monotone" dataKey="receivable" name="A Receber" stroke="#f59e0b" fill="url(#gradReceivable)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
