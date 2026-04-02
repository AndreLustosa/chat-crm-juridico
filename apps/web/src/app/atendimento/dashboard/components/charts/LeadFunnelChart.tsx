'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Briefcase } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import { CRM_STAGES } from '@/lib/crmStages';
import type { LeadFunnelData } from '../../types';

interface Props {
  data: LeadFunnelData | null;
  loading: boolean;
}

const STAGE_COLORS: Record<string, string> = {};
CRM_STAGES.forEach((s) => { STAGE_COLORS[s.id] = s.color; });

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs">
      <p className="font-bold text-foreground">{d.label}</p>
      <p className="text-muted-foreground">{d.count} leads ({d.pct}%)</p>
      {d.conversionRate > 0 && (
        <p className="text-emerald-500">Conversao: {d.conversionRate}%</p>
      )}
      {d.avgDays > 0 && (
        <p className="text-muted-foreground">Tempo medio: {d.avgDays}d</p>
      )}
    </div>
  );
};

export function LeadFunnelChart({ data, loading }: Props) {
  return (
    <WidgetCard
      title="Funil de Leads"
      icon={<Briefcase size={15} className="text-primary" />}
      loading={loading}
    >
      {!data || data.stages.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de funil
        </div>
      ) : (
        <div className="h-56 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.stages.map((s) => {
                  const stage = CRM_STAGES.find((cs) => cs.id === s.stage);
                  const total = data.stages.reduce((acc, st) => acc + st.count, 0);
                  return {
                    ...s,
                    label: stage?.label || s.stage,
                    pct: total > 0 ? Math.round((s.count / total) * 100) : 0,
                  };
                })}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={2}
                dataKey="count"
              >
                {data.stages.map((s) => (
                  <Cell key={s.stage} fill={STAGE_COLORS[s.stage] || '#6b7280'} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{data.overallConversionRate}%</p>
              <p className="text-[9px] text-muted-foreground uppercase font-semibold">Conversao</p>
            </div>
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
