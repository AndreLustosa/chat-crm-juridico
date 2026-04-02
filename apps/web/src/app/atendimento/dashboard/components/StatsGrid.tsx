'use client';

import { MessageSquare, ListTodo, Scale, BookOpen } from 'lucide-react';
import { StatCard } from './StatCard';
import type { DashboardData } from '../types';

interface Props {
  data: DashboardData;
}

export function StatsGrid({ data }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={MessageSquare}
        label="Conversas Abertas"
        value={data.conversations.open}
        color="text-blue-500 bg-blue-500/10"
        sub={data.conversations.pendingTransfers > 0 ? `${data.conversations.pendingTransfers} transferencia(s)` : undefined}
        trendColor="#3b82f6"
      />
      <StatCard
        icon={ListTodo}
        label="Tarefas Pendentes"
        value={data.tasks.pending + data.tasks.inProgress}
        color="text-amber-500 bg-amber-500/10"
        sub={data.tasks.overdue > 0 ? `${data.tasks.overdue} atrasada(s)` : undefined}
        trendColor="#f59e0b"
      />
      <StatCard
        icon={Scale}
        label="Casos Ativos"
        value={data.legalCases.total}
        color="text-purple-500 bg-purple-500/10"
        trendColor="#8b5cf6"
      />
      <StatCard
        icon={BookOpen}
        label="Processos"
        value={data.trackingCases.total}
        color="text-teal-500 bg-teal-500/10"
        trendColor="#14b8a6"
      />
    </div>
  );
}
