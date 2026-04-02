'use client';

import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Zap } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import type { ConversionVelocityData } from '../../types';

interface Props {
  data: ConversionVelocityData | null;
  loading: boolean;
}

export function ConversionVelocityWidget({ data, loading }: Props) {
  return (
    <WidgetCard
      title="Velocidade de Conversao"
      icon={<Zap size={15} className="text-amber-500" />}
      loading={loading}
    >
      {!data ? (
        <div className="h-28 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-end gap-3">
            <p className="text-3xl font-bold text-foreground">{Math.round(data.avgDays)}</p>
            <p className="text-sm text-muted-foreground pb-1">dias (media)</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Mediana: {Math.round(data.medianDays)} dias
          </p>
          {data.byMonth.length > 1 && (
            <div className="h-12">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.byMonth} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Area type="monotone" dataKey="avgDays" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
