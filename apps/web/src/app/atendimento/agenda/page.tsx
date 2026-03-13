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
  ChevronLeft, ChevronRight,
  Clock, MapPin, User, FileText, Gavel, AlertTriangle, CheckCircle2, Bell,
  Search, Download, Copy, Repeat, MessageSquare, Users, Send
} from 'lucide-react';
import { io } from 'socket.io-client';
import api, { API_BASE_URL } from '@/lib/api';
import { playNotificationSound } from '@/lib/notificationSounds';
import { AvailabilityPicker } from '@/components/AvailabilityPicker';

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
  created_by_id?: string | null;
  assigned_user?: { id: string; name: string } | null;
  created_by?: { id: string; name: string } | null;
  lead?: { id: string; name: string | null; phone: string } | null;
  legal_case?: { id: string; case_number: string | null; legal_area: string | null } | null;
  _count?: { comments: number };
}

interface EventComment {
  id: string;
  text: string;
  created_at: string;
  user: { id: string; name: string };
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

const REMINDER_OPTIONS = [
  { value: 15, label: '15 minutos antes' },
  { value: 30, label: '30 minutos antes' },
  { value: 60, label: '1 hora antes' },
  { value: 1440, label: '1 dia antes' },
];

const RECURRENCE_OPTIONS = [
  { value: '', label: 'Não repetir' },
  { value: 'DAILY', label: 'Diário' },
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'BIWEEKLY', label: 'Quinzenal' },
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'CUSTOM', label: 'Personalizado' },
];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function getEventColor(type: string) {
  return EVENT_TYPES.find(t => t.id === type)?.color || '#6b7280';
}

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = API_BASE_URL;
  if (apiUrl.startsWith('http')) {
    try { return new URL(apiUrl).origin; } catch { /* fall through */ }
  }
  return apiUrl;
}

function getSocketPath(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_PATH) return process.env.NEXT_PUBLIC_SOCKET_PATH;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const isDev = apiUrl.includes('localhost') || /https?:\/\/[^/]+:\d{4,}/.test(apiUrl);
  return isDev ? '/socket.io/' : '/api/socket.io/';
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

// ─── Mini Calendário (sidebar) ────────────────────────

const MONTH_NAMES_PT = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];
const WD_HEADERS = ['D','S','T','Q','Q','S','S'];

function MiniCalendar({ onDateSelect }: { onDateSelect: (dateStr: string) => void }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleDayClick = (day: number) => {
    const ds = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    setSelected(ds);
    onDateSelect(ds);
  };

  return (
    <div className="select-none px-1 py-1">
      {/* Cabeçalho mês */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-foreground">
          {MONTH_NAMES_PT[viewMonth]} {viewYear}
        </span>
        <div className="flex gap-0.5">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-accent/60 text-muted-foreground transition-colors">
            <ChevronLeft size={13} />
          </button>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-accent/60 text-muted-foreground transition-colors">
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      {/* Cabeçalho dias da semana */}
      <div className="grid grid-cols-7">
        {WD_HEADERS.map((d, i) => (
          <span key={i} className="text-center text-[10px] text-muted-foreground font-medium h-5 flex items-center justify-center">{d}</span>
        ))}
      </div>
      {/* Grade de dias */}
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <span key={`e-${i}`} className="h-6" />;
          const ds = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const isToday = ds === todayStr;
          const isSel = ds === selected;
          return (
            <button
              key={`d-${day}`}
              onClick={() => handleDayClick(day)}
              className={`h-6 w-6 mx-auto flex items-center justify-center rounded-full text-[11px] font-medium transition-colors
                ${isSel ? 'bg-primary text-primary-foreground' : isToday ? 'bg-primary/15 text-primary font-bold' : 'text-foreground hover:bg-accent/60'}
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
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
    reminders: [{ minutes_before: 30, channel: 'WHATSAPP' }] as { minutes_before: number; channel: string }[],
    recurrence_rule: '',
    recurrence_end: '',
    recurrence_days: [] as number[],
  });

  // Usuario logado + controle de acesso
  // Inicializado com valores neutros para evitar hydration mismatch (SSR ≠ client)
  // O useEffect abaixo popula os valores reais a partir do JWT no client
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [showAllUsers, setShowAllUsers] = useState(false);

  // Comentarios do evento
  const [eventComments, setEventComments] = useState<EventComment[]>([]);
  const [newComment, setNewComment] = useState('');

  // Real-time & UX
  const [reminderToast, setReminderToast] = useState<{ eventId: string; title: string; type: string; start_at: string; minutesBefore: number } | null>(null);
  const [conflictWarning, setConflictWarning] = useState<{ id: string; title: string; start_at: string; end_at: string }[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEvent[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // schedule-x
  const eventsServicePlugin = useState(() => createEventsServicePlugin())[0];
  const rangeRef = useRef<{ start: string; end: string } | null>(null);

  // ─── Data Fetching ──────────────────────────────────

  const fetchEvents = useCallback(async (start?: string, end?: string) => {
    try {
      const params: any = {};
      if (start) params.start = start;
      if (end) params.end = end;
      if (showAllUsers) {
        params.showAll = 'true';
        if (filterUserId) params.userId = filterUserId;
      }
      // Quando showAllUsers=false, backend filtra automaticamente pelo user logado
      const res = await api.get('/calendar/events', { params });
      setEvents(res.data || []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [filterUserId, showAllUsers]);

  // Drag-and-drop persistence
  const handleDragUpdate = useCallback(async (updatedEvent: any) => {
    try {
      const startIso = toISOFromLocal(updatedEvent.start);
      const endIso = toISOFromLocal(updatedEvent.end);
      await api.patch(`/calendar/events/${updatedEvent.id}`, { start_at: startIso, end_at: endIso });
      // Update local state optimistically
      setEvents(prev => prev.map(e => e.id === updatedEvent.id ? { ...e, start_at: startIso, end_at: endIso } : e));
    } catch {
      // Rollback: refetch on error
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    }
  }, [fetchEvents]);

  const calendar = useNextCalendarApp({
    views: [createViewWeek(), createViewMonthGrid(), createViewDay()],
    defaultView: isMobile ? 'day' : 'week',
    locale: 'pt-BR',
    firstDayOfWeek: 1,
    dayBoundaries: { start: '07:00', end: '20:00' },
    weekOptions: { gridHeight: isMobile ? 500 : 600 },
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
      onEventUpdate(updatedEvent) {
        handleDragUpdate(updatedEvent);
      },
    },
    plugins: [eventsServicePlugin, createDragAndDropPlugin()],
    events: [],
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    // Extrair userId e role do JWT
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.sub) setCurrentUserId(payload.sub);
      if (payload?.role) {
        setCurrentUserRole(payload.role);
        // Admin visualiza todos os advogados por padrão
        if (payload.role === 'ADMIN' || payload.role === 'admin') {
          setShowAllUsers(true);
        }
      }
    } catch {}
    // Buscar apenas advogados e admins para o filtro de usuários
    api.get('/users?limit=100').then(r => {
      const data: any[] = r.data?.data || r.data?.users || r.data || [];
      const lawyers = data.filter((u: any) =>
        u.role === 'Advogados' || u.role === 'ADMIN' || u.role === 'admin'
      );
      setUsers(lawyers.map((u: any) => ({ id: u.id, name: u.name })));
    }).catch(() => {});
    api.get('/leads').then(r => setLeads((r.data || []).map((l: any) => ({ id: l.id, name: l.name, phone: l.phone })))).catch(() => {});
  }, [router]);

  // Sync filtro → calendar
  useEffect(() => {
    if (!eventsServicePlugin) return;
    const filtered = events.filter(e => filterTypes.includes(e.type));
    const calEvents = filtered.map(e => {
      // No modo "Todos", prefixar com o nome do advogado responsável
      const userPrefix = (showAllUsers && !filterUserId && e.assigned_user)
        ? `[${e.assigned_user.name.split(' ')[0]}] `
        : '';
      return {
        id: e.id,
        title: `${EVENT_TYPES.find(t => t.id === e.type)?.emoji || ''} ${userPrefix}${e.title}${(e as any).recurrence_rule || (e as any).parent_event_id ? ' 🔁' : ''}${e._count?.comments ? ` 💬${e._count.comments}` : ''}`,
        start: toLocalDateTime(e.start_at),
        end: e.end_at ? toLocalDateTime(e.end_at) : toLocalDateTime(new Date(new Date(e.start_at).getTime() + 30 * 60000).toISOString()),
        calendarId: e.type,
        _customContent: {},
      };
    });
    eventsServicePlugin.set(calEvents);
  }, [events, filterTypes, eventsServicePlugin, showAllUsers, filterUserId]);

  // Refetch quando filtro de usuario muda
  useEffect(() => {
    if (rangeRef.current) {
      fetchEvents(rangeRef.current.start, rangeRef.current.end);
    }
  }, [filterUserId, showAllUsers, fetchEvents]);

  // ─── Socket.io Real-Time ─────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;  // sem token, não tenta conectar

    const wsUrl = getWsUrl();
    const socket = io(wsUrl, {
      path: getSocketPath(),
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 10000,
      auth: { token },  // necessário para o middleware JWT do socket
    });

    socket.on('connect', () => {
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.sub) socket.emit('join_user', payload.sub);
      } catch {}
    });

    const handleCalendarUpdate = () => {
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    };

    const handleCalendarReminder = (data: { eventId: string; title: string; type: string; start_at: string; minutesBefore: number }) => {
      setReminderToast(data);
      try { playNotificationSound(); } catch {}
      setTimeout(() => setReminderToast(null), 10000);
    };

    socket.on('calendar_update', handleCalendarUpdate);
    socket.on('calendar_reminder', handleCalendarReminder);

    return () => {
      socket.off('calendar_update', handleCalendarUpdate);
      socket.off('calendar_reminder', handleCalendarReminder);
      socket.disconnect();
    };
  }, [fetchEvents]);

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
      assigned_user_id: currentUserId,
      lead_id: '',
      legal_case_id: '',
      reminders: [{ minutes_before: 30, channel: 'WHATSAPP' }],
      recurrence_rule: '',
      recurrence_end: '',
      recurrence_days: [],
    });
    setEditingEvent(null);
    setEventComments([]);
    setNewComment('');
    setConflictWarning([]);
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
      reminders: (ev as any).reminders?.map((r: any) => ({ minutes_before: r.minutes_before, channel: r.channel })) || [{ minutes_before: 30, channel: 'WHATSAPP' }],
      recurrence_rule: (ev as any).recurrence_rule || '',
      recurrence_end: (ev as any).recurrence_end ? formatDateInput((ev as any).recurrence_end) : '',
      recurrence_days: (ev as any).recurrence_days || [],
    });
    setEditingEvent(ev);
    setConflictWarning([]);
    setNewComment('');
    // Buscar comentarios
    api.get(`/calendar/events/${ev.id}/comments`).then(r => setEventComments(r.data || [])).catch(() => setEventComments([]));
    setShowModal(true);
  };

  const fetchEventComments = async (eventId: string) => {
    try {
      const res = await api.get(`/calendar/events/${eventId}/comments`);
      setEventComments(res.data || []);
    } catch {
      setEventComments([]);
    }
  };

  const handleAddComment = async () => {
    if (!editingEvent || !newComment.trim()) return;
    try {
      await api.post(`/calendar/events/${editingEvent.id}/comments`, { text: newComment.trim() });
      setNewComment('');
      fetchEventComments(editingEvent.id);
    } catch (e: any) {
      alert('Erro ao comentar: ' + (e?.response?.data?.message || e?.message));
    }
  };

  const handleSave = async (forceIgnoreConflict = false) => {
    if (!formData.title.trim() || !formData.date) return;
    const startIso = toISOFromLocal(`${formData.date} ${formData.startTime}`);
    const endIso = formData.endTime ? toISOFromLocal(`${formData.date} ${formData.endTime}`) : undefined;

    // Conflict check
    if (!forceIgnoreConflict && formData.assigned_user_id && endIso) {
      try {
        const params: any = { userId: formData.assigned_user_id, start: startIso, end: endIso };
        if (editingEvent) params.excludeId = editingEvent.id;
        const conflicts = await api.get('/calendar/conflicts', { params });
        if (conflicts.data?.length > 0) {
          setConflictWarning(conflicts.data);
          return; // show warning, user must click "Salvar mesmo assim"
        }
      } catch {} // ignore conflict check failure, proceed with save
    }

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
      reminders: formData.reminders.length > 0 ? formData.reminders : undefined,
      recurrence_rule: formData.recurrence_rule || undefined,
      recurrence_end: formData.recurrence_end || undefined,
      recurrence_days: formData.recurrence_days.length > 0 ? formData.recurrence_days : undefined,
    };

    try {
      if (editingEvent) {
        await api.patch(`/calendar/events/${editingEvent.id}`, payload);
      } else {
        await api.post('/calendar/events', payload);
      }
      setShowModal(false);
      setConflictWarning([]);
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    } catch (e: any) {
      alert('Erro ao salvar: ' + (e?.response?.data?.message || e?.message || 'Tente novamente'));
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!editingEvent) return;
    try {
      await api.patch(`/calendar/events/${editingEvent.id}/status`, { status: newStatus });
      setEditingEvent({ ...editingEvent, status: newStatus });
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    } catch (e: any) {
      alert('Erro: ' + (e?.response?.data?.message || e?.message));
    }
  };

  const handleDelete = async (scope: 'single' | 'all' = 'single') => {
    if (!editingEvent) return;
    const isRecurring = (editingEvent as any).parent_event_id || (editingEvent as any).recurrence_rule;
    if (isRecurring && scope === 'single') {
      const deleteAll = confirm('Este evento faz parte de uma série.\n\nClique OK para excluir TODA a série.\nClique Cancelar para excluir apenas este evento.');
      if (deleteAll) {
        const parentId = (editingEvent as any).parent_event_id || editingEvent.id;
        try {
          await api.delete(`/calendar/events/${parentId}?deleteScope=all`);
          setShowModal(false);
          if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
        } catch (e: any) {
          alert('Erro: ' + (e?.response?.data?.message || e?.message));
        }
        return;
      }
    }
    if (!confirm('Remover este evento?')) return;
    try {
      await api.delete(`/calendar/events/${editingEvent.id}`);
      setShowModal(false);
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    } catch (e: any) {
      alert('Erro ao remover: ' + (e?.response?.data?.message || e?.message));
    }
  };

  const handleDuplicate = () => {
    if (!editingEvent) return;
    setShowModal(false);
    setTimeout(() => {
      const now = new Date();
      setFormData({
        type: editingEvent.type,
        title: editingEvent.title + ' (cópia)',
        description: editingEvent.description || '',
        date: formatDateInput(now.toISOString()),
        startTime: formatTimeInput(editingEvent.start_at),
        endTime: editingEvent.end_at ? formatTimeInput(editingEvent.end_at) : '',
        all_day: editingEvent.all_day,
        priority: editingEvent.priority,
        location: editingEvent.location || '',
        assigned_user_id: editingEvent.assigned_user_id || '',
        lead_id: editingEvent.lead_id || '',
        legal_case_id: editingEvent.legal_case_id || '',
        reminders: [{ minutes_before: 30, channel: 'WHATSAPP' }],
        recurrence_rule: '',
        recurrence_end: '',
        recurrence_days: [],
      });
      setEditingEvent(null);
      setConflictWarning([]);
      setShowModal(true);
    }, 100);
  };

  const handleExportICS = async (eventId: string) => {
    try {
      const apiUrl = API_BASE_URL;
      const token = localStorage.getItem('token');
      const res = await fetch(`${apiUrl}/calendar/export/ics/${eventId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `event-${eventId}.ics`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Erro ao exportar');
    }
  };

  const handleExportRange = async () => {
    if (!rangeRef.current) return;
    try {
      const apiUrl = API_BASE_URL;
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        start: rangeRef.current.start,
        end: rangeRef.current.end,
      });
      if (filterUserId) params.set('userId', filterUserId);
      const res = await fetch(`${apiUrl}/calendar/export/ics?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'calendar-export.ics';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Erro ao exportar');
    }
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get('/calendar/search', { params: { q } });
        setSearchResults(res.data || []);
      } catch { setSearchResults([]); }
    }, 300);
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
    <div className="flex h-full bg-background overflow-hidden">

      {/* ═══ Sidebar estilo Google Calendar ═══ */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-card/30 overflow-y-auto custom-scrollbar">

        {/* ── Topo: barra com título + botão Criar ── */}
        <div className="px-3 pt-4 pb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <CalendarIcon size={16} className="text-primary" />
            </div>
            <span className="font-semibold text-sm text-foreground">Agenda</span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {events.length} evento{events.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Botão + Criar */}
        <div className="px-3 mb-3">
          <button
            onClick={() => openCreateModal()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md text-sm font-semibold text-foreground hover:bg-accent transition-all"
          >
            <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-sm">
              <Plus size={16} className="text-primary-foreground" />
            </span>
            Criar evento
          </button>
        </div>

        {/* Mini Calendário */}
        <div className="px-2 mb-2">
          <MiniCalendar
            onDateSelect={(dateStr) => {
              try { (calendar as any)?.navigate?.(dateStr); } catch {}
            }}
          />
        </div>

        <div className="mx-3 border-t border-border/50 my-1" />

        {/* Filtros por tipo */}
        <div className="px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Meus calendários</p>
          <div className="space-y-0.5">
            {EVENT_TYPES.map(t => (
              <label key={t.id} className="flex items-center gap-2.5 cursor-pointer py-1 group rounded-lg px-1 hover:bg-accent/40 transition-colors">
                <input
                  type="checkbox"
                  checked={filterTypes.includes(t.id)}
                  onChange={() => toggleFilterType(t.id)}
                  className="sr-only"
                />
                <span
                  className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
                    filterTypes.includes(t.id) ? '' : 'opacity-30'
                  }`}
                  style={{ borderColor: t.color, background: filterTypes.includes(t.id) ? t.color : 'transparent' }}
                >
                  {filterTypes.includes(t.id) && <CheckCircle2 size={9} className="text-white" />}
                </span>
                <span className={`text-xs font-medium transition-opacity ${filterTypes.includes(t.id) ? 'text-foreground' : 'text-muted-foreground opacity-50'}`}>
                  {t.emoji} {t.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Filtro por advogado (admin) */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Advogado</p>
            <button
              onClick={() => setShowAllUsers(v => !v)}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                showAllUsers
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'text-muted-foreground border-border hover:bg-accent'
              }`}
              title={showAllUsers ? 'Mostrando todos' : 'Somente meus eventos'}
            >
              {showAllUsers ? 'Todos' : 'Meus'}
            </button>
          </div>
          {showAllUsers && (
            <select
              value={filterUserId}
              onChange={e => setFilterUserId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Todos os advogados</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </div>

        <div className="mx-3 border-t border-border/50 my-1" />

        {/* Próximos eventos */}
        <div className="px-3 py-2 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Próximos</p>
          {upcomingEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">Nenhum evento futuro</p>
          ) : (
            <div className="space-y-1.5">
              {upcomingEvents.map(ev => {
                const d = new Date(ev.start_at);
                const typeColor = getEventColor(ev.type);
                return (
                  <button
                    key={ev.id}
                    onClick={() => openEditModal(ev)}
                    className="w-full text-left p-2 rounded-xl border border-border/40 hover:bg-accent/50 hover:border-border transition-all group"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: typeColor }} />
                      <span className="text-[10px] text-muted-foreground">
                        {d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' · '}
                        {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-foreground truncate">{ev.title}</p>
                    {ev.lead && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{ev.lead.name || ev.lead.phone}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ═══ Área principal ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Top bar compacta ── */}
        <div className="shrink-0 px-3 md:px-4 py-2.5 border-b border-border bg-card/40 flex items-center gap-2">

          {/* Mobile: filtros toggle + titulo */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className="md:hidden p-2 rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            <Filter size={15} />
          </button>

          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card/80 text-sm focus-within:ring-2 focus-within:ring-primary/25 focus-within:border-primary/40 transition-all">
              <Search size={14} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                onFocus={() => setShowSearch(true)}
                placeholder="Buscar eventos..."
                className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 outline-none text-sm"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
            {showSearch && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto">
                {searchResults.map(ev => (
                  <button
                    key={ev.id}
                    onClick={() => { openEditModal(ev); setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                    className="w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors border-b border-border/30 last:border-0"
                  >
                    <p className="text-xs font-semibold text-foreground truncate">
                      {EVENT_TYPES.find(t => t.id === ev.type)?.emoji} {ev.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(ev.start_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {ev.assigned_user ? ` · ${ev.assigned_user.name}` : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Mobile: toggle todos/meus */}
          <button
            onClick={() => setShowAllUsers(v => !v)}
            className={`md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
              showAllUsers ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
            }`}
          >
            {showAllUsers ? <Users size={12} /> : <User size={12} />}
          </button>

          {/* Export */}
          <button
            onClick={handleExportRange}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
            title="Exportar .ics"
          >
            <Download size={14} />
          </button>

          {/* + Novo Evento */}
          <button
            onClick={() => openCreateModal()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Novo Evento</span>
          </button>
        </div>

        {/* Filtros mobile (expansível) */}
        {showFilters && (
          <div className="px-3 py-2 flex flex-wrap gap-1.5 border-b border-border bg-card/30 md:hidden">
            {EVENT_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => toggleFilterType(t.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  filterTypes.includes(t.id) ? 'opacity-100 ring-1 ring-offset-1 ring-offset-background' : 'opacity-40'
                }`}
                style={{ borderColor: t.color + '40', color: t.color, background: t.color + '15' }}
              >
                {t.emoji} {t.label}
              </button>
            ))}
            {showAllUsers && (
              <select
                value={filterUserId}
                onChange={e => setFilterUserId(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs text-foreground"
              >
                <option value="">Todos</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Calendário schedule-x */}
        <div className="flex-1 overflow-auto">
          <div className="sx-react-calendar-wrapper h-full min-h-[500px]" style={{
            ['--sx-color-primary' as any]: 'hsl(var(--primary))',
            ['--sx-color-surface' as any]: 'hsl(var(--card))',
            ['--sx-color-on-surface' as any]: 'hsl(var(--foreground))',
            ['--sx-color-surface-variant' as any]: 'hsl(var(--accent))',
          }}>
            {calendar && <ScheduleXCalendar calendarApp={calendar} />}
          </div>
        </div>

      </div>{/* fim área principal */}

      {/* ═══ Toast de Lembrete ═══ */}
      {reminderToast && (
        <div className="fixed top-4 right-4 z-[10000] w-80 bg-card border border-primary/30 rounded-xl shadow-2xl p-4 animate-in slide-in-from-right-5 duration-300">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Bell size={18} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary mb-0.5">
                Lembrete em {reminderToast.minutesBefore} min
              </p>
              <p className="text-sm font-semibold text-foreground truncate">
                {EVENT_TYPES.find(t => t.id === reminderToast.type)?.emoji} {reminderToast.title}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(reminderToast.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                {' - '}
                {new Date(reminderToast.start_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
              </p>
            </div>
            <button onClick={() => setReminderToast(null)} className="p-1 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ═══ Modal de Criacao/Edicao ═══ */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            {(() => {
              const canEdit = !editingEvent || currentUserRole === 'ADMIN'
                || editingEvent.created_by_id === currentUserId
                || editingEvent.assigned_user_id === currentUserId
                || editingEvent.created_by?.id === currentUserId
                || editingEvent.assigned_user?.id === currentUserId;
              return (<>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
              <div>
                <h2 className="text-base font-bold text-foreground">
                  {editingEvent ? (canEdit ? 'Editar Evento' : 'Visualizar Evento') : 'Novo Evento'}
                </h2>
                {editingEvent?.created_by && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Criado por: {editingEvent.created_by.name}
                    {!canEdit && ' · Somente leitura'}
                  </p>
                )}
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
                <X size={18} />
              </button>
            </div>

            {/* Status pills (only when editing) */}
            {editingEvent && (
              <div className="px-5 pt-3 flex flex-wrap gap-1.5">
                {EVENT_STATUSES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => canEdit && handleStatusChange(s.id)}
                    disabled={!canEdit}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all border ${
                      editingEvent.status === s.id
                        ? 'text-white shadow-sm'
                        : 'opacity-50 hover:opacity-80'
                    } ${!canEdit ? 'cursor-not-allowed' : ''}`}
                    style={{
                      borderColor: s.color + '60',
                      background: editingEvent.status === s.id ? s.color : 'transparent',
                      color: editingEvent.status === s.id ? '#fff' : s.color,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            <fieldset disabled={!canEdit} className="contents">
            <div className="p-5 space-y-4">
              {/* Conflict warning */}
              {conflictWarning.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={14} className="text-amber-500" />
                    <span className="text-xs font-bold text-amber-500">Conflito de horario</span>
                  </div>
                  {conflictWarning.map(c => (
                    <p key={c.id} className="text-xs text-amber-400 ml-5">
                      {c.title} ({new Date(c.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} - {new Date(c.end_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})
                    </p>
                  ))}
                  <button
                    onClick={() => { setConflictWarning([]); handleSave(true); }}
                    className="mt-2 ml-5 text-[11px] font-semibold text-amber-500 underline hover:text-amber-400"
                  >
                    Salvar mesmo assim
                  </button>
                </div>
              )}

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

              {/* Availability picker (only for CONSULTA with assigned user) */}
              {formData.type === 'CONSULTA' && formData.assigned_user_id && !editingEvent && (
                <AvailabilityPicker
                  userId={formData.assigned_user_id}
                  duration={60}
                  onSelectSlot={(start, end) => {
                    setFormData(f => ({ ...f, startTime: start, endTime: end }));
                  }}
                />
              )}

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

              {/* Lembretes */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                  <Bell size={11} /> Lembretes
                </label>
                <div className="space-y-1.5">
                  {formData.reminders.map((rem, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={rem.minutes_before}
                        onChange={e => {
                          const updated = [...formData.reminders];
                          updated[idx] = { ...updated[idx], minutes_before: parseInt(e.target.value) };
                          setFormData(f => ({ ...f, reminders: updated }));
                        }}
                        className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground outline-none"
                      >
                        {REMINDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <select
                        value={rem.channel}
                        onChange={e => {
                          const updated = [...formData.reminders];
                          updated[idx] = { ...updated[idx], channel: e.target.value };
                          setFormData(f => ({ ...f, reminders: updated }));
                        }}
                        className="w-28 px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground outline-none"
                      >
                        <option value="PUSH">Push</option>
                        <option value="WHATSAPP">WhatsApp</option>
                        <option value="EMAIL">Email</option>
                      </select>
                      <button
                        onClick={() => setFormData(f => ({ ...f, reminders: f.reminders.filter((_, i) => i !== idx) }))}
                        className="p-1 text-muted-foreground hover:text-destructive"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {formData.reminders.length < 3 && (
                    <button
                      onClick={() => setFormData(f => ({ ...f, reminders: [...f.reminders, { minutes_before: 60, channel: 'WHATSAPP' }] }))}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      + Adicionar lembrete
                    </button>
                  )}
                </div>
              </div>

              {/* Recorrência */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                  <Repeat size={11} /> Repetir
                </label>
                <select
                  value={formData.recurrence_rule}
                  onChange={e => setFormData(f => ({ ...f, recurrence_rule: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                {formData.recurrence_rule && (
                  <div className="mt-2 space-y-2">
                    {/* Custom weekdays */}
                    {formData.recurrence_rule === 'CUSTOM' && (
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">Dias da semana</label>
                        <div className="flex gap-1">
                          {WEEKDAYS.map((day, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setFormData(f => ({
                                  ...f,
                                  recurrence_days: f.recurrence_days.includes(idx)
                                    ? f.recurrence_days.filter(d => d !== idx)
                                    : [...f.recurrence_days, idx].sort(),
                                }));
                              }}
                              className={`w-9 h-8 rounded-md text-[11px] font-bold border transition-all ${
                                formData.recurrence_days.includes(idx)
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'border-border text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* End date */}
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">Repetir até</label>
                      <input
                        type="date"
                        value={formData.recurrence_end}
                        onChange={e => setFormData(f => ({ ...f, recurrence_end: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>
                )}
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
            </fieldset>

              {/* Comentarios (sempre visivel, qualquer usuario pode comentar) */}
              {editingEvent && (
                <div className="px-5 pb-4">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                    <MessageSquare size={11} /> Comentarios ({eventComments.length})
                  </label>
                  {eventComments.length > 0 && (
                    <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
                      {eventComments.map(c => (
                        <div key={c.id} className="p-2 rounded-lg bg-accent/30 border border-border/30">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] font-bold text-foreground">{c.user.name}</span>
                            <span className="text-[9px] text-muted-foreground">
                              {new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                              {' '}
                              {new Date(c.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-foreground/80">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddComment(); }}
                      placeholder="Adicionar comentario..."
                      className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!newComment.trim()}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1"
                    >
                      <Send size={11} />
                    </button>
                  </div>
                </div>
              )}

            {/* Modal footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-border">
              <div className="flex items-center gap-1">
                {editingEvent && canEdit && (
                  <>
                    <button
                      onClick={() => handleDelete()}
                      className="px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                    >
                      Remover
                    </button>
                    <button
                      onClick={handleDuplicate}
                      className="px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent rounded-lg transition-colors inline-flex items-center gap-1"
                      title="Duplicar evento"
                    >
                      <Copy size={12} /> Duplicar
                    </button>
                  </>
                )}
                {editingEvent && (
                  <button
                    onClick={() => handleExportICS(editingEvent.id)}
                    className="px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent rounded-lg transition-colors inline-flex items-center gap-1"
                    title="Exportar .ics"
                  >
                    <Download size={12} /> .ics
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors"
                >
                  {canEdit ? 'Cancelar' : 'Fechar'}
                </button>
                {canEdit && (
                  <button
                    onClick={() => handleSave()}
                    disabled={!formData.title.trim() || !formData.date}
                    className="px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-md disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {editingEvent ? 'Salvar' : 'Criar'}
                  </button>
                )}
              </div>
            </div>
              </>); // end canEdit IIFE
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
