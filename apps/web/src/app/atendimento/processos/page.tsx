'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, Search, RefreshCw, MessageSquare, MoreVertical, ChevronDown, ChevronRight,
  Plus, X, Calendar, FileText, Clock, Archive, ArchiveRestore, Send,
  AlertTriangle, CheckCircle2, Loader2, ExternalLink, Bell, RefreshCcw, BookOpen,
  LayoutList, LayoutGrid, DollarSign, Scale, Gavel, ArrowUpDown, FolderPlus,
} from 'lucide-react';
import api from '@/lib/api';
import { TRACKING_STAGES, findTrackingStage } from '@/lib/legalStages';

// ─── Types ────────────────────────────────────────────────────

interface LegalCase {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  lawyer_id: string;
  case_number: string | null;
  legal_area: string | null;
  stage: string;
  tracking_stage: string | null;
  in_tracking: boolean;
  filed_at: string | null;
  archived: boolean;
  archive_reason: string | null;
  notes: string | null;
  court: string | null;
  action_type: string | null;
  claim_value: string | null;
  opposing_party: string | null;
  judge: string | null;
  priority: string;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  lead: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    profile_picture_url: string | null;
  };
  _count?: { tasks: number; events: number; djen_publications: number };
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
  legal_case_id: string | null;
  legal_case?: { id: string; lead: { name: string | null } } | null;
  created_at: string;
}

interface CaseTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  start_at: string;
  assigned_user_id: string | null;
  assigned_user: { id: string; name: string } | null;
  created_by?: { id: string; name: string } | null;
  _count?: { comments: number };
}

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

interface Intern {
  id: string;
  name: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  return `há ${d}d`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function daysInStage(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}


const PRIORITY_CONFIG: Record<string, { label: string; color: string; borderColor: string; badgeClass: string }> = {
  URGENTE: {
    label: 'Urgente',
    color: '#ef4444',
    borderColor: 'border-l-red-500',
    badgeClass: 'bg-red-500/12 text-red-400 border-red-500/20',
  },
  NORMAL: {
    label: 'Normal',
    color: '#f59e0b',
    borderColor: 'border-l-amber-500',
    badgeClass: 'bg-amber-500/12 text-amber-400 border-amber-500/20',
  },
  BAIXA: {
    label: 'Baixa',
    color: '#6b7280',
    borderColor: 'border-l-gray-500',
    badgeClass: 'bg-gray-500/12 text-gray-400 border-gray-500/20',
  },
};

const EVENT_TYPES = [
  { id: 'PUBLICACAO', label: 'Publicação', color: '#3b82f6' },
  { id: 'DESPACHO', label: 'Despacho', color: '#8b5cf6' },
  { id: 'DECISAO', label: 'Decisão', color: '#ef4444' },
  { id: 'AUDIENCIA', label: 'Audiência', color: '#f59e0b' },
  { id: 'NOTA', label: 'Nota Interna', color: '#6b7280' },
];

const TASK_STATUSES = [
  { id: 'AGENDADO', label: 'A fazer', color: '#6b7280' },
  { id: 'CONFIRMADO', label: 'Em andamento', color: '#3b82f6' },
  { id: 'CONCLUIDO', label: 'Concluída', color: '#10b981' },
];

const LEGAL_AREAS = [
  'Trabalhista', 'Cível', 'Criminal', 'Previdenciário',
  'Tributário', 'Consumidor', 'Família', 'Administrativo',
];

// ─── ProcessoCard ──────────────────────────────────────────────

function ProcessoCard({
  legalCase,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
  onStageChange,
}: {
  legalCase: LegalCase;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  onStageChange: (stageId: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const djenCount = legalCase._count?.djen_publications ?? 0;
  const taskCount = legalCase._count?.tasks ?? 0;
  const eventCount = legalCase._count?.events ?? 0;
  const days = daysInStage(legalCase.stage_changed_at || legalCase.updated_at);
  const priority = PRIORITY_CONFIG[legalCase.priority] ?? PRIORITY_CONFIG.NORMAL;
  const isUrgente = legalCase.priority === 'URGENTE';
  const stageOld = days > 30;

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group relative p-3.5 bg-card border border-border rounded-xl cursor-grab active:cursor-grabbing select-none transition-all border-l-4 ${priority.borderColor} ${
        isDragging
          ? 'opacity-40 scale-95 rotate-1 shadow-2xl ring-2 ring-primary/30'
          : 'hover:border-r-border/80 hover:border-t-border/80 hover:border-b-border/80 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10'
      } ${isUrgente ? 'ring-1 ring-red-500/20' : ''}`}
    >
      {/* Priority badge + Menu */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${priority.badgeClass}`}>
          {legalCase.priority === 'URGENTE' ? '🔴' : legalCase.priority === 'BAIXA' ? '⬜' : '🟡'} {priority.label}
        </span>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(v => !v); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <MoreVertical size={13} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl w-52 py-1 text-[12px]">
              <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Mover etapa</p>
              {TRACKING_STAGES.map(s => (
                <button
                  key={s.id}
                  onClick={(e) => { e.stopPropagation(); onStageChange(s.id); setShowMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-center gap-2 ${s.id === legalCase.tracking_stage ? 'font-semibold' : ''}`}
                  style={{ color: s.id === legalCase.tracking_stage ? s.color : undefined }}
                >
                  <span>{s.emoji}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Client + Opposing party */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0">
            {legalCase.lead?.profile_picture_url ? (
              <img src={legalCase.lead.profile_picture_url} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <User size={11} className="text-muted-foreground opacity-60" />
            )}
          </div>
          <h4 className="text-[13px] font-semibold text-foreground leading-tight truncate flex-1">
            {legalCase.lead?.name || 'Sem nome'}
          </h4>
        </div>
        {legalCase.opposing_party && (
          <p className="text-[10px] text-muted-foreground mt-0.5 pl-8 truncate">
            vs. {legalCase.opposing_party}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground font-mono truncate pl-8 mt-0.5">
          {legalCase.case_number || 'Sem número'}
        </p>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        {legalCase.legal_area && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/12 text-violet-400 text-[9px] font-bold border border-violet-500/20">
            ⚖️ {legalCase.legal_area}
          </span>
        )}
        {legalCase.court && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-500/12 text-blue-400 text-[9px] font-bold border border-blue-500/20 truncate max-w-[110px]">
            🏛️ {legalCase.court}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
        <div className="flex items-center gap-2.5">
          {taskCount > 0 && (
            <span className="flex items-center gap-0.5" title={`${taskCount} tarefas`}>
              <CheckCircle2 size={10} /> {taskCount}
            </span>
          )}
          {eventCount > 0 && (
            <span className="flex items-center gap-0.5" title={`${eventCount} movimentações`}>
              <FileText size={10} /> {eventCount}
            </span>
          )}
          {djenCount > 0 && (
            <span className="flex items-center gap-0.5 text-amber-400 font-semibold" title={`${djenCount} publicações DJEN`}>
              <Bell size={10} /> {djenCount}
            </span>
          )}
        </div>
        <span
          className={`flex items-center gap-0.5 ${stageOld ? 'text-amber-400 font-semibold' : ''}`}
          title={`${days} dias nesta etapa`}
        >
          <Clock size={9} /> {days}d
        </span>
      </div>
    </div>
  );
}

// ─── Case Detail Panel ─────────────────────────────────────────

function ProcessoDetailPanel({
  legalCase,
  onClose,
  onRefresh,
}: {
  legalCase: LegalCase;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'info' | 'djen' | 'events' | 'tasks'>('info');
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Info fields
  const [trackingStage, setTrackingStage] = useState(legalCase.tracking_stage || 'DISTRIBUIDO');
  const [caseNumber, setCaseNumber] = useState(legalCase.case_number || '');
  const [court, setCourt] = useState(legalCase.court || '');
  const [notes, setNotes] = useState(legalCase.notes || '');
  const [legalArea, setLegalArea] = useState(legalCase.legal_area || '');
  const [priority, setPriority] = useState(legalCase.priority || 'NORMAL');
  const [opposingParty, setOpposingParty] = useState(legalCase.opposing_party || '');
  const [actionType, setActionType] = useState(legalCase.action_type || '');
  const [claimValue, setClaimValue] = useState(legalCase.claim_value ? String(legalCase.claim_value) : '');
  const [judge, setJudge] = useState(legalCase.judge || '');

  // ── Vinculação de cliente ──────────────────────────────────────
  const isPlaceholderLead = legalCase.lead?.phone?.startsWith('PROC_') || legalCase.lead?.name?.startsWith('[Processo]');
  type LeadLinkMode = 'existing' | 'new';
  const [showLeadSection, setShowLeadSection] = useState(isPlaceholderLead ?? false);
  const [leadLinkMode, setLeadLinkMode] = useState<LeadLinkMode>('existing');
  const [leadLinkSearch, setLeadLinkSearch] = useState('');
  const [leadLinkResults, setLeadLinkResults] = useState<{ id: string; name: string | null; phone: string; email: string | null }[]>([]);
  const [leadLinkSearching, setLeadLinkSearching] = useState(false);
  const [leadLinkDropdown, setLeadLinkDropdown] = useState(false);
  const [selectedLinkLead, setSelectedLinkLead] = useState<{ id: string; name: string | null; phone: string } | null>(null);
  const [newLinkPhone, setNewLinkPhone] = useState('');
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkEmail, setNewLinkEmail] = useState('');
  const [linkingLead, setLinkingLead] = useState(false);
  const [linkError, setLinkError] = useState('');
  const leadLinkRef = useRef<HTMLDivElement>(null);

  // Archive
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [notifyLead, setNotifyLead] = useState(true);
  const [archiving, setArchiving] = useState(false);

  // Tasks
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [interns, setInterns] = useState<Intern[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [comments, setComments] = useState<{ id: string; text: string; created_at: string; user: { id: string; name: string } }[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');

  // Events
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventType, setNewEventType] = useState('PUBLICACAO');
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventDate, setNewEventDate] = useState('');
  const [newEventUrl, setNewEventUrl] = useState('');

  // DJEN
  const [djenPubs, setDjenPubs] = useState<DjenPublication[]>([]);
  const [loadingDjen, setLoadingDjen] = useState(false);
  const [expandedDjen, setExpandedDjen] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const res = await api.get(`/calendar/events/legal-case/${legalCase.id}`);
      setTasks(res.data || []);
    } catch {} finally { setLoadingTasks(false); }
  }, [legalCase.id]);

  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await api.get(`/legal-cases/${legalCase.id}/events`);
      setEvents(res.data || []);
    } catch {} finally { setLoadingEvents(false); }
  }, [legalCase.id]);

  const fetchInterns = useCallback(async () => {
    try {
      const res = await api.get(`/users/${legalCase.lawyer_id}/interns`);
      setInterns(res.data || []);
    } catch {}
  }, [legalCase.lawyer_id]);

  const fetchDjen = useCallback(async () => {
    setLoadingDjen(true);
    try {
      const res = await api.get(`/djen/case/${legalCase.id}`);
      setDjenPubs(res.data || []);
    } catch {} finally { setLoadingDjen(false); }
  }, [legalCase.id]);

  useEffect(() => {
    fetchTasks();
    fetchEvents();
    fetchInterns();
    fetchDjen();
  }, [fetchTasks, fetchEvents, fetchInterns, fetchDjen]);

  // Busca de leads para vinculação (debounce)
  useEffect(() => {
    if (leadLinkMode !== 'existing' || !leadLinkSearch.trim()) {
      setLeadLinkResults([]); setLeadLinkDropdown(false); return;
    }
    const t = setTimeout(async () => {
      setLeadLinkSearching(true);
      try {
        const res = await api.get('/leads', { params: { search: leadLinkSearch.trim(), limit: 8 } });
        setLeadLinkResults(res.data?.data || res.data || []);
        setLeadLinkDropdown(true);
      } catch { setLeadLinkResults([]); } finally { setLeadLinkSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [leadLinkSearch, leadLinkMode]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (leadLinkRef.current && !leadLinkRef.current.contains(e.target as Node)) {
        setLeadLinkDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLinkLead = async () => {
    setLinkError('');
    if (leadLinkMode === 'existing' && !selectedLinkLead) { setLinkError('Selecione um cliente.'); return; }
    if (leadLinkMode === 'new' && !newLinkPhone.replace(/\D/g,'')) { setLinkError('Informe o telefone.'); return; }
    setLinkingLead(true);
    try {
      await api.patch(`/legal-cases/${legalCase.id}/lead`, {
        lead_id: leadLinkMode === 'existing' ? selectedLinkLead!.id : undefined,
        lead_phone: leadLinkMode === 'new' ? newLinkPhone : undefined,
        lead_name: leadLinkMode === 'new' ? newLinkName || undefined : undefined,
        lead_email: leadLinkMode === 'new' ? newLinkEmail || undefined : undefined,
      });
      setShowLeadSection(false);
      onRefresh();
    } catch (e: any) {
      setLinkError(e?.response?.data?.message || 'Erro ao vincular cliente.');
    } finally { setLinkingLead(false); }
  };

  const saveInfo = async () => {
    setSaving(true);
    try {
      const promises: Promise<any>[] = [];

      if (trackingStage !== legalCase.tracking_stage) {
        promises.push(api.patch(`/legal-cases/${legalCase.id}/tracking-stage`, { trackingStage }));
      }
      if (caseNumber !== (legalCase.case_number || '')) {
        promises.push(api.patch(`/legal-cases/${legalCase.id}/case-number`, { caseNumber }));
      }

      // Consolidate all detail fields into one call
      const detailsChanged =
        priority !== (legalCase.priority || 'NORMAL') ||
        opposingParty !== (legalCase.opposing_party || '') ||
        actionType !== (legalCase.action_type || '') ||
        claimValue !== (legalCase.claim_value ? String(legalCase.claim_value) : '') ||
        judge !== (legalCase.judge || '') ||
        court !== (legalCase.court || '') ||
        notes !== (legalCase.notes || '') ||
        legalArea !== (legalCase.legal_area || '');

      if (detailsChanged) {
        promises.push(api.patch(`/legal-cases/${legalCase.id}/details`, {
          priority,
          opposing_party: opposingParty || undefined,
          action_type: actionType || undefined,
          claim_value: claimValue ? parseFloat(claimValue) : undefined,
          judge: judge || undefined,
          court: court || undefined,
          notes: notes || undefined,
          legal_area: legalArea || undefined,
        }));
      }

      await Promise.all(promises);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2000);
      onRefresh();
    } catch {} finally { setSaving(false); }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.patch(`/legal-cases/${legalCase.id}/archive`, { reason: archiveReason, notifyLead });
      onRefresh();
      onClose();
    } catch {} finally { setArchiving(false); }
  };

  const handleUnarchive = async () => {
    try {
      await api.patch(`/legal-cases/${legalCase.id}/unarchive`);
      onRefresh();
      onClose();
    } catch {}
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;
    const startAt = newTaskDue ? new Date(newTaskDue).toISOString() : new Date().toISOString();
    const endAt = new Date(new Date(startAt).getTime() + 30 * 60000).toISOString();
    try {
      await api.post('/calendar/events', {
        type: 'TAREFA',
        title: newTaskTitle,
        description: newTaskDesc || undefined,
        legal_case_id: legalCase.id,
        assigned_user_id: newTaskAssignee || undefined,
        start_at: startAt,
        end_at: endAt,
        priority: 'NORMAL',
      });
      setNewTaskTitle(''); setNewTaskDesc(''); setNewTaskAssignee(''); setNewTaskDue('');
      setShowNewTask(false);
      fetchTasks();
    } catch {}
  };

  const handleTaskStatusChange = async (taskId: string, status: string) => {
    try {
      await api.patch(`/calendar/events/${taskId}/status`, { status });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    } catch {}
  };

  const fetchComments = async (taskId: string) => {
    setLoadingComments(true);
    try {
      const res = await api.get(`/calendar/events/${taskId}/comments`);
      setComments(res.data || []);
    } catch {} finally { setLoadingComments(false); }
  };

  const toggleTaskExpand = (taskId: string) => {
    if (expandedTask === taskId) { setExpandedTask(null); setComments([]); }
    else { setExpandedTask(taskId); fetchComments(taskId); }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !expandedTask) return;
    try {
      await api.post(`/calendar/events/${expandedTask}/comments`, { text: newComment });
      setNewComment('');
      fetchComments(expandedTask);
    } catch {}
  };

  const handleCreateEvent = async () => {
    if (!newEventTitle.trim()) return;
    try {
      await api.post(`/legal-cases/${legalCase.id}/events`, {
        type: newEventType,
        title: newEventTitle,
        description: newEventDesc || undefined,
        event_date: newEventDate || undefined,
        reference_url: newEventUrl || undefined,
      });
      setNewEventTitle(''); setNewEventDesc(''); setNewEventDate(''); setNewEventUrl('');
      setShowNewEvent(false);
      fetchEvents();
    } catch {}
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      await api.delete(`/legal-cases/events/${eventId}`);
      setEvents(prev => prev.filter(e => e.id !== eventId));
    } catch {}
  };

  const openInChat = () => {
    if (legalCase.conversation_id) {
      sessionStorage.setItem('crm_open_conv', legalCase.conversation_id);
      router.push('/atendimento');
    }
  };

  const stageInfo = findTrackingStage(legalCase.tracking_stage);
  const priorityConfig = PRIORITY_CONFIG[legalCase.priority] ?? PRIORITY_CONFIG.NORMAL;

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-[600px] bg-card border-l border-border flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="w-10 h-10 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden">
            {legalCase.lead?.profile_picture_url ? (
              <img src={legalCase.lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <User size={16} className="text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-foreground truncate">{legalCase.lead?.name || 'Sem nome'}</h2>
            {legalCase.opposing_party && (
              <p className="text-[11px] text-muted-foreground truncate">vs. {legalCase.opposing_party}</p>
            )}
            <p className="text-[10px] text-muted-foreground font-mono">{legalCase.case_number || 'Sem número'}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold border"
              style={{ backgroundColor: `${priorityConfig.color}20`, color: priorityConfig.color, borderColor: `${priorityConfig.color}40` }}>
              {legalCase.priority}
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-bold"
              style={{ backgroundColor: `${stageInfo.color}20`, color: stageInfo.color }}
            >
              {stageInfo.emoji} {stageInfo.label}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {([
            { id: 'info', label: 'Processo' },
            { id: 'djen', label: `DJEN (${djenPubs.length})` },
            { id: 'events', label: `Movim. (${events.length})` },
            { id: 'tasks', label: `Tarefas (${tasks.length})` },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* ─── INFO TAB ─── */}
          {activeTab === 'info' && (
            <div className="p-5 space-y-4">

              {/* ── Bloco Cliente ─────────────────────────────── */}
              {isPlaceholderLead && !showLeadSection ? (
                /* Alerta: processo sem cliente real */
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 flex items-start gap-3">
                  <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-amber-400">Processo sem cliente vinculado</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Vinculando um cliente real você poderá abrir o chat e receber notificações.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowLeadSection(true)}
                    className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-amber-400 border border-amber-500/30 px-2.5 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors"
                  >
                    <User size={11} /> Vincular cliente
                  </button>
                </div>
              ) : !isPlaceholderLead ? (
                /* Cliente já vinculado — card informativo */
                <div className="rounded-xl border border-border bg-accent/20 p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0 overflow-hidden">
                    {legalCase.lead?.profile_picture_url
                      ? <img src={legalCase.lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                      : <User size={14} className="text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground truncate">{legalCase.lead?.name || 'Sem nome'}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{legalCase.lead?.phone}</p>
                  </div>
                  <button
                    onClick={() => setShowLeadSection(v => !v)}
                    className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-lg hover:bg-accent transition-colors"
                  >
                    Trocar
                  </button>
                </div>
              ) : null}

              {/* Formulário de vinculação */}
              {showLeadSection && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <User size={11} /> Vincular Cliente
                    </p>
                    {/* Toggle modo */}
                    <div className="flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold">
                      <button
                        onClick={() => { setLeadLinkMode('existing'); setSelectedLinkLead(null); setLeadLinkSearch(''); }}
                        className={`px-2.5 py-1 transition-colors ${leadLinkMode === 'existing' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                      >
                        Existente
                      </button>
                      <button
                        onClick={() => { setLeadLinkMode('new'); setSelectedLinkLead(null); }}
                        className={`px-2.5 py-1 transition-colors ${leadLinkMode === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                      >
                        Novo
                      </button>
                    </div>
                  </div>

                  {leadLinkMode === 'existing' ? (
                    <div ref={leadLinkRef} className="relative">
                      {selectedLinkLead ? (
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-card border border-primary/30 rounded-lg">
                          <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                            <User size={11} className="text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold truncate">{selectedLinkLead.name || 'Sem nome'}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{selectedLinkLead.phone}</p>
                          </div>
                          <button onClick={() => setSelectedLinkLead(null)} className="p-0.5 text-muted-foreground hover:text-foreground">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                          <input
                            type="text"
                            value={leadLinkSearch}
                            onChange={e => setLeadLinkSearch(e.target.value)}
                            onFocus={() => leadLinkSearch && setLeadLinkDropdown(true)}
                            className="w-full pl-8 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                            placeholder="Buscar por nome ou telefone..."
                            autoFocus
                          />
                          {leadLinkSearching && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
                        </div>
                      )}
                      {leadLinkDropdown && !selectedLinkLead && leadLinkResults.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
                          {leadLinkResults.map(lead => (
                            <button
                              key={lead.id}
                              onClick={() => { setSelectedLinkLead(lead); setLeadLinkDropdown(false); setLeadLinkSearch(''); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent text-left transition-colors"
                            >
                              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                                <User size={11} className="text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-semibold truncate">{lead.name || '(sem nome)'}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{lead.phone}{lead.email ? ` · ${lead.email}` : ''}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {leadLinkDropdown && !selectedLinkLead && leadLinkResults.length === 0 && leadLinkSearch.length > 1 && !leadLinkSearching && (
                        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-xl shadow-xl p-3 text-center">
                          <p className="text-[12px] text-muted-foreground">Nenhum cliente encontrado.</p>
                          <button
                            onClick={() => { setLeadLinkMode('new'); setNewLinkName(leadLinkSearch); setLeadLinkDropdown(false); }}
                            className="mt-1 text-[12px] font-semibold text-primary hover:underline"
                          >
                            + Cadastrar como novo cliente
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Novo cliente */
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Telefone <span className="text-destructive">*</span></label>
                          <input
                            type="tel"
                            value={newLinkPhone}
                            onChange={e => setNewLinkPhone(e.target.value)}
                            className="mt-0.5 w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                            placeholder="(00) 00000-0000"
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nome</label>
                          <input
                            type="text"
                            value={newLinkName}
                            onChange={e => setNewLinkName(e.target.value)}
                            className="mt-0.5 w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                            placeholder="Nome completo"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">E-mail</label>
                        <input
                          type="email"
                          value={newLinkEmail}
                          onChange={e => setNewLinkEmail(e.target.value)}
                          className="mt-0.5 w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                          placeholder="email@cliente.com"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">Se o telefone já existir no CRM, o cliente será vinculado automaticamente.</p>
                    </div>
                  )}

                  {linkError && (
                    <div className="flex items-center gap-2 p-2.5 bg-destructive/10 border border-destructive/20 rounded-lg text-[11px] text-destructive">
                      <AlertTriangle size={12} /> {linkError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {!isPlaceholderLead && (
                      <button
                        onClick={() => setShowLeadSection(false)}
                        className="flex-1 py-2 text-[12px] font-semibold text-muted-foreground border border-border rounded-lg hover:bg-accent transition-colors"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      onClick={handleLinkLead}
                      disabled={linkingLead}
                      className="flex-1 py-2 text-[12px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-all"
                    >
                      {linkingLead ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Vincular Cliente
                    </button>
                  </div>
                </div>
              )}

              {/* Prioridade + Etapa */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Prioridade</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    <option value="URGENTE">🔴 Urgente</option>
                    <option value="NORMAL">🟡 Normal</option>
                    <option value="BAIXA">⬜ Baixa</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Etapa do Processo</label>
                  <select
                    value={trackingStage}
                    onChange={e => setTrackingStage(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    {TRACKING_STAGES.map(s => (
                      <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Área Jurídica + Tipo de Ação */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Área Jurídica</label>
                  <select
                    value={legalArea}
                    onChange={e => setLegalArea(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    <option value="">Selecionar...</option>
                    {LEGAL_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Tipo de Ação</label>
                  <input
                    type="text"
                    value={actionType}
                    onChange={e => setActionType(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Reclamatória, Indenizatória..."
                  />
                </div>
              </div>

              {/* Parte contrária */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Scale size={11} /> Parte Contrária
                </label>
                <input
                  type="text"
                  value={opposingParty}
                  onChange={e => setOpposingParty(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                  placeholder="Nome da parte contrária"
                />
              </div>

              {/* Nº Processo + Vara */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Nº Processo</label>
                  <input
                    type="text"
                    value={caseNumber}
                    onChange={e => setCaseNumber(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                    placeholder="0000000-00.0000.0.00.0000"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Vara / Tribunal</label>
                  <input
                    type="text"
                    value={court}
                    onChange={e => setCourt(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="1ª Vara do Trabalho"
                  />
                </div>
              </div>

              {/* Valor da Causa + Juiz */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <DollarSign size={11} /> Valor da Causa
                  </label>
                  <input
                    type="number"
                    value={claimValue}
                    onChange={e => setClaimValue(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="0,00"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Gavel size={11} /> Juiz / Relator
                  </label>
                  <input
                    type="text"
                    value={judge}
                    onChange={e => setJudge(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Dr. João Silva"
                  />
                </div>
              </div>

              {/* Filed at */}
              {legalCase.filed_at && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-accent/30 rounded-lg px-3 py-2">
                  <Calendar size={12} />
                  <span>Ajuizado em <strong>{new Date(legalCase.filed_at).toLocaleDateString('pt-BR')}</strong></span>
                  <span className="ml-auto text-[10px]">
                    <Clock size={10} className="inline mr-0.5" />
                    {daysInStage(legalCase.stage_changed_at || legalCase.updated_at)}d nesta etapa
                  </span>
                </div>
              )}

              {/* Notas */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Notas Internas</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                  placeholder="Observações internas..."
                />
              </div>

              {/* Save */}
              <button
                onClick={saveInfo}
                disabled={saving}
                className="w-full py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {savedFeedback ? '✓ Salvo!' : 'Salvar Alterações'}
              </button>

              {/* Actions */}
              {legalCase.conversation_id && (
                <button
                  onClick={openInChat}
                  className="w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors flex items-center justify-center gap-2"
                >
                  <MessageSquare size={14} /> Abrir no Chat
                </button>
              )}

              {legalCase.archived ? (
                <button
                  onClick={handleUnarchive}
                  className="w-full py-2 text-sm text-blue-500 hover:text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <ArchiveRestore size={14} /> Desarquivar Processo
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setShowArchive(!showArchive)}
                    className="w-full py-2 text-sm text-amber-500 hover:text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <Archive size={14} /> Encerrar / Arquivar
                  </button>
                  {showArchive && (
                    <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-3">
                      <div className="flex items-center gap-2 text-amber-500 text-[12px] font-bold">
                        <AlertTriangle size={14} /> Arquivar processo
                      </div>
                      <textarea
                        value={archiveReason}
                        onChange={e => setArchiveReason(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                        placeholder="Motivo do arquivamento..."
                      />
                      <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
                        <input type="checkbox" checked={notifyLead} onChange={e => setNotifyLead(e.target.checked)} className="rounded" />
                        Notificar cliente via WhatsApp
                      </label>
                      <button
                        onClick={handleArchive}
                        disabled={archiving}
                        className="w-full py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                        Confirmar Arquivamento
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── DJEN TAB ─── */}
          {activeTab === 'djen' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Publicações DJEN</h3>
                <button
                  onClick={fetchDjen}
                  disabled={loadingDjen}
                  className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <RefreshCcw size={12} className={loadingDjen ? 'animate-spin' : ''} /> Atualizar
                </button>
              </div>

              {loadingDjen ? (
                <div className="text-center py-8 text-muted-foreground text-sm animate-pulse">Carregando publicações…</div>
              ) : djenPubs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-[12px]">
                  <Bell size={28} className="mx-auto mb-2 opacity-30" />
                  Nenhuma publicação encontrada
                </div>
              ) : (
                <div className="space-y-2">
                  {djenPubs.map(pub => (
                    <div key={pub.id} className="border border-border rounded-xl overflow-hidden">
                      <div
                        className="p-3 flex items-start gap-3 cursor-pointer hover:bg-accent/30 transition-colors"
                        onClick={() => setExpandedDjen(expandedDjen === pub.id ? null : pub.id)}
                      >
                        <ChevronRight
                          size={14}
                          className={`text-muted-foreground mt-0.5 shrink-0 transition-transform ${expandedDjen === pub.id ? 'rotate-90' : ''}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            {pub.tipo_comunicacao && (
                              <span className="px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[9px] font-bold border border-blue-500/20">
                                {pub.tipo_comunicacao}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Calendar size={9} /> {formatDate(pub.data_disponibilizacao)}
                            </span>
                          </div>
                          {pub.assunto && (
                            <p className="text-[12px] font-semibold text-foreground line-clamp-1">{pub.assunto}</p>
                          )}
                          {pub.classe_processual && (
                            <p className="text-[11px] text-muted-foreground truncate">{pub.classe_processual}</p>
                          )}
                        </div>
                      </div>
                      {expandedDjen === pub.id && (
                        <div className="border-t border-border bg-accent/10 p-3">
                          <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
                            {pub.conteudo}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── EVENTS TAB ─── */}
          {activeTab === 'events' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Movimentações</h3>
                <button
                  onClick={() => setShowNewEvent(!showNewEvent)}
                  className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <Plus size={12} /> Nova Movimentação
                </button>
              </div>

              {showNewEvent && (
                <div className="p-4 bg-accent/30 border border-border rounded-xl space-y-3">
                  <select
                    value={newEventType}
                    onChange={e => setNewEventType(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                  >
                    {EVENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <input
                    type="text"
                    value={newEventTitle}
                    onChange={e => setNewEventTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Título"
                  />
                  <textarea
                    value={newEventDesc}
                    onChange={e => setNewEventDesc(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none resize-none"
                    placeholder="Descrição (opcional)"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={newEventDate}
                      onChange={e => setNewEventDate(e.target.value)}
                      className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                    />
                    <input
                      type="url"
                      value={newEventUrl}
                      onChange={e => setNewEventUrl(e.target.value)}
                      className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                      placeholder="URL"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCreateEvent} className="flex-1 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90">Criar</button>
                    <button onClick={() => setShowNewEvent(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancelar</button>
                  </div>
                </div>
              )}

              {loadingEvents ? (
                <div className="text-center py-8 text-muted-foreground text-sm animate-pulse">Carregando…</div>
              ) : events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[12px]">Nenhuma movimentação</div>
              ) : (
                <div className="space-y-2">
                  {events.map(event => {
                    const typeInfo = EVENT_TYPES.find(t => t.id === event.type) ?? EVENT_TYPES[4];
                    return (
                      <div key={event.id} className="p-3 border border-border rounded-xl group hover:bg-accent/20 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                              style={{ backgroundColor: `${typeInfo.color}20`, color: typeInfo.color }}>
                              {typeInfo.label}
                            </span>
                            {event.event_date && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <Calendar size={9} /> {new Date(event.event_date).toLocaleDateString('pt-BR')}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteEvent(event.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <h4 className="text-[13px] font-semibold text-foreground">{event.title}</h4>
                        {event.description && <p className="text-[11px] text-muted-foreground mt-1">{event.description}</p>}
                        {event.reference_url && (
                          <a href={event.reference_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1">
                            <ExternalLink size={9} /> Ver referência
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── TASKS TAB ─── */}
          {activeTab === 'tasks' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Tarefas</h3>
                <button onClick={() => setShowNewTask(!showNewTask)} className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1">
                  <Plus size={12} /> Nova Tarefa
                </button>
              </div>

              {showNewTask && (
                <div className="p-4 bg-accent/30 border border-border rounded-xl space-y-3">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Título da tarefa"
                  />
                  <textarea
                    value={newTaskDesc}
                    onChange={e => setNewTaskDesc(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none resize-none"
                    placeholder="Descrição (opcional)"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newTaskAssignee}
                      onChange={e => setNewTaskAssignee(e.target.value)}
                      className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                    >
                      <option value="">Atribuir a...</option>
                      {interns.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <input
                      type="date"
                      value={newTaskDue}
                      onChange={e => setNewTaskDue(e.target.value)}
                      className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCreateTask} className="flex-1 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90">Criar</button>
                    <button onClick={() => setShowNewTask(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancelar</button>
                  </div>
                </div>
              )}

              {loadingTasks ? (
                <div className="text-center py-8 text-muted-foreground text-sm animate-pulse">Carregando tarefas…</div>
              ) : tasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[12px]">Nenhuma tarefa criada</div>
              ) : (
                tasks.map(task => {
                  const statusInfo = TASK_STATUSES.find(s => s.id === task.status) ?? TASK_STATUSES[0];
                  const isExpanded = expandedTask === task.id;

                  return (
                    <div key={task.id} className="border border-border rounded-xl overflow-hidden">
                      <div
                        className="p-3 flex items-start gap-3 cursor-pointer hover:bg-accent/30 transition-colors"
                        onClick={() => toggleTaskExpand(task.id)}
                      >
                        <ChevronRight
                          size={14}
                          className={`text-muted-foreground mt-0.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-[13px] font-semibold text-foreground truncate">{task.title}</h4>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            {task.assigned_user && (
                              <span className="flex items-center gap-0.5"><User size={9} /> {task.assigned_user.name}</span>
                            )}
                            {task.start_at && (
                              <span className="flex items-center gap-0.5"><Calendar size={9} /> {new Date(task.start_at).toLocaleDateString('pt-BR')}</span>
                            )}
                            {(task._count?.comments ?? 0) > 0 && (
                              <span className="flex items-center gap-0.5"><MessageSquare size={9} /> {task._count?.comments}</span>
                            )}
                          </div>
                        </div>
                        <select
                          value={task.status}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); handleTaskStatusChange(task.id, e.target.value); }}
                          className="text-[10px] font-bold px-2 py-1 rounded-full border-0 focus:outline-none cursor-pointer"
                          style={{ backgroundColor: `${statusInfo.color}20`, color: statusInfo.color }}
                        >
                          {TASK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-border bg-accent/10 p-3 space-y-2">
                          {task.description && (
                            <p className="text-[12px] text-muted-foreground italic mb-2">{task.description}</p>
                          )}
                          {loadingComments ? (
                            <div className="text-center text-[11px] text-muted-foreground animate-pulse py-2">Carregando…</div>
                          ) : comments.length === 0 ? (
                            <div className="text-center text-[11px] text-muted-foreground py-2">Nenhum comentário</div>
                          ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                              {comments.map(c => (
                                <div key={c.id} className="flex gap-2">
                                  <div className="w-6 h-6 rounded-full bg-accent border border-border flex items-center justify-center shrink-0 mt-0.5">
                                    <User size={10} className="text-muted-foreground" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-[11px] font-semibold text-foreground">{c.user.name}</span>
                                      <span className="text-[9px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                                    </div>
                                    <p className="text-[12px] text-foreground/80">{c.text}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2 pt-1">
                            <input
                              type="text"
                              value={newComment}
                              onChange={e => setNewComment(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                              className="flex-1 px-3 py-1.5 text-[12px] bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                              placeholder="Escrever comentário…"
                            />
                            <button
                              onClick={handleAddComment}
                              disabled={!newComment.trim()}
                              className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 transition-all"
                            >
                              <Send size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal Cadastrar Processo Existente ────────────────────────

const LEGAL_AREAS_LIST = [
  'Trabalhista', 'Cível', 'Criminal', 'Previdenciário',
  'Tributário', 'Consumidor', 'Família', 'Administrativo',
];

function CadastrarProcessoModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  // ── Lead ──────────────────────────────────────────────────────
  type LeadMode = 'existing' | 'new';
  const [leadMode, setLeadMode] = useState<LeadMode>('existing');

  // modo existente
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<{ id: string; name: string | null; phone: string; email: string | null }[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<{ id: string; name: string | null; phone: string } | null>(null);
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);
  const leadSearchRef = useRef<HTMLDivElement>(null);

  // modo novo
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');

  // ── Processo ──────────────────────────────────────────────────
  const [caseNumber, setCaseNumber] = useState('');
  const [legalArea, setLegalArea] = useState('');
  const [actionType, setActionType] = useState('');
  const [opposingParty, setOpposingParty] = useState('');
  const [court, setCourt] = useState('');
  const [judge, setJudge] = useState('');
  const [claimValue, setClaimValue] = useState('');
  const [trackingStage, setTrackingStage] = useState('DISTRIBUIDO');
  const [priority, setPriority] = useState('NORMAL');
  const [notes, setNotes] = useState('');
  const [filedAt, setFiledAt] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Busca de leads com debounce
  useEffect(() => {
    if (leadMode !== 'existing') return;
    if (!leadSearch.trim()) { setLeadResults([]); setShowLeadDropdown(false); return; }
    const t = setTimeout(async () => {
      setLeadSearching(true);
      try {
        const res = await api.get('/leads', { params: { search: leadSearch.trim(), limit: 8 } });
        const items = res.data?.data || res.data || [];
        setLeadResults(items);
        setShowLeadDropdown(true);
      } catch { setLeadResults([]); } finally { setLeadSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [leadSearch, leadMode]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (leadSearchRef.current && !leadSearchRef.current.contains(e.target as Node)) {
        setShowLeadDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Máscara CNJ
  const handleCaseNumberChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 20);
    let masked = digits;
    if (digits.length > 7)  masked = digits.slice(0,7) + '-' + digits.slice(7);
    if (digits.length > 9)  masked = masked.slice(0,10) + '.' + digits.slice(9);
    if (digits.length > 13) masked = masked.slice(0,15) + '.' + digits.slice(13);
    if (digits.length > 14) masked = masked.slice(0,17) + '.' + digits.slice(14);
    if (digits.length > 16) masked = masked.slice(0,20) + '.' + digits.slice(16);
    setCaseNumber(masked);
  };

  const handleSubmit = async () => {
    if (!caseNumber.trim()) { setError('Informe o número do processo.'); return; }
    if (leadMode === 'existing' && !selectedLead) { setError('Selecione o cliente ou escolha "Novo cliente".'); return; }
    if (leadMode === 'new' && !newLeadPhone.replace(/\D/g,'')) { setError('Informe o telefone do novo cliente.'); return; }

    setSaving(true);
    setError('');
    try {
      await api.post('/legal-cases/direct', {
        case_number: caseNumber.trim(),
        legal_area: legalArea || undefined,
        action_type: actionType || undefined,
        opposing_party: opposingParty || undefined,
        court: court || undefined,
        judge: judge || undefined,
        claim_value: claimValue ? parseFloat(claimValue) : undefined,
        tracking_stage: trackingStage,
        priority,
        notes: notes || undefined,
        filed_at: filedAt || undefined,
        // Lead integration
        lead_id: leadMode === 'existing' && selectedLead ? selectedLead.id : undefined,
        lead_phone: leadMode === 'new' ? newLeadPhone : undefined,
        lead_name: leadMode === 'new' ? newLeadName || undefined : undefined,
        lead_email: leadMode === 'new' ? newLeadEmail || undefined : undefined,
      });
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao cadastrar processo.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'mt-1 w-full px-3 py-2.5 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40';
  const labelCls = 'text-[11px] font-bold text-muted-foreground uppercase tracking-wider';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-[660px] mx-4 bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <FolderPlus size={18} className="text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-foreground">Cadastrar Processo em Andamento</h2>
            <p className="text-[11px] text-muted-foreground">Para processos que já existem no tribunal</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">

          {/* ── Seção: Cliente ─────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-accent/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <User size={11} /> Cliente / Parte Autora
              </p>
              {/* Toggle */}
              <div className="flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold">
                <button
                  onClick={() => { setLeadMode('existing'); setSelectedLead(null); setLeadSearch(''); }}
                  className={`px-3 py-1.5 transition-colors ${leadMode === 'existing' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                >
                  Cliente existente
                </button>
                <button
                  onClick={() => { setLeadMode('new'); setSelectedLead(null); }}
                  className={`px-3 py-1.5 transition-colors ${leadMode === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                >
                  Novo cliente
                </button>
              </div>
            </div>

            {leadMode === 'existing' ? (
              <div ref={leadSearchRef} className="relative">
                {selectedLead ? (
                  /* Lead selecionado */
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-primary/5 border border-primary/30 rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                      <User size={13} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{selectedLead.name || 'Sem nome'}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{selectedLead.phone}</p>
                    </div>
                    <button
                      onClick={() => { setSelectedLead(null); setLeadSearch(''); }}
                      className="p-1 text-muted-foreground hover:text-foreground rounded"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  /* Campo de busca */
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={leadSearch}
                      onChange={e => setLeadSearch(e.target.value)}
                      onFocus={() => leadSearch && setShowLeadDropdown(true)}
                      className="w-full pl-9 pr-3 py-2.5 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="Buscar por nome, telefone ou e-mail..."
                      autoFocus
                    />
                    {leadSearching && (
                      <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                    )}
                  </div>
                )}

                {/* Dropdown de resultados */}
                {showLeadDropdown && !selectedLead && leadResults.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
                    {leadResults.map(lead => (
                      <button
                        key={lead.id}
                        onClick={() => { setSelectedLead(lead); setShowLeadDropdown(false); setLeadSearch(''); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent text-left transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <User size={12} className="text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-foreground truncate">{lead.name || '(sem nome)'}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{lead.phone}{lead.email ? ` · ${lead.email}` : ''}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {showLeadDropdown && !selectedLead && leadResults.length === 0 && leadSearch.length > 1 && !leadSearching && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-xl shadow-xl p-3 text-center">
                    <p className="text-[12px] text-muted-foreground">Nenhum cliente encontrado.</p>
                    <button
                      onClick={() => { setLeadMode('new'); setNewLeadName(leadSearch); setShowLeadDropdown(false); }}
                      className="mt-1.5 text-[12px] font-semibold text-primary hover:underline"
                    >
                      + Cadastrar "{leadSearch}" como novo cliente
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Modo novo cliente */
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Telefone <span className="text-destructive">*</span></label>
                    <input
                      type="tel"
                      value={newLeadPhone}
                      onChange={e => setNewLeadPhone(e.target.value)}
                      className={inputCls}
                      placeholder="(00) 00000-0000"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Nome do Cliente</label>
                    <input
                      type="text"
                      value={newLeadName}
                      onChange={e => setNewLeadName(e.target.value)}
                      className={inputCls}
                      placeholder="Nome completo"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>E-mail</label>
                  <input
                    type="email"
                    value={newLeadEmail}
                    onChange={e => setNewLeadEmail(e.target.value)}
                    className={inputCls}
                    placeholder="cliente@email.com"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Se já existir um cliente com esse telefone, ele será vinculado automaticamente.
                </p>
              </div>
            )}
          </div>

          {/* ── Seção: Processo ────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen size={11} /> Dados do Processo
            </p>

            {/* Nº Processo */}
            <div>
              <label className={labelCls}>
                Nº Processo CNJ <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={caseNumber}
                onChange={e => handleCaseNumberChange(e.target.value)}
                className={`${inputCls} font-mono`}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </div>

            {/* Etapa + Prioridade */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Etapa Atual</label>
                <select value={trackingStage} onChange={e => setTrackingStage(e.target.value)} className={inputCls}>
                  {TRACKING_STAGES.map(s => (
                    <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Prioridade</label>
                <select value={priority} onChange={e => setPriority(e.target.value)} className={inputCls}>
                  <option value="URGENTE">🔴 Urgente</option>
                  <option value="NORMAL">🟡 Normal</option>
                  <option value="BAIXA">⬜ Baixa</option>
                </select>
              </div>
            </div>

            {/* Área + Tipo de Ação */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Área Jurídica</label>
                <select value={legalArea} onChange={e => setLegalArea(e.target.value)} className={inputCls}>
                  <option value="">Selecionar...</option>
                  {LEGAL_AREAS_LIST.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tipo de Ação</label>
                <input
                  type="text"
                  value={actionType}
                  onChange={e => setActionType(e.target.value)}
                  className={inputCls}
                  placeholder="Reclamatória, Indenizatória..."
                />
              </div>
            </div>

            {/* Parte Contrária */}
            <div>
              <label className={`${labelCls} flex items-center gap-1`}>
                <Scale size={11} /> Parte Contrária
              </label>
              <input
                type="text"
                value={opposingParty}
                onChange={e => setOpposingParty(e.target.value)}
                className={inputCls}
                placeholder="Nome do réu / reclamado"
              />
            </div>

            {/* Vara + Juiz */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Vara / Tribunal</label>
                <input type="text" value={court} onChange={e => setCourt(e.target.value)} className={inputCls} placeholder="1ª Vara do Trabalho" />
              </div>
              <div>
                <label className={`${labelCls} flex items-center gap-1`}>
                  <Gavel size={11} /> Juiz / Relator
                </label>
                <input type="text" value={judge} onChange={e => setJudge(e.target.value)} className={inputCls} placeholder="Dr. João Silva" />
              </div>
            </div>

            {/* Valor + Data */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`${labelCls} flex items-center gap-1`}>
                  <DollarSign size={11} /> Valor da Causa
                </label>
                <input
                  type="number"
                  value={claimValue}
                  onChange={e => setClaimValue(e.target.value)}
                  className={inputCls}
                  placeholder="0,00"
                  step="0.01"
                  min="0"
                />
              </div>
              <div>
                <label className={`${labelCls} flex items-center gap-1`}>
                  <Calendar size={11} /> Data de Ajuizamento
                </label>
                <input type="date" value={filedAt} onChange={e => setFiledAt(e.target.value)} className={inputCls} />
              </div>
            </div>

            {/* Notas */}
            <div>
              <label className={labelCls}>Notas Internas</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                placeholder="Observações sobre o processo..."
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-[12px] text-destructive">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !caseNumber.trim()}
            className="flex-1 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
            Cadastrar Processo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tabela View ───────────────────────────────────────────────

type SortField = 'lead' | 'area' | 'stage' | 'priority' | 'days' | 'updated';
type SortDir = 'asc' | 'desc';

function TabelaView({
  cases,
  onSelect,
}: {
  cases: LegalCase[];
  onSelect: (c: LegalCase) => void;
}) {
  const [sortField, setSortField] = useState<SortField>('days');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const PRIORITY_ORDER = { URGENTE: 0, NORMAL: 1, BAIXA: 2 };

  const sorted = [...cases].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'lead') cmp = (a.lead?.name || '').localeCompare(b.lead?.name || '');
    else if (sortField === 'area') cmp = (a.legal_area || '').localeCompare(b.legal_area || '');
    else if (sortField === 'stage') cmp = (a.tracking_stage || '').localeCompare(b.tracking_stage || '');
    else if (sortField === 'priority') cmp = (PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] ?? 1) - (PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER] ?? 1);
    else if (sortField === 'days') cmp = daysInStage(b.stage_changed_at) - daysInStage(a.stage_changed_at);
    else if (sortField === 'updated') cmp = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => toggleSort(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        <ArrowUpDown size={9} className={sortField === field ? 'text-primary' : 'opacity-30'} />
      </span>
    </th>
  );

  return (
    <div className="flex-1 overflow-auto p-6">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <SortHeader field="priority">Prior.</SortHeader>
            <SortHeader field="lead">Cliente</SortHeader>
            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nº Processo</th>
            <SortHeader field="area">Área</SortHeader>
            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Vara</th>
            <SortHeader field="stage">Etapa</SortHeader>
            <SortHeader field="days">Dias</SortHeader>
            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tarefas</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">DJEN</th>
            <SortHeader field="updated">Atualizado</SortHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.map(c => {
            const stageInfo = findTrackingStage(c.tracking_stage);
            const pCfg = PRIORITY_CONFIG[c.priority] ?? PRIORITY_CONFIG.NORMAL;
            const days = daysInStage(c.stage_changed_at || c.updated_at);
            const djenCount = c._count?.djen_publications ?? 0;
            return (
              <tr
                key={c.id}
                onClick={() => onSelect(c)}
                className="border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors group"
              >
                <td className="px-3 py-2.5">
                  <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${pCfg.badgeClass}`}>
                    {c.priority}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-semibold text-[13px] text-foreground truncate max-w-[150px]">
                    {c.lead?.name || '—'}
                  </div>
                  {c.opposing_party && (
                    <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">vs. {c.opposing_party}</div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className="font-mono text-[11px] text-muted-foreground">{c.case_number || '—'}</span>
                </td>
                <td className="px-3 py-2.5">
                  {c.legal_area ? (
                    <span className="text-[11px] text-violet-400">{c.legal_area}</span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground truncate max-w-[100px] block">{c.court || '—'}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-[11px] font-semibold" style={{ color: stageInfo.color }}>
                    {stageInfo.emoji} {stageInfo.label}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-[12px] font-semibold ${days > 30 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {days}d
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-[12px] text-muted-foreground">{c._count?.tasks ?? 0}</span>
                </td>
                <td className="px-3 py-2.5">
                  {djenCount > 0 ? (
                    <span className="text-[12px] text-amber-400 font-semibold flex items-center gap-0.5">
                      <Bell size={10} /> {djenCount}
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">{timeAgo(c.updated_at)}</span>
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center py-12 text-muted-foreground text-sm">
                Nenhum processo encontrado
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────

export default function ProcessosPage() {
  const router = useRouter();
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [displayView, setDisplayView] = useState<'kanban' | 'tabela'>('kanban');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<LegalCase | null>(null);
  const [showCadastrarModal, setShowCadastrarModal] = useState(false);

  // (DJEN movido para /atendimento/djen)

  // Board pan
  const boardRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStartX = useRef(0);
  const panScrollLeft = useRef(0);

  const handleBoardMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[draggable="true"]')) return;
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    if (e.button !== 0) return;
    isPanning.current = true;
    panStartX.current = e.pageX - (boardRef.current?.offsetLeft ?? 0);
    panScrollLeft.current = boardRef.current?.scrollLeft ?? 0;
    if (boardRef.current) boardRef.current.style.cursor = 'grabbing';
  };

  const handleBoardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning.current || !boardRef.current) return;
    e.preventDefault();
    const x = e.pageX - boardRef.current.offsetLeft;
    boardRef.current.scrollLeft = panScrollLeft.current - (x - panStartX.current) * 1.5;
  };

  const handleBoardMouseUp = () => {
    isPanning.current = false;
    if (boardRef.current) boardRef.current.style.cursor = 'grab';
  };

  const fetchCases = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const archivedParam = view === 'archived' ? 'true' : 'false';
      const res = await api.get(`/legal-cases?archived=${archivedParam}&inTracking=true`);
      setCases(res.data || []);
    } catch (e: any) {
      console.warn('Erro ao buscar processos', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [view]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    fetchCases();
    const interval = setInterval(() => fetchCases(true), 30_000);
    return () => clearInterval(interval);
  }, [router, fetchCases]);

  const moveCase = async (caseId: string, newTrackingStage: string) => {
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, tracking_stage: newTrackingStage } : c));
    try {
      await api.patch(`/legal-cases/${caseId}/tracking-stage`, { trackingStage: newTrackingStage });
    } catch {
      fetchCases(true);
    }
  };

  // Filters
  const allAreas = [...new Set(cases.map(c => c.legal_area).filter(Boolean))].sort() as string[];

  const filteredCases = cases.filter(c => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const name = (c.lead?.name || '').toLowerCase();
      const phone = (c.lead?.phone || '').toLowerCase();
      const caseNum = (c.case_number || '').toLowerCase();
      const opp = (c.opposing_party || '').toLowerCase();
      if (!name.includes(q) && !phone.includes(q) && !caseNum.includes(q) && !opp.includes(q)) return false;
    }
    if (areaFilter && c.legal_area !== areaFilter) return false;
    if (priorityFilter && c.priority !== priorityFilter) return false;
    return true;
  });

  const getStageCase = (stageId: string) =>
    filteredCases
      .filter(c => (c.tracking_stage || 'DISTRIBUIDO') === stageId)
      .sort((a, b) => {
        // Sort: URGENTE first, then by days in stage desc
        const PORD = { URGENTE: 0, NORMAL: 1, BAIXA: 2 };
        const pa = PORD[a.priority as keyof typeof PORD] ?? 1;
        const pb = PORD[b.priority as keyof typeof PORD] ?? 1;
        if (pa !== pb) return pa - pb;
        return daysInStage(b.stage_changed_at) - daysInStage(a.stage_changed_at);
      });

  const urgentCount = cases.filter(c => c.priority === 'URGENTE').length;

  return (
    <div className="flex h-screen bg-background font-sans antialiased text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="px-6 py-4 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <BookOpen size={20} className="text-primary" />
              {view === 'archived' ? 'Processos Arquivados' : 'Processos Judiciais'}
              {urgentCount > 0 && view === 'active' && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/12 text-red-400 border border-red-500/20">
                  {urgentCount} urgente{urgentCount !== 1 ? 's' : ''}
                </span>
              )}
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {filteredCases.length} processo{filteredCases.length !== 1 ? 's' : ''}{' '}
              {searchQuery || areaFilter || priorityFilter ? 'filtrados' : 'em acompanhamento'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View toggle (kanban/tabela) — só para processos ativos */}
            {view === 'active' && (
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setDisplayView('kanban')}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                    displayView === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                  title="Kanban"
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  onClick={() => setDisplayView('tabela')}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1 transition-colors border-l border-border ${
                    displayView === 'tabela' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                  title="Tabela"
                >
                  <LayoutList size={13} />
                </button>
              </div>
            )}

            {/* View toggle (active/archived) */}
            {view === 'active' ? (
              <button
                onClick={() => setView('archived')}
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg hover:bg-accent transition-colors"
              >
                <Archive size={13} /> Arquivados
              </button>
            ) : (
              <button
                onClick={() => setView('active')}
                className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1.5 px-3 py-1.5 border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
              >
                ← Voltar aos ativos
              </button>
            )}

            {/* DJEN link → página dedicada */}
            <button
              onClick={() => router.push('/atendimento/djen')}
              className="text-[11px] font-semibold text-amber-500 hover:text-amber-400 flex items-center gap-1.5 px-3 py-1.5 border border-amber-500/30 rounded-lg hover:bg-amber-500/5 transition-colors"
            >
              <Bell size={13} /> DJEN
            </button>

            {/* Priority filter */}
            <div className="relative">
              <select
                value={priorityFilter}
                onChange={e => setPriorityFilter(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
              >
                <option value="">Prioridade</option>
                <option value="URGENTE">🔴 Urgente</option>
                <option value="NORMAL">🟡 Normal</option>
                <option value="BAIXA">⬜ Baixa</option>
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>

            {/* Area filter */}
            {allAreas.length > 0 && (
              <div className="relative">
                <select
                  value={areaFilter}
                  onChange={e => setAreaFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                >
                  <option value="">Todas as áreas</option>
                  {allAreas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar processo…"
                className="pl-8 pr-3 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 w-44"
              />
            </div>

            {/* Cadastrar processo existente */}
            {view === 'active' && (
              <button
                onClick={() => setShowCadastrarModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all"
                title="Cadastrar processo em andamento"
              >
                <FolderPlus size={13} /> Cadastrar
              </button>
            )}

            {/* Refresh */}
            <button
              onClick={() => fetchCases(true)}
              disabled={refreshing}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Atualizar"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted rounded w-3/4" />
                      <div className="h-2.5 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-2.5 bg-muted rounded w-full" />
                    <div className="h-2.5 bg-muted rounded w-5/6" />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <div className="h-5 bg-muted rounded-full w-16" />
                    <div className="h-5 bg-muted rounded-full w-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : view === 'archived' ? (
          /* ─── Archived list ─── */
          <div className="flex-1 overflow-y-auto p-6">
            {filteredCases.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground text-sm">Nenhum processo arquivado</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredCases.map(c => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCase(c)}
                    className="p-4 bg-card border border-border rounded-xl hover:border-border/80 hover:shadow-lg cursor-pointer transition-all"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden">
                        {c.lead?.profile_picture_url ? (
                          <img src={c.lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User size={14} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[13px] font-semibold truncate">{c.lead?.name || 'Sem nome'}</h4>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{c.case_number || 'Sem número'}</p>
                      </div>
                    </div>
                    {c.archive_reason && (
                      <p className="text-[11px] text-muted-foreground italic mt-1">Motivo: {c.archive_reason}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {c.legal_area && (
                        <span className="text-[9px] font-bold text-violet-400 bg-violet-500/12 px-1.5 py-0.5 rounded-full">⚖️ {c.legal_area}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{timeAgo(c.updated_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : displayView === 'tabela' ? (
          /* ─── Tabela View ─── */
          <TabelaView cases={filteredCases} onSelect={setSelectedCase} />
        ) : (
          /* ─── Kanban + DJEN Panel ─── */
          <div className="flex-1 flex overflow-hidden">
            {/* Kanban Board */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div
                ref={boardRef}
                className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5 cursor-grab select-none"
                onMouseDown={handleBoardMouseDown}
                onMouseMove={handleBoardMouseMove}
                onMouseUp={handleBoardMouseUp}
                onMouseLeave={handleBoardMouseUp}
              >
                <div className="flex h-full gap-4" style={{ minWidth: `${TRACKING_STAGES.length * 272}px` }}>
                  {TRACKING_STAGES.map(stage => {
                    const stageCases = getStageCase(stage.id);
                    const isDragTarget = dragOverStage === stage.id;

                    return (
                      <div
                        key={stage.id}
                        className={`flex flex-col w-[260px] min-w-[260px] rounded-xl border transition-all duration-150 ${
                          isDragTarget
                            ? 'border-2 bg-accent/30 scale-[1.01]'
                            : 'border-border bg-card/50'
                        }`}
                        style={isDragTarget ? { borderColor: stage.color } : undefined}
                        onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
                        onDragLeave={e => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null);
                        }}
                        onDrop={() => {
                          if (draggingId) moveCase(draggingId, stage.id);
                          setDragOverStage(null);
                        }}
                      >
                        {/* Column header */}
                        <div
                          className="flex items-center justify-between px-3.5 py-3 border-b border-border shrink-0 rounded-t-xl"
                          style={{ borderTopColor: stage.color, borderTopWidth: 3 }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base leading-none">{stage.emoji}</span>
                            <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: stage.color }}>
                              {stage.label}
                            </h3>
                          </div>
                          <span
                            className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                          >
                            {stageCases.length}
                          </span>
                        </div>

                        {/* Cards */}
                        <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
                          {stageCases.map(lc => (
                            <ProcessoCard
                              key={lc.id}
                              legalCase={lc}
                              isDragging={draggingId === lc.id}
                              onDragStart={() => setDraggingId(lc.id)}
                              onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                              onClick={() => setSelectedCase(lc)}
                              onStageChange={(newStage) => moveCase(lc.id, newStage)}
                            />
                          ))}

                          {stageCases.length === 0 && (
                            <div
                              className={`text-center p-5 border-2 border-dashed rounded-xl text-[11px] text-muted-foreground/50 transition-all ${
                                isDragTarget ? 'border-current opacity-100' : 'border-border/40 opacity-70'
                              }`}
                              style={isDragTarget ? { borderColor: stage.color, color: stage.color } : undefined}
                            >
                              {isDragTarget ? 'Soltar aqui' : 'Arraste processos aqui'}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Modal Cadastrar Processo Existente */}
      {showCadastrarModal && (
        <CadastrarProcessoModal
          onClose={() => setShowCadastrarModal(false)}
          onSuccess={() => fetchCases(true)}
        />
      )}

      {/* Case Detail Panel */}
      {selectedCase && (
        <ProcessoDetailPanel
          legalCase={selectedCase}
          onClose={() => setSelectedCase(null)}
          onRefresh={() => { fetchCases(true); setSelectedCase(null); }}
        />
      )}
    </div>
  );
}
