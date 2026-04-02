'use client';

import { BarChart, Bar, ResponsiveContainer, Tooltip } from 'recharts';
import { Clock } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import type { ResponseTimeData } from '../../types';

interface Props {
  data: ResponseTimeData | null;
  loading: boolean;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}min`;
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return min > 0 ? `${h}h${min}min` : `${h}h`;
}

export function ResponseTimeWidget({ data, loading }: Props) {
  return (
    <WidgetCard
      title="Tempo de Resposta"
      icon={<Clock size={15} className="text-blue-500" />}
      loading={loading}
    >
      {!data ? (
        <div className="h-28 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-end gap-3">
            <p className="text-3xl font-bold text-foreground">{formatMinutes(data.avgMinutes)}</p>
            <p className="text-sm text-muted-foreground pb-1">1a resposta (media)</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Mediana: {formatMinutes(data.medianMinutes)}
          </p>
          {data.byDay.length > 1 && (
            <div className="h-12">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byDay.slice(-7)} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Tooltip
                    formatter={(v: any) => [formatMinutes(Number(v || 0)), 'Tempo']}
                    contentStyle={{ fontSize: '10px', borderRadius: '6px' }}
                  />
                  <Bar dataKey="avgMinutes" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
