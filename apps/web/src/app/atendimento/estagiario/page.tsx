'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RouteGuard } from '@/components/RouteGuard';
import {
  Clock, CheckCircle2, AlertTriangle, FileText, User, Scale,
  ExternalLink, Loader2, RefreshCw, ChevronDown, ChevronRight,
  Sparkles, Send, Play, Trophy, Zap, CalendarClock,
  LayoutGrid, List, GripVertical, Eye, Pencil, BadgeCheck, Stamp,
} from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/lib/SocketProvider';

// ─── Tipos (Lista / Dashboard) ─────────────────────────────────

interface DashboardData {
  internName: string;
  supervisors: { id: string; name: string }[];
  pending: TaskItem[];
  inReview: PetitionItem[];
  corrections: PetitionItem[];
  completedToday: TaskItem[];
  stats: {
    pendingCount: number;
    inReviewCount: number;
    correctionsCount: number;
    completedTodayCount: number;
    approvalRate: number;
  };
}

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  start_at: string;
  priority: string;
  lead: { id: string; name: string | null; phone: string } | null;
  legal_case: {
    id: string;
    case_number: string | null;
    legal_area: string | null;
    stage: string;
    tracking_stage: string | null;
    opposing_party: string | null;
    lead: { id: string; name: string | null; phone: string } | null;
    lawyer: { id: string; name: string } | null;
  } | null;
  created_by: { id: string; name: string } | null;
}

interface PetitionItem {
  id: string;
  title: string;
  type: string;
  status: string;
  updated_at: string;
  legal_case: {
    id: string;
    case_number: string | null;
    legal_area: string | null;
    lead: { id: string; name: string | null } | null;
    lawyer: { id: string; name: string } | null;
  } | null;
  versions?: { version: number; created_at: string }[];
}

// ─── Tipos (Kanban) ────────────────────────────────────────────

interface KanbanPetition {
  id: string;
  title: string;
  type: string;
  status: string;
  deadline_at: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  legal_case: {
    id: string;
    case_number: string | null;
    legal_area: string | null;
    stage: string;
    lead: { id: string; name: string | null; phone: string };
    lawyer: { id: string; name: string };
  };
  reviewed_by: { id: string; name: string } | null;
  google_doc_url: string | null;
  _count: { versions: number };
}

interface KanbanData {
  internName: string;
  supervisors: { id: string; name: string }[];
  columns: {
    RASCUNHO: KanbanPetition[];
    EM_REVISAO: KanbanPetition[];
    APROVADA: KanbanPetition[];
    PROTOCOLADA: KanbanPetition[];
  };
  stats: {
    total: number;
    rascunho: number;
    emRevisao: number;
    aprovada: number;
    protocolada: number;
    correctionsCount: number;
    approvalRate: number;
  };
}

type KanbanColumnKey = keyof KanbanData['columns'];

// ─── Helpers ────────────────────────────────────────────────────

function formatDate(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function daysUntil(d: string) {
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: `${Math.abs(diff)}d atrasado`, urgent: true, overdue: true };
  if (diff === 0) return { text: 'Hoje', urgent: true, overdue: false };
  if (diff === 1) return { text: 'Amanha', urgent: false, overdue: false };
  return { text: `em ${diff}d`, urgent: false, overdue: false };
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

const AREA_COLORS: Record<string, string> = {
  Trabalhista: 'bg-blue-500/15 text-blue-400',
  Civil: 'bg-violet-500/15 text-violet-400',
  Consumidor: 'bg-emerald-500/15 text-emerald-400',
  Penal: 'bg-red-500/15 text-red-400',
  'Familia': 'bg-pink-500/15 text-pink-400',
  'Previdenciario': 'bg-sky-500/15 text-sky-400',
  Empresarial: 'bg-cyan-500/15 text-cyan-400',
  'Imobiliario': 'bg-orange-500/15 text-orange-400',
};

const PETITION_TYPES: Record<string, string> = {
  INICIAL: 'Petição Inicial', CONTESTACAO: 'Contestação', REPLICA: 'Réplica',
  EMBARGOS: 'Embargos', RECURSO: 'Recurso', MANIFESTACAO: 'Manifestação', OUTRO: 'Outro',
};

const PETITION_TYPE_COLORS: Record<string, string> = {
  INICIAL: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  CONTESTACAO: 'bg-red-500/15 text-red-400 border-red-500/25',
  REPLICA: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  RECURSO: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  MANIFESTACAO: 'bg-teal-500/15 text-teal-400 border-teal-500/25',
  OUTRO: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
};

const KANBAN_COLUMNS: { key: KanbanColumnKey; label: string; color: string; icon: React.ReactNode }[] = [
  { key: 'RASCUNHO', label: 'Rascunho', color: '#6b7280', icon: <Pencil size={13} /> },
  { key: 'EM_REVISAO', label: 'Em Revisão', color: '#8b5cf6', icon: <Eye size={13} /> },
  { key: 'APROVADA', label: 'Aprovada', color: '#10b981', icon: <BadgeCheck size={13} /> },
  { key: 'PROTOCOLADA', label: 'Protocolada', color: '#3b82f6', icon: <Stamp size={13} /> },
];

// Ordena pendentes: urgente primeiro, depois por prazo mais próximo
function sortByUrgency(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => {
    const aUrgente = a.priority === 'URGENTE' ? 0 : 1;
    const bUrgente = b.priority === 'URGENTE' ? 0 : 1;
    if (aUrgente !== bUrgente) return aUrgente - bUrgente;
    if (a.start_at && b.start_at) return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
    if (a.start_at) return -1;
    if (b.start_at) return 1;
    return 0;
  });
}

// ─── Componentes Compartilhados ─────────────────────────────────

function StatBadge({
  value, label, color, onClick,
}: {
  value: number | string; label: string; color: string; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-center transition-opacity ${color} ${onClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
    >
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
    </button>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const remaining = total - completed;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-foreground">Progresso das petições</span>
        <span className="text-[12px] font-bold text-emerald-400">{pct}%</span>
      </div>
      <div className="w-full h-2 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-muted-foreground">{completed} aprovada{completed !== 1 ? 's' : ''}/protocolada{completed !== 1 ? 's' : ''}</span>
        <span className="text-[10px] text-muted-foreground">{remaining} pendente{remaining !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

// ─── Componentes da Lista (existente) ──────────────────────────

function TaskCard({
  task, onAction, dimmed = false,
}: {
  task: TaskItem; onAction: (id: string, action: string) => void; dimmed?: boolean;
}) {
  const router = useRouter();
  const due = task.start_at ? daysUntil(task.start_at) : null;
  const clientName = task.legal_case?.lead?.name || task.lead?.name || null;
  const clientPhone = task.legal_case?.lead?.phone || task.lead?.phone || null;
  const area = task.legal_case?.legal_area || null;
  const caseNumber = task.legal_case?.case_number || null;
  const lawyerName = task.legal_case?.lawyer?.name || task.created_by?.name || null;
  const isConfirmado = task.status === 'CONFIRMADO';
  const isUrgent = task.priority === 'URGENTE' || due?.urgent;
  const [confirming, setConfirming] = useState(false);

  const handleComplete = () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    onAction(task.id, 'complete');
  };

  const cardBorder = dimmed
    ? 'border-emerald-500/20 opacity-60'
    : isConfirmado
    ? 'border-emerald-500/40 bg-emerald-500/5'
    : due?.overdue
    ? 'border-red-500/40 bg-red-500/5'
    : isUrgent
    ? 'border-amber-500/30'
    : 'border-border hover:border-primary/30';

  return (
    <div className={`bg-card border rounded-xl p-4 transition-colors ${cardBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {task.priority === 'URGENTE' && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 flex items-center gap-0.5">
                <Zap size={8} /> URGENTE
              </span>
            )}
            {isConfirmado && !dimmed && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                EM ANDAMENTO
              </span>
            )}
            {area && (
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${AREA_COLORS[area] || 'bg-gray-500/15 text-gray-400'}`}>
                {area}
              </span>
            )}
            {due && (
              <span className={`text-[9px] font-semibold flex items-center gap-1 ${due.overdue ? 'text-red-400 font-bold' : due.urgent ? 'text-amber-400' : 'text-muted-foreground'}`}>
                {due.overdue && <CalendarClock size={9} />}
                {formatDate(task.start_at)} ({due.text})
              </span>
            )}
          </div>
          <h3 className="text-[13px] font-bold text-foreground leading-tight">{task.title}</h3>
          {task.description && (
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
            {clientName && (
              <span className="flex items-center gap-1">
                <User size={10} /> {clientName}
                {clientPhone && <span className="font-mono">({clientPhone.slice(-4)})</span>}
              </span>
            )}
            {caseNumber && (
              <span className="flex items-center gap-1 font-mono">
                <Scale size={10} /> {caseNumber.slice(0, 15)}...
              </span>
            )}
            {lawyerName && (
              <span className="opacity-60">Adv: {lawyerName}</span>
            )}
          </div>
        </div>

        {!dimmed && (
          <div className="flex flex-col gap-1.5 shrink-0">
            {task.status === 'AGENDADO' && (
              <button
                onClick={() => onAction(task.id, 'start')}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[10px] font-bold hover:opacity-90 transition-opacity flex items-center gap-1"
              >
                <Play size={10} /> Iniciar
              </button>
            )}
            {task.status === 'CONFIRMADO' && (
              <button
                onClick={handleComplete}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold hover:opacity-90 transition-all flex items-center gap-1 ${
                  confirming
                    ? 'bg-emerald-600 text-white ring-2 ring-emerald-400 ring-offset-1 ring-offset-card'
                    : 'bg-emerald-600 text-white'
                }`}
              >
                <CheckCircle2 size={10} /> {confirming ? 'Confirmar?' : 'Concluir'}
              </button>
            )}
            {confirming && (
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1 rounded-lg bg-accent text-muted-foreground text-[10px] hover:bg-accent/80 transition-colors"
              >
                Cancelar
              </button>
            )}
            {task.legal_case?.id && (
              <button
                onClick={() => router.push(`/atendimento/workspace/${task.legal_case!.id}`)}
                className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-[10px] font-medium hover:bg-accent/80 transition-colors flex items-center gap-1"
              >
                <ExternalLink size={10} /> Processo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ListPetitionCard({ petition, type }: { petition: PetitionItem; type: 'review' | 'correction' }) {
  const router = useRouter();
  const petType = PETITION_TYPES[petition.type] || petition.type;
  const clientName = petition.legal_case?.lead?.name || null;
  const lawyerName = petition.legal_case?.lawyer?.name || null;
  const updatedAt = petition.updated_at
    ? new Date(petition.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`bg-card border rounded-xl p-4 ${
      type === 'correction' ? 'border-amber-500/30 bg-amber-500/5' : 'border-border hover:border-primary/30'
    } transition-colors`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">{petType}</span>
            {type === 'correction' && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 flex items-center gap-0.5">
                <AlertTriangle size={8} /> CORREÇÃO
              </span>
            )}
            {type === 'review' && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 flex items-center gap-0.5">
                <Send size={8} /> EM REVISÃO
              </span>
            )}
          </div>
          <h3 className="text-[13px] font-bold text-foreground leading-tight">{petition.title}</h3>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
            {clientName && <span className="flex items-center gap-1"><User size={10} /> {clientName}</span>}
            {lawyerName && <span className="opacity-60">Revisor: {lawyerName}</span>}
            {updatedAt && <span className="opacity-50">Atualizado: {updatedAt}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {petition.legal_case?.id && (
            <button
              onClick={() => router.push(`/atendimento/workspace/${petition.legal_case!.id}`)}
              className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-[10px] font-medium hover:bg-accent/80 transition-colors flex items-center gap-1"
            >
              <FileText size={10} /> Abrir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Kanban Card ────────────────────────────────────────────────

function KanbanPetitionCard({
  petition,
  isDragging,
  isDraggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  petition: KanbanPetition;
  isDragging: boolean;
  isDraggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const petType = PETITION_TYPES[petition.type] || petition.type;
  const typeColor = PETITION_TYPE_COLORS[petition.type] || PETITION_TYPE_COLORS.OUTRO;
  const clientName = petition.legal_case?.lead?.name || 'Sem nome';
  const lawyerName = petition.legal_case?.lawyer?.name || '';
  const area = petition.legal_case?.legal_area || null;
  const days = daysSince(petition.updated_at);
  const hasCorrection = petition._count.versions > 0 && petition.status === 'RASCUNHO';
  const hasReviewNotes = petition.review_notes && petition.status === 'RASCUNHO';

  // Deadline
  let deadlineEl: React.ReactNode = null;
  if (petition.deadline_at) {
    const dl = daysUntil(petition.deadline_at);
    const dlColor = dl.overdue
      ? 'text-red-400 bg-red-500/15 border-red-500/25'
      : dl.urgent
      ? 'text-amber-400 bg-amber-500/15 border-amber-500/25'
      : 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25';
    deadlineEl = (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${dlColor}`}>
        <CalendarClock size={9} /> {formatDate(petition.deadline_at)} ({dl.text})
      </span>
    );
  }

  return (
    <div
      draggable={isDraggable}
      onDragStart={(e) => {
        if (!isDraggable) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group p-3.5 bg-card border border-border rounded-xl select-none transition-all ${
        isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${
        isDragging
          ? 'opacity-40 scale-95 rotate-1 shadow-2xl ring-2 ring-primary/30'
          : 'hover:border-border/80 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/30'
      }`}
    >
      {/* Title */}
      <div className="flex items-start gap-1.5 mb-2">
        <h4 className="text-[13px] font-bold text-foreground leading-tight line-clamp-2 flex-1">
          {petition.title}
        </h4>
        {petition.google_doc_url && (
          <a
            href={petition.google_doc_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 p-1 rounded-md hover:bg-blue-500/10 transition-colors"
            title="Abrir no Google Docs"
          >
            <FileText size={12} className="text-blue-500" />
          </a>
        )}
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${typeColor}`}>
          {petType}
        </span>
        {hasCorrection && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 text-red-400 border border-red-500/25">
            <AlertTriangle size={8} /> Correção
          </span>
        )}
        {area && (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${AREA_COLORS[area] || 'bg-gray-500/15 text-gray-400 border-gray-500/25'}`}>
            {area}
          </span>
        )}
        {deadlineEl}
      </div>

      {/* Review notes (only for RASCUNHO with notes) */}
      {hasReviewNotes && (
        <div className="mb-2 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-[10px] text-amber-400 font-semibold mb-0.5">Observações do revisor:</p>
          <p className="text-[10px] text-muted-foreground line-clamp-2">{petition.review_notes}</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1">
            <User size={9} /> {clientName}
          </span>
          {lawyerName && (
            <span className="flex items-center gap-1 opacity-70">
              <Scale size={9} /> Adv: {lawyerName}
            </span>
          )}
        </div>
        <span
          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${
            days >= 7
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
              : 'text-muted-foreground/60'
          }`}
          title="Tempo neste status"
        >
          <Clock size={9} /> {days === 0 ? 'hoje' : days === 1 ? '1 dia' : `${days} dias`}
        </span>
      </div>
    </div>
  );
}

// ─── Kanban Board View ──────────────────────────────────────────

function KanbanView() {
  const router = useRouter();
  const { socket } = useSocket();
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumnKey | null>(null);

  // Board horizontal pan
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
    boardRef.current.scrollLeft = panScrollLeft.current - (x - panStartX.current);
  };

  const handleBoardMouseUp = () => {
    isPanning.current = false;
    if (boardRef.current) boardRef.current.style.cursor = 'grab';
  };

  const fetchKanban = useCallback(async () => {
    try {
      const res = await api.get('/intern/kanban');
      setData(res.data);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchKanban(); }, [fetchKanban]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => fetchKanban(), 60_000);
    return () => clearInterval(interval);
  }, [fetchKanban]);

  // WebSocket: refresh quando petição muda de status (devolvida/aprovada)
  useEffect(() => {
    if (!socket) return;

    const onPetitionStatusChange = () => { fetchKanban(); };

    socket.on('petition_status_change', onPetitionStatusChange);

    return () => {
      socket.off('petition_status_change', onPetitionStatusChange);
    };
  }, [socket, fetchKanban]);

  const handleDrop = async (targetColumn: KanbanColumnKey) => {
    if (!draggingId || targetColumn !== 'EM_REVISAO') return;

    // Find the petition being dragged (must be in RASCUNHO)
    const petition = data?.columns.RASCUNHO.find(p => p.id === draggingId);
    if (!petition) return;

    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev };
      updated.columns = {
        ...prev.columns,
        RASCUNHO: prev.columns.RASCUNHO.filter(p => p.id !== draggingId),
        EM_REVISAO: [{ ...petition, status: 'EM_REVISAO' }, ...prev.columns.EM_REVISAO],
      };
      updated.stats = {
        ...prev.stats,
        rascunho: Math.max(0, prev.stats.rascunho - 1),
        emRevisao: prev.stats.emRevisao + 1,
      };
      return updated;
    });

    try {
      await api.patch(`/petitions/${draggingId}/status`, { status: 'EM_REVISAO' });
      fetchKanban();
    } catch {
      fetchKanban(); // revert on error
    }

    setDraggingId(null);
    setDragOverColumn(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle size={32} className="text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Erro ao carregar kanban.</p>
        <button onClick={fetchKanban} className="text-xs text-primary hover:underline">Tentar novamente</button>
      </div>
    );
  }

  // Urgent petitions: RASCUNHO with overdue deadline
  const urgentPetitions = data.columns.RASCUNHO.filter(p => {
    if (!p.deadline_at) return false;
    return new Date(p.deadline_at).getTime() < Date.now();
  });

  const approvedAndProtocoled = data.stats.aprovada + data.stats.protocolada;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 space-y-4 shrink-0">
        {/* Stats */}
        <div className="flex gap-3 flex-wrap">
          <StatBadge
            value={data.stats.rascunho}
            label="Rascunhos"
            color="bg-gray-500/10 text-gray-400 dark:text-gray-300"
          />
          <StatBadge
            value={data.stats.emRevisao}
            label="Em Revisão"
            color="bg-violet-500/10 text-violet-400"
          />
          <StatBadge
            value={data.stats.aprovada}
            label="Aprovadas"
            color="bg-emerald-500/10 text-emerald-400"
          />
          <StatBadge
            value={data.stats.protocolada}
            label="Protocoladas"
            color="bg-blue-500/10 text-blue-400"
          />
          <StatBadge
            value={data.stats.correctionsCount}
            label="Correções"
            color="bg-amber-500/10 text-amber-400"
          />
          <StatBadge
            value={`${data.stats.approvalRate}%`}
            label="Aprovação"
            color="bg-primary/10 text-primary"
          />
        </div>

        {/* Progress bar */}
        {data.stats.total > 0 && (
          <ProgressBar completed={approvedAndProtocoled} total={data.stats.total} />
        )}

        {/* Urgent alert */}
        {urgentPetitions.length > 0 && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 flex items-start gap-2">
            <Zap size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] font-bold text-red-400">
                {urgentPetitions.length} petição(ões) com prazo vencido em Rascunho
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {urgentPetitions.map(p => p.title).slice(0, 2).join(', ')}
                {urgentPetitions.length > 2 && ` e mais ${urgentPetitions.length - 2}`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Kanban Board */}
      <div
        ref={boardRef}
        className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-2 cursor-grab select-none"
        onMouseDown={handleBoardMouseDown}
        onMouseMove={handleBoardMouseMove}
        onMouseUp={handleBoardMouseUp}
        onMouseLeave={handleBoardMouseUp}
      >
        <div className="flex h-full gap-4" style={{ minWidth: `${KANBAN_COLUMNS.length * 292}px` }}>
          {KANBAN_COLUMNS.map(col => {
            const petitions = data.columns[col.key] || [];
            const isDragTarget = dragOverColumn === col.key;
            const isValidDropTarget = col.key === 'EM_REVISAO' && draggingId !== null;
            const correctionsInCol = col.key === 'RASCUNHO'
              ? petitions.filter(p => p._count.versions > 0).length
              : 0;

            return (
              <div
                key={col.key}
                className={`flex flex-col w-[280px] min-w-[280px] rounded-xl border transition-all duration-150 ${
                  isDragTarget && isValidDropTarget
                    ? 'border-2 bg-accent/30 scale-[1.01]'
                    : 'border-border bg-card/50 dark:bg-card/30'
                }`}
                style={isDragTarget && isValidDropTarget ? { borderColor: col.color } : undefined}
                onDragOver={e => {
                  if (col.key === 'EM_REVISAO') {
                    e.preventDefault();
                    setDragOverColumn(col.key);
                  }
                }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverColumn(null);
                }}
                onDrop={() => {
                  handleDrop(col.key);
                  setDragOverColumn(null);
                }}
              >
                {/* Column header */}
                <div
                  className="flex items-center justify-between px-3.5 py-3 border-b border-border shrink-0 rounded-t-xl"
                  style={{ borderTopColor: col.color, borderTopWidth: 3 }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ color: col.color }}>{col.icon}</span>
                    <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: col.color }}>
                      {col.label}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {correctionsInCol > 0 && (
                      <span className="flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[9px] font-bold">
                        <AlertTriangle size={8} /> {correctionsInCol}
                      </span>
                    )}
                    <span
                      className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: `${col.color}20`, color: col.color }}
                    >
                      {petitions.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
                  {petitions.map(pet => (
                    <KanbanPetitionCard
                      key={pet.id}
                      petition={pet}
                      isDragging={draggingId === pet.id}
                      isDraggable={col.key === 'RASCUNHO'}
                      onDragStart={() => setDraggingId(pet.id)}
                      onDragEnd={() => { setDraggingId(null); setDragOverColumn(null); }}
                      onClick={() => router.push(`/atendimento/workspace/${pet.legal_case.id}?tab=peticoes`)}
                    />
                  ))}

                  {petitions.length === 0 && (
                    <div
                      className={`text-center p-5 border-2 border-dashed rounded-xl text-[11px] text-muted-foreground/50 transition-all ${
                        isDragTarget && isValidDropTarget ? 'border-current opacity-100' : 'border-border/40 opacity-70'
                      }`}
                      style={isDragTarget && isValidDropTarget ? { borderColor: col.color, color: col.color } : undefined}
                    >
                      {isDragTarget && isValidDropTarget
                        ? 'Soltar aqui para enviar'
                        : col.key === 'RASCUNHO'
                        ? 'Nenhum rascunho'
                        : col.key === 'EM_REVISAO'
                        ? 'Arraste rascunhos aqui'
                        : 'Nenhuma petição'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Lista View (existente) ─────────────────────────────────────

function ListView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const pendingRef = useRef<HTMLElement>(null);
  const correctionRef = useRef<HTMLElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const completedRef = useRef<HTMLElement>(null);

  const scrollTo = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/intern/dashboard');
      setData(res.data);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => fetchData(), 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleAction = async (eventId: string, action: string) => {
    setData(prev => {
      if (!prev) return prev;
      if (action === 'start') {
        return {
          ...prev,
          pending: prev.pending.map(t =>
            t.id === eventId ? { ...t, status: 'CONFIRMADO' } : t
          ),
        };
      }
      if (action === 'complete') {
        const task = prev.pending.find(t => t.id === eventId);
        if (!task) return prev;
        return {
          ...prev,
          pending: prev.pending.filter(t => t.id !== eventId),
          completedToday: [{ ...task, status: 'CONCLUIDO' }, ...prev.completedToday],
          stats: {
            ...prev.stats,
            pendingCount: Math.max(0, prev.stats.pendingCount - 1),
            completedTodayCount: prev.stats.completedTodayCount + 1,
          },
        };
      }
      return prev;
    });

    try {
      if (action === 'start') {
        await api.patch(`/calendar/events/${eventId}/status`, { status: 'CONFIRMADO' });
      } else if (action === 'complete') {
        await api.patch(`/calendar/events/${eventId}/status`, { status: 'CONCLUIDO' });
      }
      fetchData();
    } catch {
      fetchData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertTriangle size={32} className="text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Erro ao carregar painel.</p>
        <button onClick={fetchData} className="text-xs text-primary hover:underline">Tentar novamente</button>
      </div>
    );
  }

  const sortedPending = sortByUrgency(data.pending);

  const urgentTasks = sortedPending.filter(t => {
    if (!t.start_at) return false;
    const due = daysUntil(t.start_at);
    return due.urgent || t.priority === 'URGENTE';
  });

  const totalTasks = data.stats.completedTodayCount + data.stats.pendingCount;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto px-6 py-4 space-y-6">

        {/* Stats */}
        <div className="flex gap-3 flex-wrap">
          <StatBadge
            value={data.stats.pendingCount}
            label="Pendentes"
            color="bg-blue-500/10 text-blue-400"
            onClick={() => scrollTo(pendingRef)}
          />
          <StatBadge
            value={data.stats.correctionsCount}
            label="Correções"
            color="bg-amber-500/10 text-amber-400"
            onClick={data.stats.correctionsCount > 0 ? () => scrollTo(correctionRef) : undefined}
          />
          <StatBadge
            value={data.stats.inReviewCount}
            label="Em Revisão"
            color="bg-violet-500/10 text-violet-400"
            onClick={data.stats.inReviewCount > 0 ? () => scrollTo(reviewRef) : undefined}
          />
          <StatBadge
            value={data.stats.completedTodayCount}
            label="Hoje"
            color="bg-emerald-500/10 text-emerald-400"
            onClick={data.stats.completedTodayCount > 0 ? () => scrollTo(completedRef) : undefined}
          />
          <StatBadge
            value={`${data.stats.approvalRate}%`}
            label="Aprovação"
            color="bg-primary/10 text-primary"
          />
        </div>

        {/* Progress bar */}
        {totalTasks > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold text-foreground">Progresso do dia</span>
              <span className="text-[12px] font-bold text-emerald-400">{totalTasks > 0 ? Math.round((data.stats.completedTodayCount / totalTasks) * 100) : 0}%</span>
            </div>
            <div className="w-full h-2 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${totalTasks > 0 ? Math.round((data.stats.completedTodayCount / totalTasks) * 100) : 0}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground">{data.stats.completedTodayCount} concluída{data.stats.completedTodayCount !== 1 ? 's' : ''}</span>
              <span className="text-[10px] text-muted-foreground">{data.stats.pendingCount} restante{data.stats.pendingCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
        )}

        {/* Urgent alert */}
        {urgentTasks.length > 0 && data.stats.pendingCount > 0 && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 flex items-start gap-2">
            <Zap size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] font-bold text-red-400">
                {urgentTasks.length} tarefa{urgentTasks.length !== 1 ? 's' : ''} urgent{urgentTasks.length !== 1 ? 'es' : 'e'} ou vencendo hoje
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {urgentTasks.map(t => t.title).slice(0, 2).join(', ')}
                {urgentTasks.length > 2 && ` e mais ${urgentTasks.length - 2}`}
              </p>
            </div>
          </div>
        )}

        {/* Correções Solicitadas */}
        <section ref={correctionRef}>
          {data.corrections.length > 0 ? (
            <>
              <h2 className="text-[12px] font-bold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertTriangle size={13} /> Correções Solicitadas ({data.corrections.length})
              </h2>
              <div className="space-y-2">
                {data.corrections.map(p => (
                  <ListPetitionCard key={p.id} petition={p} type="correction" />
                ))}
              </div>
            </>
          ) : (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
              <Trophy size={18} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-[13px] font-bold text-emerald-400">Sem correções pendentes</p>
                <p className="text-[11px] text-muted-foreground">Bom trabalho! Todas as petições estão em ordem.</p>
              </div>
            </div>
          )}
        </section>

        {/* Pendentes */}
        <section ref={pendingRef}>
          <h2 className="text-[12px] font-bold text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock size={13} /> Pendentes ({data.pending.length})
          </h2>
          {sortedPending.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-[12px]">Nenhuma tarefa pendente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedPending.map(t => (
                <TaskCard key={t.id} task={t} onAction={handleAction} />
              ))}
            </div>
          )}
        </section>

        {/* Em Revisão */}
        {data.inReview.length > 0 && (
          <section ref={reviewRef}>
            <h2 className="text-[12px] font-bold text-violet-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Send size={13} /> Em Revisão ({data.inReview.length})
            </h2>
            <div className="space-y-2">
              {data.inReview.map(p => (
                <ListPetitionCard key={p.id} petition={p} type="review" />
              ))}
            </div>
          </section>
        )}

        {/* Concluídas Hoje */}
        {data.completedToday.length > 0 && (
          <section ref={completedRef}>
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="text-[12px] font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2 hover:opacity-80 transition-opacity w-full text-left"
            >
              {showCompleted ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <CheckCircle2 size={13} /> Concluídas Hoje ({data.completedToday.length})
            </button>
            {showCompleted && (
              <div className="space-y-2">
                {data.completedToday.map(t => (
                  <TaskCard key={t.id} task={t} onAction={handleAction} dimmed />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────

function InternDashboard() {
  const [activeView, setActiveView] = useState<'kanban' | 'lista'>('kanban');
  const [headerData, setHeaderData] = useState<{ internName: string; supervisors: { id: string; name: string }[] } | null>(null);

  // Fetch basic header info from kanban endpoint (lightweight)
  const fetchHeader = useCallback(async () => {
    try {
      const res = await api.get('/intern/kanban');
      setHeaderData({ internName: res.data.internName, supervisors: res.data.supervisors });
    } catch {
      // Fallback to dashboard endpoint
      try {
        const res = await api.get('/intern/dashboard');
        setHeaderData({ internName: res.data.internName, supervisors: res.data.supervisors });
      } catch {}
    }
  }, []);

  useEffect(() => { fetchHeader(); }, [fetchHeader]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Meu Painel</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {headerData?.supervisors && headerData.supervisors.length > 0
                ? `Supervisores: ${headerData.supervisors.map(s => s.name).join(', ')}`
                : 'Nenhum supervisor vinculado'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-accent rounded-lg p-0.5">
              <button
                onClick={() => setActiveView('kanban')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  activeView === 'kanban'
                    ? 'bg-card text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid size={13} /> Kanban
              </button>
              <button
                onClick={() => setActiveView('lista')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  activeView === 'lista'
                    ? 'bg-card text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List size={13} /> Lista
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {activeView === 'kanban' ? <KanbanView /> : <ListView />}
    </div>
  );
}

export default function EstagiarioPage() {
  return (
    <RouteGuard allowedRoles={['ADMIN', 'ESTAGIARIO']}>
      <InternDashboard />
    </RouteGuard>
  );
}
