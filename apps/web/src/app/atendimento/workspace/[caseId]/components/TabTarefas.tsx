'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, CheckCircle2, Circle, Clock, Loader2, CalendarDays,
  X, MapPin, User, Bell, ChevronDown, AlertTriangle, Flag,
  Calendar as CalendarIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

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

interface UserOption { id: string; name: string; }

// ─── Constantes ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { id: 'TAREFA',    label: 'Tarefa',    emoji: '✅', color: 'text-green-400',  bg: 'bg-green-400/10'  },
  { id: 'AUDIENCIA', label: 'Audiência', emoji: '⚖️', color: 'text-red-400',    bg: 'bg-red-400/10'    },
  { id: 'PRAZO',     label: 'Prazo',     emoji: '🕐', color: 'text-amber-400',  bg: 'bg-amber-400/10'  },
  { id: 'CONSULTA',  label: 'Consulta',  emoji: '🟣', color: 'text-purple-400', bg: 'bg-purple-400/10' },
  { id: 'OUTRO',     label: 'Outro',     emoji: '📌', color: 'text-muted-foreground', bg: 'bg-accent/50' },
] as const;

const PRIORITIES = [
  { id: 'BAIXA',   label: 'Baixa',   color: 'text-muted-foreground' },
  { id: 'NORMAL',  label: 'Normal',  color: 'text-blue-400'  },
  { id: 'ALTA',    label: 'Alta',    color: 'text-amber-400' },
  { id: 'URGENTE', label: 'Urgente', color: 'text-red-400'   },
] as const;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  AGENDADO:  { label: 'Agendado',  color: 'text-blue-400',  bg: 'bg-blue-400/10'  },
  CONFIRMADO:{ label: 'Confirmado',color: 'text-green-400', bg: 'bg-green-400/10' },
  CONCLUIDO: { label: 'Concluído', color: 'text-muted-foreground', bg: 'bg-accent/50' },
  CANCELADO: { label: 'Cancelado', color: 'text-red-400',   bg: 'bg-red-400/10'   },
  ADIADO:    { label: 'Adiado',    color: 'text-amber-400', bg: 'bg-amber-400/10' },
};

const REMINDER_OPTIONS = [
  { value: 15,   label: '15 min antes' },
  { value: 30,   label: '30 min antes' },
  { value: 60,   label: '1 hora antes' },
  { value: 1440, label: '1 dia antes'  },
];

function typeInfo(type: string) {
  return EVENT_TYPES.find(t => t.id === type) ?? EVENT_TYPES[4];
}

function formatDateTime(iso: string, allDay: boolean) {
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toLocalInputValue(iso: string): string {
  // Mostra o valor UTC como se fosse local (padrão "naive" do sistema)
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${dy}T${h}:${mi}`;
}

function localInputToISO(local: string): string {
  // Trata o valor digitado como UTC direto (padrão "naive")
  const [datePart, timePart = '00:00'] = local.replace('T', ' ').split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0)).toISOString();
}

// ─── Modal de criação de evento ────────────────────────────────────────────────

function EventModal({
  caseId,
  lawyerId,
  users,
  onClose,
  onCreated,
}: {
  caseId: string;
  lawyerId: string;
  users: UserOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const now = new Date();
  const padded = (n: number) => String(n).padStart(2, '0');
  const todayLocal = `${now.getUTCFullYear()}-${padded(now.getUTCMonth() + 1)}-${padded(now.getUTCDate())}`;
  const timeNow = `${padded(now.getUTCHours())}:${padded(now.getUTCMinutes())}`;
  const timeEnd = `${padded(Math.min(now.getUTCHours() + 1, 23))}:${padded(now.getUTCMinutes())}`;

  const [type, setType] = useState<string>('TAREFA');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayLocal);
  const [startTime, setStartTime] = useState(timeNow);
  const [endTime, setEndTime] = useState(timeEnd);
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [assignedUserId, setAssignedUserId] = useState(lawyerId);
  const [reminders, setReminders] = useState<{ minutes_before: number; channel: string }[]>([
    { minutes_before: 30, channel: 'WHATSAPP' },
  ]);
  const [saving, setSaving] = useState(false);

  const toggleReminder = (minutes: number, channel: string) => {
    const key = `${minutes}-${channel}`;
    setReminders(prev => {
      const exists = prev.some(r => `${r.minutes_before}-${r.channel}` === key);
      if (exists) return prev.filter(r => `${r.minutes_before}-${r.channel}` !== key);
      return [...prev, { minutes_before: minutes, channel }];
    });
  };

  const handleSave = async () => {
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      const startISO = allDay
        ? new Date(Date.UTC(...(date.split('-').map(Number) as [number, number, number]), 0, 0, 0)).toISOString()
        : localInputToISO(`${date} ${startTime}`);
      const endISO = allDay
        ? undefined
        : localInputToISO(`${date} ${endTime}`);

      await api.post('/calendar/events', {
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        start_at: startISO,
        end_at: endISO,
        all_day: allDay,
        location: location.trim() || undefined,
        priority,
        assigned_user_id: assignedUserId || undefined,
        legal_case_id: caseId,
        reminders: reminders.length > 0 ? reminders : undefined,
      });

      showSuccess('Evento criado');
      onCreated();
      onClose();
    } catch {
      showError('Erro ao criar evento');
    } finally {
      setSaving(false);
    }
  };

  const ti = typeInfo(type);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-[301] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-border">
            <span className="text-xl">{ti.emoji}</span>
            <h2 className="flex-1 text-sm font-bold text-foreground">Novo Evento no Processo</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">

            {/* Tipo */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Tipo</label>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_TYPES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      type === t.id
                        ? `${t.bg} ${t.color} border-current`
                        : 'border-border text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <span>{t.emoji}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Título */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Título *</label>
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder={`Ex: ${type === 'AUDIENCIA' ? 'Audiência de Instrução' : type === 'PRAZO' ? 'Prazo contestação' : type === 'CONSULTA' ? 'Consulta com cliente' : 'Revisar documentos'}`}
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {/* Descrição */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Descrição</label>
              <textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Detalhes adicionais..."
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/25 resize-none"
              />
            </div>

            {/* Data e horário */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground">Data e Horário *</label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allDay}
                    onChange={e => setAllDay(e.target.checked)}
                    className="w-3.5 h-3.5 rounded"
                  />
                  Dia inteiro
                </label>
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/25"
                />
                {!allDay && (
                  <>
                    <input
                      type="time"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                      className="w-28 px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/25"
                    />
                    <span className="flex items-center text-muted-foreground text-xs">até</span>
                    <input
                      type="time"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                      className="w-28 px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/25"
                    />
                  </>
                )}
              </div>
            </div>

            {/* Localização (visível para Audiência) */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                <MapPin size={11} />
                Local / Sala
                {type !== 'AUDIENCIA' && <span className="font-normal opacity-60">(opcional)</span>}
              </label>
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder={type === 'AUDIENCIA' ? 'Ex: Vara do Trabalho — Sala 3' : 'Local ou link de reunião'}
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {/* Prioridade e Responsável */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Flag size={11} /> Prioridade
                </label>
                <div className="relative">
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full pl-3 pr-7 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/25 appearance-none"
                  >
                    {PRIORITIES.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <User size={11} /> Responsável
                </label>
                <div className="relative">
                  <select
                    value={assignedUserId}
                    onChange={e => setAssignedUserId(e.target.value)}
                    className="w-full pl-3 pr-7 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/25 appearance-none"
                  >
                    <option value="">Nenhum</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Lembretes */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Bell size={11} /> Lembretes
              </label>
              <div className="space-y-1.5">
                {REMINDER_OPTIONS.map(r => (
                  <div key={r.value} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-28 shrink-0">{r.label}</span>
                    <div className="flex gap-2">
                      {(['PUSH', 'WHATSAPP'] as const).map(ch => {
                        const active = reminders.some(rem => rem.minutes_before === r.value && rem.channel === ch);
                        return (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => toggleReminder(r.value, ch)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                              active
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border text-muted-foreground hover:bg-accent'
                            }`}
                          >
                            {ch === 'PUSH' ? '🔔' : '💬'} {ch}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!title.trim() || !date || saving}
              className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CalendarIcon size={13} />}
              Criar evento
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Componente Principal ──────────────────────────────────────────────────────

export default function TabTarefas({
  caseId,
  lawyerId,
}: {
  caseId: string;
  lawyerId: string;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
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
  }, [fetchEvents]);

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

      {/* Modal de criação */}
      {showModal && (
        <EventModal
          caseId={caseId}
          lawyerId={lawyerId}
          users={users}
          onClose={() => setShowModal(false)}
          onCreated={fetchEvents}
        />
      )}
    </div>
  );
}
