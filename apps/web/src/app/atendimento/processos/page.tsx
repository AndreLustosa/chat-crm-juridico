'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, Search, RefreshCw, MessageSquare, MoreVertical, ChevronDown, ChevronRight,
  Plus, X, Calendar, FileText, Clock, Archive, ArchiveRestore, Send,
  AlertTriangle, CheckCircle2, Loader2, ExternalLink, Bell, RefreshCcw, BookOpen,
} from 'lucide-react';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
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
  legal_case?: {
    id: string;
    lead: { name: string | null };
  } | null;
  created_at: string;
}

interface CaseTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  assigned_user_id: string | null;
  assigned_user: { id: string; name: string } | null;
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

const EVENT_TYPES = [
  { id: 'PUBLICACAO', label: 'Publicação', color: '#3b82f6' },
  { id: 'DESPACHO', label: 'Despacho', color: '#8b5cf6' },
  { id: 'DECISAO', label: 'Decisão', color: '#ef4444' },
  { id: 'AUDIENCIA', label: 'Audiência', color: '#f59e0b' },
  { id: 'NOTA', label: 'Nota Interna', color: '#6b7280' },
];

const TASK_STATUSES = [
  { id: 'A_FAZER', label: 'A fazer', color: '#6b7280' },
  { id: 'EM_ANDAMENTO', label: 'Em andamento', color: '#3b82f6' },
  { id: 'CONCLUIDA', label: 'Concluída', color: '#10b981' },
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
          <h4 className="text-[13px] font-semibold text-foreground leading-tight truncate">
            {legalCase.lead?.name || 'Sem nome'}
          </h4>
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {legalCase.case_number || 'Sem número'}
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
          {djenCount > 0 && (
            <span className="flex items-center gap-0.5 text-amber-400">
              <Bell size={10} /> {djenCount}
            </span>
          )}
        </div>
        <span>{timeAgo(legalCase.updated_at)}</span>
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

  // Info fields
  const [trackingStage, setTrackingStage] = useState(legalCase.tracking_stage || 'DISTRIBUIDO');
  const [caseNumber, setCaseNumber] = useState(legalCase.case_number || '');
  const [court, setCourt] = useState(legalCase.court || '');
  const [notes, setNotes] = useState(legalCase.notes || '');
  const [legalArea, setLegalArea] = useState(legalCase.legal_area || '');

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
      const res = await api.get(`/tasks/legal-case/${legalCase.id}`);
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

  const saveInfo = async () => {
    setSaving(true);
    try {
      if (trackingStage !== legalCase.tracking_stage) {
        await api.patch(`/legal-cases/${legalCase.id}/tracking-stage`, { trackingStage });
      }
      if (caseNumber !== (legalCase.case_number || '')) {
        await api.patch(`/legal-cases/${legalCase.id}/case-number`, { caseNumber });
      }
      if (notes !== (legalCase.notes || '')) {
        await api.patch(`/legal-cases/${legalCase.id}/notes`, { notes });
      }
      if (court !== (legalCase.court || '')) {
        await api.patch(`/legal-cases/${legalCase.id}/court`, { court });
      }
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
    try {
      await api.post('/tasks', {
        title: newTaskTitle,
        description: newTaskDesc || undefined,
        legal_case_id: legalCase.id,
        assigned_user_id: newTaskAssignee || undefined,
        due_at: newTaskDue || undefined,
      });
      setNewTaskTitle(''); setNewTaskDesc(''); setNewTaskAssignee(''); setNewTaskDue('');
      setShowNewTask(false);
      fetchTasks();
    } catch {}
  };

  const handleTaskStatusChange = async (taskId: string, status: string) => {
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    } catch {}
  };

  const fetchComments = async (taskId: string) => {
    setLoadingComments(true);
    try {
      const res = await api.get(`/tasks/${taskId}/comments`);
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
      await api.post(`/tasks/${expandedTask}/comments`, { text: newComment });
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

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-end">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-[580px] bg-card border-l border-border flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
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
            <p className="text-[11px] text-muted-foreground font-mono">{legalCase.case_number || 'Sem número'}</p>
          </div>
          <div className="flex items-center gap-2">
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
            { id: 'events', label: `Movimentações (${events.length})` },
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
              {/* Tracking Stage */}
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

              {/* Legal Area */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Área Jurídica</label>
                <input
                  type="text"
                  value={legalArea}
                  onChange={e => setLegalArea(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                  placeholder="Trabalhista, Cível, etc."
                />
              </div>

              {/* Case number + Court */}
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

              {/* Filed at */}
              {legalCase.filed_at && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-accent/30 rounded-lg px-3 py-2">
                  <Calendar size={12} />
                  <span>Ajuizado em <strong>{new Date(legalCase.filed_at).toLocaleDateString('pt-BR')}</strong></span>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Notas</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  className="mt-1 w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                  placeholder="Observações internas..."
                />
              </div>

              {/* Save */}
              <button
                onClick={saveInfo}
                disabled={saving}
                className="w-full py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Salvar Alterações
              </button>

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
                        <input
                          type="checkbox"
                          checked={notifyLead}
                          onChange={e => setNotifyLead(e.target.checked)}
                          className="rounded"
                        />
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
                    {EVENT_TYPES.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
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

          {/* ─── TASKS TAB ─── */}
          {activeTab === 'tasks' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Tarefas</h3>
                <button
                  onClick={() => setShowNewTask(!showNewTask)}
                  className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1"
                >
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
                    <button onClick={handleCreateTask} className="flex-1 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90">
                      Criar
                    </button>
                    <button onClick={() => setShowNewTask(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg">
                      Cancelar
                    </button>
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
                              <span className="flex items-center gap-0.5">
                                <User size={9} /> {task.assigned_user.name}
                              </span>
                            )}
                            {task.due_at && (
                              <span className="flex items-center gap-0.5">
                                <Calendar size={9} /> {new Date(task.due_at).toLocaleDateString('pt-BR')}
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

// ─── Main Page ─────────────────────────────────────────────────

export default function ProcessosPage() {
  const router = useRouter();
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<LegalCase | null>(null);

  // DJEN panel
  const [djenPubs, setDjenPubs] = useState<DjenPublication[]>([]);
  const [loadingDjen, setLoadingDjen] = useState(false);
  const [syncingDjen, setSyncingDjen] = useState(false);
  const [showDjen, setShowDjen] = useState(true);
  const [expandedDjenPub, setExpandedDjenPub] = useState<string | null>(null);

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
      const res = await api.get(`/legal-cases?archived=${archivedParam}&inTracking=true`);
      setCases(res.data || []);
    } catch (e: any) {
      console.warn('Erro ao buscar processos', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [view]);

  const fetchDjen = useCallback(async () => {
    setLoadingDjen(true);
    try {
      const res = await api.get('/djen?days=7');
      setDjenPubs(res.data || []);
    } catch {} finally { setLoadingDjen(false); }
  }, []);

  const syncDjen = async () => {
    setSyncingDjen(true);
    try {
      await api.post('/djen/sync');
      await fetchDjen();
      fetchCases(true);
    } catch {} finally { setSyncingDjen(false); }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    fetchCases();
    fetchDjen();
    const interval = setInterval(() => fetchCases(true), 30_000);
    return () => clearInterval(interval);
  }, [router, fetchCases, fetchDjen]);

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
      if (!name.includes(q) && !phone.includes(q) && !caseNum.includes(q)) return false;
    }
    if (areaFilter && c.legal_area !== areaFilter) return false;
    return true;
  });

  const getStageCase = (stageId: string) =>
    filteredCases
      .filter(c => (c.tracking_stage || 'DISTRIBUIDO') === stageId)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div className="flex h-screen bg-background font-sans antialiased text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="px-6 py-5 border-b border-border shrink-0 flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <BookOpen size={20} className="text-primary" />
              {view === 'archived' ? 'Processos Arquivados' : 'Processos Judiciais'}
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {filteredCases.length} processo{filteredCases.length !== 1 ? 's' : ''} {searchQuery || areaFilter ? 'filtrados' : 'em acompanhamento'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
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

            {/* DJEN toggle */}
            <button
              onClick={() => setShowDjen(!showDjen)}
              className={`text-[11px] font-semibold flex items-center gap-1.5 px-3 py-1.5 border rounded-lg transition-colors ${
                showDjen
                  ? 'text-amber-500 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                  : 'text-muted-foreground border-border hover:bg-accent'
              }`}
            >
              <Bell size={13} /> DJEN {djenPubs.length > 0 && `(${djenPubs.length})`}
            </button>

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
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground text-sm animate-pulse">Carregando processos…</div>
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
        ) : (
          /* ─── Active: Kanban + DJEN Panel ─── */
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

            {/* DJEN Side Panel */}
            {showDjen && (
              <div className="w-[300px] shrink-0 border-l border-border flex flex-col bg-card/50 overflow-hidden">
                {/* DJEN Header */}
                <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="text-[12px] font-bold text-foreground flex items-center gap-1.5">
                      <Bell size={13} className="text-amber-500" />
                      DJEN — Publicações
                    </h3>
                    <p className="text-[10px] text-muted-foreground">Últimos 7 dias</p>
                  </div>
                  <button
                    onClick={syncDjen}
                    disabled={syncingDjen}
                    title="Sincronizar DJEN agora"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-all"
                  >
                    <RefreshCcw size={14} className={syncingDjen ? 'animate-spin' : ''} />
                  </button>
                </div>

                {/* DJEN List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {loadingDjen ? (
                    <div className="text-center py-8 text-muted-foreground text-[11px] animate-pulse">Carregando…</div>
                  ) : djenPubs.length === 0 ? (
                    <div className="text-center py-12 px-4 text-muted-foreground text-[11px]">
                      <Bell size={24} className="mx-auto mb-2 opacity-30" />
                      Nenhuma publicação nos últimos 7 dias
                    </div>
                  ) : (
                    <div className="p-2 space-y-1.5">
                      {djenPubs.map(pub => (
                        <div
                          key={pub.id}
                          className={`rounded-xl border overflow-hidden transition-all ${
                            pub.legal_case_id
                              ? 'border-border bg-card'
                              : 'border-amber-500/30 bg-amber-500/5'
                          }`}
                        >
                          <div
                            className="p-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
                            onClick={() => setExpandedDjenPub(expandedDjenPub === pub.id ? null : pub.id)}
                          >
                            <div className="flex items-start gap-2">
                              <ChevronRight
                                size={12}
                                className={`text-muted-foreground mt-0.5 shrink-0 transition-transform ${expandedDjenPub === pub.id ? 'rotate-90' : ''}`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                  <span className="text-[9px] text-muted-foreground">
                                    {formatDate(pub.data_disponibilizacao)}
                                  </span>
                                  {pub.tipo_comunicacao && (
                                    <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">
                                      {pub.tipo_comunicacao}
                                    </span>
                                  )}
                                  {!pub.legal_case_id && (
                                    <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-500/10 text-amber-400">
                                      Não vinculado
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-foreground font-mono truncate">
                                  {pub.numero_processo}
                                </p>
                                {pub.assunto && (
                                  <p className="text-[10px] text-muted-foreground truncate">{pub.assunto}</p>
                                )}
                                {pub.legal_case?.lead?.name && (
                                  <p className="text-[10px] text-primary truncate">{pub.legal_case.lead.name}</p>
                                )}
                              </div>
                            </div>
                          </div>

                          {expandedDjenPub === pub.id && (
                            <div className="border-t border-border p-2.5 bg-accent/10">
                              <p className="text-[10px] text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">
                                {pub.conteudo.slice(0, 500)}{pub.conteudo.length > 500 ? '…' : ''}
                              </p>
                              {pub.legal_case_id && (
                                <button
                                  onClick={() => {
                                    const c = cases.find(x => x.id === pub.legal_case_id);
                                    if (c) setSelectedCase(c);
                                  }}
                                  className="mt-2 text-[10px] font-semibold text-primary hover:underline flex items-center gap-1"
                                >
                                  <ExternalLink size={9} /> Ver processo
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Case Detail Panel */}
      {selectedCase && (
        <ProcessoDetailPanel
          legalCase={selectedCase}
          onClose={() => setSelectedCase(null)}
          onRefresh={() => { fetchCases(true); fetchDjen(); setSelectedCase(null); }}
        />
      )}
    </div>
  );
}
