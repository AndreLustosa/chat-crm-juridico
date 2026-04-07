'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Loader2, FileText, Calendar, Gavel, MessageSquare,
  ExternalLink, Plus, Trash2, ChevronDown, ChevronUp,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

const EVENT_TYPES = [
  { id: 'MOVIMENTACAO', label: 'Movimentacao' },
  { id: 'AUDIENCIA', label: 'Audiencia' },
  { id: 'DECISAO', label: 'Decisao' },
  { id: 'DESPACHO', label: 'Despacho' },
  { id: 'PUBLICACAO', label: 'Publicacao' },
  { id: 'PRAZO', label: 'Prazo' },
  { id: 'PETICAO', label: 'Peticao' },
  { id: 'OUTRO', label: 'Outro' },
];

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

interface DjenPublication {
  id: string;
  comunicacao_id: number;
  data_disponibilizacao: string;
  numero_processo: string;
  classe_processual: string | null;
  assunto: string | null;
  tipo_comunicacao: string | null;
  conteudo: string;
  nome_advogado: string | null;
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
  type: 'event' | 'calendar' | 'djen';
  date: string;
  title: string;
  description: string | null;
  extra: Record<string, any>;
};

function getEventIcon(type: string) {
  switch (type.toUpperCase()) {
    case 'DJEN':
    case 'PUBLICACAO':
    case 'DECISAO': return <Gavel className="h-3.5 w-3.5" />;
    case 'AUDIENCIA': return <Calendar className="h-3.5 w-3.5" />;
    case 'PRAZO': return <Calendar className="h-3.5 w-3.5 text-amber-400" />;
    case 'TAREFA': return <FileText className="h-3.5 w-3.5 text-blue-400" />;
    case 'CONSULTA': return <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />;
    default: return <Activity className="h-3.5 w-3.5" />;
  }
}

function getDotColor(type: string): string {
  switch (type.toUpperCase()) {
    case 'DJEN': return 'border-violet-500 bg-violet-500/10';
    case 'PUBLICACAO':
    case 'DECISAO': return 'border-amber-500 bg-amber-500/10';
    case 'AUDIENCIA': return 'border-primary bg-primary/10';
    case 'PRAZO': return 'border-amber-400 bg-amber-400/10';
    case 'TAREFA': return 'border-blue-400 bg-blue-400/10';
    case 'CONSULTA': return 'border-emerald-400 bg-emerald-400/10';
    default: return 'border-border bg-accent/30';
  }
}

function getBadgeColor(itemType: string, eventType: string): string {
  if (itemType === 'djen') return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
  switch (eventType.toUpperCase()) {
    case 'AUDIENCIA': return 'bg-primary/15 text-primary border-primary/30';
    case 'DECISAO': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'PRAZO': return 'bg-amber-400/15 text-amber-400 border-amber-400/30';
    case 'PETICAO': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'TAREFA': return 'bg-blue-400/15 text-blue-400 border-blue-400/30';
    case 'CONSULTA': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    default: return 'bg-accent/40 text-muted-foreground border-border';
  }
}

export default function TabTimeline({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [djenPublications, setDjenPublications] = useState<DjenPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDjen, setExpandedDjen] = useState<Set<string>>(new Set());
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newType, setNewType] = useState('MOVIMENTACAO');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsRes, calRes, djenRes] = await Promise.all([
        api.get(`/legal-cases/${caseId}/events`),
        api.get('/calendar/events', { params: { legalCaseId: caseId } }),
        api.get(`/djen/case/${caseId}`).catch(() => ({ data: [] })),
      ]);
      setEvents(eventsRes.data || []);
      setCalendarEvents(calRes.data || []);
      setDjenPublications(djenRes.data || []);
    } catch {
      showError('Erro ao carregar timeline');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleDjenExpand = (id: string) => {
    setExpandedDjen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Create / Delete event ────────────────────────────────

  const handleCreateEvent = async () => {
    if (!newTitle.trim()) {
      showError('Informe o titulo do evento');
      return;
    }
    setCreating(true);
    try {
      await api.post(`/legal-cases/${caseId}/events`, {
        type: newType,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        event_date: newDate ? new Date(newDate).toISOString() : undefined,
      });
      showSuccess('Evento criado');
      setNewTitle('');
      setNewDesc('');
      setNewDate('');
      setNewType('MOVIMENTACAO');
      setShowNewEvent(false);
      fetchData();
    } catch {
      showError('Erro ao criar evento');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Deseja remover este evento?')) return;
    setDeletingId(eventId);
    try {
      await api.delete(`/legal-cases/events/${eventId}`);
      showSuccess('Evento removido');
      fetchData();
    } catch {
      showError('Erro ao remover evento');
    } finally {
      setDeletingId(null);
    }
  };

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
        originalId: e.id,
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
    ...djenPublications.map(d => ({
      id: `djen-${d.id}`,
      type: 'djen' as const,
      date: d.data_disponibilizacao,
      title: `DJEN: ${d.tipo_comunicacao || 'Publicacao'}`,
      description: d.conteudo,
      extra: {
        eventType: 'DJEN',
        tipoComunicacao: d.tipo_comunicacao,
        classeProcessual: d.classe_processual,
        assunto: d.assunto,
        nomeAdvogado: d.nome_advogado,
        numeroProcesso: d.numero_processo,
      },
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-accent/20">
          <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
            <Activity size={14} className="text-primary" />
            Timeline do Caso
            {timeline.length > 0 && (
              <span className="text-[11px] font-normal text-muted-foreground ml-1">
                ({timeline.length} eventos)
              </span>
            )}
          </h2>
          <button
            onClick={() => setShowNewEvent(!showNewEvent)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
          >
            <Plus size={12} />
            Novo Evento
          </button>
        </div>

        {/* Create event form */}
        {showNewEvent && (
          <div className="p-5 border-b border-border bg-accent/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Tipo
                </label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all appearance-none cursor-pointer"
                >
                  {EVENT_TYPES.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Titulo
                </label>
                <input
                  placeholder="Ex: Audiencia de instrucao"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Data do evento
              </label>
              <input
                type="datetime-local"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full md:w-1/2 px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
              />
            </div>
            <div className="mt-4 space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Descricao (opcional)
              </label>
              <textarea
                placeholder="Descricao do evento..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all resize-y min-h-[60px]"
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewEvent(false)}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateEvent}
                disabled={!newTitle.trim() || creating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
              >
                {creating && <Loader2 size={12} className="animate-spin" />}
                Criar evento
              </button>
            </div>
          </div>
        )}

        {/* Timeline content area */}
        <div className="p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="text-[11px] text-muted-foreground mt-3">Carregando timeline...</p>
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Activity size={48} className="text-muted-foreground opacity-20" />
              <p className="text-[13px] font-medium text-muted-foreground mt-4">
                Nenhum evento registrado
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                Clique em "Novo Evento" para adicionar o primeiro evento a timeline.
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-3">
                {timeline.map((item) => {
                  const eventType = item.extra.eventType || '';
                  const dotColor = getDotColor(eventType);
                  const badgeColor = getBadgeColor(item.type, eventType);
                  const isDjen = item.type === 'djen';

                  return (
                    <div key={item.id} className="relative flex gap-3.5 group">
                      {/* Dot on timeline */}
                      <div className={`relative z-10 mt-2.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-2 ${dotColor}`}>
                        {getEventIcon(eventType)}
                      </div>

                      {/* Content card */}
                      <div className={`flex-1 min-w-0 rounded-xl border p-3.5 transition-colors ${
                        isDjen
                          ? 'border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10'
                          : 'border-border bg-accent/10 hover:bg-accent/20'
                      }`}>
                        {/* Top row: date + badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {formatDateTime(item.date)}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wider ${badgeColor}`}>
                            {isDjen ? (item.extra.tipoComunicacao || 'DJEN') : eventType}
                          </span>
                          {item.extra.status && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-border bg-accent/30 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                              {item.extra.status}
                            </span>
                          )}
                          {item.extra.classeProcessual && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-violet-500/20 bg-violet-500/10 text-[9px] font-bold text-violet-400">
                              {item.extra.classeProcessual}
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <p className="text-[12px] font-bold text-foreground mt-1.5">{item.title}</p>

                        {/* DJEN expandable content */}
                        {isDjen && item.description && (
                          <div className="mt-2">
                            <p className={`text-[11px] text-foreground/70 leading-relaxed ${expandedDjen.has(item.id) ? '' : 'line-clamp-2'}`}>
                              {item.description}
                            </p>
                            {item.description.length > 150 && (
                              <button
                                onClick={() => toggleDjenExpand(item.id)}
                                className="flex items-center gap-1 text-[10px] font-bold text-violet-400 hover:text-violet-300 mt-1.5 transition-colors"
                              >
                                {expandedDjen.has(item.id) ? (
                                  <><ChevronUp size={11} /> Ver menos</>
                                ) : (
                                  <><ChevronDown size={11} /> Ver mais</>
                                )}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Regular event description */}
                        {!isDjen && item.description && (
                          <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-3 leading-relaxed">
                            {item.description}
                          </p>
                        )}

                        {/* Meta info */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                          {item.extra.source && (
                            <p className="text-[10px] text-muted-foreground/70">
                              Fonte: <span className="font-medium text-muted-foreground">{item.extra.source}</span>
                            </p>
                          )}
                          {item.extra.referenceUrl && (
                            <a
                              href={item.extra.referenceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:opacity-80 transition-opacity"
                            >
                              <ExternalLink size={10} />
                              Ver referencia
                            </a>
                          )}
                          {item.extra.assignedUser && (
                            <p className="text-[10px] text-muted-foreground/70">
                              Responsavel: <span className="font-medium text-muted-foreground">{item.extra.assignedUser.name}</span>
                            </p>
                          )}
                          {item.extra.nomeAdvogado && (
                            <p className="text-[10px] text-muted-foreground/70">
                              Advogado: <span className="font-medium text-muted-foreground">{item.extra.nomeAdvogado}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Delete button -- only for manual events */}
                      {item.type === 'event' && item.extra.originalId && (
                        <button
                          onClick={() => handleDeleteEvent(item.extra.originalId)}
                          disabled={deletingId === item.extra.originalId}
                          className="opacity-0 group-hover:opacity-100 transition-opacity self-start mt-2.5 flex items-center justify-center h-[30px] w-[30px] rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          title="Remover evento"
                        >
                          {deletingId === item.extra.originalId
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Trash2 size={13} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
