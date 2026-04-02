'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ListTodo } from 'lucide-react';
import { WidgetCard } from '../WidgetCard';
import type { TaskCompletionData } from '../../types';

interface Props {
  data: TaskCompletionData | null;
  loading: boolean;
}

const COLORS = { completed: '#10b981', pending: '#f59e0b', overdue: '#ef4444' };
const LABELS = { completed: 'Concluidas', pending: 'Pendentes', overdue: 'Atrasadas' };

export function TaskCompletionChart({ data, loading }: Props) {
  const pieData = data ? [
    { key: 'completed', value: data.completed, color: COLORS.completed, label: LABELS.completed },
    { key: 'pending', value: data.pending, color: COLORS.pending, label: LABELS.pending },
    { key: 'overdue', value: data.overdue, color: COLORS.overdue, label: LABELS.overdue },
  ].filter((d) => d.value > 0) : [];

  return (
    <WidgetCard
      title="Tarefas"
      icon={<ListTodo size={15} className="text-primary" />}
      loading={loading}
    >
      {!data || pieData.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Sem tarefas no periodo
        </div>
      ) : (
        <div className="h-56 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
              >
                {pieData.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: any, _: any, entry: any) => [Number(value || 0), entry?.payload?.label || '']}
                contentStyle={{ fontSize: '12px', borderRadius: '8px' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{data.completionRate}%</p>
              <p className="text-[9px] text-muted-foreground uppercase font-semibold">Conclusao</p>
            </div>
          </div>
          {/* Legend */}
          <div className="flex justify-center gap-4 mt-1">
            {pieData.map((d) => (
              <div key={d.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                {d.label}: {d.value}
              </div>
            ))}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
