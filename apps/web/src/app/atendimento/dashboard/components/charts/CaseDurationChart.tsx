'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Scale } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import { TRACKING_STAGES } from '@/lib/legalStages';
import type { CaseDurationData } from '../../types';

interface Props {
  data: CaseDurationData | null;
  loading: boolean;
}

const STAGE_MAP: Record<string, { label: string; color: string }> = {};
TRACKING_STAGES.forEach((s) => { STAGE_MAP[s.id] = { label: s.label, color: s.color }; });

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs">
      <p className="font-bold text-foreground">{d.label}</p>
      <p className="text-muted-foreground">{d.avgDays} dias (media)</p>
      <p className="text-muted-foreground">{d.count} processo(s)</p>
    </div>
  );
};

export function CaseDurationChart({ data, loading }: Props) {
  const chartData = data?.stages.map((s) => ({
    ...s,
    label: STAGE_MAP[s.stage]?.label || s.stage,
    fill: STAGE_MAP[s.stage]?.color || '#6b7280',
  })) || [];

  return (
    <WidgetCard
      title="Tempo Medio por Fase"
      icon={<Scale size={15} className="text-primary" />}
      loading={loading}
    >
      {chartData.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de duracao
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} className="text-muted-foreground" unit="d" />
              <YAxis dataKey="label" type="category" tick={{ fontSize: 9 }} width={100} className="text-muted-foreground" />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="avgDays" radius={[0, 4, 4, 0]} barSize={14}>
                {chartData.map((d, i) => (
                  <rect key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
