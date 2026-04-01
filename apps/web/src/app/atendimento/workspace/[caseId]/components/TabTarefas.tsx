'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, CheckCircle2, Circle, Clock, Loader2, CalendarDays,
  AlertTriangle, Calendar as CalendarIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';
import { EventModal, EVENT_TYPES } from '@/components/EventModal';
import type { UserOption } from '@/components/EventModal';

// ─── Tipos ──────────────────────────────────────────────────────────────────────

interface CaseEvent {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  assigned_user: { id: string; name: string } | null;
  created_by: { id: string; name: string } | null;
  _count?: { comments: number };
}

// ─── Constantes locais ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  AGENDADO:  { label: 'Agendado',  color: 'text-blue-400',  bg: 'bg-blue-400/10'  },
  CONFIRMADO:{ label: 'Confirmado',color: 'text-green-400', bg: 'bg-green-400/10' },
  CONCLUIDO: { label: 'Concluído', color: 'text-muted-foreground', bg: 'bg-accent/50' },
  CANCELADO: { label: 'Cancelado', color: 'text-red-400',   bg: 'bg-red-400/10'   },
  ADIADO:    { label: 'Adiado',    color: 'text-amber-400', bg: 'bg-amber-400/10' },
};

const PRIORITIES = [
  { id: 'BAIXA',   label: 'Baixa',   color: 'text-muted-foreground' },
  { id: 'NORMAL',  label: 'Normal',  color: 'text-blue-400'  },
  { id: 'ALTA',    label: 'Alta',    color: 'text-amber-400' },
  { id: 'URGENTE', label: 'Urgente', color: 'text-red-400'   },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function typeInfo(type: string) {
  return EVENT_TYPES.find(t => t.id === type) ?? EVENT_TYPES[4];
}

function formatDateTime(iso: string, allDay: boolean) {
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

// ─── Componente Principal ────────────────────────────────────────────────────────

export default function TabTarefas({
  caseId,
  lawyerId,
}: {
  caseId: string;
  lawyerId: string;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);     // todos os usuários
  const [interns, setInterns] = useState<UserOption[]>([]); // estagiários do advogado
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/calendar/events/legal-case/${caseId}`);
      setEvents(res.data || []);
    } catch {
      showError('Erro ao carregar eventos');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchEvents();
    api.get('/users?limit=100').then(r => {
      const data = r.data?.data || r.data?.users || r.data || [];
      setUsers(data.filter((u: any) => u.role));
    }).catch(() => {});
    if (lawyerId) {
      api.get(`/users/${lawyerId}/interns`).then(r => {
        setInterns(r.data || []);
      }).catch(() => {});
    }
  }, [fetchEvents, lawyerId]);

  const handleToggle = async (ev: CaseEvent) => {
    const newStatus = ev.status === 'CONCLUIDO' ? 'AGENDADO' : 'CONCLUIDO';
    try {
      await api.patch(`/calendar/events/${ev.id}`, { status: newStatus });
      fetchEvents();
    } catch {
      showError('Erro ao atualizar evento');
    }
  };

  const filteredEvents = events.filter(ev => {
    if (filter === 'pending') return ev.status !== 'CONCLUIDO' && ev.status !== 'CANCELADO';
    if (filter === 'done') return ev.status === 'CONCLUIDO';
    return true;
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          Eventos ({events.length})
        </h2>
        <button
          onClick={() => setShowModal(true)}
          className="btn btn-primary btn-sm gap-1"
        >
          <Plus className="h-4 w-4" />
          Novo evento
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-1">
        {[
          { id: 'all' as const, label: 'Todos' },
          { id: 'pending' as const, label: 'Pendentes' },
          { id: 'done' as const, label: 'Concluídos' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`btn btn-xs ${filter === f.id ? 'btn-primary' : 'btn-ghost'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista de eventos */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground/50">
          <CalendarIcon className="h-12 w-12 opacity-20" />
          <p className="text-sm">
            {filter === 'pending' ? 'Nenhum evento pendente' : filter === 'done' ? 'Nenhum evento concluído' : 'Nenhum evento neste processo'}
          </p>
          {filter === 'all' && (
            <button onClick={() => setShowModal(true)} className="text-xs text-primary hover:underline">
              + Criar primeiro evento
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEvents.map(ev => {
            const isDone = ev.status === 'CONCLUIDO';
            const ti = typeInfo(ev.type);
            const statusCfg = STATUS_CONFIG[ev.status] ?? STATUS_CONFIG.AGENDADO;
            const isOverdue = !isDone && ev.status !== 'CANCELADO' && new Date(ev.start_at) < new Date();
            const daysOverdue = isOverdue
              ? Math.max(0, Math.floor((Date.now() - new Date(ev.start_at).getTime()) / 86400000))
              : 0;
            const priorityInfo = PRIORITIES.find(p => p.id === ev.priority);

            return (
              <div
                key={ev.id}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                  isDone
                    ? 'border-border/30 bg-background/30 opacity-60'
                    : 'border-border bg-card/50 hover:bg-card'
                }`}
              >
                {/* Toggle concluído */}
                <button
                  onClick={() => handleToggle(ev)}
                  className="mt-0.5 shrink-0"
                  title={isDone ? 'Reabrir' : 'Marcar como concluído'}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/30 hover:text-primary transition-colors" />
                  )}
                </button>

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{ti.emoji}</span>
                    <p className={`text-sm font-medium ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                      {ev.title}
                    </p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                    {priorityInfo && ev.priority !== 'NORMAL' && (
                      <span className={`text-[10px] font-semibold ${priorityInfo.color}`}>
                        {ev.priority === 'URGENTE' ? '🔴' : ev.priority === 'ALTA' ? '🟡' : ''} {priorityInfo.label}
                      </span>
                    )}
                  </div>

                  {ev.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{ev.description}</p>
                  )}

                  <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(ev.start_at, ev.all_day)}
                    </span>
                    {ev.location && (
                      <span className="flex items-center gap-1 truncate max-w-[160px]">
                        <span>📍</span>
                        {ev.location}
                      </span>
                    )}
                    {ev.assigned_user && (
                      <span className="flex items-center gap-1">
                        <span>👤</span>
                        {ev.assigned_user.name.split(' ')[0]}
                      </span>
                    )}
                  </div>
                </div>

                {/* SLA badge */}
                {isOverdue && (
                  <span className="shrink-0 text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full self-center">
                    {daysOverdue > 0 ? `+${daysOverdue}d` : 'Hoje'} <AlertTriangle className="inline h-2.5 w-2.5" />
                  </span>
                )}

                {/* Ver na Agenda */}
                <button
                  onClick={e => { e.stopPropagation(); router.push('/atendimento/agenda'); }}
                  className="shrink-0 p-1.5 rounded-lg text-muted-foreground/30 hover:text-primary hover:bg-primary/10 transition-colors"
                  title="Ver na Agenda"
                >
                  <CalendarDays className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de criação — componente compartilhado (mesmo do menu Agenda) */}
      {showModal && (
        <EventModal
          caseId={caseId}
          lawyerId={lawyerId}
          users={users}
          interns={interns}
          onClose={() => setShowModal(false)}
          onCreated={fetchEvents}
        />
      )}
    </div>
  );
}
