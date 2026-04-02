'use client';

import { useRouter } from 'next/navigation';
import { Calendar } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { formatEventDate, getEventColor, getEventIcon } from '../utils';
import type { DashboardEvent } from '../types';

interface Props {
  events: DashboardEvent[];
}

export function UpcomingEvents({ events }: Props) {
  const router = useRouter();

  if (events.length === 0) return null;

  return (
    <WidgetCard
      title="Proximos Compromissos"
      icon={<Calendar size={15} className="text-primary" />}
      linkLabel="Ver agenda"
      linkHref="/atendimento/agenda"
    >
      <div className="space-y-2">
        {events.slice(0, 10).map((event) => (
          <div
            key={event.id}
            onClick={() => router.push('/atendimento/agenda')}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${getEventColor(event.type)}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{event.title}</p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  {getEventIcon(event.type)}
                  {formatEventDate(event.start_at)}
                </span>
                {event.lead_name && <span className="truncate">· {event.lead_name}</span>}
              </div>
            </div>
            {(event.priority === 'ALTA' || event.priority === 'URGENTE') && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${event.priority === 'URGENTE' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>
                {event.priority}
              </span>
            )}
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
