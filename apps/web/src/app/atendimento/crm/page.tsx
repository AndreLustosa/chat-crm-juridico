'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { User, Search, RefreshCw, MessageSquare, MoreVertical, ChevronDown, Calendar, Scale, UserCheck, Download, CheckSquare, Square, X as XIcon, LayoutList, Columns, Phone, Mail, Tag, Clock, ChevronRight, Copy, Send, BarChart2, TrendingUp, AlertCircle, Briefcase } from 'lucide-react';
import { io } from 'socket.io-client';

function getWsUrl() { return typeof window !== 'undefined' ? window.location.origin : ''; }
function getSocketPath() { return process.env.NEXT_PUBLIC_SOCKET_PATH ?? '/socket.io/'; }
import api, { API_BASE_URL } from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import { CRM_STAGES, normalizeStage, findStage } from '@/lib/crmStages';
import { STAGE_TEMPLATES } from '@/lib/crmTemplates';
import { getStagnationDays } from '@/lib/crmSettings';
import { showError, showSuccess } from '@/lib/toast';

interface CrmLead {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  stage: string;
  stage_entered_at: string;
  loss_reason: string | null;
  profile_picture_url: string | null;
  tags: string[];
  created_at: string;
  conversations: Array<{
    id: string;
    legal_area: string | null;
    assigned_lawyer_id: string | null;
    next_step: string | null;
    last_message_at: string;
    messages: Array<{ text: string | null; direction: string; created_at: string }>;
    assigned_user: { id: string; name: string } | null;
    assigned_lawyer: { id: string; name: string } | null;
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function daysInStage(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function agingColor(days: number): string {
  if (days <= 2) return 'text-emerald-400';
  if (days <= 5) return 'text-yellow-400';
  if (days <= 10) return 'text-orange-400';
  return 'text-red-400';
}

const NEXT_STEP_MAP: Record<string, { label: string; color: string }> = {
  duvidas:          { label: '❓ Dúvidas',  color: 'bg-gray-500/15 text-gray-400 border-gray-500/20' },
  triagem_concluida:{ label: '✓ Triagem',   color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  formulario:       { label: '📋 Formulário', color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  reuniao:          { label: '📞 Reunião',   color: 'bg-orange-500/15 text-orange-400 border-orange-500/20' },
  encerrado:        { label: '✅ Encerrado', color: 'bg-violet-500/15 text-violet-400 border-violet-500/20' },
};

// ─── Lead Score ─────────────────────────────────────────────────────────────

const STAGE_BASE_SCORES: Record<string, number> = {
  NOVO: 10, INICIAL: 15, EM_ATENDIMENTO: 25, QUALIFICANDO: 35, QUALIFICADO: 40,
  AGUARDANDO_FORM: 50, REUNIAO_AGENDADA: 65, AGUARDANDO_DOCS: 70,
  AGUARDANDO_PROC: 80, FINALIZADO: 100, PERDIDO: 0,
};

function computeLeadScore(lead: CrmLead): number {
  const normalized = normalizeStage(lead.stage);
  let score = STAGE_BASE_SCORES[normalized] ?? 20;
  const conv = lead.conversations?.[0];
  if (conv?.legal_area) score += 8;
  if (conv?.assigned_lawyer_id) score += 5;
  if (conv?.next_step && conv.next_step !== 'duvidas') score += 5;
  const days = daysInStage(lead.stage_entered_at);
  if (days > 3) score -= Math.min(25, (days - 3) * 3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreStyle(score: number): string {
  if (score >= 70) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (score >= 45) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
  if (score >= 20) return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

function agingBorderClass(days: number, stage: string): string {
  if (stage === 'PERDIDO' || stage === 'FINALIZADO') return '';
  if (days <= 2) return 'border-l-[3px] border-l-emerald-500/50';
  if (days <= 5) return 'border-l-[3px] border-l-yellow-500/60';
  return 'border-l-[3px] border-l-red-500/70';
}

function getScoreFactors(lead: CrmLead): string[] {
  const normalized = normalizeStage(lead.stage);
  const conv = lead.conversations?.[0];
  const days = daysInStage(lead.stage_entered_at);
  const factors: string[] = [];
  const base = STAGE_BASE_SCORES[normalized] ?? 20;
  factors.push(`+${base} etapa atual`);
  if (conv?.legal_area) factors.push('+8 área jurídica definida');
  if (conv?.assigned_lawyer_id) factors.push('+5 advogado atribuído');
  if (conv?.next_step && conv.next_step !== 'duvidas') factors.push('+5 próximo passo definido');
  if (days > 3) factors.push(`-${Math.min(25, (days - 3) * 3)} estagnado há ${days}d`);
  return factors;
}

function validateStageTransition(lead: CrmLead, newStage: string): string | null {
  const conv = lead.conversations?.[0];
  if (newStage === 'REUNIAO_AGENDADA' && !conv?.legal_area) {
    return 'Defina a área jurídica antes de agendar reunião.';
  }
  if (newStage === 'FINALIZADO') {
    if (!conv?.legal_area) return 'Defina a área jurídica antes de finalizar.';
    if (!conv?.assigned_lawyer_id) return 'Atribua um advogado antes de finalizar.';
  }
  return null;
}

// ─── Motivos de perda ───────────────────────────────────────────────────────

const LOSS_REASONS = [
  'Sem interesse',
  'Sem condições financeiras',
  'Contratou outro escritório',
  'Não respondeu',
  'Caso inviável',
];

// ─── LeadCard ───────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  isDragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onOpenDetail,
  onStageChange,
  isSelected,
  onToggleSelect,
  selectionMode,
}: {
  lead: CrmLead;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onOpenDetail: () => void;
  onStageChange: (stageId: string) => void;
  isSelected: boolean;
  onToggleSelect: () => void;
  selectionMode: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const conv = lead.conversations?.[0];
  const lastMsg = conv?.messages?.[0];
  const legalArea = conv?.legal_area;
  const lawyerName = conv?.assigned_lawyer?.name;
  const nextStep = conv?.next_step ? NEXT_STEP_MAP[conv.next_step] : null;
  const normalizedStage = normalizeStage(lead.stage);
  const days = daysInStage(lead.stage_entered_at);
  const score = computeLeadScore(lead);
  const isNew = (Date.now() - new Date(lead.created_at).getTime()) < 3_600_000;
  const agingBorder = agingBorderClass(days, normalizedStage);

  // Fechar menu ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <div
      draggable={!selectionMode}
      onDragStart={(e) => { if (selectionMode) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={() => { if (selectionMode) onToggleSelect(); else onOpenDetail(); }}
      className={`group p-3.5 bg-card border rounded-xl select-none transition-all ${
        selectionMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${
        isSelected
          ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/5'
          : isDragging
            ? 'opacity-40 scale-95 rotate-1 shadow-2xl ring-2 ring-primary/30 border-border'
            : `border-border hover:border-border/80 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 ${agingBorder}`
      }`}
    >
      {/* Header do card */}
      <div className="flex items-start gap-2.5 mb-2.5">
        {/* Checkbox de seleção */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={`shrink-0 mt-0.5 transition-all ${selectionMode || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {isSelected
            ? <CheckSquare size={15} className="text-primary" />
            : <Square size={15} className="text-muted-foreground/50" />
          }
        </button>

        <div className="w-8 h-8 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0 shadow-sm mt-0.5">
          {lead.profile_picture_url ? (
            <img src={lead.profile_picture_url} alt={lead.name || ''} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <User size={13} className="text-muted-foreground opacity-60" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-semibold text-foreground leading-tight truncate">
            {lead.name || 'Sem nome'}
          </h4>
          <p className="text-[11px] text-muted-foreground truncate">
            {formatPhone(lead.phone)}
          </p>
        </div>

        {/* Menu de ações */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(v => !v); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <MoreVertical size={13} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl w-48 py-1 text-[12px]">
              {/* Ações rápidas */}
              <button
                onClick={(e) => { e.stopPropagation(); onOpen(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-center gap-2 text-muted-foreground"
              >
                <MessageSquare size={12} />
                <span>Enviar mensagem</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onStageChange('REUNIAO_AGENDADA'); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-center gap-2 text-muted-foreground"
              >
                <Calendar size={12} />
                <span>Agendar reunião</span>
              </button>
              <div className="border-t border-border my-1" />
              <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Mover para etapa</p>
              {CRM_STAGES.map(s => (
                <button
                  key={s.id}
                  onClick={(e) => { e.stopPropagation(); onStageChange(s.id); setShowMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent transition-colors flex items-center gap-2 ${s.id === normalizedStage ? 'font-semibold' : ''}`}
                  style={{ color: s.id === normalizedStage ? s.color : undefined }}
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
        {isNew && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-bold border border-emerald-500/30 animate-pulse">
            NOVO
          </span>
        )}
        {legalArea && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/12 text-violet-400 text-[9px] font-bold border border-violet-500/20">
            ⚖️ {legalArea}
          </span>
        )}
        {lawyerName && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-500/12 text-blue-400 text-[9px] font-bold border border-blue-500/20">
            <UserCheck size={9} /> {lawyerName.replace(/^(Dra?\.?)\s+/i, '').split(' ')[0]}
          </span>
        )}
        {nextStep && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${nextStep.color}`}>
            {nextStep.label}
          </span>
        )}
        {normalizedStage === 'PERDIDO' && lead.loss_reason && (
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-500/12 text-red-400 text-[9px] font-medium border border-red-500/20 max-w-[140px] truncate"
            title={lead.loss_reason}
          >
            ✗ {lead.loss_reason}
          </span>
        )}
        {lead.tags?.map(tag => (
          <span key={tag} className="inline-flex px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground text-[9px] font-medium border border-border">
            {tag}
          </span>
        ))}
      </div>

      {/* Última mensagem */}
      {lastMsg?.text && (
        <p className="text-[11px] text-muted-foreground leading-snug mb-2 line-clamp-2 italic">
          {lastMsg.direction === 'out' ? '↩ ' : ''}{lastMsg.text.slice(0, 80)}{lastMsg.text.length > 80 ? '…' : ''}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          title="Abrir no chat"
        >
          <MessageSquare size={10} />
          Abrir chat
        </button>
        <div className="flex items-center gap-2">
          {/* Score do lead */}
          {normalizedStage !== 'PERDIDO' && normalizedStage !== 'FINALIZADO' && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border cursor-help ${scoreStyle(score)}`}
              title={`Score: ${score}/100\n${getScoreFactors(lead).join('\n')}`}
            >
              {score}
            </span>
          )}
          {/* Aging indicator */}
          {days > 0 && (
            <span
              className={`text-[10px] font-bold ${agingColor(days)}`}
              title={`${days} dia(s) neste estágio`}
            >
              {days}d
            </span>
          )}
          {conv?.last_message_at && (
            <span className="text-[10px] text-muted-foreground/60">
              {timeAgo(conv.last_message_at)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── LeadDetailPanel ────────────────────────────────────────────────────────

function LeadDetailPanel({
  lead,
  onClose,
  onOpenChat,
  onStageChange,
  onConvertToCase,
  convertingCase,
}: {
  lead: CrmLead;
  onClose: () => void;
  onOpenChat: () => void;
  onStageChange: (stage: string) => void;
  onConvertToCase: () => void;
  convertingCase: boolean;
}) {
  const conv = lead.conversations?.[0];
  const normalizedStage = normalizeStage(lead.stage);
  const stageInfo = findStage(normalizedStage);
  const days = daysInStage(lead.stage_entered_at);
  const score = computeLeadScore(lead);
  const isNew = (Date.now() - new Date(lead.created_at).getTime()) < 3_600_000;

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      const res = await api.post<{ summary: string }>(`/leads/${lead.id}/summary`);
      setAiSummary(res.data.summary);
    } catch {
      showError('Não foi possível gerar o resumo. Verifique a configuração da API.');
    } finally {
      setSummarizing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showSuccess('Copiado!'));
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* Drawer */}
      <aside className="fixed right-0 top-0 h-full w-[360px] z-50 bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border shrink-0">
          <div className="w-10 h-10 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0">
            {lead.profile_picture_url
              ? <img src={lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
              : <User size={16} className="text-muted-foreground/60" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-bold text-foreground truncate">{lead.name || 'Sem nome'}</h2>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Phone size={10} />
              <span>{formatPhone(lead.phone)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <XIcon size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">

          {/* Stage + Score */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border"
              style={{ backgroundColor: `${stageInfo.color}18`, color: stageInfo.color, borderColor: `${stageInfo.color}40` }}
            >
              {stageInfo.emoji} {stageInfo.label}
            </span>
            {days > 0 && (
              <span className={`text-[11px] font-bold flex items-center gap-1 ${agingColor(days)}`}>
                <Clock size={10} /> {days}d nesta etapa
              </span>
            )}
            {isNew && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse">NOVO</span>
            )}
            {normalizedStage !== 'PERDIDO' && normalizedStage !== 'FINALIZADO' && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-help ${scoreStyle(score)}`}
                title={`Score: ${score}/100\n${getScoreFactors(lead).join('\n')}`}>
                Score {score}
              </span>
            )}
          </div>

          {/* Info geral */}
          <div className="space-y-2">
            {lead.email && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Mail size={12} className="shrink-0" />
                <span className="truncate">{lead.email}</span>
              </div>
            )}
            {conv?.legal_area && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Scale size={12} className="shrink-0" />
                <span>{conv.legal_area}</span>
              </div>
            )}
            {conv?.assigned_lawyer && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <UserCheck size={12} className="shrink-0" />
                <span>{conv.assigned_lawyer.name}</span>
              </div>
            )}
            {conv?.next_step && NEXT_STEP_MAP[conv.next_step] && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <ChevronRight size={12} className="shrink-0" />
                <span>{NEXT_STEP_MAP[conv.next_step].label}</span>
              </div>
            )}
            {lead.tags?.length > 0 && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Tag size={12} className="shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {lead.tags.map(t => (
                    <span key={t} className="px-1.5 py-0.5 rounded-full bg-accent border border-border text-[10px]">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {lead.loss_reason && (
              <div className="flex items-start gap-2 text-[12px] text-red-400">
                <XIcon size={12} className="shrink-0 mt-0.5" />
                <span>{lead.loss_reason}</span>
              </div>
            )}
          </div>

          {/* Mensagens recentes */}
          {conv?.messages && conv.messages.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Últimas mensagens</p>
              <div className="space-y-1.5">
                {conv.messages.slice(0, 5).map((msg, i) => (
                  <div key={i} className={`text-[11px] px-2.5 py-1.5 rounded-lg leading-snug ${
                    msg.direction === 'out'
                      ? 'bg-primary/10 text-primary ml-4'
                      : 'bg-accent text-muted-foreground mr-4'
                  }`}>
                    {msg.direction === 'out' && <span className="opacity-60 mr-1">↩</span>}
                    {(msg.text || '').slice(0, 120)}{(msg.text?.length ?? 0) > 120 ? '…' : ''}
                  </div>
                ))}
              </div>
              {conv.last_message_at && (
                <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-right">{timeAgo(conv.last_message_at)}</p>
              )}
            </div>
          )}

          {/* Resumo IA */}
          <div className="bg-accent/40 border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Briefing IA</p>
              <button
                onClick={handleSummarize}
                disabled={summarizing}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                <TrendingUp size={11} />
                {summarizing ? 'Analisando…' : aiSummary ? 'Atualizar' : 'Resumir com IA'}
              </button>
            </div>
            {aiSummary
              ? <p className="text-[11px] text-foreground/80 leading-relaxed">{aiSummary}</p>
              : <p className="text-[11px] text-muted-foreground/50 italic">Clique em "Resumir com IA" para gerar um briefing automático do lead.</p>
            }
          </div>

          {/* Template de mensagem */}
          {STAGE_TEMPLATES[normalizedStage] && (
            <div className="bg-accent/50 border border-border rounded-xl p-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                Mensagem sugerida — {STAGE_TEMPLATES[normalizedStage]!.label}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{STAGE_TEMPLATES[normalizedStage]!.text}</p>
              <button
                onClick={() => copyToClipboard(STAGE_TEMPLATES[normalizedStage]!.text)}
                className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
              >
                <Copy size={11} /> Copiar mensagem
              </button>
            </div>
          )}

          {/* Mover de etapa */}
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Mover para etapa</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CRM_STAGES.filter(s => s.id !== normalizedStage).map(s => (
                <button
                  key={s.id}
                  onClick={() => { onStageChange(s.id); onClose(); }}
                  className="text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors flex items-center gap-1.5 truncate"
                  style={{ color: s.color }}
                >
                  <span>{s.emoji}</span>
                  <span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Datas */}
          <div className="text-[10px] text-muted-foreground/50 space-y-0.5 pt-2 border-t border-border">
            <p>Cadastrado: {new Date(lead.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            {lead.stage_entered_at && (
              <p>Etapa atual desde: {new Date(lead.stage_entered_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border shrink-0 space-y-2">
          {normalizedStage === 'FINALIZADO' && (
            <button
              onClick={onConvertToCase}
              disabled={convertingCase}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Briefcase size={15} />
              {convertingCase ? 'Criando caso…' : 'Converter em Caso Jurídico'}
            </button>
          )}
          <button
            onClick={onOpenChat}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors"
          >
            <MessageSquare size={15} />
            Abrir no chat
          </button>
        </div>
      </aside>
    </>
  );
}

// ─── LeadListView ────────────────────────────────────────────────────────────

function LeadListView({
  leads,
  onOpenDetail,
  onOpenChat,
  onStageChange,
  selectedLeads,
  onToggleSelect,
  selectionMode,
}: {
  leads: CrmLead[];
  onOpenDetail: (lead: CrmLead) => void;
  onOpenChat: (lead: CrmLead) => void;
  onStageChange: (leadId: string, stage: string) => void;
  selectedLeads: Set<string>;
  onToggleSelect: (id: string) => void;
  selectionMode: boolean;
}) {
  if (leads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground/50 text-sm">
        Nenhum lead encontrado com os filtros aplicados.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border">
            <th className="pb-2 pr-3 w-6" />
            <th className="pb-2 pr-4">Lead</th>
            <th className="pb-2 pr-4">Etapa</th>
            <th className="pb-2 pr-4">Score</th>
            <th className="pb-2 pr-4">Tempo</th>
            <th className="pb-2 pr-4">Área</th>
            <th className="pb-2 pr-4">Advogado</th>
            <th className="pb-2 pr-4">Última msg</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {leads.map(lead => {
            const normalizedStage = normalizeStage(lead.stage);
            const stageInfo = findStage(normalizedStage);
            const days = daysInStage(lead.stage_entered_at);
            const score = computeLeadScore(lead);
            const conv = lead.conversations?.[0];
            const isSelected = selectedLeads.has(lead.id);

            return (
              <tr
                key={lead.id}
                onClick={() => selectionMode ? onToggleSelect(lead.id) : onOpenDetail(lead)}
                className={`group cursor-pointer transition-colors hover:bg-accent/40 ${isSelected ? 'bg-primary/5' : ''}`}
              >
                <td className="py-2.5 pr-3">
                  <button onClick={e => { e.stopPropagation(); onToggleSelect(lead.id); }}
                    className={`transition-opacity ${selectionMode || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    {isSelected ? <CheckSquare size={14} className="text-primary" /> : <Square size={14} className="text-muted-foreground/50" />}
                  </button>
                </td>
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0">
                      {lead.profile_picture_url
                        ? <img src={lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                        : <User size={11} className="text-muted-foreground/60" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate max-w-[140px]">{lead.name || 'Sem nome'}</p>
                      <p className="text-[10px] text-muted-foreground">{formatPhone(lead.phone)}</p>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: `${stageInfo.color}18`, color: stageInfo.color }}>
                    {stageInfo.emoji} {stageInfo.label}
                  </span>
                </td>
                <td className="py-2.5 pr-4">
                  {normalizedStage !== 'PERDIDO' && normalizedStage !== 'FINALIZADO' && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scoreStyle(score)}`}>{score}</span>
                  )}
                </td>
                <td className={`py-2.5 pr-4 font-bold text-[11px] ${agingColor(days)}`}>
                  {days > 0 ? `${days}d` : '—'}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{conv?.legal_area || '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground truncate max-w-[120px]">
                  {conv?.assigned_lawyer?.name?.replace(/^(Dra?\.?)\s+/i, '').split(' ')[0] || '—'}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground/60">{timeAgo(conv?.last_message_at)}</td>
                <td className="py-2.5">
                  <button
                    onClick={e => { e.stopPropagation(); onOpenChat(lead); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
                    title="Abrir no chat"
                  >
                    <MessageSquare size={13} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── CrmAnalyticsPanel ──────────────────────────────────────────────────────

function CrmAnalyticsPanel({ leads, onClose }: { leads: CrmLead[]; onClose: () => void }) {
  const total = leads.length;
  const active = leads.filter(l => !['PERDIDO', 'FINALIZADO'].includes(normalizeStage(l.stage)));
  const lost = leads.filter(l => normalizeStage(l.stage) === 'PERDIDO');
  const finalized = leads.filter(l => normalizeStage(l.stage) === 'FINALIZADO');

  const conversionRate = total > 0 ? Math.round((finalized.length / total) * 100) : 0;
  const lossRate = total > 0 ? Math.round((lost.length / total) * 100) : 0;

  // Distribuição por etapa
  const byStage = CRM_STAGES.map(s => ({
    ...s,
    count: leads.filter(l => normalizeStage(l.stage) === s.id).length,
  }));
  const maxCount = Math.max(...byStage.map(s => s.count), 1);

  // Motivos de perda
  const lossReasons = lost.reduce<Record<string, number>>((acc, l) => {
    const r = l.loss_reason || 'Não informado';
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});
  const sortedReasons = Object.entries(lossReasons).sort((a, b) => b[1] - a[1]);

  // Funil simplificado
  const funnelStages = [
    { label: 'Entrada', count: leads.filter(l => ['INICIAL', 'NOVO'].includes(normalizeStage(l.stage))).length, color: '#6b7280' },
    { label: 'Qualificando', count: leads.filter(l => normalizeStage(l.stage) === 'QUALIFICANDO').length, color: '#3b82f6' },
    { label: 'Formulário', count: leads.filter(l => normalizeStage(l.stage) === 'AGUARDANDO_FORM').length, color: '#f59e0b' },
    { label: 'Reunião', count: leads.filter(l => normalizeStage(l.stage) === 'REUNIAO_AGENDADA').length, color: '#8b5cf6' },
    { label: 'Finalizado', count: finalized.length, color: '#10b981' },
  ];
  const funnelMax = Math.max(...funnelStages.map(s => s.count), 1);

  // Score médio por etapa (excluindo PERDIDO/FINALIZADO)
  const avgScore = active.length > 0
    ? Math.round(active.reduce((sum, l) => sum + computeLeadScore(l), 0) / active.length)
    : 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 h-full w-[380px] z-50 bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-primary" />
            <h2 className="text-[14px] font-bold text-foreground">Analytics do Funil</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">

          {/* KPIs principais */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total de leads', value: total, color: 'text-foreground', icon: User },
              { label: 'Em andamento', value: active.length, color: 'text-blue-400', icon: TrendingUp },
              { label: 'Convertidos', value: finalized.length, color: 'text-emerald-400', icon: CheckSquare },
              { label: 'Perdidos', value: lost.length, color: 'text-red-400', icon: AlertCircle },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="bg-accent/40 border border-border rounded-xl p-3">
                <Icon size={14} className={`${color} mb-1.5`} />
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Taxa de conversão */}
          <div className="bg-accent/40 border border-border rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Taxa de conversão</p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-emerald-400 font-bold">Convertidos {conversionRate}%</span>
                  <span className="text-red-400 font-bold">Perdidos {lossRate}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${conversionRate}%` }} />
                  <div className="h-full bg-red-500 transition-all" style={{ width: `${lossRate}%` }} />
                </div>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Score médio dos leads ativos: <span className="font-bold text-foreground">{avgScore}/100</span></p>
          </div>

          {/* Funil de conversão */}
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Funil de conversão</p>
            <div className="space-y-1.5">
              {funnelStages.map((s, i) => {
                const prev = i > 0 ? funnelStages[i - 1].count : null;
                const dropPct = prev && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : null;
                return (
                  <div key={s.label}>
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="font-semibold text-foreground">{s.label}</span>
                      <div className="flex items-center gap-2">
                        {dropPct !== null && dropPct > 0 && (
                          <span className="text-red-400 text-[10px]">-{dropPct}%</span>
                        )}
                        <span className="font-bold tabular-nums" style={{ color: s.color }}>{s.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(2, (s.count / funnelMax) * 100)}%`, backgroundColor: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Distribuição por etapa */}
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Distribuição por etapa</p>
            <div className="space-y-1.5">
              {byStage.filter(s => s.count > 0).map(s => (
                <div key={s.id}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-foreground">{s.emoji} {s.label}</span>
                    <span className="font-bold tabular-nums" style={{ color: s.color }}>{s.count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(2, (s.count / maxCount) * 100)}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Motivos de perda */}
          {sortedReasons.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Motivos de perda</p>
              <div className="space-y-1.5">
                {sortedReasons.map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground truncate flex-1 mr-2">{reason}</span>
                    <span className="font-bold text-red-400 tabular-nums shrink-0">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/40 text-center pb-2">
            Baseado em {total} lead{total !== 1 ? 's' : ''} carregados
          </p>
        </div>
      </aside>
    </>
  );
}

// ─── CrmPage ────────────────────────────────────────────────────────────────

export default function CrmPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [lawyerFilter, setLawyerFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [agingFilter, setAgingFilter] = useState(''); // '', 'ok', 'warning', 'critical'
  const [sortBy, setSortBy] = useState<'activity' | 'score'>('activity');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [dragOverPerdido, setDragOverPerdido] = useState(false);
  const [dragOverFinalizado, setDragOverFinalizado] = useState(false);
  const [previousStageMap, setPreviousStageMap] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Bulk actions
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [bulkTargetStage, setBulkTargetStage] = useState('');
  const [bulkMoving, setBulkMoving] = useState(false);

  // Modal de motivo de perda
  const [lossModal, setLossModal] = useState<{ leadId: string; leadName: string } | null>(null);
  const [lossReason, setLossReason] = useState('');

  // Modal de confirmação — Finalizado
  const [finalizedModal, setFinalizedModal] = useState<{ leadId: string; leadName: string } | null>(null);

  // Painel lateral de detalhes
  const [detailLead, setDetailLead] = useState<CrmLead | null>(null);

  // Modo de visualização: kanban ou lista
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');

  // Analytics panel
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Alertas de leads estagnados
  const [dismissedStagnation, setDismissedStagnation] = useState(false);

  // Conversão de lead para caso
  const [convertingCase, setConvertingCase] = useState(false);

  // Leads cujo PATCH ainda está em voo — fetchLeads silencioso não os sobrescreve
  const movingLeads = useRef<Set<string>>(new Set());

  // Pan horizontal do board com clique+arraste do mouse
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

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('token');
      const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
      const res = await fetch(`${API_BASE_URL}/leads/export${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showError('Erro ao exportar leads.');
    } finally {
      setExporting(false);
    }
  };

  const fetchLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.get('/leads');
      const fresh: CrmLead[] = res.data || [];
      setLeads(prev => {
        // No refresh silencioso, preserva o estado otimista de leads em trânsito
        // para evitar race condition entre o PATCH e o auto-refresh
        if (silent && movingLeads.current.size > 0) {
          return fresh.map(l =>
            movingLeads.current.has(l.id) ? (prev.find(p => p.id === l.id) ?? l) : l
          );
        }
        return fresh;
      });
      setLoadError(false);
    } catch {
      if (!silent) setLoadError(true);
      showError('Não foi possível carregar os leads. Tente novamente.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    fetchLeads();

    // Auto-refresh a cada 30s
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchLeads(true);
    }, 30_000);

    // Socket: atualiza o CRM em tempo real quando há novos leads/mensagens
    const socket = io(getWsUrl(), {
      path: getSocketPath(),
      transports: ['polling', 'websocket'],
      auth: { token },
    });
    socket.on('inboxUpdate', () => {
      if (document.visibilityState === 'visible') fetchLeads(true);
    });
    socket.on('incoming_message_notification', (data: { contactName?: string }) => {
      if (document.visibilityState === 'visible') {
        fetchLeads(true);
        if (data?.contactName) showSuccess(`Nova mensagem de ${data.contactName}`);
      }
    });

    const onLogout = () => router.push('/atendimento/login');
    window.addEventListener('auth:logout', onLogout);
    return () => {
      clearInterval(interval);
      socket.disconnect();
      window.removeEventListener('auth:logout', onLogout);
    };
  }, [router, fetchLeads]);

  const moveLeadToStage = async (leadId: string, newStage: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    // Stage gate: validar antes de mover
    const validationError = validateStageTransition(lead, newStage);
    if (validationError) {
      showError(validationError);
      return;
    }

    // Se for PERDIDO, abrir modal de motivo
    if (newStage === 'PERDIDO') {
      setLossModal({ leadId, leadName: lead.name || 'Sem nome' });
      setLossReason('');
      return;
    }

    // Se for FINALIZADO, pedir confirmação
    if (newStage === 'FINALIZADO') {
      setFinalizedModal({ leadId, leadName: lead.name || 'Sem nome' });
      return;
    }

    const prev = lead.stage;
    setPreviousStageMap(m => ({ ...m, [leadId]: prev ?? 'INICIAL' }));
    // Marca como em trânsito para proteger do auto-refresh
    movingLeads.current.add(leadId);
    // Atualização otimista imediata
    setLeads(cur => cur.map(l => l.id === leadId ? { ...l, stage: newStage, stage_entered_at: new Date().toISOString() } : l));
    try {
      const res = await api.patch(`/leads/${leadId}/stage`, { stage: newStage });
      // Confirma com dados autoritativos do servidor
      if (res.data) {
        setLeads(cur => cur.map(l => l.id === leadId ? { ...l, ...res.data } : l));
      }
    } catch {
      // Rollback
      setLeads(cur => cur.map(l =>
        l.id === leadId ? { ...l, stage: previousStageMap[leadId] ?? 'INICIAL' } : l
      ));
      showError('Erro ao mover lead. Tente novamente.');
    } finally {
      movingLeads.current.delete(leadId);
    }
  };

  const confirmLoss = async () => {
    if (!lossModal || !lossReason.trim()) return;
    const { leadId } = lossModal;
    const lead = leads.find(l => l.id === leadId);
    const prev = lead?.stage;
    setPreviousStageMap(m => ({ ...m, [leadId]: prev ?? 'INICIAL' }));
    movingLeads.current.add(leadId);
    setLeads(cur => cur.map(l => l.id === leadId ? { ...l, stage: 'PERDIDO', stage_entered_at: new Date().toISOString() } : l));
    setLossModal(null);
    try {
      const res = await api.patch(`/leads/${leadId}/stage`, { stage: 'PERDIDO', loss_reason: lossReason.trim() });
      if (res.data) {
        setLeads(cur => cur.map(l => l.id === leadId ? { ...l, ...res.data } : l));
      }
    } catch {
      setLeads(cur => cur.map(l =>
        l.id === leadId ? { ...l, stage: previousStageMap[leadId] ?? 'INICIAL' } : l
      ));
      showError('Erro ao mover lead. Tente novamente.');
    } finally {
      movingLeads.current.delete(leadId);
    }
  };

  const confirmFinalized = async () => {
    if (!finalizedModal) return;
    const { leadId } = finalizedModal;
    setFinalizedModal(null);
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const validationError = validateStageTransition(lead, 'FINALIZADO');
    if (validationError) { showError(validationError); return; }
    const prev = lead.stage;
    setPreviousStageMap(m => ({ ...m, [leadId]: prev ?? 'INICIAL' }));
    movingLeads.current.add(leadId);
    setLeads(cur => cur.map(l => l.id === leadId ? { ...l, stage: 'FINALIZADO', stage_entered_at: new Date().toISOString() } : l));
    try {
      const res = await api.patch(`/leads/${leadId}/stage`, { stage: 'FINALIZADO' });
      if (res.data) setLeads(cur => cur.map(l => l.id === leadId ? { ...l, ...res.data } : l));
    } catch {
      setLeads(cur => cur.map(l => l.id === leadId ? { ...l, stage: previousStageMap[leadId] ?? 'INICIAL' } : l));
      showError('Erro ao mover lead. Tente novamente.');
    } finally {
      movingLeads.current.delete(leadId);
    }
  };

  const toggleSelect = (leadId: string) => {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedLeads(new Set());
    setBulkTargetStage('');
  };

  const bulkMoveLeads = async () => {
    if (!bulkTargetStage || selectedLeads.size === 0 || bulkMoving) return;
    // Não permite bulk move para PERDIDO (exige motivo) ou FINALIZADO (exige validações)
    if (bulkTargetStage === 'PERDIDO' || bulkTargetStage === 'FINALIZADO') {
      showError('Mova leads para PERDIDO ou FINALIZADO individualmente (requerem validações).');
      return;
    }
    setBulkMoving(true);
    const ids = [...selectedLeads];
    // Otimismo: atualiza todos de vez
    setLeads(prev => prev.map(l =>
      ids.includes(l.id) ? { ...l, stage: bulkTargetStage, stage_entered_at: new Date().toISOString() } : l
    ));
    try {
      await Promise.all(ids.map(id => api.patch(`/leads/${id}/stage`, { stage: bulkTargetStage })));
      showSuccess(`${ids.length} lead(s) movidos para ${findStage(bulkTargetStage)?.label ?? bulkTargetStage}.`);
      clearSelection();
    } catch {
      // Rollback parcial — rebusca do servidor
      fetchLeads(true);
      showError('Erro ao mover alguns leads. A lista foi atualizada.');
    } finally {
      setBulkMoving(false);
    }
  };

  // Sincroniza painel lateral com o lead atualizado
  const openDetail = useCallback((lead: CrmLead) => {
    setDetailLead(leads.find(l => l.id === lead.id) ?? lead);
  }, [leads]);

  // Converte lead finalizado em caso jurídico
  const convertLeadToCase = async (lead: CrmLead) => {
    if (convertingCase) return;
    setConvertingCase(true);
    try {
      const conv = lead.conversations?.[0];
      await api.post('/legal-cases', {
        lead_id: lead.id,
        conversation_id: conv?.id ?? undefined,
        legal_area: conv?.legal_area ?? undefined,
      });
      showSuccess(`Caso criado para ${lead.name || 'o lead'}! Redirecionando...`);
      setDetailLead(null);
      setTimeout(() => router.push('/atendimento/advogado'), 1200);
    } catch {
      showError('Erro ao criar caso. Tente novamente.');
    } finally {
      setConvertingCase(false);
    }
  };

  const openInChat = (lead: CrmLead) => {
    const conv = lead.conversations?.[0];
    if (conv?.id) sessionStorage.setItem('crm_open_conv', conv.id);
    router.push('/atendimento');
  };

  // Coletar valores únicos para filtros
  const allAreas = [...new Set(
    leads.flatMap(l => l.conversations?.map(c => c.legal_area).filter(Boolean) ?? [])
  )].sort() as string[];

  const allLawyers = [...new Map(
    leads.flatMap(l => l.conversations?.map(c => c.assigned_lawyer).filter(Boolean) ?? [])
      .map(lawyer => [lawyer!.id, lawyer!])
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  const allTags = [...new Set(
    leads.flatMap(l => l.tags ?? [])
  )].sort();

  const activeFilterCount = [areaFilter, lawyerFilter, tagFilter, agingFilter].filter(Boolean).length;

  // Filtrar leads
  const filteredLeads = leads.filter(lead => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const name = (lead.name || '').toLowerCase();
      const phone = (lead.phone || '').toLowerCase();
      if (!name.includes(q) && !phone.includes(q)) return false;
    }
    if (areaFilter) {
      const hasArea = lead.conversations?.some(c => c.legal_area === areaFilter);
      if (!hasArea) return false;
    }
    if (lawyerFilter) {
      const hasLawyer = lead.conversations?.some(c => c.assigned_lawyer?.id === lawyerFilter);
      if (!hasLawyer) return false;
    }
    if (tagFilter) {
      if (!lead.tags?.includes(tagFilter)) return false;
    }
    if (agingFilter) {
      const days = daysInStage(lead.stage_entered_at);
      if (agingFilter === 'ok' && days > 2) return false;
      if (agingFilter === 'warning' && (days <= 2 || days > 5)) return false;
      if (agingFilter === 'critical' && days <= 5) return false;
    }
    return true;
  });

  const getStageLeads = (stageId: string) =>
    filteredLeads
      .filter(l => normalizeStage(l.stage) === stageId)
      .sort((a, b) => {
        if (sortBy === 'score') return computeLeadScore(b) - computeLeadScore(a);
        const ta = a.conversations?.[0]?.last_message_at ? new Date(a.conversations[0].last_message_at).getTime() : 0;
        const tb = b.conversations?.[0]?.last_message_at ? new Date(b.conversations[0].last_message_at).getTime() : 0;
        return tb - ta;
      });

  return (
    <div className="flex h-screen bg-background font-sans antialiased text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="px-6 py-5 border-b border-border shrink-0 flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground tracking-tight">CRM Pipeline</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {filteredLeads.filter(l => normalizeStage(l.stage) !== 'PERDIDO' && normalizeStage(l.stage) !== 'FINALIZADO').length} lead{filteredLeads.filter(l => normalizeStage(l.stage) !== 'PERDIDO' && normalizeStage(l.stage) !== 'FINALIZADO').length !== 1 ? 's' : ''} {searchQuery || activeFilterCount > 0 ? 'filtrados' : 'no total'}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setAreaFilter(''); setLawyerFilter(''); setTagFilter(''); setAgingFilter(''); }}
                  className="ml-2 text-primary hover:underline"
                >
                  Limpar filtros ({activeFilterCount})
                </button>
              )}
            </p>
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro por área */}
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

            {/* Filtro por advogado */}
            {allLawyers.length > 0 && (
              <div className="relative">
                <select
                  value={lawyerFilter}
                  onChange={e => setLawyerFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                >
                  <option value="">Todos os advogados</option>
                  {allLawyers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            )}

            {/* Filtro por tag */}
            {allTags.length > 0 && (
              <div className="relative">
                <select
                  value={tagFilter}
                  onChange={e => setTagFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                >
                  <option value="">Todas as tags</option>
                  {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            )}

            {/* Filtro por tempo no estágio */}
            <div className="relative">
              <select
                value={agingFilter}
                onChange={e => setAgingFilter(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
              >
                <option value="">Tempo no estágio</option>
                <option value="ok">Recentes (até 2d)</option>
                <option value="warning">Atenção (3-5d)</option>
                <option value="critical">Críticos (6d+)</option>
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>

            {/* Busca por nome/telefone */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar lead…"
                className="pl-8 pr-3 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 w-44"
              />
            </div>

            {/* Ordenar por score */}
            <button
              onClick={() => setSortBy(v => v === 'activity' ? 'score' : 'activity')}
              className={`px-2.5 py-1.5 text-[12px] rounded-lg border transition-all ${
                sortBy === 'score'
                  ? 'border-primary/50 bg-primary/10 text-primary font-semibold'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
              title="Ordenar por score do lead"
            >
              {sortBy === 'score' ? '⭐ Score' : '⭐ Score'}
            </button>

            {/* Analytics */}
            <button
              onClick={() => setShowAnalytics(v => !v)}
              className={`p-1.5 rounded-lg transition-all ${showAnalytics ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              title="Analytics do funil"
            >
              <BarChart2 size={14} />
            </button>

            {/* Toggle visualização kanban/lista */}
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('kanban')}
                className={`p-1.5 transition-all ${viewMode === 'kanban' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
                title="Visualização kanban"
              >
                <Columns size={14} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 transition-all ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
                title="Visualização lista"
              >
                <LayoutList size={14} />
              </button>
            </div>

            {/* Exportar CSV */}
            <button
              onClick={downloadCsv}
              disabled={exporting}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Exportar leads para CSV"
            >
              <Download size={14} className={exporting ? 'animate-pulse' : ''} />
            </button>

            {/* Atualizar */}
            <button
              onClick={() => fetchLeads(true)}
              disabled={refreshing}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Atualizar"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {/* Alerta de leads estagnados */}
        {!dismissedStagnation && !loading && (() => {
          const threshold = getStagnationDays();
          const stagnant = leads.filter(l => {
            const stage = normalizeStage(l.stage);
            if (stage === 'PERDIDO' || stage === 'FINALIZADO') return false;
            const lastMsg = l.conversations?.[0]?.last_message_at;
            const daysSinceMsg = lastMsg ? Math.floor((Date.now() - new Date(lastMsg).getTime()) / 86400000) : 999;
            return daysSinceMsg >= threshold;
          });
          if (stagnant.length === 0) return null;
          return (
            <div className="mx-6 mt-3 mb-1 flex items-center gap-3 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
              <AlertCircle size={15} className="text-yellow-400 shrink-0" />
              <p className="flex-1 text-[12px] text-yellow-300">
                <span className="font-bold">{stagnant.length} lead{stagnant.length !== 1 ? 's' : ''}</span> sem atividade há mais de 3 dias:{' '}
                <span className="opacity-80">{stagnant.slice(0, 3).map(l => l.name || l.phone).join(', ')}{stagnant.length > 3 ? ` e mais ${stagnant.length - 3}` : ''}</span>
              </p>
              <button onClick={() => setDismissedStagnation(true)} className="p-1 rounded-md text-yellow-400/60 hover:text-yellow-400 transition-colors shrink-0">
                <XIcon size={13} />
              </button>
            </div>
          );
        })()}

        {/* Board / Lista */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground text-sm animate-pulse">Carregando leads…</div>
          </div>
        ) : loadError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-muted-foreground text-sm">Erro ao carregar leads.</p>
            <button onClick={() => fetchLeads()} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors">
              Tentar novamente
            </button>
          </div>
        ) : viewMode === 'list' ? (
          <LeadListView
            leads={filteredLeads}
            onOpenDetail={openDetail}
            onOpenChat={openInChat}
            onStageChange={(id, stage) => moveLeadToStage(id, stage)}
            selectedLeads={selectedLeads}
            onToggleSelect={toggleSelect}
            selectionMode={selectedLeads.size > 0}
          />
        ) : (
          <div
            ref={boardRef}
            className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5 cursor-grab select-none"
            onMouseDown={handleBoardMouseDown}
            onMouseMove={handleBoardMouseMove}
            onMouseUp={handleBoardMouseUp}
            onMouseLeave={handleBoardMouseUp}
          >
            <div className="flex h-full gap-4" style={{ minWidth: `${(CRM_STAGES.length - 2) * 272}px` }}>
              {CRM_STAGES.filter(s => s.id !== 'PERDIDO' && s.id !== 'FINALIZADO').map(stage => {
                const stageLeads = getStageLeads(stage.id);
                const isTerminal = false;
                const isDragTarget = dragOverStage === stage.id;
                const agingCount = stageLeads.filter(l => daysInStage(l.stage_entered_at) > 5).length;

                return (
                  <div
                    key={stage.id}
                    className={`flex flex-col w-[260px] min-w-[260px] rounded-xl border transition-all duration-150 ${
                      isTerminal ? 'opacity-75' : ''
                    } ${
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
                      if (draggingId) moveLeadToStage(draggingId, stage.id);
                      setDragOverStage(null);
                    }}
                  >
                    {/* Header da coluna */}
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
                      <div className="flex items-center gap-1">
                        {/* Aging alert counter */}
                        {agingCount > 0 && (
                          <span
                            className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold bg-red-500/20 text-red-400"
                            title={`${agingCount} lead(s) parado(s) há mais de 5 dias`}
                          >
                            {agingCount}
                          </span>
                        )}
                        {/* Total counter */}
                        <span
                          className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                        >
                          {stageLeads.length}
                        </span>
                      </div>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
                      {stageLeads.map(lead => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          isDragging={draggingId === lead.id}
                          onDragStart={() => setDraggingId(lead.id)}
                          onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                          onOpen={() => openInChat(lead)}
                          onOpenDetail={() => openDetail(lead)}
                          onStageChange={(newStage) => moveLeadToStage(lead.id, newStage)}
                          isSelected={selectedLeads.has(lead.id)}
                          onToggleSelect={() => toggleSelect(lead.id)}
                          selectionMode={selectedLeads.size > 0}
                        />
                      ))}

                      {stageLeads.length === 0 && (
                        <div
                          className={`text-center p-5 border-2 border-dashed rounded-xl text-muted-foreground/50 transition-all ${
                            isDragTarget ? 'border-current opacity-100' : 'border-border/40 opacity-60'
                          }`}
                          style={isDragTarget ? { borderColor: stage.color, color: stage.color } : undefined}
                        >
                          {isDragTarget ? (
                            <p className="text-[12px] font-semibold">Soltar aqui</p>
                          ) : (
                            <>
                              <p className="text-[11px] font-medium">Nenhum lead aqui</p>
                              <p className="text-[10px] mt-1 opacity-70">Arraste cards ou use o menu ⋮</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Barra de ações em massa */}
        {selectedLeads.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-card border border-border rounded-2xl shadow-2xl shadow-black/30 backdrop-blur-sm">
            <span className="text-[13px] font-semibold text-foreground">
              {selectedLeads.size} lead{selectedLeads.size !== 1 ? 's' : ''} selecionado{selectedLeads.size !== 1 ? 's' : ''}
            </span>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <select
                value={bulkTargetStage}
                onChange={e => setBulkTargetStage(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 text-[12px] bg-accent border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
              >
                <option value="">Mover para…</option>
                {CRM_STAGES.filter(s => s.id !== 'PERDIDO' && s.id !== 'FINALIZADO').map(s => (
                  <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                ))}
              </select>
              <button
                onClick={bulkMoveLeads}
                disabled={!bulkTargetStage || bulkMoving}
                className="px-4 py-1.5 text-[12px] rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bulkMoving ? 'Movendo…' : 'Mover'}
              </button>
            </div>
            <button
              onClick={clearSelection}
              className="ml-1 w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Cancelar seleção"
            >
              <XIcon size={14} />
            </button>
          </div>
        )}

        {/* ── Drop zones — Finalizado e Perdido (aparecem ao arrastar qualquer card) ── */}
        {draggingId && (
          <div className="fixed bottom-6 right-6 z-50 flex items-end gap-3">

            {/* FINALIZADO */}
            <div
              className={`flex items-center gap-3 px-5 py-4 rounded-2xl border-2 border-dashed transition-all duration-150 select-none ${
                dragOverFinalizado
                  ? 'bg-emerald-500/15 border-emerald-500 scale-105 shadow-lg shadow-emerald-500/20'
                  : 'bg-background/95 border-emerald-400/50 shadow-xl shadow-black/20 backdrop-blur-sm'
              }`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFinalizado(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFinalizado(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverFinalizado(false);
                setDragOverStage(null);
                if (draggingId) moveLeadToStage(draggingId, 'FINALIZADO');
              }}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                dragOverFinalizado ? 'bg-emerald-500' : 'bg-emerald-500/15'
              }`}>
                <CheckSquare size={20} className={dragOverFinalizado ? 'text-white' : 'text-emerald-400'} />
              </div>
              <div>
                <p className={`text-sm font-bold leading-tight transition-colors ${
                  dragOverFinalizado ? 'text-emerald-400' : 'text-foreground'
                }`}>
                  {dragOverFinalizado ? 'Soltar para Finalizar' : 'Arraste aqui → Finalizado'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Lead convertido com sucesso ✅</p>
              </div>
            </div>

            {/* PERDIDO */}
            <div
              className={`flex items-center gap-3 px-5 py-4 rounded-2xl border-2 border-dashed transition-all duration-150 select-none ${
                dragOverPerdido
                  ? 'bg-red-500/15 border-red-500 scale-105 shadow-lg shadow-red-500/20'
                  : 'bg-background/95 border-red-400/50 shadow-xl shadow-black/20 backdrop-blur-sm'
              }`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverPerdido(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverPerdido(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverPerdido(false);
                setDragOverStage(null);
                if (draggingId) moveLeadToStage(draggingId, 'PERDIDO');
              }}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                dragOverPerdido ? 'bg-red-500' : 'bg-red-500/15'
              }`}>
                <XIcon size={20} className={dragOverPerdido ? 'text-white' : 'text-red-400'} />
              </div>
              <div>
                <p className={`text-sm font-bold leading-tight transition-colors ${
                  dragOverPerdido ? 'text-red-400' : 'text-foreground'
                }`}>
                  {dragOverPerdido ? 'Soltar para marcar como Perdido' : 'Arraste aqui → Perdido'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Arquivado após informar o motivo</p>
              </div>
            </div>

          </div>
        )}

        {/* Modal de confirmação — Finalizado */}
        {finalizedModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
              <h3 className="text-lg font-bold text-foreground mb-1">Finalizar lead?</h3>
              <p className="text-sm text-muted-foreground mb-5">
                Deseja marcar <strong>{finalizedModal.leadName}</strong> como <span className="text-emerald-400 font-semibold">Finalizado</span>? Essa etapa indica que o lead foi convertido com sucesso.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setFinalizedModal(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmFinalized}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
                >
                  Confirmar ✅
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de motivo de perda */}
        {lossModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
              <h3 className="text-lg font-bold text-foreground mb-1">Marcar como Perdido</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Por que o lead <strong>{lossModal.leadName}</strong> foi perdido?
              </p>
              <div className="space-y-2 mb-4">
                {LOSS_REASONS.map(reason => (
                  <button
                    key={reason}
                    onClick={() => setLossReason(reason)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                      lossReason === reason
                        ? 'border-red-500 bg-red-500/10 text-red-400 font-medium'
                        : 'border-border hover:bg-accent text-muted-foreground'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={LOSS_REASONS.includes(lossReason) ? '' : lossReason}
                onChange={e => setLossReason(e.target.value)}
                placeholder="Outro motivo..."
                className="w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setLossModal(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmLoss}
                  disabled={!lossReason.trim()}
                  className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Confirmar Perda
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Painel lateral de detalhes */}
      {detailLead && (
        <LeadDetailPanel
          lead={leads.find(l => l.id === detailLead.id) ?? detailLead}
          onClose={() => setDetailLead(null)}
          onOpenChat={() => { openInChat(detailLead); setDetailLead(null); }}
          onStageChange={(stage) => moveLeadToStage(detailLead.id, stage)}
          onConvertToCase={() => convertLeadToCase(detailLead)}
          convertingCase={convertingCase}
        />
      )}

      {/* Analytics panel */}
      {showAnalytics && (
        <CrmAnalyticsPanel leads={leads} onClose={() => setShowAnalytics(false)} />
      )}

    </div>
  );
}
