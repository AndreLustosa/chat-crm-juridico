'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Loader2, FileText, Calendar, Gavel, MessageSquare,
  ArrowRight, ExternalLink,
} from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';

interface CaseEvent {
  id: string;
  type: string;
  title: string;
  description: string | null;
  source: string | null;
  reference_url: string | null;
  event_date: string | null;
  created_at: string;
}

interface CalendarEvent {
  id: string;
  type: string;
  title: string;
  description: string | null;
  start_at: string;
  status: string;
  assigned_user: { id: string; name: string } | null;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

type TimelineItem = {
  id: string;
  type: 'event' | 'calendar';
  date: string;
  title: string;
  description: string | null;
  extra: Record<string, any>;
};

function getEventIcon(type: string) {
  switch (type.toUpperCase()) {
    case 'PUBLICACAO':
    case 'DECISAO': return <Gavel className="h-3.5 w-3.5" />;
    case 'AUDIENCIA': return <Calendar className="h-3.5 w-3.5" />;
    case 'PRAZO': return <Calendar className="h-3.5 w-3.5 text-warning" />;
    case 'TAREFA': return <FileText className="h-3.5 w-3.5 text-info" />;
    case 'CONSULTA': return <MessageSquare className="h-3.5 w-3.5 text-success" />;
    default: return <Activity className="h-3.5 w-3.5" />;
  }
}

function getEventColor(type: string): string {
  switch (type.toUpperCase()) {
    case 'PUBLICACAO':
    case 'DECISAO': return 'border-secondary';
    case 'AUDIENCIA': return 'border-primary';
    case 'PRAZO': return 'border-warning';
    case 'TAREFA': return 'border-info';
    case 'CONSULTA': return 'border-success';
    default: return 'border-base-300';
  }
}

export default function TabTimeline({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsRes, calRes] = await Promise.all([
        api.get(`/legal-cases/${caseId}/events`),
        api.get('/calendar/events', { params: { legalCaseId: caseId } }),
      ]);
      setEvents(eventsRes.data || []);
      setCalendarEvents(calRes.data || []);
    } catch {
      showError('Erro ao carregar timeline');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Merge events into unified timeline
  const timeline: TimelineItem[] = [
    ...events.map(e => ({
      id: `event-${e.id}`,
      type: 'event' as const,
      date: e.event_date || e.created_at,
      title: e.title,
      description: e.description,
      extra: {
        eventType: e.type,
        source: e.source,
        referenceUrl: e.reference_url,
      },
    })),
    ...calendarEvents.map(e => ({
      id: `cal-${e.id}`,
      type: 'calendar' as const,
      date: e.start_at,
      title: e.title,
      description: e.description,
      extra: {
        eventType: e.type,
        status: e.status,
        assignedUser: e.assigned_user,
      },
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        Timeline do Caso
        {timeline.length > 0 && (
          <span className="text-xs text-base-content/50">({timeline.length} eventos)</span>
        )}
      </h2>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : timeline.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <Activity className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhum evento registrado</p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-base-300" />

          <div className="space-y-4">
            {timeline.map((item) => {
              const eventType = item.extra.eventType || '';
              const borderColor = getEventColor(eventType);

              return (
                <div key={item.id} className="relative flex gap-4 pl-2">
                  {/* Dot on timeline */}
                  <div className={`relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-200 border-2 ${borderColor}`}>
                    {getEventIcon(eventType)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-base-content/50">
                        {formatDateTime(item.date)}
                      </span>
                      <span className="badge badge-xs badge-outline">{eventType}</span>
                      {item.extra.status && (
                        <span className="badge badge-xs badge-ghost">{item.extra.status}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-0.5">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-base-content/50 mt-0.5 line-clamp-3">
                        {item.description}
                      </p>
                    )}
                    {item.extra.source && (
                      <p className="text-xs text-base-content/40 mt-0.5">
                        Fonte: {item.extra.source}
                      </p>
                    )}
                    {item.extra.referenceUrl && (
                      <a
                        href={item.extra.referenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary mt-0.5 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Ver referência
                      </a>
                    )}
                    {item.extra.assignedUser && (
                      <p className="text-xs text-base-content/40 mt-0.5">
                        Responsável: {item.extra.assignedUser.name}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
