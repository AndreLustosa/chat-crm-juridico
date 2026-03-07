'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useNextCalendarApp, ScheduleXCalendar } from '@schedule-x/react';
import { createViewDay, createViewWeek, createViewMonthGrid } from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import { createDragAndDropPlugin } from '@schedule-x/drag-and-drop';
import '@schedule-x/theme-default/dist/index.css';
import {
  Plus, X, Calendar as CalendarIcon, Filter, ChevronDown,
  Clock, MapPin, User, FileText, Gavel, AlertTriangle, CheckCircle2
} from 'lucide-react';
import api from '@/lib/api';

// ─── Tipos ────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  start_at: string;
  end_at?: string | null;
  all_day: boolean;
  status: string;
  priority: string;
  color?: string | null;
  location?: string | null;
  lead_id?: string | null;
  conversation_id?: string | null;
  legal_case_id?: string | null;
  assigned_user_id?: string | null;
  assigned_user?: { id: string; name: string } | null;
  created_by?: { id: string; name: string } | null;
  lead?: { id: string; name: string | null; phone: string } | null;
  legal_case?: { id: string; case_number: string | null; legal_area: string | null } | null;
}

interface UserOption {
  id: string;
  name: string;
}

interface LeadOption {
  id: string;
  name: string | null;
  phone: string;
}

// ─── Constantes ───────────────────────────────────────

const EVENT_TYPES = [
  { id: 'CONSULTA', label: 'Consulta', emoji: '🟣', color: '#8b5cf6' },
  { id: 'TAREFA', label: 'Tarefa', emoji: '🟢', color: '#22c55e' },
  { id: 'AUDIENCIA', label: 'Audiencia', emoji: '🔴', color: '#ef4444' },
  { id: 'PRAZO', label: 'Prazo', emoji: '🟠', color: '#f59e0b' },
  { id: 'OUTRO', label: 'Outro', emoji: '⚪', color: '#6b7280' },
] as const;

const EVENT_PRIORITIES = [
  { id: 'BAIXA', label: 'Baixa' },
  { id: 'NORMAL', label: 'Normal' },
  { id: 'ALTA', label: 'Alta' },
  { id: 'URGENTE', label: 'Urgente' },
];

const EVENT_STATUSES = [
  { id: 'AGENDADO', label: 'Agendado', color: '#3b82f6' },
  { id: 'CONFIRMADO', label: 'Confirmado', color: '#22c55e' },
  { id: 'CONCLUIDO', label: 'Concluido', color: '#6b7280' },
  { id: 'CANCELADO', label: 'Cancelado', color: '#ef4444' },
  { id: 'ADIADO', label: 'Adiado', color: '#f59e0b' },
];

function getEventColor(type: string) {
  return EVENT_TYPES.find(t => t.id === type)?.color || '#6b7280';
}

function toLocalDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function toISOFromLocal(localStr: string): string {
  // "2026-03-07 14:00" → ISO string
  return new Date(localStr.replace(' ', 'T')).toISOString();
}

function formatDateInput(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTimeInput(isoStr: string): string {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Componente Principal ─────────────────────────────

export default function AgendaPage() {
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);

  // Filtros
  const [filterTypes, setFilterTypes] = useState<string[]>(EVENT_TYPES.map(t => t.id));
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal de criacao/edicao
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formData, setFormData] = useState({
    type: 'CONSULTA',
    title: '',
    description: '',
    date: '',
    startTime: '09:00',
    endTime: '10:00',
    all_day: false,
    priority: 'NORMAL',
    location: '',
    assigned_user_id: '',
    lead_id: '',
    legal_case_id: '',
  });

  // schedule-x
  const eventsServicePlugin = useState(() => createEventsServicePlugin())[0];
  const rangeRef = useRef<{ start: string; end: string } | null>(null);

  const calendar = useNextCalendarApp({
    views: [createViewWeek(), createViewMonthGrid(), createViewDay()],
    defaultView: 'week',
    locale: 'pt-BR',
    firstDayOfWeek: 1,
    dayBoundaries: { start: '07:00', end: '20:00' },
    weekOptions: { gridHeight: 600 },
    isDark: true,
    callbacks: {
      onRangeUpdate(range) {
        rangeRef.current = { start: range.start, end: range.end };
        fetchEvents(range.start, range.end);
      },
      onEventClick(calEvent) {
        const ev = events.find(e => e.id === calEvent.id);
        if (ev) openEditModal(ev);
      },
      onClickDateTime(dateTime) {
        openCreateModal(dateTime);
      },
      onClickDate(date) {
        openCreateModal(date);
      },
    },
    plugins: [eventsServicePlugin, createDragAndDropPlugin()],
    events: [],
  });

  // ─── Data Fetching ──────────────────────────────────

  const fetchEvents = useCallback(async (start?: string, end?: string) => {
    try {
      const params: any = {};
      if (start) params.start = start;
      if (end) params.end = end;
      if (filterUserId) params.userId = filterUserId;
      const res = await api.get('/calendar/events', { params });
      setEvents(res.data || []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [filterUserId]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    // Buscar usuarios e leads para dropdowns
    api.get('/users').then(r => setUsers(r.data || [])).catch(() => {});
    api.get('/leads').then(r => setLeads((r.data || []).map((l: any) => ({ id: l.id, name: l.name, phone: l.phone })))).catch(() => {});
  }, [router]);

  // Sync filtro → calendar
  useEffect(() => {
    if (!eventsServicePlugin) return;
    const filtered = events.filter(e => filterTypes.includes(e.type));
    const calEvents = filtered.map(e => ({
      id: e.id,
      title: `${EVENT_TYPES.find(t => t.id === e.type)?.emoji || ''} ${e.title}`,
      start: toLocalDateTime(e.start_at),
      end: e.end_at ? toLocalDateTime(e.end_at) : toLocalDateTime(new Date(new Date(e.start_at).getTime() + 30 * 60000).toISOString()),
      calendarId: e.type,
      _customContent: {},
    }));
    eventsServicePlugin.set(calEvents);
  }, [events, filterTypes, eventsServicePlugin]);

  // Refetch quando filtro de usuario muda
  useEffect(() => {
    if (rangeRef.current) {
      fetchEvents(rangeRef.current.start, rangeRef.current.end);
    }
  }, [filterUserId, fetchEvents]);

  // ─── Modal Handlers ─────────────────────────────────

  const openCreateModal = (dateTime?: string) => {
    const now = new Date();
    const date = dateTime ? dateTime.split(' ')[0] || dateTime : formatDateInput(now.toISOString());
    const time = dateTime?.includes(' ') ? dateTime.split(' ')[1]?.substring(0, 5) : formatTimeInput(now.toISOString());
    const [h, m] = (time || '09:00').split(':').map(Number);
    const endH = String(h + 1).padStart(2, '0');
    setFormData({
      type: 'CONSULTA',
      title: '',
      description: '',
      date,
      startTime: time || '09:00',
      endTime: `${endH}:${String(m).padStart(2, '0')}`,
      all_day: false,
      priority: 'NORMAL',
      location: '',
      assigned_user_id: '',
      lead_id: '',
      legal_case_id: '',
    });
    setEditingEvent(null);
    setShowModal(true);
  };

  const openEditModal = (ev: CalendarEvent) => {
    setFormData({
      type: ev.type,
      title: ev.title,
      description: ev.description || '',
      date: formatDateInput(ev.start_at),
      startTime: formatTimeInput(ev.start_at),
      endTime: ev.end_at ? formatTimeInput(ev.end_at) : '',
      all_day: ev.all_day,
      priority: ev.priority,
      location: ev.location || '',
      assigned_user_id: ev.assigned_user_id || '',
      lead_id: ev.lead_id || '',
      legal_case_id: ev.legal_case_id || '',
    });
    setEditingEvent(ev);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.title.trim() || !formData.date) return;
    const startIso = toISOFromLocal(`${formData.date} ${formData.startTime}`);
    const endIso = formData.endTime ? toISOFromLocal(`${formData.date} ${formData.endTime}`) : undefined;

    const payload: any = {
      type: formData.type,
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      start_at: startIso,
      end_at: endIso || null,
      all_day: formData.all_day,
      priority: formData.priority,
      location: formData.location.trim() || null,
      assigned_user_id: formData.assigned_user_id || null,
      lead_id: formData.lead_id || null,
      legal_case_id: formData.legal_case_id || null,
    };

    try {
      if (editingEvent) {
        await api.patch(`/calendar/events/${editingEvent.id}`, payload);
      } else {
        await api.post('/calendar/events', payload);
      }
      setShowModal(false);
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    } catch (e: any) {
      alert('Erro ao salvar: ' + (e?.response?.data?.message || e?.message || 'Tente novamente'));
    }
  };

  const handleDelete = async () => {
    if (!editingEvent) return;
    if (!confirm('Remover este evento?')) return;
    try {
      await api.delete(`/calendar/events/${editingEvent.id}`);
      setShowModal(false);
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    } catch (e: any) {
      alert('Erro ao remover: ' + (e?.response?.data?.message || e?.message));
    }
  };

  const toggleFilterType = (typeId: string) => {
    setFilterTypes(prev =>
      prev.includes(typeId) ? prev.filter(t => t !== typeId) : [...prev, typeId]
    );
  };

  // ─── Proximo eventos (sidebar) ──────────────────────

  const upcomingEvents = events
    .filter(e => new Date(e.start_at) >= new Date() && e.status !== 'CANCELADO' && e.status !== 'CONCLUIDO')
    .filter(e => filterTypes.includes(e.type))
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 8);

  // ─── Render ─────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 md:px-6 py-4 border-b border-border bg-card/50">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <CalendarIcon size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Agenda</h1>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                {events.length} evento{events.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Filtro mobile toggle */}
            <button
              onClick={() => setShowFilters(v => !v)}
              className="md:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              <Filter size={14} />
              Filtros
            </button>
            {/* Filtro por advogado */}
            <select
              value={filterUserId}
              onChange={e => setFilterUserId(e.target.value)}
              className="hidden md:block px-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground"
            >
              <option value="">Todos os advogados</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {/* Botao novo evento */}
            <button
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors shadow-md"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Novo Evento</span>
            </button>
          </div>
        </div>

        {/* Filtros mobile (expansivel) */}
        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-2 md:hidden">
            {EVENT_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => toggleFilterType(t.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  filterTypes.includes(t.id)
                    ? 'opacity-100 ring-1 ring-offset-1 ring-offset-background'
                    : 'opacity-40'
                }`}
                style={{ borderColor: t.color + '40', color: t.color, background: t.color + '15' }}
              >
                {t.emoji} {t.label}
              </button>
            ))}
            <select
              value={filterUserId}
              onChange={e => setFilterUserId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs text-foreground"
            >
              <option value="">Todos</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Content: sidebar + calendar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar desktop */}
        <div className="hidden md:flex flex-col w-56 border-r border-border bg-card/30 p-4 overflow-y-auto custom-scrollbar shrink-0">
          {/* Filtros por tipo */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Tipo</p>
          <div className="space-y-1 mb-5">
            {EVENT_TYPES.map(t => (
              <label key={t.id} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={filterTypes.includes(t.id)}
                  onChange={() => toggleFilterType(t.id)}
                  className="sr-only"
                />
                <span
                  className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-all ${
                    filterTypes.includes(t.id) ? '' : 'opacity-30'
                  }`}
                  style={{ borderColor: t.color, background: filterTypes.includes(t.id) ? t.color : 'transparent' }}
                >
                  {filterTypes.includes(t.id) && (
                    <CheckCircle2 size={10} className="text-white" />
                  )}
                </span>
                <span className={`text-xs font-medium transition-opacity ${filterTypes.includes(t.id) ? 'opacity-100' : 'opacity-40'}`}>
                  {t.emoji} {t.label}
                </span>
              </label>
            ))}
          </div>

          {/* Proximos eventos */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Proximos</p>
          {upcomingEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum evento futuro</p>
          ) : (
            <div className="space-y-2">
              {upcomingEvents.map(ev => {
                const d = new Date(ev.start_at);
                const typeColor = getEventColor(ev.type);
                return (
                  <button
                    key={ev.id}
                    onClick={() => openEditModal(ev)}
                    className="w-full text-left p-2 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: typeColor }} />
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' '}
                        {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-foreground truncate">{ev.title}</p>
                    {ev.lead && (
                      <p className="text-[10px] text-muted-foreground truncate">{ev.lead.name || ev.lead.phone}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Calendar */}
        <div className="flex-1 overflow-auto p-2 md:p-4">
          <div className="sx-react-calendar-wrapper h-full min-h-[500px]" style={{
            // Override schedule-x dark theme vars
            ['--sx-color-primary' as any]: 'hsl(var(--primary))',
            ['--sx-color-surface' as any]: 'hsl(var(--card))',
            ['--sx-color-on-surface' as any]: 'hsl(var(--foreground))',
            ['--sx-color-surface-variant' as any]: 'hsl(var(--accent))',
          }}>
            {calendar && <ScheduleXCalendar calendarApp={calendar} />}
          </div>
        </div>
      </div>

      {/* ═══ Modal de Criacao/Edicao ═══ */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
              <h2 className="text-base font-bold text-foreground">
                {editingEvent ? 'Editar Evento' : 'Novo Evento'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Tipo */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Tipo</label>
                <div className="flex flex-wrap gap-1.5">
                  {EVENT_TYPES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setFormData(f => ({ ...f, type: t.id }))}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        formData.type === t.id ? 'ring-2 ring-offset-1 ring-offset-background opacity-100' : 'opacity-50'
                      }`}
                      style={{ borderColor: t.color + '40', color: t.color, background: t.color + '15', ['--tw-ring-color' as any]: t.color }}
                    >
                      {t.emoji} {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Titulo */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Titulo *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                  placeholder={formData.type === 'CONSULTA' ? 'Consulta com...' : formData.type === 'AUDIENCIA' ? 'Audiencia - Vara...' : 'Titulo do evento'}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/30 focus:border-primary/50 outline-none"
                />
              </div>

              {/* Data + Horarios */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Data *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData(f => ({ ...f, date: e.target.value }))}
                    className="w-full px-2 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Inicio</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={e => setFormData(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-2 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Fim</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={e => setFormData(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full px-2 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              {/* Advogado */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Advogado / Responsavel</label>
                <select
                  value={formData.assigned_user_id}
                  onChange={e => setFormData(f => ({ ...f, assigned_user_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Nenhum</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              {/* Lead */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Lead / Cliente</label>
                <select
                  value={formData.lead_id}
                  onChange={e => setFormData(f => ({ ...f, lead_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Nenhum</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{l.name || l.phone}</option>)}
                </select>
              </div>

              {/* Prioridade */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Prioridade</label>
                <select
                  value={formData.priority}
                  onChange={e => setFormData(f => ({ ...f, priority: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {EVENT_PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>

              {/* Local */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Local</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData(f => ({ ...f, location: e.target.value }))}
                  placeholder="Ex: Sala 3, Zoom, Vara 1a TRT..."
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Descricao */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Descricao</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="Notas adicionais..."
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-border">
              <div>
                {editingEvent && (
                  <button
                    onClick={handleDelete}
                    className="px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  >
                    Remover
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formData.title.trim() || !formData.date}
                  className="px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-md disabled:opacity-40 disabled:pointer-events-none"
                >
                  {editingEvent ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
