'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, Search, RefreshCw, MessageSquare, MoreVertical, ChevronDown, ChevronRight,
  Plus, X, Calendar, FileText, Gavel, Clock, Archive, ArchiveRestore, Send,
  AlertTriangle, CheckCircle2, Loader2, ExternalLink, ArrowRight, Flame, ArrowDown, CheckSquare, Bell,
  Save, Trash2, Sparkles, ArrowLeft, CalendarClock,
} from 'lucide-react';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import { LEGAL_STAGES, findLegalStage } from '@/lib/legalStages';
import { useRole } from '@/lib/useRole';
import dynamic from 'next/dynamic';

const TiptapEditor = dynamic(() => import('@/components/TiptapEditor'), { ssr: false });
const GoogleDocsEmbed = dynamic(() => import('@/components/GoogleDocsEmbed'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────

interface LegalCase {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  lawyer_id: string;
  case_number: string | null;
  legal_area: string | null;
  stage: string;
  archived: boolean;
  archive_reason: string | null;
  notes: string | null;
  court: string | null;
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
  _count?: { tasks: number; events: number; petitions?: number };
}

interface IncomingLead {
  id: string; // conversation id
  lead_id: string;
  legal_area: string | null;
  last_message_at: string;
  lead: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    profile_picture_url: string | null;
  };
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

interface TaskComment {
  id: string;
  text: string;
  created_at: string;
  user: { id: string; name: string };
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

interface Petition {
  id: string;
  title: string;
  type: string;
  status: string;
  template_id: string | null;
  google_doc_url: string | null;
  google_doc_id: string | null;
  deadline_at: string | null;
  review_notes: string | null;
  content_json: any;
  content_html: string | null;
  created_at: string;
  updated_at: string;
  created_by: { id: string; name: string };
  reviewed_by: { id: string; name: string } | null;
  _count: { versions: number };
}

interface PetitionVersion {
  id: string;
  version: number;
  created_at: string;
  saved_by: { id: string; name: string };
}

// ─── Constants ────────────────────────────────────────────────

const EVENT_TYPES = [
  { id: 'PUBLICACAO', label: 'Publicação',    color: '#3b82f6' },
  { id: 'DESPACHO',   label: 'Despacho',      color: '#8b5cf6' },
  { id: 'DECISAO',    label: 'Decisão',        color: '#ef4444' },
  { id: 'AUDIENCIA',  label: 'Audiência',      color: '#f59e0b' },
  { id: 'NOTA',       label: 'Nota Interna',   color: '#6b7280' },
];

const TASK_STATUSES = [
  { id: 'AGENDADO',   label: 'A fazer',       color: '#6b7280' },
  { id: 'CONFIRMADO', label: 'Em andamento',  color: '#3b82f6' },
  { id: 'CONCLUIDO',  label: 'Concluída',     color: '#10b981' },
];

const PRIORITIES = [
  { id: 'URGENTE', label: 'Urgente', color: '#ef4444', bg: 'bg-red-500/12',  text: 'text-red-400',  border: 'border-red-500/20'  },
  { id: 'NORMAL',  label: 'Normal',  color: '#f59e0b', bg: 'bg-amber-500/12', text: 'text-amber-400', border: 'border-amber-500/20' },
  { id: 'BAIXA',   label: 'Baixa',   color: '#6b7280', bg: 'bg-gray-500/12', text: 'text-gray-400', border: 'border-gray-500/20' },
];

const PETITION_TYPES: Record<string, { label: string; color: string; bg: string; text: string; border: string }> = {
  INICIAL:       { label: 'Inicial',       color: '#3b82f6', bg: 'bg-blue-500/12',   text: 'text-blue-400',   border: 'border-blue-500/20'   },
  CONTESTACAO:   { label: 'Contestação',   color: '#ef4444', bg: 'bg-red-500/12',    text: 'text-red-400',    border: 'border-red-500/20'    },
  REPLICA:       { label: 'Réplica',       color: '#a855f7', bg: 'bg-purple-500/12', text: 'text-purple-400', border: 'border-purple-500/20' },
  RECURSO:       { label: 'Recurso',       color: '#f97316', bg: 'bg-orange-500/12', text: 'text-orange-400', border: 'border-orange-500/20' },
  MANIFESTACAO:  { label: 'Manifestação',  color: '#14b8a6', bg: 'bg-teal-500/12',   text: 'text-teal-400',   border: 'border-teal-500/20'   },
  OUTRO:         { label: 'Outro',         color: '#6b7280', bg: 'bg-gray-500/12',   text: 'text-gray-400',   border: 'border-gray-500/20'   },
};

const PETITION_STATUSES: Record<string, { label: string; color: string; bg: string; text: string; border: string }> = {
  RASCUNHO:    { label: 'Rascunho',    color: '#6b7280', bg: 'bg-gray-500/12',   text: 'text-gray-400',   border: 'border-gray-500/20'   },
  EM_REVISAO:  { label: 'Em Revisão',  color: '#eab308', bg: 'bg-yellow-500/12', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  APROVADA:    { label: 'Aprovada',    color: '#22c55e', bg: 'bg-green-500/12',  text: 'text-green-400',  border: 'border-green-500/20'  },
  PROTOCOLADA: { label: 'Protocolada', color: '#3b82f6', bg: 'bg-blue-500/12',   text: 'text-blue-400',   border: 'border-blue-500/20'   },
};

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

function stageTime(dateStr: string | null | undefined): { label: string; isStale: boolean } {
  if (!dateStr) return { label: '', isStale: false };
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return { label: 'hoje',    isStale: false };
  if (days === 1) return { label: '1 dia',   isStale: false };
  if (days < 7)  return { label: `${days} dias`, isStale: false };
  return { label: `${days} dias`, isStale: true };
}

// ─── CaseCard ─────────────────────────────────────────────────

function CaseCard({
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
  const priority = PRIORITIES.find(p => p.id === (legalCase.priority || 'NORMAL')) ?? PRIORITIES[1];
  const { label: stageDays, isStale } = stageTime(legalCase.stage_changed_at);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group p-3.5 bg-card border border-border rounded-xl cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging
          ? 'opacity-40 scale-95 rotate-1 shadow-2xl ring-2 ring-primary/30'
          : 'hover:border-border/80 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10'
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0 shadow-sm mt-0.5">
          {legalCase.lead?.profile_picture_url ? (
            <img src={legalCase.lead.profile_picture_url} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <User size={13} className="text-muted-foreground opacity-60" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h4 className="text-[13px] font-semibold text-foreground leading-tight truncate">
              {legalCase.lead?.name || 'Sem nome'}
            </h4>
            {/* Priority badge — só mostra URGENTE visualmente */}
            {legalCase.priority === 'URGENTE' && (
              <Flame size={11} className="text-red-400 shrink-0" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {formatPhone(legalCase.lead?.phone || '')}
          </p>
        </div>

        {/* Menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(v => !v); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <MoreVertical size={13} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl w-48 py-1 text-[12px]">
              <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Mover para etapa</p>
              {LEGAL_STAGES.map(s => (
                <button
                  key={s.id}
                  onClick={(e) => { e.stopPropagation(); onStageChange(s.id); setShowMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-center gap-2 ${s.id === legalCase.stage ? 'font-semibold' : ''}`}
                  style={{ color: s.id === legalCase.stage ? s.color : undefined }}
                >
                  <span>{s.emoji}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        {legalCase.legal_area && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/12 text-violet-400 text-[9px] font-bold border border-violet-500/20">
            ⚖️ {legalCase.legal_area}
          </span>
        )}
        {legalCase.case_number && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-500/12 text-blue-400 text-[9px] font-bold border border-blue-500/20">
            📋 {legalCase.case_number}
          </span>
        )}
        {legalCase.priority === 'URGENTE' && (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${priority.bg} ${priority.text} ${priority.border}`}>
            🔴 Urgente
          </span>
        )}
        {legalCase.priority === 'BAIXA' && (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${priority.bg} ${priority.text} ${priority.border}`}>
            🔵 Baixa
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
        <div className="flex items-center gap-2">
          {(legalCase._count?.tasks ?? 0) > 0 && (
            <span className="flex items-center gap-0.5">
              <CheckCircle2 size={10} /> {legalCase._count?.tasks}
            </span>
          )}
          {(legalCase._count?.events ?? 0) > 0 && (
            <span className="flex items-center gap-0.5">
              <FileText size={10} /> {legalCase._count?.events}
            </span>
          )}
          {(legalCase._count?.petitions ?? 0) > 0 && (
            <span className="flex items-center gap-0.5">
              <Gavel size={10} /> {legalCase._count?.petitions}
            </span>
          )}
        </div>
        {/* Tempo na etapa */}
        {stageDays && (
          <span
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${
              isStale
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                : 'text-muted-foreground/60'
            }`}
            title="Tempo nesta etapa"
          >
            <Clock size={9} /> {stageDays}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Case Detail Panel ────────────────────────────────────────

function CaseDetailPanel({
  legalCase,
  onClose,
  onCaseUpdated,
  onRefresh,
  globalNotify = false,
}: {
  legalCase: LegalCase;
  onClose: () => void;
  onCaseUpdated: (updated: LegalCase) => void;
  onRefresh: () => void;
  globalNotify?: boolean;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'info' | 'tasks' | 'events' | 'petitions'>('info');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Info fields
  const [stage, setStage] = useState(legalCase.stage);
  const [caseNumber, setCaseNumber] = useState(legalCase.case_number || '');
  const [court, setCourt] = useState(legalCase.court || '');
  const [notes, setNotes] = useState(legalCase.notes || '');
  const [legalArea, setLegalArea] = useState(legalCase.legal_area || '');
  const [priority, setPriority] = useState(legalCase.priority || 'NORMAL');

  // Archive
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [notifyLead, setNotifyLead] = useState(globalNotify);
  const [archiving, setArchiving] = useState(false);

  // Send to tracking (PROTOCOLO → Processos)
  const [sendingToTracking, setSendingToTracking] = useState(false);
  const [trackingError, setTrackingError] = useState('');

  // Tasks
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [interns, setInterns] = useState<Intern[]>([]);

  // Task comments
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
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

  // Petitions
  const [petitions, setPetitions] = useState<Petition[]>([]);
  const [loadingPetitions, setLoadingPetitions] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [, setReviewAction] = useState<'APROVAR' | 'DEVOLVER' | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Petition editor (inline)
  const [editingPetition, setEditingPetition] = useState<Petition | null>(null);
  const [editorMode, setEditorMode] = useState<'local' | 'gdocs'>('local');
  const [editGoogleDocUrl, setEditGoogleDocUrl] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [editContentKey, setEditContentKey] = useState(0);
  const [editVersions, setEditVersions] = useState<PetitionVersion[]>([]);
  const [showEditVersions, setShowEditVersions] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showLinkDoc, setShowLinkDoc] = useState(false);
  const [linkDocUrl, setLinkDocUrl] = useState('');
  const [linkingDoc, setLinkingDoc] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create petition form
  const [showCreatePetition, setShowCreatePetition] = useState(false);
  const [newPetTitle, setNewPetTitle] = useState('');
  const [newPetType, setNewPetType] = useState('INICIAL');
  const [newPetDeadline, setNewPetDeadline] = useState('');
  const [creatingPetition, setCreatingPetition] = useState(false);
  const [generatingPetition, setGeneratingPetition] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [createGoogleDoc, setCreateGoogleDoc] = useState(true);

  // Sync fields when legalCase changes externally
  useEffect(() => {
    setStage(legalCase.stage);
    setCaseNumber(legalCase.case_number || '');
    setCourt(legalCase.court || '');
    setNotes(legalCase.notes || '');
    setLegalArea(legalCase.legal_area || '');
    setPriority(legalCase.priority || 'NORMAL');
  }, [legalCase.id]);

  // Load tasks, events, interns
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

  const fetchPetitions = useCallback(async () => {
    setLoadingPetitions(true);
    try {
      const res = await api.get(`/petitions/case/${legalCase.id}`);
      setPetitions(res.data || []);
    } catch {} finally { setLoadingPetitions(false); }
  }, [legalCase.id]);

  useEffect(() => {
    fetchTasks();
    fetchEvents();
    fetchInterns();
  }, [fetchTasks, fetchEvents, fetchInterns]);

  // Fetch petitions when tab is selected
  useEffect(() => {
    if (activeTab === 'petitions') fetchPetitions();
  }, [activeTab, fetchPetitions]);

  // ─── Save info (BUG FIX: não fecha o painel + salva todos os campos) ───

  const saveInfo = async () => {
    setSaving(true);
    setSaveError('');
    try {
      let updatedStageChangedAt = legalCase.stage_changed_at;

      // Stage change (endpoint dedicado com WebSocket emit)
      if (stage !== legalCase.stage) {
        await api.patch(`/legal-cases/${legalCase.id}/stage`, { stage });
        updatedStageChangedAt = new Date().toISOString();
      }

      // Número do processo e vara (endpoint dedicado)
      const caseNumberChanged = caseNumber.trim() !== (legalCase.case_number || '');
      const courtChangedOnly  = court.trim()       !== (legalCase.court || '');
      if (caseNumberChanged || courtChangedOnly) {
        await api.patch(`/legal-cases/${legalCase.id}/case-number`, {
          caseNumber: caseNumber.trim(),
          court: court.trim() || undefined,
        });
      }

      // Demais campos via /details (um único request)
      const detailsChanged =
        legalArea !== (legalCase.legal_area || '') ||
        notes     !== (legalCase.notes || '')     ||
        priority  !== (legalCase.priority || 'NORMAL');

      if (detailsChanged) {
        await api.patch(`/legal-cases/${legalCase.id}/details`, {
          legal_area: legalArea || null,
          notes:      notes     || null,
          priority,
        });
      }

      // Atualiza o card no kanban sem fechar o painel
      onCaseUpdated({
        ...legalCase,
        stage,
        case_number:      caseNumber.trim() || null,
        legal_area:       legalArea || null,
        court:            court.trim() || null,
        notes:            notes     || null,
        priority,
        stage_changed_at: updatedStageChangedAt,
      });

      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch {
      setSaveError('Erro ao salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // Send to tracking
  const handleSendToTracking = async () => {
    if (!caseNumber.trim()) {
      setTrackingError('Informe o número do processo antes de enviar.');
      return;
    }
    setSendingToTracking(true);
    setTrackingError('');
    try {
      await api.patch(`/legal-cases/${legalCase.id}/send-to-tracking`, {
        caseNumber: caseNumber.trim(),
        court: court.trim() || undefined,
      });
      onRefresh();
      onClose();
    } catch (e: any) {
      setTrackingError(e?.response?.data?.message || 'Erro ao enviar para Processos.');
    } finally {
      setSendingToTracking(false);
    }
  };

  // Archive
  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.patch(`/legal-cases/${legalCase.id}/archive`, {
        reason: archiveReason,
        notifyLead,
      });
      onRefresh();
      onClose();
    } catch {} finally { setArchiving(false); }
  };

  // Unarchive
  const handleUnarchive = async () => {
    try {
      await api.patch(`/legal-cases/${legalCase.id}/unarchive`);
      onRefresh();
      onClose();
    } catch {}
  };

  // Create task (via calendar events)
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

  // Update task status
  const handleTaskStatusChange = async (taskId: string, status: string) => {
    try {
      await api.patch(`/calendar/events/${taskId}/status`, { status });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    } catch {}
  };

  // Comments
  const fetchComments = async (taskId: string) => {
    setLoadingComments(true);
    try {
      const res = await api.get(`/calendar/events/${taskId}/comments`);
      setComments(res.data || []);
    } catch {} finally { setLoadingComments(false); }
  };

  const toggleTaskExpand = (taskId: string) => {
    if (expandedTask === taskId) {
      setExpandedTask(null);
      setComments([]);
    } else {
      setExpandedTask(taskId);
      fetchComments(taskId);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !expandedTask) return;
    try {
      await api.post(`/calendar/events/${expandedTask}/comments`, { text: newComment });
      setNewComment('');
      fetchComments(expandedTask);
    } catch {}
  };

  // Create event
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

  // Delete event
  const handleDeleteEvent = async (eventId: string) => {
    try {
      await api.delete(`/legal-cases/events/${eventId}`);
      setEvents(prev => prev.filter(e => e.id !== eventId));
    } catch {}
  };

  // Review petition (approve or return)
  const handleReviewPetition = async (petitionId: string, action: 'APROVAR' | 'DEVOLVER', notes?: string) => {
    setSubmittingReview(true);
    try {
      await api.post(`/petitions/${petitionId}/review`, { action, notes: notes || undefined });
      setReviewingId(null);
      setReviewAction(null);
      setReviewNotes('');
      if (editingPetition?.id === petitionId) {
        setEditingPetition(null);
      }
      fetchPetitions();
    } catch {} finally { setSubmittingReview(false); }
  };

  // ─── Petition Editor Functions ────────────────────────────────

  // Check Google Drive config on mount
  useEffect(() => {
    api.get('/google-drive/config').then(res => {
      setDriveConfigured(res.data?.configured || false);
    }).catch(() => {});
  }, []);

  // Open petition for editing
  const openPetitionEditor = async (petitionId: string) => {
    try {
      const res = await api.get(`/petitions/${petitionId}`);
      const pet = res.data;
      setEditingPetition(pet);
      setEditTitle(pet.title);
      setEditGoogleDocUrl(pet.google_doc_url);
      setEditorMode(pet.google_doc_url ? 'gdocs' : 'local');
      setEditContentKey(prev => prev + 1);
      setShowEditVersions(false);
      setShowLinkDoc(false);
    } catch {}
  };

  const closePetitionEditor = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEditingPetition(null);
    setAutoSaveStatus('idle');
    fetchPetitions();
  };

  // Auto-save
  const doAutoSave = useCallback(async (json: any, html: string) => {
    if (!editingPetition) return;
    setAutoSaveStatus('saving');
    try {
      await api.patch(`/petitions/${editingPetition.id}`, { content_json: json, content_html: html });
      setAutoSaveStatus('saved');
    } catch { setAutoSaveStatus('idle'); }
  }, [editingPetition?.id]);

  const handleEditorChange = useCallback((json: any, html: string) => {
    setAutoSaveStatus('idle');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doAutoSave(json, html), 2000);
  }, [doAutoSave]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Title save
  const handleEditTitleSave = async () => {
    if (!editingPetition || !editTitle.trim() || editTitle === editingPetition.title) return;
    try {
      await api.patch(`/petitions/${editingPetition.id}`, { title: editTitle });
    } catch {}
  };

  // Status change
  const handlePetitionStatusChange = async (newStatus: string) => {
    if (!editingPetition) return;
    try {
      await api.patch(`/petitions/${editingPetition.id}/status`, { status: newStatus });
      setEditingPetition(prev => prev ? { ...prev, status: newStatus } : null);
    } catch {}
  };

  // Save version
  const handleSaveVersion = async () => {
    if (!editingPetition) return;
    setSavingVersion(true);
    try {
      await api.post(`/petitions/${editingPetition.id}/version`);
      loadEditVersions();
    } catch {} finally { setSavingVersion(false); }
  };

  const loadEditVersions = async () => {
    if (!editingPetition) return;
    try {
      const res = await api.get(`/petitions/${editingPetition.id}/versions`);
      setEditVersions(res.data || []);
    } catch {}
  };

  useEffect(() => {
    if (showEditVersions && editingPetition) loadEditVersions();
  }, [showEditVersions, editingPetition?.id]);

  // Regenerate with AI
  const handleRegenerate = async () => {
    if (!editingPetition || !confirm('Substituir conteúdo pela IA?')) return;
    setRegenerating(true);
    try {
      const res = await api.post(`/petitions/${editingPetition.id}/generate`);
      setEditingPetition(prev => prev ? { ...prev, content_json: res.data.content_json } : null);
      setEditContentKey(prev => prev + 1);
    } catch {} finally { setRegenerating(false); }
  };

  // Sync from Google Docs
  const handleSyncFromGoogleDoc = async () => {
    if (!editingPetition) return;
    setSyncing(true);
    try {
      await api.post(`/petitions/${editingPetition.id}/sync-gdoc`);
    } catch {} finally { setSyncing(false); }
  };

  // Link Google Doc manually
  const handleLinkGoogleDoc = async () => {
    if (!editingPetition) return;
    const url = linkDocUrl.trim();
    if (!url) return;
    const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return;
    const docId = match[1];
    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
    setLinkingDoc(true);
    try {
      await api.patch(`/petitions/${editingPetition.id}`, { google_doc_id: docId, google_doc_url: docUrl });
      setEditGoogleDocUrl(docUrl);
      setEditorMode('gdocs');
      setShowLinkDoc(false);
      setLinkDocUrl('');
    } catch {} finally { setLinkingDoc(false); }
  };

  // Delete petition
  const handleDeletePetition = async () => {
    if (!editingPetition || !confirm('Excluir esta petição?')) return;
    try {
      await api.delete(`/petitions/${editingPetition.id}`);
      setEditingPetition(null);
      fetchPetitions();
    } catch {}
  };

  // Create petition
  const handleCreatePetition = async () => {
    if (!newPetTitle.trim()) return;
    setCreatingPetition(true);
    try {
      const res = await api.post(`/petitions/case/${legalCase.id}`, {
        title: newPetTitle,
        type: newPetType,
        deadline_at: newPetDeadline || undefined,
        create_google_doc: driveConfigured ? createGoogleDoc : false,
      });
      setShowCreatePetition(false);
      setNewPetTitle(''); setNewPetDeadline('');
      openPetitionEditor(res.data.id);
    } catch {} finally { setCreatingPetition(false); }
  };

  const handleGeneratePetitionAI = async () => {
    if (!newPetTitle.trim()) return;
    setGeneratingPetition(true);
    try {
      const res = await api.post(`/petitions/case/${legalCase.id}/generate`, {
        title: newPetTitle,
        type: newPetType,
      });
      setShowCreatePetition(false);
      setNewPetTitle(''); setNewPetDeadline('');
      openPetitionEditor(res.data.id);
    } catch {} finally { setGeneratingPetition(false); }
  };

  // Status transitions
  const PETITION_STATUS_TRANSITIONS: Record<string, string[]> = {
    RASCUNHO: ['EM_REVISAO'],
    EM_REVISAO: ['RASCUNHO', 'APROVADA'],
    APROVADA: ['EM_REVISAO', 'PROTOCOLADA'],
    PROTOCOLADA: [],
  };

  const openInChat = () => {
    if (legalCase.conversation_id) {
      sessionStorage.setItem('crm_open_conv', legalCase.conversation_id);
      router.push('/atendimento');
    }
  };

  const priorityInfo = PRIORITIES.find(p => p.id === priority) ?? PRIORITIES[1];

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-end">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-[560px] bg-card border-l border-border flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
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
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-foreground truncate">{legalCase.lead?.name || 'Sem nome'}</h2>
              {priority !== 'NORMAL' && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${priorityInfo.bg} ${priorityInfo.text} ${priorityInfo.border}`}>
                  {priorityInfo.label}
                </span>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground">{formatPhone(legalCase.lead?.phone || '')}</p>
          </div>
          <button
            onClick={() => router.push(`/atendimento/workspace/${legalCase.id}`)}
            className="p-1.5 rounded-lg text-violet-400 hover:text-violet-300 hover:bg-accent transition-all"
            title="Abrir Workspace"
          >
            <ExternalLink size={18} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {(['info', 'tasks', 'events', 'petitions'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-[12px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                activeTab === tab
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              {tab === 'info' ? 'Informações' : tab === 'tasks' ? `Tarefas (${tasks.length})` : tab === 'events' ? `Eventos (${events.length})` : `Petições${petitions.length > 0 ? ` (${petitions.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* ─── INFO TAB ─── */}
          {activeTab === 'info' && (
            <div className="p-5 space-y-4">
              {/* Stage */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Etapa</label>
                <select
                  value={stage}
                  onChange={e => setStage(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                  {LEGAL_STAGES.map(s => (
                    <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                  ))}
                </select>
              </div>

              {/* Prioridade + Área Jurídica */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Prioridade</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    style={{ color: priorityInfo.color }}
                  >
                    {PRIORITIES.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Área Jurídica</label>
                  <input
                    type="text"
                    value={legalArea}
                    onChange={e => setLegalArea(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Trabalhista, Cível..."
                  />
                </div>
              </div>

              {/* Case number + Court */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Nº Processo</label>
                  <input
                    type="text"
                    value={caseNumber}
                    onChange={e => setCaseNumber(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
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

              {/* Notes */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Notas do Advogado</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                  placeholder="Observações internas..."
                />
              </div>

              {/* Save — com toast inline */}
              <div className="space-y-1.5">
                <button
                  onClick={saveInfo}
                  disabled={saving}
                  className="w-full py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {savedOk ? '✓ Salvo!' : 'Salvar Alterações'}
                </button>
                {saveError && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertTriangle size={11} /> {saveError}
                  </p>
                )}
                {savedOk && (
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={11} /> Alterações salvas com sucesso
                  </p>
                )}
              </div>

              {/* Send to Processos — only when case is at PROTOCOLO */}
              {legalCase.stage === 'PROTOCOLO' && (
                <div className="p-4 bg-pink-500/5 border border-pink-500/20 rounded-xl space-y-2">
                  <p className="text-[11px] font-bold text-pink-500 uppercase tracking-wider flex items-center gap-1.5">
                    🏛️ Protocolar Processo
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Preencha o <strong>nº do processo</strong> e a <strong>vara</strong> acima e clique para mover o caso para o menu <strong>Processos</strong>.
                  </p>
                  {trackingError && (
                    <p className="text-[11px] text-destructive flex items-center gap-1">
                      <AlertTriangle size={11} /> {trackingError}
                    </p>
                  )}
                  <button
                    onClick={handleSendToTracking}
                    disabled={sendingToTracking || !caseNumber.trim()}
                    className="w-full py-2.5 text-sm font-semibold bg-pink-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
                  >
                    {sendingToTracking ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    Enviar para Processos
                  </button>
                </div>
              )}

              {/* Open in chat */}
              {legalCase.conversation_id && (
                <button
                  onClick={openInChat}
                  className="w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors flex items-center justify-center gap-2"
                >
                  <MessageSquare size={14} /> Abrir no Chat
                </button>
              )}

              {/* Archive / Unarchive */}
              {legalCase.archived ? (
                <button
                  onClick={handleUnarchive}
                  className="w-full py-2 text-sm text-blue-500 hover:text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <ArchiveRestore size={14} /> Desarquivar Caso
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setShowArchive(!showArchive)}
                    className="w-full py-2 text-sm text-amber-500 hover:text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <Archive size={14} /> Arquivar Caso
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
                        <input
                          type="checkbox"
                          checked={notifyLead}
                          onChange={e => setNotifyLead(e.target.checked)}
                          className="rounded"
                        />
                        Notificar lead via WhatsApp
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

          {/* ─── TASKS TAB ─── */}
          {activeTab === 'tasks' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Tarefas do Caso</h3>
                <button
                  onClick={() => setShowNewTask(!showNewTask)}
                  className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <Plus size={12} /> Nova Tarefa
                </button>
              </div>

              {/* New task form */}
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
                      {interns.map(i => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={newTaskDue}
                      onChange={e => setNewTaskDue(e.target.value)}
                      className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateTask}
                      className="flex-1 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                    >
                      Criar
                    </button>
                    <button
                      onClick={() => setShowNewTask(false)}
                      className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Task list */}
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
                              <span className="flex items-center gap-0.5">
                                <User size={9} /> {task.assigned_user.name}
                              </span>
                            )}
                            {task.start_at && (
                              <span className="flex items-center gap-0.5">
                                <Calendar size={9} /> {new Date(task.start_at).toLocaleDateString('pt-BR')}
                              </span>
                            )}
                            {(task._count?.comments ?? 0) > 0 && (
                              <span className="flex items-center gap-0.5">
                                <MessageSquare size={9} /> {task._count?.comments}
                              </span>
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
                          {TASK_STATUSES.map(s => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Expanded: comments */}
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

                          {/* New comment */}
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

          {/* ─── EVENTS TAB ─── */}
          {activeTab === 'events' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Eventos / Publicações</h3>
                <button
                  onClick={() => setShowNewEvent(!showNewEvent)}
                  className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <Plus size={12} /> Novo Evento
                </button>
              </div>

              {/* New event form */}
              {showNewEvent && (
                <div className="p-4 bg-accent/30 border border-border rounded-xl space-y-3">
                  <select
                    value={newEventType}
                    onChange={e => setNewEventType(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                  >
                    {EVENT_TYPES.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>

                  {/* Aviso Audiência → Agenda automática */}
                  {newEventType === 'AUDIENCIA' && newEventDate && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/20 rounded-lg">
                      <Calendar size={12} className="text-amber-400 shrink-0" />
                      <p className="text-[11px] text-amber-400">
                        Será criado automaticamente na <strong>Agenda</strong> com lembrete 24h antes.
                      </p>
                    </div>
                  )}

                  <input
                    type="text"
                    value={newEventTitle}
                    onChange={e => setNewEventTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Título do evento"
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
                      placeholder="URL de referência"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateEvent}
                      className="flex-1 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                    >
                      Criar
                    </button>
                    <button
                      onClick={() => setShowNewEvent(false)}
                      className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Events timeline */}
              {loadingEvents ? (
                <div className="text-center py-8 text-muted-foreground text-sm animate-pulse">Carregando eventos…</div>
              ) : events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[12px]">Nenhum evento registrado</div>
              ) : (
                <div className="space-y-2">
                  {events.map(event => {
                    const typeInfo = EVENT_TYPES.find(t => t.id === event.type) ?? EVENT_TYPES[4];
                    return (
                      <div key={event.id} className="p-3 border border-border rounded-xl group hover:bg-accent/20 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                              style={{ backgroundColor: `${typeInfo.color}20`, color: typeInfo.color }}
                            >
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
                        {event.description && (
                          <p className="text-[11px] text-muted-foreground mt-1">{event.description}</p>
                        )}
                        {event.reference_url && (
                          <a
                            href={event.reference_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
                          >
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

          {/* ─── PETITIONS TAB ─── */}
          {activeTab === 'petitions' && !editingPetition && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <FileText size={12} /> Petições do Caso
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCreatePetition(true)}
                    className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1 px-2 py-1 rounded-md border border-primary/20 hover:bg-primary/5 transition-colors"
                  >
                    <Plus size={11} /> Nova Petição
                  </button>
                </div>
              </div>

              {/* Create petition form */}
              {showCreatePetition && (
                <div className="border border-primary/30 bg-accent/30 rounded-xl p-4 space-y-3">
                  <h4 className="text-[12px] font-semibold">Nova Petição</h4>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Título da petição..."
                      value={newPetTitle}
                      onChange={e => setNewPetTitle(e.target.value)}
                      className="flex-1 text-[12px] bg-card border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/40"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && !creatingPetition && handleCreatePetition()}
                    />
                    <select
                      value={newPetType}
                      onChange={e => setNewPetType(e.target.value)}
                      className="text-[11px] bg-card border border-border rounded-lg px-2 py-2"
                    >
                      {Object.entries(PETITION_TYPES).map(([key, val]) => (
                        <option key={key} value={key}>{val.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <CalendarClock size={10} /> Prazo:
                    </label>
                    <input
                      type="date"
                      value={newPetDeadline}
                      onChange={e => setNewPetDeadline(e.target.value)}
                      className="text-[11px] bg-card border border-border rounded-lg px-2 py-1"
                      min={new Date().toISOString().split('T')[0]}
                    />
                    {driveConfigured && (
                      <label className="flex items-center gap-1 text-[10px] cursor-pointer ml-auto">
                        <input type="checkbox" checked={createGoogleDoc} onChange={e => setCreateGoogleDoc(e.target.checked)} className="w-3 h-3" />
                        <FileText size={10} className="text-blue-500" /> Google Docs
                      </label>
                    )}
                  </div>
                  {generatingPetition && (
                    <div className="flex items-center gap-2 text-[11px] text-primary animate-pulse">
                      <Sparkles size={12} /> Gerando com IA...
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setShowCreatePetition(false); setNewPetTitle(''); }} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border transition-colors">Cancelar</button>
                    <button
                      onClick={handleCreatePetition}
                      disabled={creatingPetition || generatingPetition || !newPetTitle.trim()}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors flex items-center gap-1 disabled:opacity-40"
                    >
                      {creatingPetition ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Criar
                    </button>
                    <button
                      onClick={handleGeneratePetitionAI}
                      disabled={creatingPetition || generatingPetition || !newPetTitle.trim()}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-40"
                    >
                      {generatingPetition ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Gerar com IA
                    </button>
                  </div>
                </div>
              )}

              {loadingPetitions ? (
                <div className="text-center py-8 text-muted-foreground text-sm animate-pulse">Carregando petições…</div>
              ) : petitions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[12px]">
                  <FileText size={24} className="mx-auto mb-2 opacity-30" />
                  <p>Nenhuma petição</p>
                  <p className="text-[10px] mt-1">Clique em &quot;Nova Petição&quot; para começar</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {petitions.map(petition => {
                    const typeInfo = PETITION_TYPES[petition.type] ?? PETITION_TYPES.OUTRO;
                    const statusInfo = PETITION_STATUSES[petition.status] ?? PETITION_STATUSES.RASCUNHO;
                    const isReviewing = reviewingId === petition.id;

                    return (
                      <div key={petition.id} className="border border-border rounded-xl overflow-hidden">
                        <div className="p-3 hover:bg-accent/20 transition-colors">
                          {/* Title + Edit button */}
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h4 className="text-[13px] font-semibold text-foreground flex-1 min-w-0 truncate">{petition.title}</h4>
                            <button
                              onClick={() => openPetitionEditor(petition.id)}
                              className="shrink-0 text-[10px] font-semibold text-primary hover:text-primary/80 px-2 py-1 rounded-md border border-primary/20 hover:bg-primary/5 transition-colors"
                            >
                              Editar
                            </button>
                          </div>

                          {/* Type + Status + Deadline badges */}
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${typeInfo.bg} ${typeInfo.text} ${typeInfo.border}`}>
                              {typeInfo.label}
                            </span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}>
                              {statusInfo.label}
                            </span>
                            {petition.deadline_at && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold border border-amber-500/20 bg-amber-500/10 text-amber-400">
                                <CalendarClock size={8} /> {new Date(petition.deadline_at).toLocaleDateString('pt-BR')}
                              </span>
                            )}
                          </div>

                          {/* Meta info */}
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-0.5">
                              <User size={9} /> {petition.created_by?.name || 'Desconhecido'}
                            </span>
                            <span className="flex items-center gap-0.5">
                              <Clock size={9} /> {timeAgo(petition.updated_at)}
                            </span>
                            {petition._count?.versions > 0 && (
                              <span className="flex items-center gap-0.5">
                                <FileText size={9} /> {petition._count.versions} versões
                              </span>
                            )}
                            {petition.google_doc_url && (
                              <a href={petition.google_doc_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="flex items-center gap-0.5 text-blue-500 hover:text-blue-400">
                                <FileText size={9} /> Google Docs <ExternalLink size={8} />
                              </a>
                            )}
                          </div>

                          {/* Review notes (if returned) */}
                          {petition.review_notes && petition.status === 'RASCUNHO' && (
                            <div className="mt-2 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                              <p className="text-[9px] font-semibold text-amber-400">Notas do revisor:</p>
                              <p className="text-[10px] text-muted-foreground line-clamp-2">{petition.review_notes}</p>
                            </div>
                          )}

                          {/* Review actions for EM_REVISAO petitions */}
                          {petition.status === 'EM_REVISAO' && (
                            <div className="mt-3 pt-2 border-t border-border/50">
                              {!isReviewing ? (
                                <div className="flex gap-2">
                                  <button onClick={() => handleReviewPetition(petition.id, 'APROVAR')} disabled={submittingReview} className="flex-1 py-1.5 text-[11px] font-semibold bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg hover:bg-green-500/25 transition-colors flex items-center justify-center gap-1 disabled:opacity-50">
                                    <CheckCircle2 size={11} /> Aprovar
                                  </button>
                                  <button onClick={() => { setReviewingId(petition.id); setReviewAction('DEVOLVER'); setReviewNotes(''); }} className="flex-1 py-1.5 text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded-lg hover:bg-amber-500/25 transition-colors flex items-center justify-center gap-1">
                                    <ArrowDown size={11} /> Devolver
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} className="w-full px-3 py-2 text-[12px] bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none" placeholder="Observações para devolução…" autoFocus />
                                  <div className="flex gap-2">
                                    <button onClick={() => handleReviewPetition(petition.id, 'DEVOLVER', reviewNotes)} disabled={submittingReview || !reviewNotes.trim()} className="flex-1 py-1.5 text-[11px] font-semibold bg-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1">
                                      {submittingReview ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Devolver
                                    </button>
                                    <button onClick={() => { setReviewingId(null); setReviewAction(null); setReviewNotes(''); }} className="px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancelar</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── PETITION EDITOR (inline) ─── */}
          {activeTab === 'petitions' && editingPetition && (
            <div className="flex flex-col h-full">
              {/* Editor header */}
              <div className="flex items-center gap-2 border-b border-border bg-accent/30 px-4 py-2.5 shrink-0">
                <button onClick={closePetitionEditor} className="p-1 rounded-md hover:bg-accent transition-colors" title="Voltar à lista">
                  <ArrowLeft size={14} />
                </button>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onBlur={handleEditTitleSave}
                  className="flex-1 text-[13px] font-semibold bg-transparent border-none focus:outline-none min-w-0"
                  disabled={editingPetition.status === 'PROTOCOLADA'}
                />
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${(PETITION_STATUSES[editingPetition.status] ?? PETITION_STATUSES.RASCUNHO).bg} ${(PETITION_STATUSES[editingPetition.status] ?? PETITION_STATUSES.RASCUNHO).text} ${(PETITION_STATUSES[editingPetition.status] ?? PETITION_STATUSES.RASCUNHO).border}`}>
                  {(PETITION_STATUSES[editingPetition.status] ?? PETITION_STATUSES.RASCUNHO).label}
                </span>
                {autoSaveStatus === 'saving' && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Salvando...</span>}
                {autoSaveStatus === 'saved' && <span className="text-[10px] text-green-400">Salvo</span>}
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-1.5 border-b border-border px-4 py-1.5 shrink-0 flex-wrap">
                {/* Google Docs: botão discreto para trocar para editor local */}
                {editGoogleDocUrl && editorMode === 'gdocs' && (
                  <button onClick={() => setEditorMode('local')} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 px-2 py-1">
                    Editor local
                  </button>
                )}

                {/* Se está no editor local mas tem Google Doc, botão para voltar ao Docs */}
                {editGoogleDocUrl && editorMode === 'local' && (
                  <>
                    <button onClick={() => setEditorMode('gdocs')} className="text-[10px] text-blue-500 hover:text-blue-400 flex items-center gap-1 px-2 py-1">
                      <FileText size={10} /> Voltar ao Docs
                    </button>
                    <button onClick={handleSyncFromGoogleDoc} disabled={syncing} className="text-[10px] text-blue-500 hover:text-blue-400 flex items-center gap-1 px-2 py-1">
                      {syncing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Sync
                    </button>
                  </>
                )}

                {/* Save version */}
                <button onClick={handleSaveVersion} disabled={savingVersion} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1">
                  {savingVersion ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Versão
                </button>

                {/* Versions */}
                <button onClick={() => setShowEditVersions(!showEditVersions)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1">
                  <Clock size={10} /> {editingPetition._count.versions}v
                  <ChevronDown size={10} className={`transition-transform ${showEditVersions ? 'rotate-180' : ''}`} />
                </button>

                {/* Regenerate AI (only in local editor mode) */}
                {(editingPetition.status === 'RASCUNHO' || editingPetition.status === 'EM_REVISAO') && editorMode === 'local' && (
                  <button onClick={handleRegenerate} disabled={regenerating} className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 px-2 py-1">
                    {regenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} IA
                  </button>
                )}

                {/* Vincular Google Doc (quando não tem doc vinculado) */}
                {!editGoogleDocUrl && (editingPetition.status === 'RASCUNHO' || editingPetition.status === 'EM_REVISAO') && (
                  <button onClick={() => setShowLinkDoc(!showLinkDoc)} className="text-[10px] text-blue-500 hover:text-blue-400 flex items-center gap-1 px-2 py-1">
                    <ExternalLink size={10} /> Vincular Google Doc
                  </button>
                )}

                <div className="flex-1" />

                {/* Review actions (for EM_REVISAO) */}
                {editingPetition.status === 'EM_REVISAO' && (
                  <>
                    <button onClick={() => handleReviewPetition(editingPetition.id, 'APROVAR')} disabled={submittingReview} className="text-[10px] font-semibold text-green-400 border border-green-500/25 px-2.5 py-1 rounded-lg hover:bg-green-500/10 flex items-center gap-1 disabled:opacity-50">
                      <CheckCircle2 size={10} /> Aprovar
                    </button>
                    <button onClick={() => { setReviewingId(editingPetition.id); setReviewAction('DEVOLVER'); setReviewNotes(''); }} className="text-[10px] font-semibold text-amber-400 border border-amber-500/25 px-2.5 py-1 rounded-lg hover:bg-amber-500/10 flex items-center gap-1">
                      <ArrowDown size={10} /> Devolver
                    </button>
                  </>
                )}

                {/* Status transitions */}
                {(PETITION_STATUS_TRANSITIONS[editingPetition.status] || []).filter(s => s !== 'APROVADA' && s !== 'RASCUNHO' || editingPetition.status !== 'EM_REVISAO').map(newStatus => (
                  <button key={newStatus} onClick={() => handlePetitionStatusChange(newStatus)} className="text-[10px] font-medium border border-border px-2 py-1 rounded-lg hover:bg-accent">
                    {(PETITION_STATUSES[newStatus] ?? { label: newStatus }).label}
                  </button>
                ))}

                {/* Delete (only drafts) */}
                {editingPetition.status === 'RASCUNHO' && (
                  <button onClick={handleDeletePetition} className="text-[10px] text-red-400 hover:text-red-300 p-1" title="Excluir">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>

              {/* Review notes input (when returning) */}
              {reviewingId === editingPetition.id && (
                <div className="border-b border-border px-4 py-2 bg-amber-500/5 shrink-0">
                  <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} className="w-full text-[12px] bg-card border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/40" placeholder="Observações para devolução…" autoFocus />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => handleReviewPetition(editingPetition.id, 'DEVOLVER', reviewNotes)} disabled={submittingReview || !reviewNotes.trim()} className="text-[11px] font-semibold bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-1">
                      {submittingReview ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Devolver
                    </button>
                    <button onClick={() => { setReviewingId(null); setReviewAction(null); setReviewNotes(''); }} className="text-[11px] text-muted-foreground px-3 py-1.5 border border-border rounded-lg">Cancelar</button>
                  </div>
                </div>
              )}

              {/* Link Google Doc panel */}
              {showLinkDoc && (
                <div className="border-b border-border bg-blue-500/5 px-4 py-2.5 shrink-0 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground">Crie um Google Doc e cole a URL abaixo:</p>
                  <div className="flex gap-2">
                    <input type="text" value={linkDocUrl} onChange={e => setLinkDocUrl(e.target.value)} placeholder="https://docs.google.com/document/d/.../edit" className="flex-1 text-[11px] bg-card border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40" onKeyDown={e => e.key === 'Enter' && handleLinkGoogleDoc()} autoFocus />
                    <button onClick={handleLinkGoogleDoc} disabled={linkingDoc || !linkDocUrl.trim()} className="text-[10px] font-semibold bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-1">
                      {linkingDoc ? <Loader2 size={10} className="animate-spin" /> : <FileText size={10} />} Vincular
                    </button>
                    <button onClick={() => { setShowLinkDoc(false); setLinkDocUrl(''); }} className="text-[10px] text-muted-foreground px-2 py-1.5 border border-border rounded-lg">Cancelar</button>
                  </div>
                  <p className="text-[9px] text-muted-foreground/60">
                    Abra o <a href="https://docs.google.com/document/create" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Google Docs</a>, crie um documento, e cole a URL. O doc deve ser &quot;qualquer pessoa com o link pode editar&quot;.
                  </p>
                </div>
              )}

              {/* Versions panel */}
              {showEditVersions && (
                <div className="border-b border-border bg-accent/30 px-4 py-2 max-h-32 overflow-y-auto shrink-0">
                  {editVersions.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground">Nenhuma versão salva</p>
                  ) : editVersions.map(v => (
                    <div key={v.id} className="flex items-center justify-between text-[10px] py-0.5">
                      <span className="font-medium">v{v.version}</span>
                      <span className="text-muted-foreground">{v.saved_by.name}</span>
                      <span className="text-muted-foreground/60">{new Date(v.created_at).toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Editor area */}
              <div className={`flex-1 overflow-y-auto ${editorMode === 'gdocs' ? 'p-0' : 'p-4'}`}>
                {regenerating ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Sparkles size={24} className="text-primary animate-pulse" />
                    <p className="text-[12px] text-muted-foreground">Gerando com IA...</p>
                  </div>
                ) : editorMode === 'gdocs' && editGoogleDocUrl ? (
                  <GoogleDocsEmbed
                    docUrl={editGoogleDocUrl}
                    editable={editingPetition.status === 'RASCUNHO' || editingPetition.status === 'EM_REVISAO'}
                    fullHeight
                    petitionId={editingPetition.id}
                  />
                ) : (
                  <TiptapEditor
                    key={editContentKey}
                    initialContent={editingPetition.content_json}
                    onChange={handleEditorChange}
                    editable={editingPetition.status === 'RASCUNHO' || editingPetition.status === 'EM_REVISAO'}
                    placeholder="Comece a redigir a petição..."
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────

export default function AdvogadoPage() {
  const router = useRouter();
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [incoming, setIncoming] = useState<IncomingLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [showIncoming, setShowIncoming] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<LegalCase | null>(null);
  const [creatingCase, setCreatingCase] = useState<string | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<{ id: string; type: string; title: string; start_at: string; lead?: { name: string | null } | null }[]>([]);

  // BUG FIX: archivedCount via fetch separado
  const [archivedTotal, setArchivedTotal] = useState(0);

  // Prazos e petições pendentes
  const [deadlines, setDeadlines] = useState<any[]>([]);
  const [showDeadlines, setShowDeadlines] = useState(true);
  const [interns, setInterns] = useState<{ id: string; name: string }[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  // Toggle notificação DJEN ao cliente (admin only)
  const { isAdmin } = useRole();
  const [djenNotify, setDjenNotify] = useState(true);
  const [loadingNotify, setLoadingNotify] = useState(false);

  // Modal de confirmação de conclusão de tarefas ao mover estágio
  const [pendingMove, setPendingMove] = useState<{ caseId: string; newStage: string; pendingTasks: number } | null>(null);

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
    const walk = (x - panStartX.current) * 1.5;
    boardRef.current.scrollLeft = panScrollLeft.current - walk;
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
      const [casesRes, incomingRes] = await Promise.all([
        api.get(`/legal-cases?archived=${archivedParam}&inTracking=false`),
        view === 'active' ? api.get('/legal-cases/incoming') : Promise.resolve({ data: [] }),
      ]);
      setCases(casesRes.data || []);
      setIncoming(incomingRes.data || []);
    } catch (e: any) {
      console.warn('Erro ao buscar casos', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [view]);

  // BUG FIX: busca o total de arquivados separadamente
  const fetchArchivedTotal = useCallback(async () => {
    try {
      const res = await api.get('/legal-cases?archived=true&inTracking=false&page=1&limit=1');
      const total = res.data?.total ?? (Array.isArray(res.data) ? res.data.length : 0);
      setArchivedTotal(total);
    } catch {}
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    fetchCases();
    if (view === 'active') fetchArchivedTotal();

    // Fetch upcoming calendar events
    const now = new Date().toISOString();
    const in7d = new Date(Date.now() + 7 * 86400000).toISOString();
    api.get('/calendar/events', { params: { start: now, end: in7d } })
      .then(r => setUpcomingEvents((r.data || []).filter((e: any) => e.status !== 'CANCELADO' && e.status !== 'CONCLUIDO').slice(0, 5)))
      .catch(() => {});

    // Fetch prazos/tarefas pendentes (AGENDADO/CONFIRMADO, tipo TAREFA/PRAZO)
    // Fetch TODOS os prazos/tarefas pendentes (com ou sem caso vinculado)
    api.get('/calendar/events', { params: { start: new Date(Date.now() - 30 * 86400000).toISOString(), end: in7d, showAll: 'true' } })
      .then(r => {
        const items = (r.data || []).filter((e: any) =>
          ['AGENDADO', 'CONFIRMADO'].includes(e.status) && e.type === 'PRAZO'
        );
        setDeadlines(items.sort((a: any, b: any) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()).slice(0, 50));
      })
      .catch(() => {});

    // Fetch setting DJEN_NOTIFY_CLIENT (admin only)
    if (isAdmin) {
      api.get('/settings').then(r => {
        const settings = r.data || [];
        const notify = settings.find((s: any) => s.key === 'DJEN_NOTIFY_CLIENT');
        setDjenNotify(notify?.value !== 'false');
      }).catch(() => {});
    }

    // Fetch estagiários vinculados
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.sub) {
        api.get(`/users/${payload.sub}/interns`).then(r => setInterns(r.data || [])).catch(() => {});
      }
    } catch {}

    const interval = setInterval(() => fetchCases(true), 30_000);
    return () => clearInterval(interval);
  }, [router, fetchCases, fetchArchivedTotal, view]);

  // WebSocket: atualização em tempo real quando petição muda de status
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
    if (!token) return;

    let socket: any;
    const initSocket = async () => {
      const { io } = await import('socket.io-client');
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || '';
      socket = io(wsUrl, {
        path: '/socket.io/',
        transports: ['polling', 'websocket'],
        auth: { token },
        reconnection: true,
      });

      socket.on('connect', () => {
        const payload = token.split('.')[1];
        if (payload) {
          try {
            const decoded = JSON.parse(atob(payload));
            if (decoded.sub) socket.emit('join_user', decoded.sub);
          } catch {}
        }
      });

      // Petição mudou de status → refresh silencioso
      socket.on('petition_status_change', () => {
        fetchCases(true);
      });

      socket.on('petition_created', () => {
        fetchCases(true);
      });
    };

    initSocket();
    return () => { socket?.disconnect(); };
  }, [fetchCases]);

  const executeMoveToStage = async (caseId: string, newStage: string) => {
    // Optimistic update
    const now = new Date().toISOString();
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, stage: newStage, stage_changed_at: now } : c));
    if (selectedCase?.id === caseId) {
      setSelectedCase(prev => prev ? { ...prev, stage: newStage, stage_changed_at: now } : prev);
    }
    try {
      await api.patch(`/legal-cases/${caseId}/stage`, { stage: newStage });
    } catch {
      fetchCases(true); // rollback
    }
  };

  const moveCaseToStage = async (caseId: string, newStage: string) => {
    // Verificar tarefas pendentes antes de mover
    try {
      const res = await api.get(`/calendar/events/legal-case/${caseId}`);
      const tasks = (res.data || []).filter((t: any) => t.type === 'TAREFA' && ['AGENDADO', 'CONFIRMADO'].includes(t.status));
      if (tasks.length > 0) {
        // Mostrar modal de confirmação
        setPendingMove({ caseId, newStage, pendingTasks: tasks.length });
        return;
      }
    } catch {} // Se falhar a verificação, segue sem perguntar
    // Sem tarefas pendentes → mover direto
    executeMoveToStage(caseId, newStage);
  };

  const handleConfirmMove = async (completeTasks: boolean) => {
    if (!pendingMove) return;
    const { caseId, newStage } = pendingMove;
    if (completeTasks) {
      try {
        await api.patch(`/legal-cases/${caseId}/complete-stage-tasks`);
      } catch {}
    }
    setPendingMove(null);
    executeMoveToStage(caseId, newStage);
  };

  const handleCreateCase = async (conv: IncomingLead) => {
    setCreatingCase(conv.id);
    try {
      await api.post('/legal-cases', {
        lead_id: conv.lead.id,
        conversation_id: conv.id,
        legal_area: conv.legal_area || undefined,
      });
      fetchCases(true);
      fetchArchivedTotal();
    } catch {} finally { setCreatingCase(null); }
  };

  // BUG FIX: atualiza o caso no lugar sem fechar o painel
  const handleCaseUpdated = (updatedCase: LegalCase) => {
    setCases(prev => prev.map(c => c.id === updatedCase.id ? updatedCase : c));
    setSelectedCase(updatedCase);
  };

  // Filter
  const allAreas = [...new Set(cases.map(c => c.legal_area).filter(Boolean))].sort() as string[];

  const filteredCases = cases.filter(c => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const name = (c.lead?.name || '').toLowerCase();
      const phone = (c.lead?.phone || '').toLowerCase();
      const caseNum = (c.case_number || '').toLowerCase();
      if (!name.includes(q) && !phone.includes(q) && !caseNum.includes(q)) return false;
    }
    if (areaFilter) {
      if (c.legal_area !== areaFilter) return false;
    }
    return true;
  });

  const getStageCase = (stageId: string) =>
    filteredCases
      .filter(c => c.stage === stageId)
      .sort((a, b) => {
        // Urgentes primeiro
        const pa = a.priority === 'URGENTE' ? 0 : a.priority === 'BAIXA' ? 2 : 1;
        const pb = b.priority === 'URGENTE' ? 0 : b.priority === 'BAIXA' ? 2 : 1;
        if (pa !== pb) return pa - pb;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });

  return (
    <div className="flex h-screen bg-background font-sans antialiased text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="px-6 py-5 border-b border-border shrink-0 flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              {view === 'archived' ? 'Casos Arquivados' : 'Advogado — Preparação'}
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {filteredCases.length} caso{filteredCases.length !== 1 ? 's' : ''} {searchQuery || areaFilter ? 'filtrados' : 'no total'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            {view === 'active' ? (
              <button
                onClick={() => setView('archived')}
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg hover:bg-accent transition-colors"
              >
                <Archive size={13} />
                Arquivados
                {archivedTotal > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[9px] font-bold">
                    {archivedTotal}
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={() => setView('active')}
                className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1.5 px-3 py-1.5 border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
              >
                ← Voltar aos ativos
              </button>
            )}

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
                placeholder="Buscar caso…"
                className="pl-8 pr-3 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 w-44"
              />
            </div>

            {/* Toggle notificação DJEN (admin only) */}
            {isAdmin && (
              <button
                onClick={async () => {
                  setLoadingNotify(true);
                  const newVal = !djenNotify;
                  try {
                    await api.put('/settings', { key: 'DJEN_NOTIFY_CLIENT', value: newVal ? 'true' : 'false' });
                    setDjenNotify(newVal);
                  } catch {}
                  setLoadingNotify(false);
                }}
                disabled={loadingNotify}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                  djenNotify
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                }`}
                title={djenNotify ? 'Notificação DJEN ao cliente: ATIVADA' : 'Notificação DJEN ao cliente: DESATIVADA'}
              >
                <Bell size={11} />
                {djenNotify ? 'Notif. Cliente ON' : 'Notif. Cliente OFF'}
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

        {/* Upcoming events strip */}
        {upcomingEvents.length > 0 && view === 'active' && (
          <div className="px-6 py-2 border-b border-border bg-card/30 flex items-center gap-3 overflow-x-auto shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 flex items-center gap-1">
              <Calendar size={10} /> Agenda
            </span>
            {upcomingEvents.map(ev => {
              const d = new Date(ev.start_at);
              const typeColor = ev.type === 'CONSULTA' ? '#8b5cf6' : ev.type === 'AUDIENCIA' ? '#ef4444' : ev.type === 'PRAZO' ? '#f59e0b' : '#22c55e';
              return (
                <button
                  key={ev.id}
                  onClick={() => router.push('/atendimento/agenda')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors shrink-0"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: typeColor }} />
                  <span className="text-[11px] font-medium text-foreground truncate max-w-[150px]">{ev.title}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => router.push('/atendimento/agenda')}
              className="text-[11px] font-semibold text-primary hover:underline shrink-0"
            >
              Ver agenda →
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground text-sm animate-pulse">Carregando processos…</div>
          </div>
        ) : view === 'archived' ? (
          /* ─── Archived list ─── */
          <div className="flex-1 overflow-y-auto p-6">
            {filteredCases.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground text-sm">Nenhum caso arquivado</div>
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
                        <p className="text-[11px] text-muted-foreground">{formatPhone(c.lead?.phone || '')}</p>
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
        ) : (
          /* ─── Active: Incoming + Kanban ─── */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Incoming Section */}
            {incoming.length > 0 && (
              <div className="px-6 py-3 border-b border-border shrink-0">
                <button
                  onClick={() => setShowIncoming(!showIncoming)}
                  className="flex items-center gap-2 text-[13px] font-bold text-foreground"
                >
                  <ChevronRight size={14} className={`transition-transform ${showIncoming ? 'rotate-90' : ''}`} />
                  📥 Entrada
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                    {incoming.length} novo{incoming.length !== 1 ? 's' : ''}
                  </span>
                </button>

                {showIncoming && (
                  <div className="flex gap-3 mt-3 overflow-x-auto pb-2 custom-scrollbar">
                    {incoming.map(conv => (
                      <div
                        key={conv.id}
                        className="min-w-[220px] max-w-[260px] p-3 bg-card border border-border rounded-xl flex flex-col gap-2 shrink-0"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0">
                            {conv.lead?.profile_picture_url ? (
                              <img src={conv.lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <User size={11} className="text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-[12px] font-semibold truncate">{conv.lead?.name || 'Sem nome'}</h4>
                            <p className="text-[10px] text-muted-foreground">{formatPhone(conv.lead?.phone || '')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {conv.legal_area && (
                            <span className="text-[9px] font-bold text-violet-400 bg-violet-500/12 px-1.5 py-0.5 rounded-full">⚖️ {conv.legal_area}</span>
                          )}
                          <span className="text-[9px] text-muted-foreground">{timeAgo(conv.last_message_at)}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleCreateCase(conv)}
                            disabled={creatingCase === conv.id}
                            className="flex-1 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {creatingCase === conv.id ? <Loader2 size={11} className="animate-spin" /> : <Gavel size={11} />}
                            Abrir Caso
                          </button>
                          <button
                            onClick={() => { sessionStorage.setItem('crm_open_conv', conv.id); router.push('/atendimento'); }}
                            className="px-2.5 py-1.5 text-[11px] text-muted-foreground border border-border rounded-lg hover:bg-accent transition-colors"
                          >
                            <MessageSquare size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Prazos e Petições Pendentes */}
            {view === 'active' && deadlines.length > 0 && (
              <div className="mx-6 mt-4">
                <button
                  onClick={() => setShowDeadlines(!showDeadlines)}
                  className="flex items-center gap-2 text-[12px] font-bold text-amber-400 uppercase tracking-wider mb-2 hover:opacity-80 transition-opacity"
                >
                  <ChevronRight size={14} className={`transition-transform ${showDeadlines ? 'rotate-90' : ''}`} />
                  <Clock size={13} />
                  Prazos Processuais ({deadlines.length})
                </button>
                {showDeadlines && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {deadlines.map((d: any) => {
                      const isOverdue = new Date(d.start_at) < new Date();
                      return (
                        <div key={d.id} className={`bg-card border rounded-xl p-3 ${isOverdue ? 'border-red-500/40 bg-red-500/5' : 'border-border'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${d.type === 'PRAZO' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400'}`}>
                                  {d.type}
                                </span>
                                <span className={`text-[9px] font-semibold ${isOverdue ? 'text-red-400' : 'text-muted-foreground'}`}>
                                  {new Date(d.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                  {isOverdue && ' (vencido)'}
                                </span>
                              </div>
                              <p className="text-[11px] font-semibold text-foreground truncate">{d.title}</p>
                              {d.lead?.name && <p className="text-[9px] text-muted-foreground mt-0.5">{d.lead.name}</p>}
                              {d.assigned_user && (
                                <p className="text-[9px] text-emerald-400 mt-0.5">Atribuído: {d.assigned_user.name}</p>
                              )}
                            </div>
                            <div className="shrink-0">
                              {interns.length > 0 && (
                                <select
                                  value={d.assigned_user_id || ''}
                                  onChange={async (e) => {
                                    const newId = e.target.value || null;
                                    setAssigningId(d.id);
                                    try {
                                      await api.patch(`/calendar/events/${d.id}`, { assigned_user_id: newId });
                                      setDeadlines(prev => prev.map(item =>
                                        item.id === d.id ? { ...item, assigned_user_id: newId, assigned_user: newId ? interns.find(i => i.id === newId) : null } : item
                                      ));
                                    } catch {}
                                    setAssigningId(null);
                                  }}
                                  disabled={assigningId === d.id}
                                  className="text-[9px] bg-accent/50 border border-border rounded-lg px-2 py-1 text-foreground focus:outline-none max-w-[100px]"
                                >
                                  <option value="">Atribuir...</option>
                                  {interns.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                </select>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Kanban Board */}
            <div
              ref={boardRef}
              className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5 cursor-grab select-none"
              onMouseDown={handleBoardMouseDown}
              onMouseMove={handleBoardMouseMove}
              onMouseUp={handleBoardMouseUp}
              onMouseLeave={handleBoardMouseUp}
            >
              <div className="flex h-full gap-4" style={{ minWidth: `${LEGAL_STAGES.length * 272}px` }}>
                {LEGAL_STAGES.map(stage => {
                  const stageCases = getStageCase(stage.id);
                  const isDragTarget = dragOverStage === stage.id;
                  const urgentCount = stageCases.filter(c => c.priority === 'URGENTE').length;

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
                        if (draggingId) moveCaseToStage(draggingId, stage.id);
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
                        <div className="flex items-center gap-1.5">
                          {urgentCount > 0 && (
                            <span className="flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[9px] font-bold">
                              <Flame size={8} /> {urgentCount}
                            </span>
                          )}
                          <span
                            className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                          >
                            {stageCases.length}
                          </span>
                        </div>
                      </div>

                      {/* Cards */}
                      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
                        {stageCases.map(lc => (
                          <CaseCard
                            key={lc.id}
                            legalCase={lc}
                            isDragging={draggingId === lc.id}
                            onDragStart={() => setDraggingId(lc.id)}
                            onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                            onClick={() => setSelectedCase(lc)}
                            onStageChange={(newStage) => moveCaseToStage(lc.id, newStage)}
                          />
                        ))}

                        {stageCases.length === 0 && (
                          <div
                            className={`text-center p-5 border-2 border-dashed rounded-xl text-[11px] text-muted-foreground/50 transition-all ${
                              isDragTarget ? 'border-current opacity-100' : 'border-border/40 opacity-70'
                            }`}
                            style={isDragTarget ? { borderColor: stage.color, color: stage.color } : undefined}
                          >
                            {isDragTarget ? 'Soltar aqui' : 'Arraste casos aqui'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Case Detail Panel */}
      {selectedCase && (
        <CaseDetailPanel
          legalCase={selectedCase}
          onClose={() => setSelectedCase(null)}
          onCaseUpdated={handleCaseUpdated}
          onRefresh={() => { fetchCases(true); fetchArchivedTotal(); }}
          globalNotify={djenNotify}
        />
      )}

      {/* Modal: Tarefas pendentes ao mover estágio */}
      {pendingMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPendingMove(null)} />
          <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                <CheckSquare size={18} className="text-amber-400" />
              </div>
              <div>
                <p className="text-[14px] font-bold text-foreground">Tarefas pendentes</p>
                <p className="text-[11px] text-muted-foreground">
                  {pendingMove.pendingTasks} tarefa{pendingMove.pendingTasks > 1 ? 's' : ''} pendente{pendingMove.pendingTasks > 1 ? 's' : ''} neste estágio
                </p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Deseja concluir as tarefas antes de avançar para o próximo estágio?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleConfirmMove(true)}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-bold transition-colors"
              >
                Concluir tarefas e avançar
              </button>
              <button
                onClick={() => handleConfirmMove(false)}
                className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent/80 text-foreground text-[12px] font-medium transition-colors"
              >
                Avançar sem concluir
              </button>
              <button
                onClick={() => setPendingMove(null)}
                className="w-full py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
