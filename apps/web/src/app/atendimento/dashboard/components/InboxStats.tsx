'use client';

import { Activity } from 'lucide-react';
import { WidgetCard } from './WidgetCard';

interface Props {
  closedToday: number;
  closedThisWeek: number;
  closedThisMonth: number;
}

export function InboxStats({ closedToday, closedThisWeek, closedThisMonth }: Props) {
  return (
    <WidgetCard
      title="Atendimentos Encerrados"
      icon={<Activity size={15} className="text-primary" />}
      linkLabel="Ver inbox"
      linkHref="/atendimento"
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-2xl font-bold text-emerald-400">{closedToday}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Hoje</p>
        </div>
        <div className="text-center p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <p className="text-2xl font-bold text-blue-400">{closedThisWeek}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Esta semana</p>
        </div>
        <div className="text-center p-3 rounded-xl bg-violet-500/5 border border-violet-500/20">
          <p className="text-2xl font-bold text-violet-400">{closedThisMonth}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Este mes</p>
        </div>
      </div>
    </WidgetCard>
  );
}
