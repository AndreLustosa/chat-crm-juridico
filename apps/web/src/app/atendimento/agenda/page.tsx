'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Search, Download, Copy, Repeat, MessageSquare, Users, Send,
  LayoutGrid, CalendarDays as CalendarViewIcon, CheckSquare, List,
  BookOpen, ExternalLink,
} from 'lucide-react';
import { io } from 'socket.io-client';
import api, { API_BASE_URL } from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { playNotificationSound } from '@/lib/notificationSounds';
import { AvailabilityPicker } from '@/components/AvailabilityPicker';
import { TasksPanel } from './TasksPanel';

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
  legal_case?: { id: string; case_number: string | null; legal_area: string | null; lead?: { name: string | null } | null } | null;
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
  { id: 'AUDIENCIA', label: 'Audiência', emoji: '🔴', color: '#ef4444' },
  { id: 'PERICIA', label: 'Perícia', emoji: '🔬', color: '#0ea5e9' },
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

const PRIORITY_COLORS: Record<string, string> = {
  BAIXA: '#6b7280',
  NORMAL: '#3b82f6',
  ALTA: '#f59e0b',
  URGENTE: '#ef4444',
};

const PRIORITY_LABELS: Record<string, string> = {
  BAIXA: 'Baixa',
  NORMAL: 'Normal',
  ALTA: 'Alta',
  URGENTE: 'Urgente',
};

const KANBAN_COLUMNS = [
  { id: 'AGENDADO',  label: 'A Fazer',      emoji: '📋', color: '#3b82f6' },
  { id: 'CONFIRMADO', label: 'Em Andamento', emoji: '🔄', color: '#f59e0b' },
  { id: 'CONCLUIDO', label: 'Concluído',    emoji: '✅', color: '#22c55e' },
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
  // App usa UTC "naive" — horários salvos como UTC = horário local de Maceió
  const d = new Date(isoStr);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/**
 * Converte Temporal.ZonedDateTime, Temporal.PlainDate, ou string
 * para ISO string usável como query param no backend.
 * Schedule-x v4 passa objetos Temporal nos callbacks — o Axios
 * não os serializa corretamente como query params.
 */
function temporalToISO(dt: any): string {
  if (!dt) return '';
  if (typeof dt === 'string') return dt;
  // Temporal.ZonedDateTime — usar toInstant().toString() p/ UTC ISO
  if (typeof dt.toInstant === 'function') {
    return dt.toInstant().toString(); // "2026-03-09T00:00:00Z"
  }
  // Temporal.PlainDate / PlainDateTime — construir manualmente
  if (typeof dt.year === 'number') {
    const y = String(dt.year).padStart(4, '0');
    const mo = String(dt.month).padStart(2, '0');
    const d = String(dt.day).padStart(2, '0');
    if (typeof dt.hour === 'number') {
      const h = String(dt.hour).padStart(2, '0');
      const mi = String(dt.minute).padStart(2, '0');
      return `${y}-${mo}-${d}T${h}:${mi}:00`;
    }
    return `${y}-${mo}-${d}`;
  }
  return String(dt);
}

/**
 * Converte Temporal.ZonedDateTime ou Temporal.PlainDate
 * para "YYYY-MM-DD HH:mm" (formato que openCreateModal espera).
 */
function temporalToLocalStr(dt: any): string {
  if (!dt) return '';
  if (typeof dt === 'string') return dt;
  if (typeof dt.year === 'number') {
    const y = String(dt.year).padStart(4, '0');
    const mo = String(dt.month).padStart(2, '0');
    const d = String(dt.day).padStart(2, '0');
    if (typeof dt.hour === 'number') {
      const h = String(dt.hour).padStart(2, '0');
      const mi = String(dt.minute).padStart(2, '0');
      return `${y}-${mo}-${d} ${h}:${mi}`;
    }
    return `${y}-${mo}-${d}`;
  }
  return String(dt);
}

function toISOFromLocal(localStr: string): string {
  // App usa UTC "naive": trata o horário digitado como UTC direto (= horário de Maceió)
  // "2026-06-03 09:05" → "2026-06-03T09:05:00.000Z" (sem converter fuso)
  const [datePart, timePart = '00:00'] = localStr.replace('T', ' ').split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0)).toISOString();
}

function formatDateInput(isoStr: string): string {
  // Lê data em UTC (horário naive = horário local de Maceió)
  const d = new Date(isoStr);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function formatTimeInput(isoStr: string): string {
  // Lê hora em UTC (horário naive = horário local de Maceió)
  const d = new Date(isoStr);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
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

  // Lê o tab da URL no client side sem useSearchParams (evita prerender error do Next.js)
  const [activeTab, setActiveTab] = useState<'calendar' | 'tasks'>('calendar');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'tasks') setActiveTab('tasks');
  }, []);

  const switchTab = (tab: 'calendar' | 'tasks') => {
    setActiveTab(tab);
    const url = tab === 'calendar' ? '/atendimento/agenda' : '/atendimento/agenda?tab=tasks';
    router.push(url, { scroll: false });
  };

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
  const [mounted, setMounted] = useState(false);
  const [hoverTooltip, setHoverTooltip] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);
  const [kanbanView, setKanbanView] = useState(false);

  // ─── openCreateModal — definido ANTES dos useEffects e callbacks que o usam ──
  // useCallback com [currentUserId] para evitar stale closure no atalho de teclado
  const openCreateModal = useCallback((dateTime?: string) => {
    const now = new Date();
    let date: string;
    let time: string;

    if (dateTime) {
      // schedule-x pode enviar "YYYY-MM-DD HH:mm" ao clicar na célula da grid
      const parts = dateTime.split(' ');
      date = parts[0] || formatDateInput(now.toISOString());
      if (parts[1]) {
        // Arredondar minutos para múltiplo de 30 (grid de 30min)
        const [hh, mm] = parts[1].substring(0, 5).split(':').map(Number);
        const roundedMin = Math.round(mm / 30) * 30;
        const finalH = roundedMin >= 60 ? Math.min(hh + 1, 23) : hh;
        const finalM = roundedMin >= 60 ? 0 : roundedMin;
        time = `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
      } else {
        time = formatTimeInput(now.toISOString());
      }
    } else {
      date = formatDateInput(now.toISOString());
      time = formatTimeInput(now.toISOString());
    }

    const [h, m] = time.split(':').map(Number);
    // Duração padrão: 30 min (compatível com grid de 30min)
    const endMinTotal = h * 60 + m + 30;
    const endH = String(Math.min(Math.floor(endMinTotal / 60), 23)).padStart(2, '0');
    const endM = String(endMinTotal % 60).padStart(2, '0');

    setFormData({
      type: 'CONSULTA',
      title: '',
      description: '',
      date,
      startTime: time,
      endTime: `${endH}:${endM}`,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  useEffect(() => { setMounted(true); }, []);

  // Atalho de teclado: 'N' abre modal de criação
  // openCreateModal é estável via useCallback([currentUserId]) — sem stale closure
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openCreateModal();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openCreateModal]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // schedule-x
  const eventsServicePlugin = useState(() => createEventsServicePlugin())[0];
  const rangeRef = useRef<{ start: string; end: string } | null>(null);
  // Refs para evitar stale closure nos callbacks do schedule-x
  // (useNextCalendarApp captura apenas a versão inicial das funções/estados)
  const fetchEventsRef = useRef<typeof fetchEvents | null>(null);
  const eventsRef = useRef<CalendarEvent[]>([]); // para onEventClick sempre ter a lista atualizada

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

  // Manter refs atualizados com os valores mais recentes
  useEffect(() => { fetchEventsRef.current = fetchEvents; }, [fetchEvents]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Drag-and-drop persistence
  const handleDragUpdate = useCallback(async (updatedEvent: any) => {
    try {
      // schedule-x v4: updatedEvent.start/end são Temporal.ZonedDateTime — usar temporalToISO
      const startIso = temporalToISO(updatedEvent.start);
      const endIso = temporalToISO(updatedEvent.end);
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
    dayBoundaries: { start: '05:00', end: '23:00' },
    weekOptions: { gridHeight: isMobile ? 800 : 1200, gridStep: 30 },
    isDark: true,
    callbacks: {
      onRangeUpdate(range) {
        try {
          // schedule-x v4 passa Temporal.ZonedDateTime — converter para ISO string
          const startISO = temporalToISO(range.start);
          const endISO = temporalToISO(range.end);
          rangeRef.current = { start: startISO, end: endISO };
          // Usar ref para ter sempre a versão mais recente de fetchEvents
          const fn = fetchEventsRef.current ?? fetchEvents;
          fn(startISO, endISO);
        } catch (e) {
          console.error('[Agenda] onRangeUpdate error:', e);
        }
      },
      onEventClick(calEvent) {
        // Usar eventsRef para ter a lista atualizada (evita stale closure)
        const ev = eventsRef.current.find(e => e.id === calEvent.id);
        if (ev) openEditModal(ev);
      },
      onClickDateTime(dateTime) {
        // schedule-x v4 passa Temporal.ZonedDateTime — converter para "YYYY-MM-DD HH:mm"
        openCreateModal(temporalToLocalStr(dateTime));
      },
      onClickDate(date) {
        // schedule-x v4 passa Temporal.PlainDate — converter para "YYYY-MM-DD"
        openCreateModal(temporalToLocalStr(date));
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
      // Multi-role: aceita roles (array) ou role (string legado)
      const roles: string[] = Array.isArray(payload?.roles)
        ? payload.roles
        : (payload?.role ? [payload.role] : []);
      if (roles.length > 0) {
        setCurrentUserRole(roles[0]);
        if (roles.includes('ADMIN')) {
          setShowAllUsers(true);
        }
      }
    } catch {}
    // Buscar apenas advogados e admins para o filtro de usuários
    api.get('/users?limit=100').then(r => {
      const data: any[] = r.data?.data || r.data?.users || r.data || [];
      const lawyers = data.filter((u: any) =>
        u.roles?.includes('ADVOGADO') || u.roles?.includes('ADMIN') || u.role === 'ADVOGADO' || u.role === 'ADMIN'
      );
      setUsers(lawyers.map((u: any) => ({ id: u.id, name: u.name })));
    }).catch(() => {});
    api.get('/leads').then(r => setLeads((r.data || []).map((l: any) => ({ id: l.id, name: l.name, phone: l.phone })))).catch(() => {});

    // Deep link: abrir evento via alerta de tarefa vencida
    const openEventId = sessionStorage.getItem('open_event_id');
    if (openEventId) {
      sessionStorage.removeItem('open_event_id');
      api.get(`/calendar/events/${openEventId}`)
        .then(res => {
          if (res.data) {
            const ev = res.data;
            setEditingEvent(ev);
            setShowModal(true);
          }
        })
        .catch(() => {});
    }
  }, [router]);

  // Sync filtro → calendar
  // schedule-x v4 exige Temporal.ZonedDateTime (não string) em start/end
  useEffect(() => {
    if (!eventsServicePlugin) return;
    try {
      // Temporal disponível nativamente no Chrome 137+ (Mar/2026) e polyfillado pelo schedule-x
      const T = (globalThis as any).Temporal;
      const tz: string = T ? T.Now.timeZoneId() : 'America/Sao_Paulo';

      const filtered = events.filter(e => filterTypes.includes(e.type));
      const calEvents = filtered
        .filter(e => {
          // Validate dates to prevent schedule-x crashes
          const startMs = new Date(e.start_at).getTime();
          return !isNaN(startMs);
        })
        .map(e => {
          // No modo "Todos", prefixar com o nome do advogado responsável
          const userPrefix = (showAllUsers && !filterUserId && e.assigned_user)
            ? `[${e.assigned_user.name.split(' ')[0]}] `
            : '';
          const startLocal = toLocalDateTime(e.start_at); // "YYYY-MM-DD HH:mm"
          let endLocal: string;
          if (e.end_at && !isNaN(new Date(e.end_at).getTime())) {
            endLocal = toLocalDateTime(e.end_at);
          } else {
            endLocal = toLocalDateTime(new Date(new Date(e.start_at).getTime() + 30 * 60000).toISOString());
          }

          // Converter strings para Temporal.ZonedDateTime (obrigatório no schedule-x v4)
          // Usa forma de objeto (mais robusta que parsing de string) para evitar falhas silenciosas.
          let startSx: any = startLocal;
          let endSx: any = endLocal;
          if (T) {
            const parseLocalToZDT = (local: string) => {
              // local = "YYYY-MM-DD HH:mm"
              const [datePart, timePart = '00:00'] = local.split(' ');
              const [year, month, day] = datePart.split('-').map(Number);
              const [hour, minute] = timePart.split(':').map(Number);
              return T.ZonedDateTime.from({
                year, month, day, hour, minute, second: 0,
                timeZone: 'UTC',
              });
            };
            try { startSx = parseLocalToZDT(startLocal); } catch { /* manter string */ }
            try { endSx   = parseLocalToZDT(endLocal);   } catch { /* manter string */ }
          }

          const caseTag = e.legal_case?.case_number ? ` [${e.legal_case.case_number}]` : '';
          return {
            id: e.id,
            title: `${EVENT_TYPES.find(t => t.id === e.type)?.emoji || ''} ${userPrefix}${e.title}${caseTag}${e.status === 'ADIADO' ? ' ⏸️' : ''}${e.status === 'CANCELADO' ? ' ✖️' : ''}${(e as any).recurrence_rule || (e as any).parent_event_id ? ' 🔁' : ''}${e._count?.comments ? ` 💬${e._count.comments}` : ''}`,
            start: startSx,
            end: endSx,
            calendarId: e.type,
            _customContent: {},
          };
        });
      eventsServicePlugin.set(calEvents);
    } catch (err) {
      console.error('[Agenda] Error syncing events to calendar:', err);
    }
  }, [events, filterTypes, eventsServicePlugin, showAllUsers, filterUserId]);

  // Carga inicial: schedule-x v4 não chama onRangeUpdate no mount.
  // Buscamos um range largo (semana atual ± 4 semanas = ~2 meses) para garantir
  // que eventos próximos já apareçam no sidebar e no calendário sem precisar navegar.
  useEffect(() => {
    const now = new Date();
    const day = now.getDay(); // 0=Dom, 1=Seg … 6=Sab
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    // Range inicial: semana atual + 4 semanas à frente (cobre eventos próximos no sidebar)
    const rangeStart = new Date(monday);
    rangeStart.setDate(monday.getDate() - 7); // 1 semana atrás
    const rangeEnd = new Date(monday);
    rangeEnd.setDate(monday.getDate() + 4 * 7); // 4 semanas à frente
    rangeEnd.setHours(23, 59, 59, 999);
    const start = rangeStart.toISOString();
    const end = rangeEnd.toISOString();
    // rangeRef aponta para a semana atual (para refetch correto ao mudar filtros)
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    rangeRef.current = { start: monday.toISOString(), end: sunday.toISOString() };
    fetchEvents(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // apenas no mount — onRangeUpdate atualiza o range nas navegações

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
      showError(e?.response?.data?.message || e?.message || 'Erro ao comentar');
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
      showError(e?.response?.data?.message || e?.message || 'Erro ao salvar. Tente novamente');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!editingEvent) return;
    try {
      await api.patch(`/calendar/events/${editingEvent.id}/status`, { status: newStatus });
      setEditingEvent({ ...editingEvent, status: newStatus });
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    } catch (e: any) {
      showError(e?.response?.data?.message || e?.message || 'Erro ao alterar status');
    }
  };

  const handleDelete = async (scope: 'single' | 'all' = 'single') => {
    if (!editingEvent) return;
    const isRecurring = (editingEvent as any).parent_event_id || (editingEvent as any).recurrence_rule;

    if (isRecurring && scope === 'single') {
      // Evento recorrente: perguntar se quer deletar a série inteira ou só este
      const deleteAll = confirm('Este evento faz parte de uma série.\n\nClique OK para excluir TODA a série.\nClique Cancelar para excluir apenas este evento.');
      if (deleteAll) {
        // Usuário confirmou deleção de toda a série
        const parentId = (editingEvent as any).parent_event_id || editingEvent.id;
        try {
          await api.delete(`/calendar/events/${parentId}?deleteScope=all`);
          setShowModal(false);
          showSuccess('Série de eventos removida');
          if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
        } catch (e: any) {
          showError(e?.response?.data?.message || e?.message || 'Erro ao remover série');
        }
      } else {
        // Usuário cancelou a deleção da série — perguntar se quer deletar só este
        if (!confirm('Remover apenas este evento da série?')) return;
        try {
          await api.delete(`/calendar/events/${editingEvent.id}`);
          setShowModal(false);
          showSuccess('Evento removido');
          if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
        } catch (e: any) {
          showError(e?.response?.data?.message || e?.message || 'Erro ao remover evento');
        }
      }
      return; // sempre encerra aqui para eventos recorrentes
    }

    // Evento simples (não recorrente)
    if (!confirm('Remover este evento?')) return;
    try {
      await api.delete(`/calendar/events/${editingEvent.id}`);
      setShowModal(false);
      showSuccess('Evento removido');
      if (rangeRef.current) fetchEvents(rangeRef.current.start, rangeRef.current.end);
    } catch (e: any) {
      showError(e?.response?.data?.message || e?.message || 'Erro ao remover evento');
    }
  };

  const [sendingNotify, setSendingNotify] = useState(false);

  const handleNotify = async () => {
    if (!editingEvent) return;
    setSendingNotify(true);
    try {
      const res = await api.post(`/calendar/events/${editingEvent.id}/notify`);
      showSuccess(res.data?.message || 'Notificação WhatsApp enviada ao cliente!');
    } catch (e: any) {
      showError(e?.response?.data?.message || e?.message || 'Erro ao reenviar notificação');
    } finally {
      setSendingNotify(false);
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
      showError('Erro ao exportar evento');
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
      showError('Erro ao exportar calendário');
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

  // ── Aba "Tarefas": renderiza o painel de tarefas sem o layout do calendário
  if (activeTab === 'tasks') {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        {/* Barra de abas */}
        <div className="shrink-0 flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border bg-card/30">
          <button
            onClick={() => switchTab('calendar')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60"
          >
            <CalendarViewIcon size={14} />
            Calendário
          </button>
          <button
            onClick={() => switchTab('tasks')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors border-b-2 border-primary text-primary"
          >
            <CheckSquare size={14} />
            Tarefas
          </button>
        </div>
        {/* Conteúdo da aba */}
        <div className="flex-1 overflow-hidden">
          <TasksPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Barra de abas */}
      <div className="shrink-0 flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border bg-card/30">
        <button
          onClick={() => switchTab('calendar')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors border-b-2 border-primary text-primary"
        >
          <CalendarViewIcon size={14} />
          Calendário
        </button>
        <button
          onClick={() => switchTab('tasks')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60"
        >
          <CheckSquare size={14} />
          Tarefas
        </button>
      </div>

      {/* Conteúdo do Calendário */}
      <div className="flex flex-1 overflow-hidden">

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
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <div className="w-10 h-10 rounded-full bg-accent/50 flex items-center justify-center">
                <CalendarIcon size={18} className="text-muted-foreground/50" />
              </div>
              <p className="text-xs text-muted-foreground">Nenhum evento futuro</p>
              <button
                onClick={() => openCreateModal()}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                + Criar evento
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {upcomingEvents.map(ev => {
                const d = new Date(ev.start_at);
                const typeColor = getEventColor(ev.type);
                const priorityColor = PRIORITY_COLORS[ev.priority] ?? '#6b7280';
                const isOverdue = new Date(ev.start_at) < new Date() && ev.status === 'AGENDADO';
                return (
                  <button
                    key={ev.id}
                    onClick={() => openEditModal(ev)}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoverTooltip({ event: ev, x: rect.right + 8, y: rect.top });
                    }}
                    onMouseLeave={() => setHoverTooltip(null)}
                    className="w-full text-left p-2 rounded-xl border border-border/40 hover:bg-accent/50 hover:border-border transition-all group overflow-hidden relative"
                    style={{ borderLeft: `3px solid ${priorityColor}` }}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: typeColor }} />
                      <span className={`text-[10px] ${isOverdue ? 'text-red-400 font-semibold' : 'text-muted-foreground'}`}>
                        {isOverdue ? '⚠️ ' : ''}{d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}
                        {' · '}
                        {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                      </span>
                    </div>
                    <p className={`text-xs font-semibold truncate ${ev.status === 'ADIADO' ? 'text-amber-400/70 line-through' : 'text-foreground'}`}>
                      {ev.status === 'ADIADO' ? '⏸️ ' : ''}{ev.title}
                    </p>
                    {ev.lead && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">👤 {ev.lead.name || ev.lead.phone}</p>
                    )}
                    {ev.legal_case && (
                      <p className="text-[10px] text-primary/70 font-semibold truncate mt-0.5">
                        📂 {ev.legal_case.case_number ?? 'Processo vinculado'}
                        {ev.legal_case.legal_area ? ` · ${ev.legal_case.legal_area}` : ''}
                      </p>
                    )}
                    {ev.legal_case?.lead?.name && (
                      <p className="text-[10px] text-muted-foreground truncate">👤 {ev.legal_case.lead.name}</p>
                    )}
                    {ev.location && (
                      <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">📍 {ev.location}</p>
                    )}
                    {isOverdue && (() => {
                      const days = Math.max(0, Math.floor((Date.now() - new Date(ev.start_at).getTime()) / 86400000));
                      return (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full mt-1">
                          {days > 0 ? `${days}d atraso` : 'Venceu hoje'}
                        </span>
                      );
                    })()}
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
                      {new Date(ev.start_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                      {ev.assigned_user ? ` · ${ev.assigned_user.name}` : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quick nav chips */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                try { (calendar as any)?.navigate?.(today); } catch {}
              }}
              className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              Hoje
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const day = now.getDay();
                const diffToMonday = day === 0 ? -6 : 1 - day;
                const monday = new Date(now);
                monday.setDate(now.getDate() + diffToMonday);
                try { (calendar as any)?.navigate?.(monday.toISOString().slice(0, 10)); } catch {}
              }}
              className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              Semana
            </button>
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

          {/* Toggle Kanban / Calendário */}
          <button
            onClick={() => setKanbanView(v => !v)}
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
              kanbanView
                ? 'bg-accent border-accent-foreground/20 text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
            title={kanbanView ? 'Ver Calendário' : 'Ver Kanban de Tarefas'}
          >
            {kanbanView ? <CalendarViewIcon size={14} /> : <LayoutGrid size={14} />}
            <span>{kanbanView ? 'Calendário' : 'Kanban'}</span>
          </button>

          {/* + Novo Evento (atalho: N) */}
          <button
            onClick={() => openCreateModal()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors shadow-sm"
            title="Criar evento (atalho: N)"
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

        {/* ══ KANBAN VIEW ══ */}
        {kanbanView ? (
          <div className="flex-1 overflow-auto p-4">
            <div className="flex gap-3 h-full" style={{ minWidth: 600 }}>
              {KANBAN_COLUMNS.map(col => {
                const colEvents = events.filter(e =>
                  e.type === 'TAREFA' && e.status === col.id
                );
                return (
                  <div key={col.id} className="flex flex-col flex-1 min-w-[220px] max-w-[320px]">
                    {/* Cabeçalho da coluna */}
                    <div
                      className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl border"
                      style={{ borderColor: col.color + '40', background: col.color + '10' }}
                    >
                      <span className="text-sm">{col.emoji}</span>
                      <span className="text-sm font-bold text-foreground">{col.label}</span>
                      <span className="ml-auto text-xs font-bold text-muted-foreground bg-background/60 px-2 py-0.5 rounded-full">
                        {colEvents.length}
                      </span>
                    </div>

                    {/* Cards */}
                    <div className="flex flex-col gap-2 flex-1 overflow-y-auto custom-scrollbar pb-4">
                      {colEvents.map(ev => {
                        const priorityColor = PRIORITY_COLORS[ev.priority] ?? '#6b7280';
                        const isOverdue = new Date(ev.start_at) < new Date() && col.id !== 'CONCLUIDO';
                        const daysOverdue = isOverdue
                          ? Math.max(0, Math.floor((Date.now() - new Date(ev.start_at).getTime()) / 86400000))
                          : 0;
                        return (
                          <div
                            key={ev.id}
                            className="bg-card border border-border rounded-xl p-3 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
                            style={{ borderLeft: `3px solid ${priorityColor}` }}
                            onClick={() => openEditModal(ev)}
                          >
                            <p className="text-sm font-semibold text-foreground mb-1 group-hover:text-primary transition-colors leading-snug">
                              {ev.title}
                            </p>
                            <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground mb-2">
                              <span className="flex items-center gap-0.5">
                                <Clock size={9} />
                                {new Date(ev.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' })}
                              </span>
                              {ev.assigned_user && <span>· {ev.assigned_user.name}</span>}
                              {ev.lead && <span>· {ev.lead.name || ev.lead.phone}</span>}
                            </div>

                            {isOverdue && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full mb-2">
                                ⚠️ {daysOverdue > 0 ? `${daysOverdue}d atraso` : 'Venceu hoje'}
                              </span>
                            )}

                            {/* Mover para outra coluna */}
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex-wrap">
                              {KANBAN_COLUMNS.filter(c => c.id !== col.id).map(target => (
                                <button
                                  key={target.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    api.patch(`/calendar/events/${ev.id}`, { status: target.id })
                                      .then(() => setEvents(prev =>
                                        prev.map(x => x.id === ev.id ? { ...x, status: target.id } : x)
                                      ));
                                  }}
                                  className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-border hover:bg-accent transition-colors"
                                  style={{ color: target.color }}
                                >
                                  → {target.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}

                      {/* Estado vazio por coluna */}
                      {colEvents.length === 0 && (
                        <div className="flex flex-col items-center gap-2 py-10 rounded-xl border-2 border-dashed border-border/30">
                          <span className="text-3xl opacity-20">{col.emoji}</span>
                          <p className="text-xs text-muted-foreground/40">Nenhuma tarefa</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
        /* ══ CALENDÁRIO SCHEDULE-X ══ */
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
        )}

      </div>{/* fim área principal */}

      {/* ═══ Tooltip de Evento (hover nos Próximos) ═══ */}
      {mounted && hoverTooltip && createPortal(
        <div
          style={{ position: 'fixed', top: hoverTooltip.y, left: hoverTooltip.x, zIndex: 9998, maxWidth: 240 }}
          className="bg-card border border-border rounded-xl shadow-2xl p-3 pointer-events-none animate-in fade-in-0 zoom-in-95 duration-150"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-base">{EVENT_TYPES.find(t => t.id === hoverTooltip.event.type)?.emoji}</span>
            <span className="text-xs font-bold text-foreground truncate">{hoverTooltip.event.title}</span>
          </div>
          <div className="space-y-0.5 text-[11px] text-muted-foreground">
            <p>🕐 {new Date(hoverTooltip.event.start_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}</p>
            {hoverTooltip.event.location && <p>📍 {hoverTooltip.event.location}</p>}
            {hoverTooltip.event.lead && <p>👤 {hoverTooltip.event.lead.name || hoverTooltip.event.lead.phone}</p>}
            {hoverTooltip.event.assigned_user && <p>⚖️ {hoverTooltip.event.assigned_user.name}</p>}
            {hoverTooltip.event.legal_case && (
              <p className="text-primary/80 font-semibold truncate">
                📂 {hoverTooltip.event.legal_case.case_number ?? 'Processo vinculado'}
                {hoverTooltip.event.legal_case.legal_area ? ` · ${hoverTooltip.event.legal_case.legal_area}` : ''}
              </p>
            )}
            {hoverTooltip.event.legal_case?.lead?.name && (
              <p className="truncate">👤 {hoverTooltip.event.legal_case.lead.name}</p>
            )}
            <p style={{ color: PRIORITY_COLORS[hoverTooltip.event.priority] }}>
              ● {PRIORITY_LABELS[hoverTooltip.event.priority] ?? hoverTooltip.event.priority}
            </p>
          </div>
        </div>,
        document.body
      )}

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
                {new Date(reminderToast.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                {' - '}
                {new Date(reminderToast.start_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
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
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
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
                      {c.title} ({new Date(c.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} - {new Date(c.end_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })})
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

              {/* ── Processo Vinculado ── */}
              {editingEvent?.legal_case && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-primary/25 bg-primary/5">
                  <BookOpen size={14} className="text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary/70 mb-0.5">Processo vinculado</p>
                    <p className="text-xs font-semibold text-foreground truncate">
                      {editingEvent.legal_case.case_number ?? 'Nº não informado'}
                    </p>
                    {editingEvent.legal_case.lead?.name && (
                      <p className="text-[11px] text-foreground/80 truncate">👤 {editingEvent.legal_case.lead.name}</p>
                    )}
                    {editingEvent.legal_case.legal_area && (
                      <p className="text-[10px] text-muted-foreground">{editingEvent.legal_case.legal_area}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); router.push(`/atendimento/workspace/${editingEvent.legal_case!.id}`); }}
                    className="shrink-0 p-1.5 rounded-lg text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Abrir processo"
                  >
                    <ExternalLink size={14} />
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

            {/* Modal footer — sticky no rodapé do modal */}
            <div className="sticky bottom-0 flex items-center justify-between px-5 py-4 border-t border-border bg-card rounded-b-2xl">
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
                {editingEvent && ['AUDIENCIA', 'PERICIA'].includes(editingEvent.type) && (
                  <button
                    onClick={handleNotify}
                    disabled={sendingNotify}
                    className="px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition-colors inline-flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
                    title="Reenviar notificação WhatsApp ao cliente"
                  >
                    <Bell size={12} /> {sendingNotify ? 'Enviando…' : 'Notificar'}
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

      </div>{/* fim flex-1 conteúdo calendário */}
    </div>
  );
}
