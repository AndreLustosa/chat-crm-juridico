'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RouteGuard } from '@/components/RouteGuard';
import {
  User, Search, RefreshCw, MessageSquare, MoreVertical, ChevronRight,
  Plus, X, Calendar, FileText, Clock, Archive, ArchiveRestore, Send,
  AlertTriangle, CheckCircle2, Loader2, ExternalLink, Bell, RefreshCcw, BookOpen,
  LayoutList, LayoutGrid, DollarSign, Scale, Gavel, ArrowUpDown, FolderPlus, Pencil, Trash2,
  Sparkles, AlertCircle, SlidersHorizontal, Columns3, BookmarkPlus, Bookmark, Star,
  Undo2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { TRACKING_STAGES, findTrackingStage } from '@/lib/legalStages';
import { useRole } from '@/lib/useRole';
import { ClientPanel } from '@/components/ClientPanel';
import { ChatPopup } from '@/components/ChatPopup';
import { EventModal } from '@/components/EventModal';
import { EventActionButton } from '@/components/EventActionButton';
import TabHonorarios from '@/app/atendimento/workspace/[caseId]/components/TabHonorarios';
import {
  ProcessosFilterDrawer,
  emptyFilters,
  countActiveFilters,
  type ProcessosFilters,
} from './components/ProcessosFilterDrawer';
import { AgendaView } from './components/AgendaView';
import { ClienteView } from './components/ClienteView';
import { DashboardStrip, DashboardStripReopenButton } from './components/DashboardStrip';
import { ProcessoTimeline } from './components/ProcessoTimeline';
import {
  loadSavedViews,
  persistSavedViews,
  serializeFilters,
  deserializeFilters,
  loadColumns,
  persistColumns,
  loadSort,
  persistSort,
  loadDashboardVisible,
  persistDashboardVisible,
  loadDisplayView,
  persistDisplayView,
  DEFAULT_COLUMNS,
  COLUMN_LABELS,
  type SavedView,
  type TableColumnsState,
  type SortState,
  type SortField,
  type DisplayView,
} from './components/processosStorage';

// ─── Helpers ─────────────────────────────────────────────────

/** Formata número de processo no padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO */
const formatCNJ = (num: string | null | undefined): string => {
  if (!num) return 'Sem número';
  const digits = num.replace(/\D/g, '');
  if (digits.length === 20) {
    return `${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16,20)}`;
  }
  return num; // Não é CNJ de 20 dígitos, retorna como está
};

/**
 * Identifica tribunal + sistema a partir do numero CNJ.
 * CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
 *   J (1 digito): segmento da justica
 *   TR (2 digitos): tribunal dentro do segmento
 *
 * Retorna { code: 'TJAL', system: 'ESAJ', label: 'TJAL-ESAJ', ramo: 'Estadual' }
 * ou null se nao conseguir identificar.
 */
function getTribunalInfo(caseNumber: string | null | undefined): {
  code: string;
  system: string | null;
  label: string;
  ramo: string;
  color: string;
} | null {
  if (!caseNumber) return null;
  const digits = caseNumber.replace(/\D/g, '');
  if (digits.length !== 20) return null;
  const j = digits.slice(13, 14);   // segmento
  const tr = digits.slice(14, 16);  // tribunal

  // Ramos da justica + sistema predominante
  // Cores: estadual=sky, trabalho=red, federal=emerald, eleitoral=amber
  const TRIBUNAIS: Record<string, { code: string; system: string | null; ramo: string; color: string }> = {
    // ─── Justica Estadual (J=8) ───
    '8.01': { code: 'TJAC',  system: 'ESAJ',   ramo: 'Estadual', color: 'sky' },
    '8.02': { code: 'TJAL',  system: 'ESAJ',   ramo: 'Estadual', color: 'sky' },
    '8.03': { code: 'TJAP',  system: 'TUCUJURIS', ramo: 'Estadual', color: 'sky' },
    '8.04': { code: 'TJAM',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.05': { code: 'TJBA',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.06': { code: 'TJCE',  system: 'ESAJ',   ramo: 'Estadual', color: 'sky' },
    '8.07': { code: 'TJDFT', system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.08': { code: 'TJES',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.09': { code: 'TJGO',  system: 'PROJUDI', ramo: 'Estadual', color: 'sky' },
    '8.10': { code: 'TJMA',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.11': { code: 'TJMT',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.12': { code: 'TJMS',  system: 'ESAJ',   ramo: 'Estadual', color: 'sky' },
    '8.13': { code: 'TJMG',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.14': { code: 'TJPA',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.15': { code: 'TJPB',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.16': { code: 'TJPR',  system: 'PROJUDI', ramo: 'Estadual', color: 'sky' },
    '8.17': { code: 'TJPE',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.18': { code: 'TJPI',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.19': { code: 'TJRJ',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.20': { code: 'TJRN',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.21': { code: 'TJRS',  system: 'Eproc', ramo: 'Estadual', color: 'sky' },
    '8.22': { code: 'TJRO',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.23': { code: 'TJRR',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.24': { code: 'TJSC',  system: 'Eproc', ramo: 'Estadual', color: 'sky' },
    '8.25': { code: 'TJSE',  system: 'PJE',    ramo: 'Estadual', color: 'sky' },
    '8.26': { code: 'TJSP',  system: 'ESAJ',   ramo: 'Estadual', color: 'sky' },
    '8.27': { code: 'TJTO',  system: 'Eproc', ramo: 'Estadual', color: 'sky' },
    // ─── Justica do Trabalho (J=5) ───
    '5.01': { code: 'TRT1',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.02': { code: 'TRT2',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.03': { code: 'TRT3',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.04': { code: 'TRT4',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.05': { code: 'TRT5',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.06': { code: 'TRT6',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.07': { code: 'TRT7',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.08': { code: 'TRT8',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.09': { code: 'TRT9',  system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.10': { code: 'TRT10', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.11': { code: 'TRT11', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.12': { code: 'TRT12', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.13': { code: 'TRT13', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.14': { code: 'TRT14', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.15': { code: 'TRT15', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.16': { code: 'TRT16', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.17': { code: 'TRT17', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.18': { code: 'TRT18', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.19': { code: 'TRT19', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.20': { code: 'TRT20', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.21': { code: 'TRT21', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.22': { code: 'TRT22', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.23': { code: 'TRT23', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    '5.24': { code: 'TRT24', system: 'PJE', ramo: 'Trabalho', color: 'red' },
    // ─── Justica Federal (J=4) ───
    '4.01': { code: 'TRF1', system: 'PJE', ramo: 'Federal', color: 'emerald' },
    '4.02': { code: 'TRF2', system: 'PJE', ramo: 'Federal', color: 'emerald' },
    '4.03': { code: 'TRF3', system: 'PJE', ramo: 'Federal', color: 'emerald' },
    '4.04': { code: 'TRF4', system: 'Eproc', ramo: 'Federal', color: 'emerald' },
    '4.05': { code: 'TRF5', system: 'PJE', ramo: 'Federal', color: 'emerald' },
    '4.06': { code: 'TRF6', system: 'PJE', ramo: 'Federal', color: 'emerald' },
  };
  const key = `${j}.${tr}`;
  const info = TRIBUNAIS[key];
  if (!info) return null;
  return {
    ...info,
    label: info.system ? `${info.code}-${info.system}` : info.code,
  };
}

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
  lawyer?: {
    id: string;
    name: string | null;
  } | null;
  calendar_events?: {
    id: string;
    type: string;
    start_at: string;
    title: string;
    location: string | null;
  }[];
  honorarios?: {
    total_value: string;
    type: string;
    payments: { amount: string; status: string }[];
  }[];
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

interface AiAnalysis {
  resumo: string;
  urgencia: 'URGENTE' | 'NORMAL' | 'BAIXA';
  tipo_acao: string;
  prazo_dias: number;
  estagio_sugerido: string | null;
  tarefa_titulo: string;
  tarefa_descricao: string;
  orientacoes: string;
  event_type: 'AUDIENCIA' | 'PERICIA' | 'PRAZO' | 'TAREFA';
  data_audiencia: string | null;
  data_prazo: string | null;
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
    color: '#0ea5e9',
    borderColor: 'border-l-sky-500',
    badgeClass: 'bg-sky-500/12 text-sky-400 border-sky-500/20',
  },
  BAIXA: {
    label: 'Baixa',
    color: '#6b7280',
    borderColor: 'border-l-gray-500',
    badgeClass: 'bg-gray-500/12 text-gray-400 border-gray-500/20',
  },
};

const EVENT_TYPES = [
  { id: 'PUBLICACAO', label: 'Publicação',        color: '#3b82f6' },
  { id: 'DESPACHO',   label: 'Despacho',          color: '#8b5cf6' },
  { id: 'DECISAO',    label: 'Decisão',           color: '#ef4444' },
  { id: 'AUDIENCIA',  label: 'Audiência',         color: '#f59e0b' },
  { id: 'PERICIA',    label: 'Perícia',           color: '#0ea5e9' },
  { id: 'NOTA',       label: 'Nota Interna',      color: '#6b7280' },
];

const TASK_STATUSES = [
  { id: 'AGENDADO', label: 'A fazer', color: '#6b7280' },
  { id: 'CONFIRMADO', label: 'Em andamento', color: '#3b82f6' },
  { id: 'CONCLUIDO', label: 'Concluída', color: '#10b981' },
];

const LEGAL_AREAS = [
  'Trabalhista', 'Cível', 'Criminal', 'Previdenciário',
  'Tributário', 'Consumidor', 'Família', 'Administrativo',
  'Empresarial', 'Tributário',
];

/**
 * Normaliza legal_area vindo do ESAJ/usuario pra valor canonico.
 * ESAJ retorna em MAIUSCULAS sem acento ('CIVIL', 'TRABALHISTA', 'PREVIDENCIARIO').
 * Os selects usam valores com acento ('Cível', 'Previdenciário').
 * Sem normalizacao, o select fica 'Selecionar...' mesmo com dado no banco.
 */
function normalizeLegalArea(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.toString().trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove acentos
  const map: Record<string, string> = {
    'trabalhista': 'Trabalhista',
    'trabalho':    'Trabalhista',
    'civel':       'Cível',
    'civil':       'Cível',
    'criminal':    'Criminal',
    'penal':       'Criminal',
    'previdenciario': 'Previdenciário',
    'previdencia': 'Previdenciário',
    'tributario':  'Tributário',
    'fiscal':      'Tributário',
    'consumidor':  'Consumidor',
    'familia':     'Família',
    'administrativo': 'Administrativo',
    'empresarial': 'Empresarial',
  };
  return map[s] || raw; // se nao mapeia, devolve o original (nao perde dado)
}

// ─── ProcessoCard ──────────────────────────────────────────────

function ProcessoCard({
  legalCase,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
  onStageChange,
  onEventAction,
}: {
  legalCase: LegalCase;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  onStageChange: (stageId: string) => void;
  onEventAction?: () => void;
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

  // Resumo financeiro
  const fin = (legalCase.honorarios || []).reduce((acc, h) => {
    acc.contracted += parseFloat(h.total_value) || 0;
    h.payments.forEach(p => {
      const amt = parseFloat(p.amount) || 0;
      if (p.status === 'PAGO') acc.received += amt;
      else if (p.status === 'ATRASADO') acc.overdue += amt;
      else acc.pending += amt;
    });
    return acc;
  }, { contracted: 0, received: 0, pending: 0, overdue: 0 });
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
          {formatCNJ(legalCase.case_number)}
        </p>
      </div>

      {/* Badges area juridica + advogado */}
      <div className="flex flex-wrap gap-1 mb-2">
        {legalCase.legal_area && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/12 text-violet-400 text-[9px] font-bold border border-violet-500/20">
            ⚖️ {normalizeLegalArea(legalCase.legal_area)}
          </span>
        )}
        {legalCase.lawyer?.name && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/12 text-emerald-400 text-[9px] font-bold border border-emerald-500/20 truncate max-w-[160px]" title={legalCase.lawyer.name}>
            👨‍⚖️ {legalCase.lawyer.name}
          </span>
        )}
      </div>

      {/* Onde o processo tramita — Tribunal/Sistema (do CNJ) + Vara + Tipo de Acao */}
      {(() => {
        const tribunal = getTribunalInfo(legalCase.case_number);
        if (!tribunal && !legalCase.court && !legalCase.action_type) return null;
        // Mapa de cores tailwind pro tribunal.color
        const colorCls: Record<string, string> = {
          sky:     'bg-sky-500/10 border-sky-500/25 text-sky-400',
          red:     'bg-red-500/10 border-red-500/25 text-red-400',
          emerald: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
          amber:   'bg-amber-500/10 border-amber-500/25 text-amber-400',
        };
        return (
          <div className="mb-2 flex flex-col gap-1">
            {tribunal && (
              <div
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border ${colorCls[tribunal.color] || colorCls.sky} self-start`}
                title={`${tribunal.code} · Justiça ${tribunal.ramo}${tribunal.system ? ` · Sistema ${tribunal.system}` : ''}`}
              >
                <span className="text-[10px] shrink-0">⚖️</span>
                <span className="text-[10px] font-bold leading-tight">
                  {tribunal.label}
                </span>
              </div>
            )}
            {legalCase.court && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/8 border border-blue-500/20"
                title={legalCase.court}
              >
                <span className="text-[10px] shrink-0">🏛️</span>
                <span className="text-[10px] font-semibold text-blue-400 leading-tight line-clamp-2 break-words">
                  {legalCase.court}
                </span>
              </div>
            )}
            {legalCase.action_type && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-500/8 border border-indigo-500/20"
                title={legalCase.action_type}
              >
                <span className="text-[10px] shrink-0">📋</span>
                <span className="text-[10px] font-semibold text-indigo-400 leading-tight line-clamp-2 break-words">
                  {legalCase.action_type}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Todos os eventos (audiências, perícias, prazos, tarefas) */}
      {legalCase.calendar_events && legalCase.calendar_events.length > 0 && (() => {
        const nowCard = new Date();
        const typeLabel: Record<string, string> = {
          AUDIENCIA: 'Audiência', PERICIA: 'Perícia', PRAZO: 'Prazo', TAREFA: 'Tarefa',
          CONSULTA: 'Consulta', OUTRO: 'Evento',
        };
        const typeEmoji: Record<string, string> = {
          AUDIENCIA: '⚖️', PERICIA: '🔬', PRAZO: '⏰', TAREFA: '✅', CONSULTA: '📞', OUTRO: '📅',
        };
        return (
          <div className="mt-1.5 flex flex-col gap-1">
            {legalCase.calendar_events!.map(ev => {
              const d = new Date(ev.start_at);
              const diffDias = Math.ceil((d.getTime() - nowCard.getTime()) / 86400000);
              const isPast = diffDias < 0;
              const isProxima = !isPast && diffDias <= 7;
              const isHoje = diffDias <= 0 && diffDias > -1;
              const dateLabel = `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')} às ${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')}`;
              const label = typeLabel[ev.type] ?? ev.type;
              const emoji = typeEmoji[ev.type] ?? '📅';
              const colorBg = isHoje ? 'bg-red-500/12 border-red-500/30' : isPast ? 'bg-gray-500/8 border-gray-500/20' : isProxima ? 'bg-amber-500/10 border-amber-500/25' : 'bg-blue-500/8 border-blue-500/20';
              const colorText = isHoje ? 'text-red-400' : isPast ? 'text-gray-400' : isProxima ? 'text-amber-400' : 'text-blue-400';
              return (
                <div
                  key={ev.id}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${colorBg}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Calendar size={9} className={`${colorText} shrink-0`} />
                  <span className={`text-[9px] font-semibold leading-tight ${colorText} flex-1`}>
                    {isHoje
                      ? `🔴 ${label} HOJE`
                      : isPast
                      ? `${label} realizada: ${dateLabel}`
                      : `${emoji} ${label}: ${dateLabel}${isProxima ? ` (em ${diffDias}d)` : ''}`}
                  </span>
                  <EventActionButton
                    type="CALENDAR"
                    id={ev.id}
                    compact
                    onActionComplete={onEventAction}
                  />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Aviso: trabalhista em contestação — juntada = data da audiência */}
      {legalCase.legal_area?.toUpperCase().includes('TRABALHIST') && legalCase.tracking_stage === 'CONTESTACAO' && (
        <div className="mt-1.5 flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <AlertTriangle size={9} className="text-amber-400 shrink-0 mt-0.5" />
          <span className="text-[9px] text-amber-400 font-semibold leading-tight">
            Atenção: juntada da contestação ocorre na data da audiência
          </span>
        </div>
      )}

      {/* Badge financeiro */}
      {fin.contracted > 0 && (
        <div className="mt-1.5 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
          <DollarSign size={9} className="text-emerald-400 shrink-0" />
          <div className="flex items-center gap-2 text-[9px] font-semibold overflow-hidden">
            <span className="text-blue-400" title="Contratado">
              {fin.contracted.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
            </span>
            <span className="text-emerald-400" title="Recebido">
              ✅ {fin.received.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
            </span>
            {fin.overdue > 0 && (
              <span className="text-red-400" title="Atrasado">
                🔴 {fin.overdue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
              </span>
            )}
            {fin.pending > 0 && fin.overdue === 0 && (
              <span className="text-amber-400" title="Pendente">
                ⏰ {fin.pending.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
        <div className="flex items-center gap-2.5">
          {taskCount > 0 && (
            <span className="flex items-center gap-0.5" title={`${taskCount} eventos`}>
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

// ─── AgendarAudienciaModal ────────────────────────────────────
// Exibido quando o usuário tenta mover um card para INSTRUCAO sem
// ter cadastrado uma audiência para esse processo.

function AgendarAudienciaModal({
  legalCase,
  suggestedDate,
  onScheduled,
  onSkip,
  onCancel,
}: {
  legalCase: LegalCase;
  suggestedDate?: string | null;
  onScheduled: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(suggestedDate ? suggestedDate.slice(0, 10) : '');
  const [time, setTime] = useState(suggestedDate ? (suggestedDate.slice(11, 16) || '07:00') : '07:00');
  const [title, setTitle] = useState('Audiência de Instrução e Julgamento');
  const [location, setLocation] = useState(legalCase.court || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!date) { setError('Informe a data da audiência para continuar.'); return; }
    setSaving(true);
    setError(null);
    try {
      const startAt = `${date}T${time || '07:00'}:00`;
      const h = parseInt((time || '07:00').split(':')[0]);
      const m = parseInt((time || '07:00').split(':')[1] || '0');
      const endH = String(h + 1 < 24 ? h + 1 : h).padStart(2, '0');
      const endAt = `${date}T${endH}:${String(m).padStart(2, '0')}:00`;

      await api.post('/calendar/events', {
        type: 'AUDIENCIA',
        title: title.trim() || 'Audiência',
        start_at: startAt,
        end_at: endAt,
        legal_case_id: legalCase.id,
        lead_id: legalCase.lead_id,
        location: location.trim() || undefined,
        priority: 'URGENTE',
        reminders: [
          { minutes_before: 1440, channel: 'WHATSAPP' },
          { minutes_before: 60, channel: 'WHATSAPP' },
        ],
      });
      onScheduled();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao agendar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-amber-500/5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <Calendar size={16} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground">Cadastrar Data da Audiência</p>
            <p className="text-[11px] text-amber-400/80 mt-0.5">
              Obrigatório para mover para Audiência/Instrução
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Info do processo */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-muted-foreground">
            <Scale size={12} className="shrink-0" />
            <span className="truncate font-mono">{formatCNJ(legalCase.case_number)}</span>
            <span className="shrink-0">·</span>
            <span className="truncate">{legalCase.lead?.name || 'Sem cliente'}</span>
          </div>

          {/* Título */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Tipo de Audiência
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              placeholder="Audiência de Instrução e Julgamento"
            />
          </div>

          {/* Data + Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Data *
              </label>
              <input
                type="date"
                value={date}
                min={today}
                onChange={e => setDate(e.target.value)}
                className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Hora
              </label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
          </div>

          {/* Local */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Local / Vara
            </label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder={legalCase.court || 'Ex: 1ª Vara do Trabalho'}
              className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>

          {error && (
            <p className="text-[12px] text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={11} /> {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onSkip}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-xl border border-border hover:bg-accent transition-colors"
            title="Mover sem agendar audiência"
          >
            Pular por agora
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="text-[12px] font-semibold px-4 py-2 rounded-xl border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !date}
            className="flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-500/90 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />}
            {saving ? 'Agendando…' : 'Agendar e Mover'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SentencaModal ──────────────────────────────────────────────
// Exibido quando o usuário move um card para EXECUCAO.
// Coleta valor da condenação, data e tipo da sentença.

function SentencaModal({
  legalCase,
  onConfirm,
  onSkip,
  onCancel,
}: {
  legalCase: LegalCase;
  onConfirm: (data: { sentence_value?: number; sentence_date?: string; sentence_type?: string }) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [sentenceValue, setSentenceValue] = useState('');
  const [sentenceDate, setSentenceDate] = useState('');
  const [sentenceType, setSentenceType] = useState('PROCEDENTE');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 text-lg">💰</div>
          <div>
            <h3 className="text-base font-bold text-foreground">Execução — Dados da Sentença</h3>
            <p className="text-xs text-muted-foreground">
              {legalCase.lead?.name} • {formatCNJ(legalCase.case_number)}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Valor da Condenação (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={sentenceValue}
              onChange={e => setSentenceValue(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              placeholder="Ex: 50000.00"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Data da Sentença</label>
              <input
                type="date"
                value={sentenceDate}
                onChange={e => setSentenceDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Resultado</label>
              <select
                value={sentenceType}
                onChange={e => setSentenceType(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <option value="PROCEDENTE">Procedente</option>
                <option value="PARCIAL">Parcialmente Procedente</option>
                <option value="IMPROCEDENTE">Improcedente</option>
                <option value="ACORDO">Acordo</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onConfirm({
              sentence_value: sentenceValue ? parseFloat(sentenceValue) : undefined,
              sentence_date: sentenceDate || undefined,
              sentence_type: sentenceType,
            })}
            className="flex-1 py-2.5 text-sm font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
          >
            Confirmar e Mover
          </button>
          <button
            onClick={onSkip}
            className="px-4 py-2.5 text-sm font-medium text-muted-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            Pular
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2.5 text-sm font-medium text-muted-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AgendarPericiaModal ──────────────────────────────────────
// Exibido quando o usuário move um card para PERICIA_AGENDADA.

function AgendarPericiaModal({
  legalCase,
  suggestedDate,
  onScheduled,
  onSkip,
  onCancel,
}: {
  legalCase: LegalCase;
  suggestedDate?: string | null;
  onScheduled: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(suggestedDate ? suggestedDate.slice(0, 10) : '');
  const [time, setTime] = useState(suggestedDate ? (suggestedDate.slice(11, 16) || '07:00') : '07:00');
  const [title, setTitle] = useState('Perícia Médica/Técnica');
  const [location, setLocation] = useState(legalCase.court || '');
  const [perito, setPerito] = useState('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!date) { setError('Informe a data da perícia para continuar.'); return; }
    setSaving(true);
    setError(null);
    try {
      const startAt = `${date}T${time || '07:00'}:00`;
      const h = parseInt((time || '07:00').split(':')[0]);
      const m = parseInt((time || '07:00').split(':')[1] || '0');
      const endH = String(h + 2 < 24 ? h + 2 : h).padStart(2, '0');
      const endAt = `${date}T${endH}:${String(m).padStart(2, '0')}:00`;
      const description = [
        perito ? `Perito: ${perito}` : '',
        obs ? `Observações: ${obs}` : '',
      ].filter(Boolean).join('\n');

      await api.post('/calendar/events', {
        type: 'PERICIA',
        title: title.trim() || 'Perícia',
        start_at: startAt,
        end_at: endAt,
        legal_case_id: legalCase.id,
        lead_id: legalCase.lead_id,
        location: location.trim() || undefined,
        description: description || undefined,
        priority: 'URGENTE',
        reminders: [
          { minutes_before: 1440, channel: 'WHATSAPP' },
          { minutes_before: 120, channel: 'WHATSAPP' },
        ],
      });
      onScheduled();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao agendar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-sky-500/5">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
            <span className="text-[18px]">🔬</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground">Agendar Perícia</p>
            <p className="text-[11px] text-sky-400/80 mt-0.5">
              Registre data, local e perito designado
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Info do processo */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-muted-foreground">
            <Scale size={12} className="shrink-0" />
            <span className="truncate font-mono">{formatCNJ(legalCase.case_number)}</span>
            <span className="shrink-0">·</span>
            <span className="truncate">{legalCase.lead?.name || 'Sem cliente'}</span>
          </div>

          {/* Tipo de perícia */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Tipo de Perícia
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="Ex: Perícia Médica, Perícia Contábil…"
            />
          </div>

          {/* Data + Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Data *
              </label>
              <input
                type="date"
                value={date}
                min={today}
                onChange={e => setDate(e.target.value)}
                className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Hora
              </label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>
          </div>

          {/* Local */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Local / Endereço
            </label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Ex: Fórum, clínica, endereço do perito"
              className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>

          {/* Perito */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Nome do Perito (opcional)
            </label>
            <input
              type="text"
              value={perito}
              onChange={e => setPerito(e.target.value)}
              placeholder="Nome do perito designado"
              className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>

          {/* Observações */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Observações (opcional)
            </label>
            <textarea
              value={obs}
              onChange={e => setObs(e.target.value)}
              rows={2}
              placeholder="Documentos a levar, orientações ao cliente…"
              className="w-full text-[12px] bg-background border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
            />
          </div>

          {error && (
            <p className="text-[12px] text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={11} /> {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onSkip}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-xl border border-border hover:bg-accent transition-colors"
          >
            Pular por agora
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="text-[12px] font-semibold px-4 py-2 rounded-xl border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !date}
            className="flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-500/90 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <span>🔬</span>}
            {saving ? 'Agendando…' : 'Agendar e Mover'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Case Detail Panel ─────────────────────────────────────────

function ProcessoDetailPanel({
  legalCase,
  onClose,
  onRefresh,
  onOpenClientPanel,
  onOpenChat,
}: {
  legalCase: LegalCase;
  onClose: () => void;
  onRefresh: () => void;
  onOpenClientPanel: (leadId: string) => void;
  onOpenChat: (legalCase: LegalCase) => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'info' | 'timeline' | 'djen' | 'events' | 'tasks' | 'honorarios'>('info');
  const { isAdmin } = useRole();
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Advogado responsável
  const [lawyers, setLawyers] = useState<{ id: string; name: string | null }[]>([]);
  const [lawyerSelectId, setLawyerSelectId] = useState(legalCase.lawyer?.id || '');
  const [changingLawyer, setChangingLawyer] = useState(false);
  const [lawyerError, setLawyerError] = useState('');

  // Info fields
  const [trackingStage, setTrackingStage] = useState(legalCase.tracking_stage || 'DISTRIBUIDO');
  const [caseNumber, setCaseNumber] = useState(legalCase.case_number || '');
  const [court, setCourt] = useState(legalCase.court || '');
  const [notes, setNotes] = useState(legalCase.notes || '');
  // Normaliza pra bater com as opcoes do select ('CIVIL' -> 'Cível', etc)
  const [legalArea, setLegalArea] = useState(normalizeLegalArea(legalCase.legal_area));
  const [priority, setPriority] = useState(legalCase.priority || 'NORMAL');
  const [opposingParty, setOpposingParty] = useState(legalCase.opposing_party || '');
  const [actionType, setActionType] = useState(legalCase.action_type || '');
  const [claimValue, setClaimValue] = useState(legalCase.claim_value ? String(legalCase.claim_value) : '');
  const [judge, setJudge] = useState(legalCase.judge || '');

  // Sincronizar com ESAJ — preenche campos vazios com dados do tribunal
  const [syncingEsaj, setSyncingEsaj] = useState(false);
  const handleSyncEsaj = async () => {
    setSyncingEsaj(true);
    try {
      const res = await api.post(`/legal-cases/${legalCase.id}/resync-movements`);
      const metaUpdated: string[] = res.data?.metadata_updated || [];
      const newMovements = res.data?.created || 0;
      const parts: string[] = [];
      if (metaUpdated.length > 0) {
        parts.push(`${metaUpdated.length} campo(s) preenchido(s): ${metaUpdated.join(', ')}`);
      }
      if (newMovements > 0) {
        parts.push(`${newMovements} nova(s) movimentação(ões)`);
      }
      if (parts.length === 0) {
        toast(`Tudo já estava atualizado (total: ${res.data?.total_now || 0} movimentações)`, { icon: '✓' });
      } else {
        toast.success(parts.join(' · '));
      }
      onRefresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao sincronizar com tribunal');
    } finally {
      setSyncingEsaj(false);
    }
  };

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
  const [notifyLead, setNotifyLead] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Tasks
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [interns, setInterns] = useState<Intern[]>([]);       // estagiários do advogado
  const [allUsers, setAllUsers] = useState<Intern[]>([]);      // todos os usuários do sistema
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [editTaskForm, setEditTaskForm] = useState({ title: '', description: '', date: '', time: '', assignee: '' });
  const [savingTask, setSavingTask] = useState(false);
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
  const [analyzingDjen, setAnalyzingDjen] = useState<string | null>(null);
  const [djenAnalyses, setDjenAnalyses] = useState<Record<string, AiAnalysis>>({});
  const [djenTaskCreated, setDjenTaskCreated] = useState<Record<string, boolean>>({});
  const [creatingDjenTask, setCreatingDjenTask] = useState<string | null>(null);
  const [djenEventPreview, setDjenEventPreview] = useState<Record<string, {
    type: string; title: string; date: string; time: string; description: string; priority: string;
  }>>({});

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
      // Estagiários vinculados ao advogado responsável pelo processo
      const res = await api.get(`/users/${legalCase.lawyer_id}/interns`);
      setInterns(res.data || []);
    } catch {}
    try {
      // Todos os usuários com perfil (para campo Responsável em eventos não-prazo)
      const res2 = await api.get('/users?limit=100');
      const data = res2.data?.data || res2.data?.users || res2.data || [];
      setAllUsers(data.filter((u: any) => u.roles?.length > 0 || u.role));
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

  // Busca lista de advogados (apenas para ADMIN)
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/users/lawyers').then(res => setLawyers(res.data || [])).catch(() => {});
  }, [isAdmin]);

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

  const handleUpdateLawyer = async () => {
    if (!lawyerSelectId) return;
    setLawyerError('');
    setChangingLawyer(true);
    try {
      await api.patch(`/legal-cases/${legalCase.id}/lawyer`, { lawyerId: lawyerSelectId });
      onRefresh();
    } catch (e: any) {
      setLawyerError(e?.response?.data?.message || 'Erro ao atualizar advogado.');
    } finally {
      setChangingLawyer(false);
    }
  };

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

  const handleTaskStatusChange = async (taskId: string, status: string) => {
    try {
      await api.patch(`/calendar/events/${taskId}/status`, { status });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    } catch {}
  };

  const openEditTask = (task: CaseTask) => {
    const dateVal = task.start_at ? task.start_at.slice(0, 10) : '';
    const timeVal = task.start_at ? task.start_at.slice(11, 16) || '07:00' : '';
    setEditTaskForm({
      title: task.title,
      description: task.description || '',
      date: dateVal,
      time: timeVal,
      assignee: task.assigned_user_id || '',
    });
    setEditingTask(task.id);
    setExpandedTask(null);
  };

  const handleSaveTaskEdit = async (taskId: string) => {
    if (!editTaskForm.title.trim()) return;
    setSavingTask(true);
    try {
      const startAt = editTaskForm.date
        ? new Date(`${editTaskForm.date}T${editTaskForm.time || '07:00'}:00Z`).toISOString()
        : undefined;
      await api.patch(`/calendar/events/${taskId}`, {
        title: editTaskForm.title.trim(),
        description: editTaskForm.description.trim() || null,
        start_at: startAt,
        assigned_user_id: editTaskForm.assignee || null,
      });
      setEditingTask(null);
      fetchTasks();
    } catch {} finally { setSavingTask(false); }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Remover esta tarefa?')) return;
    try {
      await api.delete(`/calendar/events/${taskId}`);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      if (editingTask === taskId) setEditingTask(null);
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
            <p className="text-[10px] text-muted-foreground font-mono">{formatCNJ(legalCase.case_number)}</p>
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
            <button
              onClick={() => onOpenChat(legalCase)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-green-600 hover:bg-green-500/10 transition-all"
              title="Falar com o cliente"
            >
              <MessageSquare size={16} />
            </button>
            <button
              onClick={() => onOpenClientPanel(legalCase.lead_id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
              title="Abrir Painel do Cliente"
            >
              <User size={16} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {([
            { id: 'info' as const, label: 'Processo' },
            { id: 'timeline' as const, label: 'Linha do tempo' },
            { id: 'honorarios' as const, label: 'Honorários' },
            { id: 'djen' as const, label: `DJEN (${djenPubs.length})` },
            { id: 'events' as const, label: `Movim. (${events.length})` },
            { id: 'tasks' as const, label: `Eventos (${tasks.length})` },
          ]).map(tab => (
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
                    onClick={() => onOpenClientPanel(legalCase.lead_id)}
                    className="shrink-0 text-[10px] font-semibold text-primary border border-primary/30 px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors flex items-center gap-1"
                    title="Abrir Painel do Cliente"
                  >
                    <User size={10} /> Ver perfil
                  </button>
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

              {/* ── Botao de sincronizar com tribunal (ESAJ) ────────── */}
              {legalCase.case_number && (
                <button
                  onClick={handleSyncEsaj}
                  disabled={syncingEsaj}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 text-[12px] font-bold hover:bg-sky-500/15 transition-colors disabled:opacity-50"
                  title="Busca dados atualizados no ESAJ TJAL e preenche campos vazios + novas movimentações"
                >
                  {syncingEsaj ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      Consultando tribunal...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={13} />
                      Atualizar do tribunal (ESAJ)
                    </>
                  )}
                </button>
              )}

              {/* ── Bloco Advogado Responsável ───────────────────── */}
              <div className="rounded-xl border border-border bg-accent/20 p-3 space-y-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  👨‍⚖️ Advogado Responsável
                </p>
                {isAdmin ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={lawyerSelectId}
                      onChange={e => setLawyerSelectId(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                    >
                      <option value="">Selecionar advogado…</option>
                      {lawyers.map(l => (
                        <option key={l.id} value={l.id}>{l.name || l.id}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleUpdateLawyer}
                      disabled={changingLawyer || !lawyerSelectId || lawyerSelectId === legalCase.lawyer?.id}
                      className="px-3 py-2 text-[12px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5 transition-all shrink-0"
                    >
                      {changingLawyer ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Salvar
                    </button>
                  </div>
                ) : (
                  <p className="text-[13px] font-semibold text-foreground">
                    {legalCase.lawyer?.name || <span className="text-muted-foreground italic text-sm">Não atribuído</span>}
                  </p>
                )}
                {lawyerError && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertTriangle size={11} /> {lawyerError}
                  </p>
                )}
              </div>

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
                    {/* Fallback: se legal_area tem valor fora da lista (ex: 'Bancário'),
                        preserva como opcao extra pra nao perder ao salvar. */}
                    {legalArea && !LEGAL_AREAS.includes(legalArea) && (
                      <option value={legalArea}>{legalArea} (atual)</option>
                    )}
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
                isAdmin && (
                  <button onClick={handleUnarchive} className="w-full py-2 text-sm text-blue-500 hover:text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors flex items-center justify-center gap-2">
                    <ArchiveRestore size={14} /> Reativar Processo
                  </button>
                )
              ) : legalCase.tracking_stage === 'ENCERRADO' ? (
                isAdmin ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                      <p className="text-[11px] text-amber-500 font-semibold">Processo aguardando arquivamento</p>
                    </div>
                    <button
                      onClick={() => setShowArchive(!showArchive)}
                      className="w-full py-2 text-sm text-amber-500 hover:text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors flex items-center justify-center gap-2"
                    >
                      <Archive size={14} /> Arquivar Processo
                    </button>
                    {showArchive && (
                      <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-3">
                        <div className="flex items-center gap-2 text-amber-500 text-[12px] font-bold">
                          <AlertTriangle size={14} /> Confirmar arquivamento
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
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              try {
                                await api.patch(`/legal-cases/${legalCase.id}/tracking-stage`, { trackingStage: 'TRANSITADO' });
                                onRefresh();
                                setShowArchive(false);
                              } catch {}
                            }}
                            className="flex-1 py-2 text-sm font-semibold border border-border rounded-lg hover:bg-accent transition-colors text-muted-foreground"
                          >
                            Reativar
                          </button>
                          <button
                            onClick={handleArchive}
                            disabled={archiving}
                            className="flex-1 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                            Arquivar
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Clock size={13} className="text-amber-500 shrink-0" />
                    <div>
                      <p className="text-[11px] text-amber-500 font-semibold">Aguardando revisão do administrador</p>
                      <p className="text-[10px] text-muted-foreground">Solicitação de encerramento enviada</p>
                    </div>
                  </div>
                )
              ) : (
                !isAdmin ? (
                  <button
                    onClick={async () => {
                      try {
                        await api.patch(`/legal-cases/${legalCase.id}/tracking-stage`, { trackingStage: 'ENCERRADO' });
                        onRefresh();
                      } catch {}
                    }}
                    className="w-full py-2 text-sm text-muted-foreground hover:text-amber-400 border border-border rounded-lg hover:border-amber-500/30 hover:bg-amber-500/5 transition-colors flex items-center justify-center gap-2"
                  >
                    <Archive size={14} /> Solicitar Encerramento
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
                )
              )}
            </div>
          )}

          {/* ─── TIMELINE TAB ─── */}
          {activeTab === 'timeline' && (
            <ProcessoTimeline
              legalCase={legalCase}
              tasks={tasks}
              events={events}
              djenPubs={djenPubs}
              onRefresh={fetchEvents}
            />
          )}

          {/* ─── HONORÁRIOS TAB ─── */}
          {activeTab === 'honorarios' && (
            <div className="py-2">
              <TabHonorarios caseId={legalCase.id} />
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
                  {djenPubs.map(pub => {
                    const analysis = djenAnalyses[pub.id];
                    const isAnalyzing = analyzingDjen === pub.id;
                    const isExpanded = expandedDjen === pub.id;
                    const URGENCIA_CFG = {
                      URGENTE: { bg: 'bg-red-500/10', text: 'text-red-400', Icon: AlertCircle },
                      NORMAL:  { bg: 'bg-amber-500/10', text: 'text-amber-400', Icon: Clock },
                      BAIXA:   { bg: 'bg-gray-500/10', text: 'text-gray-400', Icon: CheckCircle2 },
                    };
                    return (
                      <div key={pub.id} className="border border-border rounded-xl overflow-hidden">
                        {/* Header row */}
                        <div className="p-3 flex items-start gap-2">
                          <button
                            className="mt-0.5 shrink-0"
                            onClick={() => setExpandedDjen(isExpanded ? null : pub.id)}
                          >
                            <ChevronRight
                              size={14}
                              className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            />
                          </button>
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => setExpandedDjen(isExpanded ? null : pub.id)}
                          >
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {pub.tipo_comunicacao && (
                                <span className="px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[9px] font-bold border border-blue-500/20">
                                  {pub.tipo_comunicacao}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <Calendar size={9} /> {formatDate(pub.data_disponibilizacao)}
                              </span>
                              {analysis && (() => {
                                const cfg = URGENCIA_CFG[analysis.urgencia];
                                return (
                                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5 ${cfg.bg} ${cfg.text}`}>
                                    <cfg.Icon size={8} /> {analysis.urgencia}
                                  </span>
                                );
                              })()}
                            </div>
                            {pub.assunto && (
                              <p className="text-[12px] font-semibold text-foreground line-clamp-1">{pub.assunto}</p>
                            )}
                            {pub.classe_processual && (
                              <p className="text-[11px] text-muted-foreground truncate">{pub.classe_processual}</p>
                            )}
                          </div>
                          {/* Botão IA — bloqueado se não há processo vinculado */}
                          <button
                            onClick={async () => {
                              if (!pub.legal_case_id) return;
                              if (analysis || isAnalyzing) {
                                setExpandedDjen(isExpanded ? null : pub.id);
                                return;
                              }
                              setAnalyzingDjen(pub.id);
                              setExpandedDjen(pub.id);
                              try {
                                const res = await api.post(`/djen/${pub.id}/analyze`);
                                setDjenAnalyses(prev => ({ ...prev, [pub.id]: res.data }));
                              } catch {} finally { setAnalyzingDjen(null); }
                            }}
                            disabled={!pub.legal_case_id}
                            className={`shrink-0 flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
                              !pub.legal_case_id
                                ? 'opacity-40 cursor-not-allowed border-border text-muted-foreground'
                                : analysis
                                ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                                : 'text-violet-400 border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10'
                            }`}
                            title={!pub.legal_case_id ? 'Vincule ao processo antes de analisar' : 'Analisar com IA'}
                          >
                            {isAnalyzing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                            IA
                          </button>
                        </div>

                        {/* Conteúdo expandido */}
                        {isExpanded && (
                          <div className="border-t border-border bg-accent/10 p-3 space-y-3">
                            {/* Texto bruto */}
                            <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">
                              {pub.conteudo}
                            </p>

                            {/* Análise IA */}
                            {isAnalyzing && (
                              <div className="flex items-center gap-2 text-[11px] text-violet-400 animate-pulse">
                                <Loader2 size={12} className="animate-spin" /> Analisando com IA…
                              </div>
                            )}
                            {analysis && (
                              <div className="space-y-2 border-t border-border/50 pt-3">
                                <div className="flex items-center gap-1 text-[10px] font-bold text-violet-400 uppercase tracking-wider">
                                  <Sparkles size={10} /> Análise IA
                                </div>
                                <p className="text-[11px] text-foreground/90 leading-relaxed">{analysis.resumo}</p>
                                <div className="flex flex-wrap gap-2">
                                  {analysis.tipo_acao && (
                                    <span className="text-[10px] bg-card border border-border px-2 py-0.5 rounded-full text-foreground/70">
                                      {analysis.tipo_acao}
                                    </span>
                                  )}
                                  {analysis.prazo_dias > 0 && (
                                    <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full text-amber-400 flex items-center gap-0.5">
                                      <Clock size={9} /> Prazo: {analysis.prazo_dias}d
                                    </span>
                                  )}
                                </div>
                                {analysis.orientacoes && (
                                  <div className="bg-card border border-border rounded-lg p-2.5">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Orientações</p>
                                    <p className="text-[11px] text-foreground/80 leading-relaxed">{analysis.orientacoes}</p>
                                  </div>
                                )}
                                {/* Evento sugerido — com preview antes de criar */}
                                {analysis.tarefa_titulo && !djenTaskCreated[pub.id] && (() => {
                                  const preview = djenEventPreview[pub.id];
                                  const eventTypeLabels: Record<string, string> = { AUDIENCIA: '⚖️ Audiência', PERICIA: '🔬 Perícia', PRAZO: '🕐 Prazo', TAREFA: '✅ Tarefa' };
                                  // Calcula data/hora sugerida pela IA
                                  // IMPORTANTE: extraímos data e hora diretamente da string ISO da IA,
                                  // sem criar objetos Date — assim evitamos conversão de fuso (UTC-3 do browser).
                                  const pad = (n: number) => String(n).padStart(2, '0');
                                  const isoFromAi = (() => {
                                    if ((analysis.event_type === 'AUDIENCIA' || analysis.event_type === 'PERICIA') && analysis.data_audiencia) return analysis.data_audiencia;
                                    if (analysis.event_type === 'PRAZO' && analysis.data_prazo) return analysis.data_prazo;
                                    return null;
                                  })();
                                  const defaultDate = (() => {
                                    if (isoFromAi) return isoFromAi.slice(0, 10); // "YYYY-MM-DD"
                                    // Perícia sem data explícita: deixa em branco para o usuário preencher
                                    if (analysis.event_type === 'PERICIA') return '';
                                    // fallback: data da publicação + prazo_dias úteis (usa UTC pois pub.data_disponibilizacao é ISO)
                                    const base = new Date(pub.data_disponibilizacao);
                                    let days = analysis.prazo_dias > 0 ? analysis.prazo_dias : 0;
                                    while (days > 0) { base.setUTCDate(base.getUTCDate() + 1); if (base.getUTCDay() !== 0 && base.getUTCDay() !== 6) days--; }
                                    return `${base.getUTCFullYear()}-${pad(base.getUTCMonth()+1)}-${pad(base.getUTCDate())}`;
                                  })();
                                  const defaultTime = isoFromAi ? isoFromAi.slice(11, 16) || '07:00' : '07:00';
                                  const defaultPriority = analysis.urgencia === 'URGENTE' ? 'ALTA' : analysis.urgencia === 'BAIXA' ? 'BAIXA' : 'NORMAL';
                                  return (
                                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                                          {eventTypeLabels[analysis.event_type] || '✅ Tarefa'} sugerida
                                        </p>
                                        {!preview && (
                                          <button
                                            onClick={() => setDjenEventPreview(prev => ({ ...prev, [pub.id]: {
                                              type: analysis.event_type || 'TAREFA',
                                              title: analysis.tarefa_titulo,
                                              date: defaultDate,
                                              time: defaultTime,
                                              description: analysis.tarefa_descricao || '',
                                              priority: defaultPriority,
                                            }}))}
                                            className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 underline"
                                          >
                                            Revisar e criar
                                          </button>
                                        )}
                                      </div>
                                      <p className="text-[11px] font-semibold text-foreground">{analysis.tarefa_titulo}</p>
                                      {analysis.tarefa_descricao && !preview && (
                                        <p className="text-[10px] text-muted-foreground">{analysis.tarefa_descricao}</p>
                                      )}

                                      {/* Preview editável */}
                                      {preview && (
                                        <div className="space-y-2 border-t border-emerald-500/20 pt-2">
                                          <p className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-wider">Confirme antes de criar</p>
                                          {/* Tipo */}
                                          <div>
                                            <label className="text-[10px] text-muted-foreground mb-0.5 block">Tipo</label>
                                            <select
                                              value={preview.type}
                                              onChange={e => setDjenEventPreview(prev => ({ ...prev, [pub.id]: { ...prev[pub.id], type: e.target.value } }))}
                                              className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground outline-none"
                                            >
                                              <option value="AUDIENCIA">⚖️ Audiência</option>
                                              <option value="PERICIA">🔬 Perícia</option>
                                              <option value="PRAZO">🕐 Prazo</option>
                                              <option value="TAREFA">✅ Tarefa</option>
                                              <option value="OUTRO">📌 Outro</option>
                                            </select>
                                          </div>
                                          {/* Título */}
                                          <div>
                                            <label className="text-[10px] text-muted-foreground mb-0.5 block">Título</label>
                                            <input
                                              value={preview.title}
                                              onChange={e => setDjenEventPreview(prev => ({ ...prev, [pub.id]: { ...prev[pub.id], title: e.target.value } }))}
                                              className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground outline-none"
                                            />
                                          </div>
                                          {/* Data e hora */}
                                          <div className="flex gap-2">
                                            <div className="flex-1">
                                              <label className="text-[10px] text-muted-foreground mb-0.5 block">Data</label>
                                              <input
                                                type="date"
                                                value={preview.date}
                                                onChange={e => setDjenEventPreview(prev => ({ ...prev, [pub.id]: { ...prev[pub.id], date: e.target.value } }))}
                                                className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground outline-none"
                                              />
                                            </div>
                                            <div className="w-24">
                                              <label className="text-[10px] text-muted-foreground mb-0.5 block">Hora</label>
                                              <input
                                                type="time"
                                                value={preview.time}
                                                onChange={e => setDjenEventPreview(prev => ({ ...prev, [pub.id]: { ...prev[pub.id], time: e.target.value } }))}
                                                className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground outline-none"
                                              />
                                            </div>
                                          </div>
                                          {/* Botões */}
                                          <div className="flex gap-2 pt-1">
                                            <button
                                              onClick={() => setDjenEventPreview(prev => { const n = { ...prev }; delete n[pub.id]; return n; })}
                                              className="flex-1 py-1.5 text-xs font-semibold border border-border rounded-lg text-muted-foreground hover:bg-accent transition-colors"
                                            >
                                              Cancelar
                                            </button>
                                            <button
                                              disabled={!preview.title || !preview.date || creatingDjenTask === pub.id}
                                              onClick={async () => {
                                                setCreatingDjenTask(pub.id);
                                                try {
                                                  const [y, m, d] = preview.date.split('-').map(Number);
                                                  const [h, mi] = preview.time.split(':').map(Number);
                                                  const start = new Date(Date.UTC(y, m-1, d, h, mi, 0));
                                                  const dur = preview.type === 'AUDIENCIA' ? 60 : preview.type === 'PERICIA' ? 120 : 30;
                                                  await api.post('/calendar/events', {
                                                    type: preview.type,
                                                    title: preview.title,
                                                    description: preview.description || undefined,
                                                    legal_case_id: legalCase.id,
                                                    lead_id: legalCase.lead?.id || undefined,
                                                    start_at: start.toISOString(),
                                                    end_at: new Date(start.getTime() + dur * 60000).toISOString(),
                                                    priority: preview.priority,
                                                  });
                                                  setDjenTaskCreated(prev => ({ ...prev, [pub.id]: true }));
                                                  setDjenEventPreview(prev => { const n = { ...prev }; delete n[pub.id]; return n; });
                                                  fetchTasks();
                                                } catch {} finally { setCreatingDjenTask(null); }
                                              }}
                                              className="flex-1 py-1.5 text-xs font-semibold bg-emerald-500/80 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                                            >
                                              {creatingDjenTask === pub.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                              Confirmar
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                {djenTaskCreated[pub.id] && (
                                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold">
                                    <CheckCircle2 size={13} /> Evento criado no calendário
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Eventos</h3>
                <button onClick={() => setShowEventModal(true)} className="text-[11px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1">
                  <Plus size={12} /> Novo Evento
                </button>
              </div>

              {showEventModal && (
                <EventModal
                  caseId={legalCase.id}
                  leadId={legalCase.lead_id}
                  lawyerId={legalCase.lawyer_id}
                  users={allUsers}
                  interns={interns}
                  onClose={() => setShowEventModal(false)}
                  onCreated={fetchTasks}
                />
              )}

              {loadingTasks ? (
                <div className="text-center py-8 text-muted-foreground text-sm animate-pulse">Carregando eventos…</div>
              ) : tasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[12px]">Nenhum evento criado</div>
              ) : (
                tasks.map(task => {
                  const statusInfo = TASK_STATUSES.find(s => s.id === task.status) ?? TASK_STATUSES[0];
                  const isExpanded = expandedTask === task.id;

                  const isEditing = editingTask === task.id;

                  return (
                    <div key={task.id} className="border border-border rounded-xl overflow-hidden">
                      {/* ── Linha principal da tarefa ── */}
                      <div
                        className="p-3 flex items-start gap-3 cursor-pointer hover:bg-accent/30 transition-colors"
                        onClick={() => !isEditing && toggleTaskExpand(task.id)}
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
                        {/* Status select + botão editar */}
                        <div className="flex flex-col items-end gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <select
                            value={task.status}
                            onChange={e => handleTaskStatusChange(task.id, e.target.value)}
                            className="text-[10px] font-bold px-2 py-1 rounded-full border-0 focus:outline-none cursor-pointer"
                            style={{ backgroundColor: `${statusInfo.color}20`, color: statusInfo.color }}
                          >
                            {TASK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                          <button
                            onClick={() => isEditing ? setEditingTask(null) : openEditTask(task)}
                            className="text-[9px] font-semibold text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors"
                          >
                            <Pencil size={9} /> {isEditing ? 'Fechar' : 'Editar'}
                          </button>
                        </div>
                      </div>

                      {/* ── Formulário de edição inline ── */}
                      {isEditing && (
                        <div className="border-t border-border bg-accent/10 p-3 space-y-2">
                          <input
                            type="text"
                            value={editTaskForm.title}
                            onChange={e => setEditTaskForm(f => ({ ...f, title: e.target.value }))}
                            className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
                            placeholder="Título"
                          />
                          <textarea
                            value={editTaskForm.description}
                            onChange={e => setEditTaskForm(f => ({ ...f, description: e.target.value }))}
                            rows={2}
                            className="w-full px-3 py-2 text-[12px] bg-card border border-border rounded-lg focus:outline-none resize-none"
                            placeholder="Descrição (opcional)"
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <select
                              value={editTaskForm.assignee}
                              onChange={e => setEditTaskForm(f => ({ ...f, assignee: e.target.value }))}
                              className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                            >
                              <option value="">Atribuir a...</option>
                              {interns.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                            </select>
                            <input
                              type="date"
                              value={editTaskForm.date}
                              onChange={e => setEditTaskForm(f => ({ ...f, date: e.target.value }))}
                              className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                            />
                            <input
                              type="time"
                              value={editTaskForm.time}
                              onChange={e => setEditTaskForm(f => ({ ...f, time: e.target.value }))}
                              className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSaveTaskEdit(task.id)}
                              disabled={!editTaskForm.title.trim() || savingTask}
                              className="flex-1 py-1.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40"
                            >
                              {savingTask ? 'Salvando…' : 'Salvar'}
                            </button>
                            <button
                              onClick={() => setEditingTask(null)}
                              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => handleDeleteTask(task.id)}
                              className="px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                              title="Remover tarefa"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )}

                      {isExpanded && !isEditing && (
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
  prefillData,
  batchProgress,
}: {
  onClose: () => void;
  onSuccess: () => void;
  prefillData?: {
    case_number?: string;
    legal_area?: string;
    action_type?: string;
    author?: string;          // nome(s) do(s) autor(es) no processo
    opposing_party?: string;  // nome(s) do(s) reu(s) no processo
    court?: string;
    judge?: string;
    claim_value?: number | null;
    filed_at?: string | null;
    tracking_stage?: string;
    notes?: string;
  } | null;
  batchProgress?: { current: number; total: number } | null;
}) {
  const { isAdmin } = useRole();

  // ── Advogado e Atendente (ADMIN only) ────────────────────────
  const [lawyers, setLawyers] = useState<{ id: string; name: string | null }[]>([]);
  const [operators, setOperators] = useState<{ id: string; name: string | null }[]>([]);
  const [selectedLawyerId, setSelectedLawyerId] = useState('');
  const [selectedOperatorId, setSelectedOperatorId] = useState('');

  useEffect(() => {
    // Advogados: ADMIN pode escolher qualquer um
    if (isAdmin) {
      api.get('/users/lawyers').then(res => setLawyers(res.data || [])).catch(() => {});
    }
    // Atendentes: todos os usuários podem selecionar (inclusive ADVOGADO)
    api.get('/users?limit=100').then(res => {
      const users = res.data?.data || res.data?.users || res.data || [];
      setOperators(users.filter((u: any) => u.id && u.name));
    }).catch(() => {});
  }, [isAdmin]);

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
  const [phoneCheckResult, setPhoneCheckResult] = useState<{
    exists: boolean;
    lead?: { id: string; name: string | null; phone: string; stage?: string; is_client?: boolean };
    inactive?: boolean;
    inactiveReason?: string | null;
  } | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const phoneCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkPhoneExists = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) { setPhoneCheckResult(null); return; }
    if (phoneCheckTimer.current) clearTimeout(phoneCheckTimer.current);
    phoneCheckTimer.current = setTimeout(async () => {
      setCheckingPhone(true);
      try {
        const res = await api.get('/leads/check-phone', { params: { phone: digits } });
        setPhoneCheckResult(res.data);
      } catch { setPhoneCheckResult(null); }
      finally { setCheckingPhone(false); }
    }, 500);
  };

  // ── Processo ──────────────────────────────────────────────────
  const [caseNumber, setCaseNumber] = useState(prefillData?.case_number || '');
  // Normaliza ('CIVIL' -> 'Cível') pra bater com opcoes do select
  const [legalArea, setLegalArea] = useState(normalizeLegalArea(prefillData?.legal_area));
  const [actionType, setActionType] = useState(prefillData?.action_type || '');
  // author e opposingParty representam SEMPRE os lados do processo
  // (autor no polo ativo, reu no polo passivo). Quem e o cliente do
  // escritorio e definido pela flag clientIsAuthor — o handleSubmit faz
  // o swap para preencher legalCase.opposing_party corretamente.
  const [author, setAuthor] = useState(prefillData?.author || '');
  const [opposingParty, setOpposingParty] = useState(prefillData?.opposing_party || '');
  const [clientIsAuthor, setClientIsAuthor] = useState(true);
  const [court, setCourt] = useState(prefillData?.court || '');
  const [judge, setJudge] = useState(prefillData?.judge || '');
  const [claimValue, setClaimValue] = useState(prefillData?.claim_value ? String(prefillData.claim_value) : '');
  const [trackingStage, setTrackingStage] = useState(prefillData?.tracking_stage || 'DISTRIBUIDO');
  const [priority, setPriority] = useState('NORMAL');
  const [notes, setNotes] = useState(prefillData?.notes || '');
  const [filedAt, setFiledAt] = useState(prefillData?.filed_at || '');

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

  // Pre-preenche a busca/criacao de cliente com o nome da parte selecionada
  // pelo toggle "escritorio representa Autor/Reu". Roda no mount (quando o
  // prefillData chega do scraper) e cada vez que o usuario alterna.
  // Deps intencionalmente so com clientIsAuthor: nao queremos re-fire quando
  // o usuario edita o nome nos campos de Autor/Reu manualmente.
  useEffect(() => {
    const partyName = clientIsAuthor ? author : opposingParty;
    if (!partyName) return;
    setLeadSearch(partyName);
    setNewLeadName(partyName);
    setSelectedLead(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIsAuthor]);

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
    if (leadMode === 'new' && phoneCheckResult?.exists) { setError('Este telefone já está cadastrado. Clique em "Usar este contato" para vincular ao cliente existente.'); return; }

    setSaving(true);
    setError('');
    try {
      // Quem e o "outro lado" depende de quem o escritorio representa:
      // - representa autor -> opposing_party = reu
      // - representa reu   -> opposing_party = autor
      const opposingPartyForApi = clientIsAuthor ? opposingParty : author;

      await api.post('/legal-cases/direct', {
        case_number: caseNumber.trim(),
        legal_area: legalArea || undefined,
        action_type: actionType || undefined,
        opposing_party: opposingPartyForApi || undefined,
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
        // Advogado: apenas ADMIN pode substituir (demais usam o próprio user via req.user.id)
        lawyer_id: isAdmin && selectedLawyerId ? selectedLawyerId : undefined,
        // Atendente: qualquer usuário pode indicar o responsável pelo atendimento no chat
        assigned_user_id: selectedOperatorId || undefined,
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
            <h2 className="text-base font-bold text-foreground">
              {batchProgress ? `Cadastrar Processo ${batchProgress.current} de ${batchProgress.total}` : 'Cadastrar Processo em Andamento'}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {batchProgress ? 'Importação em lote via OAB — preencha os dados e salve' : 'Para processos que já existem no tribunal'}
            </p>
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
                <User size={11} /> Cliente / {clientIsAuthor ? 'Parte Autora' : 'Parte Ré'}
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
                      onChange={e => { setNewLeadPhone(e.target.value); checkPhoneExists(e.target.value); }}
                      className={`${inputCls} ${phoneCheckResult?.exists ? 'border-amber-500 ring-1 ring-amber-500/30' : ''}`}
                      placeholder="(00) 00000-0000"
                      autoFocus
                    />
                    {checkingPhone && <p className="text-[10px] text-muted-foreground mt-1">Verificando...</p>}
                    {phoneCheckResult?.exists && phoneCheckResult.lead && (
                      <div className="mt-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
                        <p className="text-[11px] text-amber-400 font-bold">⚠️ Este telefone já está cadastrado!</p>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-[10px] font-bold">
                            {phoneCheckResult.lead.name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-foreground">{phoneCheckResult.lead.name || 'Sem nome'}</p>
                            <p className="text-[10px] text-muted-foreground">{phoneCheckResult.lead.phone}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setLeadMode('existing');
                            setSelectedLead(phoneCheckResult.lead || null);
                            setNewLeadPhone('');
                            setPhoneCheckResult(null);
                          }}
                          className="w-full px-3 py-2 text-[11px] font-bold text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
                        >
                          Usar este contato
                        </button>
                      </div>
                    )}
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

          {/* ── Seção: Responsáveis (Advogado: ADMIN; Atendente: todos) ─── */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-4">
            {/* Advogado — apenas ADMIN pode escolher */}
            {isAdmin && lawyers.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  👨‍⚖️ Advogado Responsável
                </p>
                <select
                  value={selectedLawyerId}
                  onChange={e => setSelectedLawyerId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Atribuir a mim (padrão)</option>
                  {lawyers.map(l => (
                    <option key={l.id} value={l.id}>{l.name || l.id}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Se não selecionado, o processo será atribuído ao usuário logado.
                </p>
              </div>
            )}

            {/* Atendente — disponível para todos os perfis */}
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                👤 Atendente Responsável
              </p>
              <select
                value={selectedOperatorId}
                onChange={e => setSelectedOperatorId(e.target.value)}
                className={inputCls}
              >
                <option value="">Atribuir automaticamente</option>
                {operators.map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.id}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Usuário responsável pelo atendimento no chat. Se não selecionado, será definido automaticamente.
              </p>
            </div>
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

            {/* Partes do Processo + toggle de quem o escritorio representa */}
            <div className="rounded-xl border border-border bg-accent/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Scale size={11} /> Partes do Processo
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Escritório representa:</span>
                  <div className="flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setClientIsAuthor(true)}
                      className={`px-3 py-1 transition-colors ${clientIsAuthor ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                    >
                      Autor
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientIsAuthor(false)}
                      className={`px-3 py-1 transition-colors ${!clientIsAuthor ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                    >
                      Réu
                    </button>
                  </div>
                </div>
              </div>

              {/* Campo: Autor */}
              <div>
                <label className={`${labelCls} flex items-center gap-1.5`}>
                  <User size={11} /> Autor
                  {clientIsAuthor && (
                    <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[9px] font-bold uppercase tracking-wider">
                      Cliente
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  className={`${inputCls} ${clientIsAuthor ? 'border-primary/40 bg-primary/5' : ''}`}
                  placeholder="Nome do autor / requerente / reclamante"
                />
              </div>

              {/* Campo: Réu */}
              <div>
                <label className={`${labelCls} flex items-center gap-1.5`}>
                  <Scale size={11} /> Réu
                  {!clientIsAuthor && (
                    <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[9px] font-bold uppercase tracking-wider">
                      Cliente
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={opposingParty}
                  onChange={e => setOpposingParty(e.target.value)}
                  className={`${inputCls} ${!clientIsAuthor ? 'border-primary/40 bg-primary/5' : ''}`}
                  placeholder="Nome do réu / requerido / reclamado"
                />
              </div>
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

// ─── FilterChip (chip de filtro ativo removível) ──────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary">
      {label}
      <button
        onClick={onRemove}
        className="opacity-70 hover:opacity-100 hover:text-destructive"
        aria-label={`Remover filtro ${label}`}
      >
        <X size={10} />
      </button>
    </span>
  );
}

// ─── Tabela View ───────────────────────────────────────────────

// SortField e SortDir importados de ./components/processosStorage

interface TabelaViewProps {
  cases: LegalCase[];
  onSelect: (c: LegalCase) => void;
  columns: TableColumnsState;
  onToggleColumn: (key: keyof TableColumnsState) => void;
  sort: SortState;
  onSortChange: (field: SortField) => void;
}

function TabelaView({ cases, onSelect, columns, onToggleColumn, sort, onSortChange }: TabelaViewProps) {
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const PRIORITY_ORDER = { URGENTE: 0, NORMAL: 1, BAIXA: 2 };

  const nextDeadline = (c: LegalCase): number => {
    const now = Date.now();
    const future = (c.calendar_events || [])
      .map(e => new Date(e.start_at).getTime())
      .filter(t => t >= now)
      .sort((a, b) => a - b);
    return future[0] ?? Number.MAX_SAFE_INTEGER;
  };

  const sorted = [...cases].sort((a, b) => {
    let cmp = 0;
    const f = sort.field;
    if (f === 'lead') cmp = (a.lead?.name || '').localeCompare(b.lead?.name || '');
    else if (f === 'area') cmp = (a.legal_area || '').localeCompare(b.legal_area || '');
    else if (f === 'stage') cmp = (a.tracking_stage || '').localeCompare(b.tracking_stage || '');
    else if (f === 'priority') cmp = (PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] ?? 1) - (PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER] ?? 1);
    else if (f === 'days') cmp = daysInStage(b.stage_changed_at) - daysInStage(a.stage_changed_at);
    else if (f === 'updated') cmp = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    else if (f === 'claim_value') cmp = (Number(a.claim_value) || 0) - (Number(b.claim_value) || 0);
    else if (f === 'next_deadline') cmp = nextDeadline(a) - nextDeadline(b);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const SortableTh = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => onSortChange(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        <ArrowUpDown size={9} className={sort.field === field ? 'text-primary' : 'opacity-30'} />
      </span>
    </th>
  );

  const StaticTh = ({ children }: { children: React.ReactNode }) => (
    <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );

  const visibleColsCount = Object.values(columns).filter(Boolean).length;

  const fmtMoney = (v: any) => {
    const n = Number(v);
    if (!n || Number.isNaN(n)) return '—';
    return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const fmtNextDeadline = (c: LegalCase): React.ReactNode => {
    const now = Date.now();
    const future = (c.calendar_events || [])
      .map(e => ({ t: new Date(e.start_at).getTime(), e }))
      .filter(x => x.t >= now)
      .sort((a, b) => a.t - b.t);
    if (future.length === 0) return <span className="text-[11px] text-muted-foreground">—</span>;
    const d = new Date(future[0].t);
    const daysLeft = Math.ceil((future[0].t - now) / (24 * 60 * 60 * 1000));
    const cls = daysLeft <= 3 ? 'text-red-400' : daysLeft <= 7 ? 'text-amber-400' : 'text-emerald-400';
    return (
      <span className={`text-[11px] font-semibold ${cls}`}>
        {d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
        <span className="opacity-70 ml-1">({daysLeft}d)</span>
      </span>
    );
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Toolbar: column picker */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-muted-foreground">
          {sorted.length} processo{sorted.length !== 1 ? 's' : ''}
        </p>
        <div className="relative">
          <button
            onClick={() => setShowColumnPicker(v => !v)}
            className="text-[11px] font-semibold flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Colunas visíveis"
          >
            <Columns3 size={13} /> Colunas
          </button>
          {showColumnPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowColumnPicker(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-20 overflow-hidden">
                <div className="px-3 py-2 border-b border-border text-[10px] font-bold text-muted-foreground uppercase">
                  Colunas visíveis
                </div>
                <div className="max-h-80 overflow-y-auto py-1">
                  {(Object.keys(COLUMN_LABELS) as Array<keyof TableColumnsState>).map(key => (
                    <label
                      key={key}
                      className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-accent/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={columns[key]}
                        onChange={() => onToggleColumn(key)}
                        className="accent-primary"
                      />
                      <span className="text-foreground">{COLUMN_LABELS[key]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            {columns.priority && <SortableTh field="priority">Prior.</SortableTh>}
            {columns.lead && <SortableTh field="lead">Cliente</SortableTh>}
            {columns.case_number && <StaticTh>Nº Processo</StaticTh>}
            {columns.area && <SortableTh field="area">Área</SortableTh>}
            {columns.court && <StaticTh>Vara</StaticTh>}
            {columns.lawyer && <StaticTh>Advogado</StaticTh>}
            {columns.stage && <SortableTh field="stage">Etapa</SortableTh>}
            {columns.days && <SortableTh field="days">Dias</SortableTh>}
            {columns.tasks && <StaticTh>Tarefas</StaticTh>}
            {columns.djen && <StaticTh>DJEN</StaticTh>}
            {columns.updated && <SortableTh field="updated">Atualizado</SortableTh>}
            {columns.claim_value && <SortableTh field="claim_value">Valor</SortableTh>}
            {columns.next_deadline && <SortableTh field="next_deadline">Próx. prazo</SortableTh>}
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
                {columns.priority && (
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${pCfg.badgeClass}`}>
                      {c.priority}
                    </span>
                  </td>
                )}
                {columns.lead && (
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-[13px] text-foreground truncate max-w-[150px]">
                      {c.lead?.name || '—'}
                    </div>
                    {c.opposing_party && (
                      <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">vs. {c.opposing_party}</div>
                    )}
                  </td>
                )}
                {columns.case_number && (
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{formatCNJ(c.case_number) === 'Sem número' ? '—' : formatCNJ(c.case_number)}</span>
                  </td>
                )}
                {columns.area && (
                  <td className="px-3 py-2.5">
                    {c.legal_area ? (
                      <span className="text-[11px] text-violet-400">{c.legal_area}</span>
                    ) : '—'}
                  </td>
                )}
                {columns.court && (
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground truncate max-w-[100px] block">{c.court || '—'}</span>
                  </td>
                )}
                {columns.lawyer && (
                  <td className="px-3 py-2.5">
                    {c.lawyer?.name ? (
                      <span className="text-[11px] text-emerald-400 font-semibold truncate max-w-[120px] block" title={c.lawyer.name}>
                        {c.lawyer.name}
                      </span>
                    ) : <span className="text-[11px] text-muted-foreground">—</span>}
                  </td>
                )}
                {columns.stage && (
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] font-semibold" style={{ color: stageInfo.color }}>
                      {stageInfo.emoji} {stageInfo.label}
                    </span>
                  </td>
                )}
                {columns.days && (
                  <td className="px-3 py-2.5">
                    <span className={`text-[12px] font-semibold ${days > 30 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                      {days}d
                    </span>
                  </td>
                )}
                {columns.tasks && (
                  <td className="px-3 py-2.5">
                    <span className="text-[12px] text-muted-foreground">{c._count?.tasks ?? 0}</span>
                  </td>
                )}
                {columns.djen && (
                  <td className="px-3 py-2.5">
                    {djenCount > 0 ? (
                      <span className="text-[12px] text-amber-400 font-semibold flex items-center gap-0.5">
                        <Bell size={10} /> {djenCount}
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {columns.updated && (
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">{timeAgo(c.updated_at)}</span>
                  </td>
                )}
                {columns.claim_value && (
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-foreground font-semibold">{fmtMoney(c.claim_value)}</span>
                  </td>
                )}
                {columns.next_deadline && (
                  <td className="px-3 py-2.5">{fmtNextDeadline(c)}</td>
                )}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={visibleColsCount} className="text-center py-12 text-muted-foreground text-sm">
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

// ─── OAB Import Modal ──────────────────────────────────────────

// Cache em sessionStorage: persiste resultados da busca OAB + processos ja
// cadastrados, pra nao forcar nova busca toda vez que o usuario cadastra
// 1 processo dos 100+ retornados. TTL 1h — depois disso, vale re-buscar.
const OAB_IMPORT_CACHE_KEY = 'oab-import-cache-v2';
const OAB_IMPORT_CACHE_TTL_MS = 3600_000; // 1h

function loadOabCache(): {
  oabs: string[];
  results: any[];
  sentSet: string[];
  ts: number;
} | null {
  try {
    const raw = sessionStorage.getItem(OAB_IMPORT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > OAB_IMPORT_CACHE_TTL_MS) {
      sessionStorage.removeItem(OAB_IMPORT_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveOabCache(data: { oabs: string[]; results: any[]; sentSet: string[] }) {
  try {
    sessionStorage.setItem(OAB_IMPORT_CACHE_KEY, JSON.stringify({ ...data, ts: Date.now() }));
  } catch {
    // quota exceeded ou SSR — ignora
  }
}

function OabImportModal({ onClose, onStartCadastro }: {
  onClose: () => void;
  onStartCadastro: (items: Array<{ processo_codigo: string; foro: string; case_number: string }>) => void;
}) {
  const UF_LIST = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
  const [lawyers, setLawyers] = useState<Array<{ id: string; name: string; oab_number: string | null; oab_uf: string | null }>>([]);
  const [selectedOabs, setSelectedOabs] = useState<Set<string>>(new Set());
  const [customOab, setCustomOab] = useState('');
  const [customUf, setCustomUf] = useState('AL');
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedForImport, setSelectedForImport] = useState<Set<string>>(new Set());
  const [sendingToCadastro, setSendingToCadastro] = useState<string | null>(null);
  const [sentSet, setSentSet] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [restoredFromCache, setRestoredFromCache] = useState(false);

  useEffect(() => {
    api.get('/court-scraper/lawyers').then(r => {
      const data = r.data || [];
      setLawyers(data);
      // So setar OABs default se o cache nao restaurou
      const cached = loadOabCache();
      if (cached) {
        setSelectedOabs(new Set(cached.oabs));
        setResults(cached.results);
        setSentSet(new Set(cached.sentSet));
        const toSelect = new Set<string>(
          cached.results
            .filter((c: any) => !c.already_registered && !cached.sentSet.includes(c.processo_codigo) && c.processo_codigo)
            .map((c: any) => c.processo_codigo as string),
        );
        setSelectedForImport(toSelect);
        setRestoredFromCache(true);
      } else {
        const oabs = new Set<string>(data.filter((l: any) => l.oab_number).map((l: any) => l.oab_number as string));
        setSelectedOabs(oabs);
      }
    }).catch(() => {});
  }, []);

  // Escuta evento global — quando pai cadastra um processo com sucesso,
  // risca visualmente e persiste no cache.
  useEffect(() => {
    const handler = (e: Event) => {
      const codigo = (e as CustomEvent).detail?.processo_codigo;
      if (!codigo) return;
      setSentSet(prev => {
        if (prev.has(codigo)) return prev;
        const n = new Set(prev);
        n.add(codigo);
        return n;
      });
      setSendingToCadastro(null);
    };
    window.addEventListener('oab-case-saved', handler);
    return () => window.removeEventListener('oab-case-saved', handler);
  }, []);

  // Persiste mudancas de results/sentSet no sessionStorage
  useEffect(() => {
    if (results.length === 0) return;
    saveOabCache({
      oabs: Array.from(selectedOabs),
      results,
      sentSet: Array.from(sentSet),
    });
  }, [results, sentSet, selectedOabs]);

  const toggleOab = (oab: string) => {
    setSelectedOabs(prev => { const n = new Set(prev); n.has(oab) ? n.delete(oab) : n.add(oab); return n; });
  };

  const handleSearch = async () => {
    // Montar lista de OABs com UF: "14209:AL,17697:AL"
    const oabEntries: string[] = [];
    for (const oab of selectedOabs) {
      const lawyer = lawyers.find(l => l.oab_number === oab);
      oabEntries.push(`${oab}:${lawyer?.oab_uf || 'AL'}`);
    }
    if (customOab.trim()) oabEntries.push(`${customOab.trim()}:${customUf}`);
    if (oabEntries.length === 0) { setError('Selecione ao menos uma OAB'); return; }

    setSearching(true);
    setSearchProgress('Conectando ao ESAJ/TJAL...');
    setError(null);
    setResults([]);
    setSelectedForImport(new Set());
    setSentSet(new Set());
    try {
      const res = await api.get('/court-scraper/search-oab', {
        params: { oabs: oabEntries.join(',') },
        timeout: 300000, // 5 min — pode demorar com muitas páginas
      });
      const cases = res.data?.cases || [];
      setResults(cases);
      const toSelect = new Set<string>(cases.filter((c: any) => !c.already_registered && c.processo_codigo).map((c: any) => c.processo_codigo as string));
      setSelectedForImport(toSelect);
      setSearchProgress('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao buscar processos no ESAJ. A busca pode demorar para OABs com muitos processos.');
    } finally {
      setSearching(false);
      setSearchProgress('');
    }
  };

  const handleStartBatchCadastro = () => {
    const items = results
      .filter(c => selectedForImport.has(c.processo_codigo) && !c.already_registered && !sentSet.has(c.processo_codigo))
      .map(c => ({ processo_codigo: c.processo_codigo, foro: c.foro || '1', case_number: c.case_number }));
    if (items.length === 0) { setError('Nenhum processo selecionado'); return; }
    onStartCadastro(items);
  };

  const handleStartOneCadastro = (c: any) => {
    if (!c.processo_codigo || c.already_registered || sentSet.has(c.processo_codigo)) return;
    setSendingToCadastro(c.processo_codigo);
    onStartCadastro([{ processo_codigo: c.processo_codigo, foro: c.foro || '1', case_number: c.case_number }]);
  };

  const toggleImport = (codigo: string) => {
    setSelectedForImport(prev => { const n = new Set(prev); n.has(codigo) ? n.delete(codigo) : n.add(codigo); return n; });
  };

  const notRegistered = results.filter(c => !c.already_registered && !sentSet.has(c.processo_codigo));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-base font-bold text-foreground">Importar Processos por OAB</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Busca TODAS as páginas do ESAJ/TJAL automaticamente</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent"><X size={16} /></button>
        </div>

        {restoredFromCache && results.length > 0 && (
          <div className="px-4 py-2 border-b border-border bg-emerald-500/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px]">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
              <span className="text-emerald-400 font-semibold">
                Busca anterior restaurada ({results.length} processos, {sentSet.size} já cadastrados)
              </span>
            </div>
            <button
              onClick={() => {
                sessionStorage.removeItem(OAB_IMPORT_CACHE_KEY);
                setResults([]);
                setSentSet(new Set());
                setSelectedForImport(new Set());
                setRestoredFromCache(false);
              }}
              className="text-[10px] font-semibold text-muted-foreground hover:text-foreground underline"
            >
              Limpar e buscar de novo
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Advogados com OAB */}
          <div>
            <label className="text-xs font-semibold text-foreground mb-2 block">Selecione os advogados:</label>
            {lawyers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nenhum advogado com OAB cadastrada. Cadastre na tela Configurações → Equipe.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {lawyers.map(l => (
                  <label key={l.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all text-[11px] ${
                    l.oab_number && selectedOabs.has(l.oab_number)
                      ? 'bg-primary/10 border-primary text-primary font-semibold'
                      : 'bg-accent/30 border-border text-muted-foreground'
                  }`}>
                    <input
                      type="checkbox"
                      checked={!!l.oab_number && selectedOabs.has(l.oab_number)}
                      onChange={() => l.oab_number && toggleOab(l.oab_number)}
                      disabled={!l.oab_number}
                      className="rounded"
                    />
                    {l.name} {l.oab_number ? `(OAB ${l.oab_number}/${l.oab_uf || 'AL'})` : '(sem OAB)'}
                  </label>
                ))}
              </div>
            )}

            {/* OAB avulsa com UF */}
            <div className="mt-2 flex items-center gap-2">
              <input
                value={customOab}
                onChange={e => setCustomOab(e.target.value.replace(/\D/g, ''))}
                placeholder="OAB avulsa..."
                className="px-3 py-1.5 text-[11px] bg-accent/50 border border-border rounded-lg w-28 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <select
                value={customUf}
                onChange={e => setCustomUf(e.target.value)}
                className="px-2 py-1.5 text-[11px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
              <button
                onClick={handleSearch}
                disabled={searching}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold bg-emerald-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                {searching ? 'Buscando todas as páginas...' : 'Buscar Processos'}
              </button>
            </div>
            {searchProgress && <p className="text-[10px] text-orange-500 mt-1 animate-pulse">{searchProgress}</p>}
          </div>

          {/* Erro */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" /> <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="shrink-0 p-0.5 hover:opacity-70"><X size={12} /></button>
            </div>
          )}

          {/* Processos enviados para cadastro */}
          {sentSet.size > 0 && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 rounded-lg text-xs">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={14} className="inline mr-1" />
                {sentSet.size} processo(s) enviado(s) para pré-cadastro!
              </p>
            </div>
          )}

          {/* Lista de processos */}
          {results.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-foreground">
                  {results.length} processo(s) encontrado(s)
                  {results.filter(c => c.already_registered).length > 0 && (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({results.filter(c => c.already_registered).length} já cadastrados)
                    </span>
                  )}
                  {sentSet.size > 0 && (
                    <span className="text-emerald-500 font-normal ml-1">
                      ({sentSet.size} enviado(s) para cadastro)
                    </span>
                  )}
                </label>
                <span className="text-[10px] text-muted-foreground">
                  {selectedForImport.size} selecionado(s)
                </span>
              </div>
              <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
                {results.map((c: any, i: number) => {
                  const isSent = sentSet.has(c.processo_codigo);
                  const isRegistered = c.already_registered || isSent;
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all text-[11px] ${
                        isRegistered
                          ? 'bg-accent/20 border-border/50 opacity-60'
                          : selectedForImport.has(c.processo_codigo)
                          ? 'bg-primary/5 border-primary/30'
                          : 'bg-card border-border'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedForImport.has(c.processo_codigo)}
                        onChange={() => toggleImport(c.processo_codigo)}
                        disabled={isRegistered || !c.processo_codigo}
                        className="rounded shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold">{c.case_number}</span>
                          {c.already_registered && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-500 font-bold">Já cadastrado</span>
                          )}
                          {isSent && !c.already_registered && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-bold flex items-center gap-0.5">
                              <CheckCircle2 size={10} /> Enviado para cadastro
                            </span>
                          )}
                        </div>
                        {(c.action_type || c.court) && (
                          <div className="text-muted-foreground truncate mt-0.5">
                            {c.action_type && <span>{c.action_type}</span>}
                            {c.court && <span> • {c.court}</span>}
                          </div>
                        )}
                        {c.found_by_lawyers?.length > 0 && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {c.found_by_lawyers.map((name: string, j: number) => (
                              <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/12 text-violet-500 font-bold">{name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Botão cadastrar individual */}
                      {!isRegistered && c.processo_codigo && (
                        <button
                          onClick={() => handleStartOneCadastro(c)}
                          disabled={sendingToCadastro === c.processo_codigo}
                          className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                          title="Abrir pré-cadastro"
                        >
                          {sendingToCadastro === c.processo_codigo ? <Loader2 size={11} className="animate-spin" /> : <FolderPlus size={11} />}
                          Cadastrar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && notRegistered.length > 0 && (
          <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
            <button onClick={onClose} className="px-4 py-1.5 text-[11px] font-semibold rounded-lg border border-border hover:bg-accent">
              Cancelar
            </button>
            <button
              onClick={handleStartBatchCadastro}
              disabled={selectedForImport.size === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              <FolderPlus size={12} />
              {`Cadastrar ${selectedForImport.size} processo(s) em lote`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────

function ProcessosPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // ─── Filtros unificados ────────────────────────────────
  const [filters, setFilters] = useState<ProcessosFilters>(() => emptyFilters());
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);
  const [showSavedViewsMenu, setShowSavedViewsMenu] = useState(false);

  // ─── Estado da tabela (colunas + ordenação persistidas) ───
  const [tableColumns, setTableColumns] = useState<TableColumnsState>(DEFAULT_COLUMNS);
  const [tableSort, setTableSort] = useState<SortState>({ field: 'days', dir: 'desc' });
  const [tablePageSize, setTablePageSize] = useState<number>(50);
  const [tablePage, setTablePage] = useState<number>(1);

  // ─── Dashboard KPI strip (visibilidade persistida) ─────────
  const [dashboardVisible, setDashboardVisible] = useState<boolean>(true);

  // Hidratar estado a partir de localStorage após mount (evita SSR mismatch)
  useEffect(() => {
    setTableColumns(loadColumns());
    setTableSort(loadSort());
    setSavedViews(loadSavedViews());
    setDashboardVisible(loadDashboardVisible());
  }, []);

  const hideDashboard = useCallback(() => {
    setDashboardVisible(false);
    persistDashboardVisible(false);
  }, []);
  const showDashboard = useCallback(() => {
    setDashboardVisible(true);
    persistDashboardVisible(true);
  }, []);

  // Alias para busca textual (mantém compat com handlers existentes)
  const searchQuery = filters.search;
  const setSearchQuery = (v: string) => setFilters(f => ({ ...f, search: v }));

  const [view, setView] = useState<'active' | 'archived'>('active');
  const [displayView, setDisplayViewState] = useState<DisplayView>('kanban');
  // Hidrata preferência de view persistida após mount (evita hidration mismatch SSR)
  useEffect(() => {
    setDisplayViewState(loadDisplayView());
  }, []);
  const setDisplayView = useCallback((v: DisplayView) => {
    setDisplayViewState(v);
    persistDisplayView(v);
  }, []);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<LegalCase | null>(null);
  const [showCadastrarModal, setShowCadastrarModal] = useState(false);
  const [clientPanelLeadId, setClientPanelLeadId] = useState<string | null>(null);
  const [chatPopupCase, setChatPopupCase] = useState<LegalCase | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { isAdmin: currentUserIsAdmin } = useRole();

  // ─── ESAJ / Tribunal Search State ──────────────────────
  const [esajSearching, setEsajSearching] = useState(false);
  const [esajResult, setEsajResult] = useState<any>(null);
  const [esajError, setEsajError] = useState<string | null>(null);
  const [prefillData, setPrefillData] = useState<any>(null);
  const [showOabImportModal, setShowOabImportModal] = useState(false);
  const [oabCadastroQueue, setOabCadastroQueue] = useState<Array<{ processo_codigo: string; foro: string; case_number: string }>>([]);
  const [oabCadastroProgress, setOabCadastroProgress] = useState<{ current: number; total: number } | null>(null);
  // Ref do item atualmente em cadastro — usado pra dispatch do event 'oab-case-saved'
  // pro OabImportModal quando o CadastrarModal finaliza com sucesso.
  const currentOabItemRef = useRef<{ processo_codigo: string } | null>(null);

  const [pendingClosure, setPendingClosure] = useState<any[]>([]);

  useEffect(() => {
    if (!currentUserIsAdmin) return;
    api.get('/legal-cases/encerrados-pendentes')
      .then(r => setPendingClosure(r.data || []))
      .catch(() => {});
  }, [currentUserIsAdmin, cases]); // refresh when cases change

  // Mover para INSTRUCAO requer audiência agendada
  const [pendingMoveToInstrucao, setPendingMoveToInstrucao] = useState<{
    legalCase: LegalCase;
    targetStage: string;
    suggestedDate?: string | null;
  } | null>(null);

  // Mover para PERICIA_AGENDADA abre modal de perícia
  const [pendingMoveToPericia, setPendingMoveToPericia] = useState<{
    legalCase: LegalCase;
    targetStage: string;
    suggestedDate?: string | null;
  } | null>(null);

  // Mover para EXECUCAO abre modal de sentença (obrigatório)
  const [pendingMoveToExecucao, setPendingMoveToExecucao] = useState<{
    legalCase: LegalCase;
  } | null>(null);

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
      setFetchError(false);
    } catch (e: any) {
      console.warn('Erro ao buscar processos', e);
      if (!silent) setFetchError(true);
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

  // Abre painel automaticamente quando redirecionado do DJEN com ?openCase=ID
  useEffect(() => {
    const openCaseId = searchParams.get('openCase');
    if (!openCaseId || cases.length === 0) return;
    const target = cases.find(c => c.id === openCaseId);
    if (target) {
      setSelectedCase(target);
      // Remove o param da URL sem recarregar a página
      router.replace('/atendimento/processos', { scroll: false });
    }
  }, [searchParams, cases, router]);

  const executeMoveCase = async (
    caseId: string,
    newTrackingStage: string,
    extra?: { sentence_value?: number; sentence_date?: string; sentence_type?: string },
    options?: { showUndoToast?: boolean },
  ) => {
    // Captura o stage ANTES da atualização otimista — usado pelo botão "Desfazer".
    const previousStage = cases.find(c => c.id === caseId)?.tracking_stage || null;

    setCases(prev => prev.map(c => c.id === caseId ? { ...c, tracking_stage: newTrackingStage } : c));
    try {
      await api.patch(`/legal-cases/${caseId}/tracking-stage`, { trackingStage: newTrackingStage, ...extra });
    } catch {
      fetchCases(true);
      return;
    }

    // Toast com undo: so mostra se foi arraste manual (evita loop no proprio undo
    // e evita mostrar quando o fluxo veio de modal de PERICIA/EXECUCAO etc).
    const showUndo = options?.showUndoToast !== false && previousStage && previousStage !== newTrackingStage;
    if (showUndo) {
      const fromLabel = findTrackingStage(previousStage)?.label || previousStage;
      const toLabel = findTrackingStage(newTrackingStage)?.label || newTrackingStage;
      toast.custom(
        (t) => (
          <div
            className={`bg-card border border-border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 min-w-[320px] max-w-md ${
              t.visible ? 'animate-in fade-in slide-in-from-bottom-2' : 'animate-out fade-out'
            }`}
          >
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <div className="flex-1 text-[13px] text-foreground leading-tight">
              Processo movido para <span className="font-semibold">{toLabel}</span>
              <div className="text-[11px] text-muted-foreground mt-0.5">Estava em: {fromLabel}</div>
            </div>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                void executeMoveCase(caseId, previousStage, undefined, { showUndoToast: false });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-[12px] font-semibold text-foreground transition-colors"
            >
              <Undo2 size={14} /> Desfazer
            </button>
          </div>
        ),
        { duration: 8000, position: 'bottom-right' },
      );
    }
  };

  const moveCase = async (caseId: string, newTrackingStage: string) => {
    // PERICIA_AGENDADA — abre modal para agendar perícia
    if (newTrackingStage === 'PERICIA_AGENDADA') {
      const lc = cases.find(c => c.id === caseId);
      let suggestedDate: string | null = null;
      try {
        const res = await api.get('/calendar/events', {
          params: { type: 'PERICIA', legalCaseId: caseId, showAll: 'true' },
        });
        const events: any[] = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        if (events.length > 0 && events[0]?.start_at) suggestedDate = events[0].start_at;
      } catch { /* permite mover mesmo sem eventos */ }
      if (lc) {
        setPendingMoveToPericia({ legalCase: lc, targetStage: newTrackingStage, suggestedDate });
        return;
      }
    }

    // EXECUCAO — abre modal para informar valor da condenação
    if (newTrackingStage === 'EXECUCAO') {
      const lc = cases.find(c => c.id === caseId);
      if (lc) {
        setPendingMoveToExecucao({ legalCase: lc });
        return;
      }
    }

    // INSTRUCAO exige audiência cadastrada no calendário
    if (newTrackingStage === 'INSTRUCAO') {
      const lc = cases.find(c => c.id === caseId);
      // Verificar se já existe audiência para o processo
      let hasAudiencia = false;
      let suggestedDate: string | null = null;
      try {
        const res = await api.get('/calendar/events', {
          params: { type: 'AUDIENCIA', legalCaseId: caseId, showAll: 'true' },
        });
        const events: any[] = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        hasAudiencia = events.length > 0;
        if (hasAudiencia && events[0]?.start_at) suggestedDate = events[0].start_at;
      } catch { /* se falhar, permite mover */ hasAudiencia = true; }

      if (!hasAudiencia && lc) {
        setPendingMoveToInstrucao({ legalCase: lc, targetStage: newTrackingStage, suggestedDate });
        return; // bloqueia — aguarda modal
      }
    }
    await executeMoveCase(caseId, newTrackingStage);
  };

  // ─── ESAJ Search helpers ──────────────────────────────────
  const isCNJLike = (query: string): boolean => {
    const digits = query.replace(/\D/g, '');
    return digits.length >= 15 && digits.length <= 20;
  };

  const searchEsaj = async () => {
    const digits = searchQuery.replace(/\D/g, '');
    setEsajSearching(true);
    setEsajError(null);
    setEsajResult(null);
    try {
      const res = await api.get('/court-scraper/search', { params: { caseNumber: digits } });
      if (res.data?.found) {
        if (res.data.already_registered) {
          setEsajError(`Processo já cadastrado no sistema (ID: ${res.data.existing_case_id})`);
        } else {
          setEsajResult(res.data.data);
        }
      } else {
        setEsajError('Processo não encontrado no ESAJ/TJAL. Verifique o número.');
      }
    } catch (e: any) {
      setEsajError(e?.response?.data?.message || 'Erro ao consultar ESAJ. Tente novamente.');
    } finally {
      setEsajSearching(false);
    }
  };

  const openCadastrarWithEsajData = () => {
    if (!esajResult) return;
    const opposingParty = esajResult.parties
      ?.filter((p: any) => /r[eé]u|requerido|executado/i.test(p.role))
      .map((p: any) => p.name)
      .join(', ') || '';
    const assuntoNotes = [
      esajResult.subject ? `Assunto: ${esajResult.subject}` : '',
      ...(esajResult.parties || []).slice(0, 6).map((p: any) => `${p.role}: ${p.name}`),
    ].filter(Boolean).join('\n');

    setPrefillData({
      case_number: esajResult.case_number,
      legal_area: esajResult.legal_area,
      action_type: esajResult.action_type,
      court: esajResult.court,
      judge: esajResult.judge,
      claim_value: esajResult.claim_value,
      filed_at: esajResult.filed_at,
      tracking_stage: esajResult.tracking_stage || 'DISTRIBUIDO',
      notes: assuntoNotes,
      opposing_party: opposingParty,
    });
    setShowCadastrarModal(true);
    setEsajResult(null);
  };

  const openCadastroForOabItem = useCallback(async (item: { processo_codigo: string; foro: string; case_number: string }) => {
    // Guarda ref pra saber qual processo_codigo foi cadastrado quando o
    // modal de cadastro fechar com sucesso (usado em handleCadastroModalSuccess).
    currentOabItemRef.current = { processo_codigo: item.processo_codigo };
    try {
      const res = await api.get('/court-scraper/search', { params: { caseNumber: item.case_number }, timeout: 30000 });
      // Backend retorna { found, already_registered, data: CourtCaseData, tribunal }.
      // Os dados do processo ficam DENTRO de payload.data — ler direto res.data
      // resultava em case_number/parties/etc. undefined e modal vazio.
      const payload = res.data;
      const data = payload?.data;

      if (!data) {
        // found=false ou already_registered=true — cai no fallback com o case_number da listagem
        setPrefillData({ case_number: item.case_number });
      } else {
        // Extrai autor(es) e reu(s) das partes. Regex separados — litisconsorcio e
        // terminologia variam (autor/requerente/exequente/reclamante no polo ativo,
        // reu/requerido/executado/reclamado/denunciado no polo passivo).
        const parties = data.parties || [];
        const authorNames = parties
          .filter((p: any) => /autor|requerente|exequente|reclamante/i.test(p.role))
          .map((p: any) => p.name)
          .join(', ');
        const defendantNames = parties
          .filter((p: any) => /r[eé]u|requerido|executado|reclamado|denunciado/i.test(p.role))
          .map((p: any) => p.name)
          .join(', ');

        const assuntoNotes = [
          data.subject ? `Assunto: ${data.subject}` : '',
          ...parties.slice(0, 6).map((p: any) => `${p.role}: ${p.name}`),
        ].filter(Boolean).join('\n');

        setPrefillData({
          case_number: data.case_number || item.case_number,
          legal_area: data.legal_area,
          action_type: data.action_type,
          court: data.court,
          judge: data.judge,
          claim_value: data.claim_value,
          filed_at: data.filed_at,
          tracking_stage: data.tracking_stage || 'DISTRIBUIDO',
          notes: assuntoNotes,
          author: authorNames,
          opposing_party: defendantNames,
        });
      }
    } catch {
      // Fallback: abre com dados parciais disponíveis do resultado OAB
      setPrefillData({ case_number: item.case_number });
    }
    setShowCadastrarModal(true);
  }, []);

  const handleStartOabCadastro = useCallback(async (items: Array<{ processo_codigo: string; foro: string; case_number: string }>) => {
    // NAO fechar o OabImportModal — mantem os resultados da busca visiveis
    // pra o usuario cadastrar outros processos em sequencia sem re-buscar.
    // Antes (bug): setShowOabImportModal(false) derrubava o state da busca.
    if (items.length === 0) return;
    setOabCadastroQueue(items.slice(1));
    setOabCadastroProgress({ current: 1, total: items.length });
    await openCadastroForOabItem(items[0]);
  }, [openCadastroForOabItem]);

  const handleCadastroModalSuccess = useCallback(() => {
    fetchCases(true);

    // Notifica o OabImportModal (se estiver aberto) que este processo_codigo
    // foi cadastrado com sucesso — ele vai riscar visualmente + persistir no
    // sessionStorage pra nao aparecer como pendente.
    const saved = currentOabItemRef.current;
    if (saved?.processo_codigo) {
      window.dispatchEvent(
        new CustomEvent('oab-case-saved', {
          detail: { processo_codigo: saved.processo_codigo },
        }),
      );
      currentOabItemRef.current = null;
    }

    if (oabCadastroQueue.length > 0) {
      const [next, ...remaining] = oabCadastroQueue;
      setOabCadastroQueue(remaining);
      setOabCadastroProgress(prev => prev ? { ...prev, current: prev.current + 1 } : null);
      openCadastroForOabItem(next);
    } else {
      setShowCadastrarModal(false);
      setPrefillData(null);
      setOabCadastroProgress(null);
    }
  }, [oabCadastroQueue, openCadastroForOabItem, fetchCases]);

  // ─── Helpers de views salvas e colunas ────────────────────
  const handleSaveView = useCallback(() => {
    const name = window.prompt('Nome para a view (ex: "Urgentes sem movimentação"):');
    if (!name || !name.trim()) return;
    const view: SavedView = {
      id: `v_${Date.now()}`,
      name: name.trim(),
      filters: serializeFilters(filters),
      createdAt: new Date().toISOString(),
    };
    const updated = [...savedViews, view];
    setSavedViews(updated);
    persistSavedViews(updated);
    setActiveSavedViewId(view.id);
  }, [filters, savedViews]);

  const handleApplySavedView = useCallback((view: SavedView) => {
    setFilters(deserializeFilters(view.filters));
    setActiveSavedViewId(view.id);
    setShowSavedViewsMenu(false);
  }, []);

  const handleDeleteSavedView = useCallback((id: string) => {
    const updated = savedViews.filter(v => v.id !== id);
    setSavedViews(updated);
    persistSavedViews(updated);
    if (activeSavedViewId === id) setActiveSavedViewId(null);
  }, [savedViews, activeSavedViewId]);

  const handleClearFilters = useCallback(() => {
    setFilters(emptyFilters());
    setActiveSavedViewId(null);
  }, []);

  const handleToggleColumn = useCallback((key: keyof TableColumnsState) => {
    setTableColumns(prev => {
      const next = { ...prev, [key]: !prev[key] };
      persistColumns(next);
      return next;
    });
  }, []);

  const handleSortChange = useCallback((field: SortField) => {
    setTableSort(prev => {
      const next: SortState =
        prev.field === field
          ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
          : { field, dir: 'desc' };
      persistSort(next);
      return next;
    });
  }, []);

  // Filters
  const allAreas = [...new Set(cases.map(c => c.legal_area).filter(Boolean))].sort() as string[];
  // Advogados disponíveis para filtragem (distintos dos casos carregados)
  const allLawyers = (() => {
    const map = new Map<string, { id: string; name: string | null }>();
    cases.forEach(c => {
      if (c.lawyer?.id && !map.has(c.lawyer.id)) {
        map.set(c.lawyer.id, { id: c.lawyer.id, name: c.lawyer.name });
      }
    });
    return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  })();
  const activeFiltersCount = countActiveFilters(filters);

  const filteredCases = cases.filter(c => {
    // Busca textual (nome, telefone, CNJ, parte contrária)
    const q = filters.search.toLowerCase().trim();
    if (q) {
      const name = (c.lead?.name || '').toLowerCase();
      const phone = (c.lead?.phone || '').toLowerCase();
      const caseNum = (c.case_number || '').toLowerCase();
      const opp = (c.opposing_party || '').toLowerCase();
      // Normalizar dígitos para busca por número CNJ (ex: 0706377-27.2026.8.02 ↔ 07063772720268020058)
      const qDigits = q.replace(/\D/g, '');
      const caseNumDigits = (c.case_number || '').replace(/\D/g, '');
      const matchDigits = qDigits.length >= 5 && caseNumDigits.includes(qDigits);
      if (!name.includes(q) && !phone.includes(q) && !caseNum.includes(q) && !opp.includes(q) && !matchDigits) return false;
    }
    // Áreas (multi)
    if (filters.areas.size > 0 && !filters.areas.has(c.legal_area || '')) return false;
    // Prioridades (multi)
    if (filters.priorities.size > 0 && !filters.priorities.has(c.priority)) return false;
    // Advogados (multi)
    if (filters.lawyerIds.size > 0 && !filters.lawyerIds.has(c.lawyer_id)) return false;
    // Etapa processual (multi)
    if (filters.trackingStages.size > 0 && !filters.trackingStages.has(c.tracking_stage || 'DISTRIBUIDO')) return false;
    // Vara (contém)
    if (filters.court.trim()) {
      const courtQ = filters.court.toLowerCase().trim();
      if (!(c.court || '').toLowerCase().includes(courtQ)) return false;
    }
    // Próximo prazo/audiência em X dias
    if (filters.nextDeadlineDays !== null) {
      const now = Date.now();
      const limit = now + filters.nextDeadlineDays * 24 * 60 * 60 * 1000;
      const hasEventInWindow = (c.calendar_events || []).some(e => {
        const t = new Date(e.start_at).getTime();
        return t >= now && t <= limit;
      });
      if (!hasEventInWindow) return false;
    }
    // Sem movimentação há mais de X dias
    if (filters.withoutMovementDays !== null) {
      const lastUpdate = new Date(c.stage_changed_at || c.updated_at).getTime();
      const threshold = Date.now() - filters.withoutMovementDays * 24 * 60 * 60 * 1000;
      if (lastUpdate > threshold) return false;
    }
    return true;
  });

  const getStageCase = (stageId: string) =>
    filteredCases
      .filter(c => (c.tracking_stage || 'DISTRIBUIDO') === stageId)
      .sort((a, b) => {
        // URGENTE sempre primeiro
        const PORD = { URGENTE: 0, NORMAL: 1, BAIXA: 2 };
        const pa = PORD[a.priority as keyof typeof PORD] ?? 1;
        const pb = PORD[b.priority as keyof typeof PORD] ?? 1;
        if (pa !== pb) return pa - pb;
        // Dentro da mesma prioridade: evento mais próximo primeiro
        const now = Date.now();
        const aEvent = a.calendar_events?.find(e => new Date(e.start_at).getTime() >= now - 3600000);
        const bEvent = b.calendar_events?.find(e => new Date(e.start_at).getTime() >= now - 3600000);
        if (aEvent && bEvent) return new Date(aEvent.start_at).getTime() - new Date(bEvent.start_at).getTime();
        if (aEvent) return -1;
        if (bEvent) return 1;
        // Sem eventos: mais antigo na etapa primeiro
        const ta = a.stage_changed_at ? new Date(a.stage_changed_at).getTime() : now;
        const tb = b.stage_changed_at ? new Date(b.stage_changed_at).getTime() : now;
        return ta - tb;
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
              {activeFiltersCount > 0 ? `filtrado${filteredCases.length !== 1 ? 's' : ''} (${activeFiltersCount} filtro${activeFiltersCount > 1 ? 's' : ''} ativo${activeFiltersCount > 1 ? 's' : ''})` : 'em acompanhamento'}
            </p>
            {currentUserIsAdmin && pendingClosure.length > 0 && (
              <div className="mt-1.5 flex items-center gap-3 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/5">
                <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                <p className="text-[11px] text-amber-400 font-semibold flex-1">
                  {pendingClosure.length} processo{pendingClosure.length > 1 ? 's' : ''} aguardando arquivamento
                  {' '}— {pendingClosure.map((c: any) => c.lead?.name || c.case_number || '').filter(Boolean).join(', ')}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View toggle (kanban / tabela / agenda / clientes) — só para processos ativos */}
            {view === 'active' && (
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setDisplayView('kanban')}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors ${
                    displayView === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                  title="Kanban — fluxo por etapa"
                >
                  <LayoutGrid size={13} />
                  <span className="hidden sm:inline">Kanban</span>
                </button>
                <button
                  onClick={() => setDisplayView('tabela')}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors border-l border-border ${
                    displayView === 'tabela' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                  title="Tabela — colunas ordenáveis e filtráveis"
                >
                  <LayoutList size={13} />
                  <span className="hidden sm:inline">Tabela</span>
                </button>
                <button
                  onClick={() => setDisplayView('agenda')}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors border-l border-border ${
                    displayView === 'agenda' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                  title="Agenda — prazos e audiências por data"
                >
                  <Calendar size={13} />
                  <span className="hidden sm:inline">Agenda</span>
                </button>
                <button
                  onClick={() => setDisplayView('clientes')}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors border-l border-border ${
                    displayView === 'clientes' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                  title="Visão por cliente — processos agrupados por lead"
                >
                  <User size={13} />
                  <span className="hidden sm:inline">Clientes</span>
                </button>
              </div>
            )}

            {/* Botão para reexibir o dashboard de KPIs quando oculto */}
            {view === 'active' && !dashboardVisible && (
              <DashboardStripReopenButton onClick={showDashboard} />
            )}

            {/* Filtros avançados */}
            {view === 'active' && (
              <button
                onClick={() => setFilterDrawerOpen(true)}
                className={`text-[11px] font-semibold flex items-center gap-1.5 px-3 py-1.5 border rounded-lg transition-colors ${
                  activeFiltersCount > 0
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
                title="Filtros avançados"
              >
                <SlidersHorizontal size={13} />
                <span className="hidden lg:inline">Filtros</span>
                {activeFiltersCount > 0 && (
                  <span className="ml-0.5 px-1.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            )}

            {/* Views salvas */}
            {view === 'active' && savedViews.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowSavedViewsMenu(v => !v)}
                  className="text-[11px] font-semibold flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Views salvas"
                >
                  <Bookmark size={13} />
                  <span className="hidden lg:inline">Views</span>
                </button>
                {showSavedViewsMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowSavedViewsMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-lg shadow-lg z-20 overflow-hidden">
                      <div className="px-3 py-2 border-b border-border text-[10px] font-bold text-muted-foreground uppercase">
                        Views salvas
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {savedViews.map(v => (
                          <div
                            key={v.id}
                            className={`flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-accent/50 group ${
                              activeSavedViewId === v.id ? 'bg-primary/5 border-l-2 border-primary' : ''
                            }`}
                          >
                            <button
                              onClick={() => handleApplySavedView(v)}
                              className="flex-1 text-left font-semibold text-foreground truncate"
                            >
                              {activeSavedViewId === v.id && <Star size={10} className="inline mr-1 text-primary" />}
                              {v.name}
                            </button>
                            <button
                              onClick={() => handleDeleteSavedView(v.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                              title="Excluir view"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* View toggle (active/archived) */}
            {view === 'active' ? (
              <button
                onClick={() => setView('archived')}
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg hover:bg-accent transition-colors"
                title="Arquivados"
              >
                <Archive size={13} /> <span className="hidden xl:inline">Arquivados</span>
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
              className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1.5 px-3 py-1.5 border border-sky-500/30 rounded-lg hover:bg-sky-500/5 transition-colors"
              title="DJEN — diário eletrônico"
            >
              <Bell size={13} /> <span className="hidden xl:inline">DJEN</span>
            </button>

            {/* Search — mais estreito em telas menores */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar processo…"
                className="pl-8 pr-3 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 w-32 lg:w-44"
              />
            </div>

            {/* Buscar no ESAJ (quando 0 resultados locais e query é CNJ-like) */}
            {view === 'active' && filteredCases.length === 0 && isCNJLike(searchQuery) && (
              <button
                onClick={searchEsaj}
                disabled={esajSearching}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-orange-500 text-white rounded-lg hover:opacity-90 transition-all"
                title="Buscar dados do processo no tribunal"
              >
                {esajSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                {esajSearching ? 'Buscando...' : 'Buscar no ESAJ'}
              </button>
            )}

            {/* Importar por OAB */}
            {view === 'active' && currentUserIsAdmin && (
              <button
                onClick={() => setShowOabImportModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-emerald-600 text-white rounded-lg hover:opacity-90 transition-all shrink-0"
                title="Importar processos pelo número da OAB"
              >
                <ExternalLink size={13} /> <span className="hidden xl:inline">Importar OAB</span><span className="xl:hidden">OAB</span>
              </button>
            )}

            {/* Cadastrar processo existente */}
            {view === 'active' && (
              <button
                onClick={() => { setPrefillData(null); setShowCadastrarModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shrink-0"
                title="Cadastrar processo em andamento"
              >
                <FolderPlus size={13} /> <span className="hidden xl:inline">Cadastrar</span>
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

        {/* ─── Chips de filtros ativos ───────────────────────── */}
        {view === 'active' && activeFiltersCount > 0 && (
          <div className="px-6 py-2 border-b border-border bg-accent/20 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-1">
              Filtros ativos:
            </span>
            {filters.search.trim() && (
              <FilterChip
                label={`Busca: "${filters.search.trim()}"`}
                onRemove={() => setFilters(f => ({ ...f, search: '' }))}
              />
            )}
            {Array.from(filters.priorities).map(p => (
              <FilterChip
                key={`pri-${p}`}
                label={`Prioridade: ${p}`}
                onRemove={() => setFilters(f => {
                  const n = new Set(f.priorities);
                  n.delete(p);
                  return { ...f, priorities: n };
                })}
              />
            ))}
            {Array.from(filters.areas).map(a => (
              <FilterChip
                key={`area-${a}`}
                label={`Área: ${a}`}
                onRemove={() => setFilters(f => {
                  const n = new Set(f.areas);
                  n.delete(a);
                  return { ...f, areas: n };
                })}
              />
            ))}
            {Array.from(filters.lawyerIds).map(id => {
              const lw = allLawyers.find(l => l.id === id);
              return (
                <FilterChip
                  key={`lw-${id}`}
                  label={`Adv: ${lw?.name || id.slice(0, 6)}`}
                  onRemove={() => setFilters(f => {
                    const n = new Set(f.lawyerIds);
                    n.delete(id);
                    return { ...f, lawyerIds: n };
                  })}
                />
              );
            })}
            {Array.from(filters.trackingStages).map(s => {
              const stage = findTrackingStage(s);
              return (
                <FilterChip
                  key={`st-${s}`}
                  label={`Etapa: ${stage?.label || s}`}
                  onRemove={() => setFilters(f => {
                    const n = new Set(f.trackingStages);
                    n.delete(s);
                    return { ...f, trackingStages: n };
                  })}
                />
              );
            })}
            {filters.court.trim() && (
              <FilterChip
                label={`Vara: ${filters.court.trim()}`}
                onRemove={() => setFilters(f => ({ ...f, court: '' }))}
              />
            )}
            {filters.nextDeadlineDays !== null && (
              <FilterChip
                label={`Prazo em ${filters.nextDeadlineDays} dias`}
                onRemove={() => setFilters(f => ({ ...f, nextDeadlineDays: null }))}
              />
            )}
            {filters.withoutMovementDays !== null && (
              <FilterChip
                label={`Sem movimento há +${filters.withoutMovementDays} dias`}
                onRemove={() => setFilters(f => ({ ...f, withoutMovementDays: null }))}
              />
            )}
            <button
              onClick={handleClearFilters}
              className="ml-1 text-[10px] font-semibold text-muted-foreground hover:text-destructive underline"
            >
              Limpar tudo
            </button>
          </div>
        )}

        {/* ─── Dashboard Strip (KPIs operacionais) ────────────── */}
        {view === 'active' && dashboardVisible && (
          <DashboardStrip
            cases={filteredCases}
            onClose={hideDashboard}
            onFilterUrgent={() => setFilters(f => ({ ...f, priorities: new Set(['URGENTE']) }))}
            onFilterWithoutMovement={() => setFilters(f => ({ ...f, withoutMovementDays: 30 }))}
            onFilterNext7Days={() => setFilters(f => ({ ...f, nextDeadlineDays: 7 }))}
            onSwitchToAgenda={() => setDisplayView('agenda')}
          />
        )}

        {/* ─── ESAJ Result Banner ─────────────────────────────── */}
        {esajResult && (
          <div className="mx-4 mt-2 p-4 bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-800 rounded-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-orange-600 bg-orange-100 dark:bg-orange-900/50 px-2 py-0.5 rounded-full">ESAJ / {esajResult.tribunal || 'TJAL'}</span>
                  <span className="text-sm font-semibold text-foreground font-mono">{esajResult.case_number}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-muted-foreground">
                  {esajResult.action_type && <div><span className="font-semibold text-foreground">Classe:</span> {esajResult.action_type}</div>}
                  {esajResult.court && <div><span className="font-semibold text-foreground">Vara:</span> {esajResult.court}</div>}
                  {esajResult.judge && <div><span className="font-semibold text-foreground">Juiz:</span> {esajResult.judge}</div>}
                  {esajResult.legal_area && <div><span className="font-semibold text-foreground">Área:</span> {esajResult.legal_area}</div>}
                  {esajResult.filed_at && <div><span className="font-semibold text-foreground">Distribuição:</span> {esajResult.filed_at}</div>}
                  {esajResult.claim_value && <div><span className="font-semibold text-foreground">Valor:</span> R$ {Number(esajResult.claim_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>}
                </div>
                {esajResult.parties?.length > 0 && (
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground">Partes: </span>
                    {esajResult.parties.slice(0, 4).map((p: any, i: number) => (
                      <span key={i}>{i > 0 ? ' • ' : ''}{p.role}: {p.name}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={openCadastrarWithEsajData}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all"
                >
                  <FolderPlus size={13} /> Cadastrar com estes dados
                </button>
                <button onClick={() => setEsajResult(null)} className="p-1 text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ESAJ Error */}
        {esajError && (
          <div className="mx-4 mt-2 p-3 bg-destructive/10 border border-destructive/30 rounded-xl flex items-center gap-2">
            <AlertCircle size={14} className="text-destructive shrink-0" />
            <span className="text-xs text-destructive">{esajError}</span>
            <button onClick={() => setEsajError(null)} className="ml-auto p-0.5 text-destructive/50 hover:text-destructive">
              <X size={12} />
            </button>
          </div>
        )}

        {fetchError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <p className="text-sm text-destructive font-medium">Erro ao carregar processos.</p>
            <p className="text-xs text-muted-foreground">Verifique sua conexão ou tente novamente.</p>
            <button
              onClick={() => fetchCases()}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        ) : loading ? (
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
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{formatCNJ(c.case_number)}</p>
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
          <TabelaView
            cases={filteredCases}
            onSelect={setSelectedCase}
            columns={tableColumns}
            onToggleColumn={handleToggleColumn}
            sort={tableSort}
            onSortChange={handleSortChange}
          />
        ) : displayView === 'agenda' ? (
          /* ─── Agenda View (cockpit de prazos) ─── */
          <AgendaView
            cases={filteredCases}
            onSelectCase={id => {
              const c = filteredCases.find(x => x.id === id);
              if (c) setSelectedCase(c);
            }}
          />
        ) : displayView === 'clientes' ? (
          /* ─── Visão por Cliente ─── */
          <ClienteView
            cases={filteredCases}
            onSelectCase={id => {
              const c = filteredCases.find(x => x.id === id);
              if (c) setSelectedCase(c);
            }}
            onSelectLead={leadId => setClientPanelLeadId(leadId)}
          />
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
                          setDraggingId(null);
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
                              onEventAction={() => fetchCases(true)}
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

      {/* Modal: Agendar Perícia (ao mover para PERICIA_AGENDADA) */}
      {pendingMoveToPericia && (
        <AgendarPericiaModal
          legalCase={pendingMoveToPericia.legalCase}
          suggestedDate={pendingMoveToPericia.suggestedDate}
          onScheduled={() => {
            const { legalCase: lc, targetStage } = pendingMoveToPericia;
            setPendingMoveToPericia(null);
            executeMoveCase(lc.id, targetStage);
          }}
          onSkip={() => {
            const { legalCase: lc, targetStage } = pendingMoveToPericia;
            setPendingMoveToPericia(null);
            executeMoveCase(lc.id, targetStage);
          }}
          onCancel={() => setPendingMoveToPericia(null)}
        />
      )}

      {/* Modal: Sentença (ao mover para EXECUCAO) */}
      {pendingMoveToExecucao && (
        <SentencaModal
          legalCase={pendingMoveToExecucao.legalCase}
          onConfirm={(data) => {
            const lc = pendingMoveToExecucao.legalCase;
            setPendingMoveToExecucao(null);
            executeMoveCase(lc.id, 'EXECUCAO', data);
          }}
          onSkip={() => {
            const lc = pendingMoveToExecucao.legalCase;
            setPendingMoveToExecucao(null);
            executeMoveCase(lc.id, 'EXECUCAO');
          }}
          onCancel={() => setPendingMoveToExecucao(null)}
        />
      )}

      {/* Modal: Agendar Audiência (bloqueio ao mover para INSTRUCAO) */}
      {pendingMoveToInstrucao && (
        <AgendarAudienciaModal
          legalCase={pendingMoveToInstrucao.legalCase}
          suggestedDate={pendingMoveToInstrucao.suggestedDate}
          onScheduled={() => {
            const { legalCase: lc, targetStage } = pendingMoveToInstrucao;
            setPendingMoveToInstrucao(null);
            executeMoveCase(lc.id, targetStage);
          }}
          onSkip={() => {
            const { legalCase: lc, targetStage } = pendingMoveToInstrucao;
            setPendingMoveToInstrucao(null);
            executeMoveCase(lc.id, targetStage);
          }}
          onCancel={() => setPendingMoveToInstrucao(null)}
        />
      )}

      {/* Modal Cadastrar Processo Existente */}
      {/* key: força remount a cada item do lote — os states do form sao inicializados
          via useState(prefillData?.xxx), que so roda no mount. Sem a key, items 2..N
          do cadastro em lote reusariam os inputs do primeiro item. */}
      {showCadastrarModal && (
        <CadastrarProcessoModal
          key={prefillData?.case_number || 'manual'}
          onClose={() => { setShowCadastrarModal(false); setPrefillData(null); setOabCadastroQueue([]); setOabCadastroProgress(null); }}
          onSuccess={handleCadastroModalSuccess}
          prefillData={prefillData}
          batchProgress={oabCadastroProgress}
        />
      )}

      {/* Case Detail Panel */}
      {selectedCase && (
        <ProcessoDetailPanel
          legalCase={selectedCase}
          onClose={() => setSelectedCase(null)}
          onRefresh={() => { fetchCases(true); setSelectedCase(null); }}
          onOpenClientPanel={(leadId) => setClientPanelLeadId(leadId)}
          onOpenChat={(lc) => setChatPopupCase(lc)}
        />
      )}

      {/* Chat popup — falar com o cliente sem sair da tela */}
      {chatPopupCase && (
        <ChatPopup
          leadId={chatPopupCase.lead_id}
          leadName={chatPopupCase.lead?.name ?? null}
          conversationId={chatPopupCase.conversation_id}
          caseNumber={chatPopupCase.case_number}
          onClose={() => setChatPopupCase(null)}
        />
      )}

      {/* Painel do Cliente — sobreposto ao painel de processo (zBase=200) */}
      {clientPanelLeadId && (
        <ClientPanel
          leadId={clientPanelLeadId}
          onClose={() => setClientPanelLeadId(null)}
          onLightbox={(url) => setLightboxUrl(url)}
          isAdmin={currentUserIsAdmin}
          zBase={200}
        />
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center"
          style={{ zIndex: 300 }}
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl" />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {/* Modal Importar por OAB */}
      {showOabImportModal && (
        <OabImportModal
          onClose={() => setShowOabImportModal(false)}
          onStartCadastro={handleStartOabCadastro}
        />
      )}

      {/* Drawer de Filtros Avançados */}
      <ProcessosFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        filters={filters}
        onChange={setFilters}
        availableAreas={allAreas}
        availableLawyers={allLawyers}
        onClear={handleClearFilters}
        onSaveView={handleSaveView}
      />
    </div>
  );
}

export default function ProcessosPage() {
  return (
    <RouteGuard allowedRoles={['ADMIN', 'ADVOGADO', 'ESTAGIARIO']}>
      <ProcessosPageContent />
    </RouteGuard>
  );
}
