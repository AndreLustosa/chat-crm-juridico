'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Globe } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import type { LeadSourcesData } from '../../types';

interface Props {
  data: LeadSourcesData | null;
  loading: boolean;
}

const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs">
      <p className="font-bold text-foreground">{d.source}</p>
      <p className="text-muted-foreground">{d.count} leads ({d.percentage}%)</p>
    </div>
  );
};

export function LeadSourcesChart({ data, loading }: Props) {
  return (
    <WidgetCard
      title="Origem dos Leads"
      icon={<Globe size={15} className="text-primary" />}
      loading={loading}
    >
      {!data || data.sources.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de origem
        </div>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.sources}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={65}
                paddingAngle={2}
                dataKey="count"
                nameKey="source"
              >
                {data.sources.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
