'use client';

import { useState, useRef, useEffect } from 'react';
import { Bot, BotOff, UserCheck, CornerDownLeft, Inbox, Eye, ClipboardList, ArrowLeft, ChevronDown, ChevronRight, MoreVertical, Clock, Copy, Check, Tag, Plus, X as XIcon, RefreshCw } from 'lucide-react';
import { CRM_STAGES, findStage, normalizeStage } from '@/lib/crmStages';
import type { ConversationSummary, ActiveTask } from '../types';
import { ContactAvatar } from './ContactAvatar';

const LEGAL_AREAS = [
  'Trabalhista', 'Consumidor', 'Família', 'Previdenciário',
  'Penal', 'Civil', 'Empresarial', 'Imobiliário', 'Outro',
];

function getInitial(name?: string) {
  return (name || 'V')[0].toUpperCase();
}

function formatTaskDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (d < now) return 'Atrasado';
  if (isToday) return `Hoje ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (isTomorrow) return `Amanhã ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}


export interface ChatHeaderProps {
  selected: ConversationSummary;
  selectedId: string;
  isMobile: boolean;
  isRealConvo: boolean;
  isClosed: boolean;
  aiMode: boolean;
  leadStage: string | null;
  fichaFinalizada: boolean;
  allSpecialists: { id: string; name: string; specialties: string[] }[];
  currentUserId: string | null;
  // Dropdowns
  showLegalAreaDropdown: boolean;
  showLawyerDropdown: boolean;
  showStageDropdown: boolean;
  // Refs
  legalAreaDropdownRef: React.RefObject<HTMLDivElement | null>;
  lawyerDropdownRef: React.RefObject<HTMLDivElement | null>;
  stageDropdownRef: React.RefObject<HTMLDivElement | null>;
  // Callbacks
  onBack: () => void;
  onToggleLegalArea: () => void;
  onChangeLegalArea: (area: string | null) => void;
  onToggleLawyer: () => void;
  onAssignLawyer: (id: string | null) => void;
  onToggleAiMode: () => void;
  onAccept: () => void;
  onOpenTransferModal: () => void;
  onOpenReasonPopup: (ctx: 'lawyer' | 'operator' | 'return', name: string) => void;
  onKeepInInbox: () => void;
  onToggleStage: () => void;
  onChangeStage: (stage: string) => void;
  onSendFormLink: () => void;
  onShowFicha: () => void;
  onShowDetails: () => void;
  onSetClientPanelLeadId: (id: string | null) => void;
  onLightbox: (url: string) => void;
  onCreateTask: () => void;
  onSyncHistory?: () => void;
  contactPresence?: string;
  // Task management
  activeTask?: ActiveTask | null;
  onCompleteTask?: (note: string) => void;
  onPostponeTask?: (newDate: string, reason: string) => void;
  onNewTask?: () => void;
  leadTags?: string[];
  onUpdateTags?: (tags: string[]) => void;
}

export function ChatHeader({
  selected,
  selectedId,
  isMobile,
  isRealConvo,
  isClosed,
  aiMode,
  leadStage,
  fichaFinalizada,
  allSpecialists,
  currentUserId,
  showLegalAreaDropdown,
  showLawyerDropdown,
  showStageDropdown,
  legalAreaDropdownRef,
  lawyerDropdownRef,
  stageDropdownRef,
  onBack,
  onToggleLegalArea,
  onChangeLegalArea,
  onToggleLawyer,
  onAssignLawyer,
  onToggleAiMode,
  onAccept,
  onOpenTransferModal,
  onOpenReasonPopup,
  onKeepInInbox,
  onToggleStage,
  onChangeStage,
  onSendFormLink,
  onShowFicha,
  onShowDetails,
  onSetClientPanelLeadId,
  onLightbox,
  onCreateTask,
  onSyncHistory,
  contactPresence,
  activeTask,
  onCompleteTask,
  onPostponeTask,
  onNewTask,
  leadTags,
  onUpdateTags,
}: ChatHeaderProps) {
  const [copiedPhone, setCopiedPhone] = useState(false);
  // Modais de tarefa
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeNote, setCompleteNote] = useState('');
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeReason, setPostponeReason] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showTagInput) setTimeout(() => tagInputRef.current?.focus(), 50);
  }, [showTagInput]);

  const handleAddTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '_');
    if (!t || (leadTags ?? []).includes(t)) { setTagInput(''); setShowTagInput(false); return; }
    onUpdateTags?.([...(leadTags ?? []), t]);
    setTagInput('');
    setShowTagInput(false);
  };

  const handleRemoveTag = (tag: string) => {
    onUpdateTags?.((leadTags ?? []).filter(t => t !== tag));
  };
  const isAdiado = selected?.status === 'ADIADO';
  const isOverdue = activeTask?.dueAt ? new Date(activeTask.dueAt) < new Date() : false;

  return (
    <div className="shrink-0 relative z-40">
    <header className="min-h-[60px] md:min-h-[80px] py-2 md:py-3 px-3 md:px-8 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between">
      <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
        {/* Botão Voltar - mobile only */}
        {isMobile && (
          <button
            onClick={onBack}
            aria-label="Voltar"
            className="p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <ContactAvatar
          src={selected.profile_picture_url}
          name={selected.contactName}
          sizeClass="w-10 h-10 md:w-12 md:h-12"
          onClick={(url) => onLightbox(url)}
        />
        <div
          className="min-w-0 flex-1 cursor-pointer active:opacity-70 transition-opacity"
          onClick={() => {
            if (isMobile) {
              onShowDetails();
            } else {
              onSetClientPanelLeadId(selected.leadId);
            }
          }}
        >
          <div className="flex items-center gap-1">
            <h3 className="font-bold text-base md:text-lg leading-tight truncate">{selected.contactName || selected.contactPhone}</h3>
            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
          </div>
          <div className="flex items-center gap-1 mt-0.5 md:mt-1">
            <span className="text-[11px] md:text-xs text-muted-foreground uppercase tracking-wider font-semibold truncate">
              {selected.channel} <span className="mx-1">•</span> {selected.contactPhone}
            </span>
            {selected.contactPhone && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(selected.contactPhone).then(() => {
                    setCopiedPhone(true);
                    setTimeout(() => setCopiedPhone(false), 2000);
                  });
                }}
                title="Copiar número"
                className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {copiedPhone ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              </button>
            )}
          </div>
          {contactPresence && contactPresence !== 'unavailable' && (
            <span className="text-[10px] font-medium text-emerald-400">
              {contactPresence === 'composing' ? 'digitando...' : 'online'}
            </span>
          )}
          {/* Tags do lead */}
          {isRealConvo && (
            <div className="hidden md:flex items-center gap-1 flex-wrap mt-1" onClick={e => e.stopPropagation()}>
              {(leadTags ?? []).map(tag => (
                <span
                  key={tag}
                  className="group inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 border border-primary/20 transition-colors hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 cursor-pointer"
                  onClick={() => handleRemoveTag(tag)}
                  title={`Remover tag "${tag}"`}
                >
                  {tag}
                  <XIcon size={8} className="opacity-60 group-hover:opacity-100" />
                </span>
              ))}
              {showTagInput ? (
                <input
                  ref={tagInputRef}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddTag(); if (e.key === 'Escape') { setShowTagInput(false); setTagInput(''); } }}
                  onBlur={handleAddTag}
                  placeholder="nova tag…"
                  className="text-[10px] bg-transparent border-b border-primary/40 outline-none text-foreground w-20 px-0.5"
                />
              ) : (
                <button
                  onClick={() => setShowTagInput(true)}
                  title="Adicionar etiqueta"
                  className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground/50 hover:text-primary transition-colors"
                >
                  <Tag size={9} />
                  <Plus size={8} />
                </button>
              )}
            </div>
          )}
          {/* Área jurídica + especialista pré-atribuído — hidden on mobile */}
          <div className="hidden md:flex items-center gap-2 flex-wrap mt-1.5">
            {/* Badge de área — clicável para editar */}
            <div className="relative" ref={legalAreaDropdownRef}>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleLegalArea(); }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors hover:opacity-80 ${selected.legalArea ? 'bg-violet-500/15 text-violet-400 border-violet-500/20 hover:bg-violet-500/25' : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'}`}
                title="Clique para definir ou alterar a área de atendimento"
              >
                ⚖️ {selected.legalArea || 'Definir área'}
                <ChevronDown size={9} className="ml-0.5 opacity-70" />
              </button>
              {showLegalAreaDropdown && (
                <div className="absolute left-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl w-44 py-1 text-[12px] z-[200]">
                  <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Área de Atendimento</p>
                  {LEGAL_AREAS.map(area => (
                    <button
                      key={area}
                      onClick={(e) => { e.stopPropagation(); onChangeLegalArea(area); }}
                      className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 ${selected.legalArea === area ? 'text-violet-400 font-semibold' : 'text-foreground'}`}
                    >
                      ⚖️ {area}
                    </button>
                  ))}
                  {selected.legalArea && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onChangeLegalArea(null); }}
                      className="w-full text-left px-3 py-2 text-muted-foreground hover:bg-accent hover:text-destructive transition-colors text-[11px] border-t border-border mt-1"
                    >
                      Remover área
                    </button>
                  )}
                </div>
              )}
            </div>
            {fichaFinalizada && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                ✅ Ficha Finalizada
              </span>
            )}
            {selected.legalArea && (
              <div className="relative" ref={lawyerDropdownRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleLawyer(); }}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${selected.assignedLawyerName ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20' : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'}`}
                  title="Clique para atribuir ou trocar o especialista"
                >
                  <UserCheck size={10} />
                  {selected.assignedLawyerName || 'Atribuir especialista'}
                </button>
                {showLawyerDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-xl shadow-xl w-56 py-1 text-[12px]" style={{ zIndex: 9999 }}>
                    <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      {selected.assignedLawyerName ? 'Trocar especialista' : 'Escolher especialista'}
                    </p>
                    {allSpecialists.length === 0 && (
                      <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhum especialista cadastrado</p>
                    )}
                    {allSpecialists.map(u => (
                      <button
                        key={u.id}
                        onClick={(e) => { e.stopPropagation(); onAssignLawyer(u.id); }}
                        className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 ${u.id === selected.assignedLawyerId ? 'text-primary font-semibold' : 'text-foreground'}`}
                      >
                        <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                          {u.name.charAt(0)}
                        </span>
                        <div>
                          <p className="leading-tight">{u.name}</p>
                          <p className="text-[9px] text-muted-foreground">{u.specialties.join(', ')}</p>
                        </div>
                      </button>
                    ))}
                    {selected.assignedLawyerId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAssignLawyer(null); }}
                        className="w-full text-left px-3 py-2 text-muted-foreground hover:bg-accent hover:text-destructive transition-colors text-[11px] border-t border-border mt-1"
                      >
                        Remover especialista
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        {/* Badges informativos inline — mobile */}
        {isMobile && (
          <div className="flex items-center gap-1.5">
            {isRealConvo && (
              <span className={`w-2 h-2 rounded-full shrink-0 ${aiMode ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-muted-foreground/40'}`} title={aiMode ? 'IA Ativa' : 'IA Inativa'} />
            )}
            {selected?.legalArea && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 text-[9px] font-bold border border-violet-500/20">
                ⚖️ {selected.legalArea}
              </span>
            )}
            {fichaFinalizada && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-bold border border-emerald-500/20">
                ✅
              </span>
            )}
          </div>
        )}
        {/* Linha de botões de ação — desktop only */}
        <div className="hidden md:flex gap-2 items-center flex-wrap justify-end">
          {selected?.legalArea?.toLowerCase().includes('trabalhist') && (
            <>
              {!isClosed && (
                <button
                  onClick={onSendFormLink}
                  title="Enviar link do formulário trabalhista ao lead"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/20 hover:bg-amber-500/25 transition-colors"
                >
                  <ClipboardList size={10} />
                  Enviar Formulário
                </button>
              )}
              <button
                onClick={onShowFicha}
                title="Visualizar ficha trabalhista"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 text-[10px] font-bold border border-violet-500/20 hover:bg-violet-500/25 transition-colors"
              >
                <Eye size={10} />
                Visualizar Ficha
              </button>
            </>
          )}
          {isRealConvo && (
            <button
              onClick={onToggleAiMode}
              title={aiMode ? 'Desativar IA' : 'Ativar IA'}
              className={`px-4 py-2 text-sm font-semibold border rounded-xl transition-colors flex items-center gap-2 ${
                aiMode
                  ? 'text-primary bg-primary/10 border-primary/20 hover:bg-primary/20'
                  : 'text-muted-foreground bg-muted/30 border-border hover:bg-muted/60'
              }`}
            >
              {aiMode ? <Bot size={16} /> : <BotOff size={16} />}
              {aiMode ? 'IA Ativa' : 'IA Inativa'}
            </button>
          )}
          {selected.status === 'WAITING' && isRealConvo && (
            <button
              onClick={onAccept}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-ring text-primary-foreground font-bold text-sm shadow-[0_0_15px_rgba(var(--primary),0.3)] hover:shadow-[0_0_20px_rgba(var(--primary),0.4)] hover:-translate-y-0.5 transition-all"
            >
              Aceitar Atendimento
            </button>
          )}
          {!isClosed && isRealConvo && (
            <button
              onClick={onOpenTransferModal}
              title="Transferir conversa para outro operador"
              className="px-3 py-2 text-sm font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-xl hover:bg-sky-500/20 transition-colors flex items-center gap-2"
            >
              <UserCheck size={16} />
              Transferir
            </button>
          )}
          {selected?.originAssignedUserId && selected?.assignedAgentId === currentUserId && !isClosed && (
            <>
              <button
                onClick={() => onOpenReasonPopup('return', selected?.originAssignedUserName || 'atendente de origem')}
                title="Devolver conversa ao atendente de origem"
                className="px-3 py-2 text-sm font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 transition-colors flex items-center gap-2"
              >
                <CornerDownLeft size={16} />
                Devolver
              </button>
              <button
                onClick={onKeepInInbox}
                title="Manter conversa no meu inbox"
                className="px-3 py-2 text-sm font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl hover:bg-emerald-500/20 transition-colors flex items-center gap-2"
              >
                <Inbox size={16} />
                Manter Aqui
              </button>
            </>
          )}
          {selected?.leadId && isRealConvo && !isClosed && (
            <button
              onClick={onCreateTask}
              title="Adiar atendimento"
              className="px-3 py-2 text-sm font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 transition-colors flex items-center gap-2"
            >
              <Clock size={16} />
              Adiar
            </button>
          )}
          {isRealConvo && onSyncHistory && (
            <button
              onClick={onSyncHistory}
              title="Sincronizar histórico de mensagens com WhatsApp"
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-xl transition-colors"
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>

        {/* Etapa do Funil (CRM) — hidden on mobile */}
        {isRealConvo && (() => {
          const stage = findStage(normalizeStage(leadStage));
          return (
            <div className="relative hidden md:flex items-center gap-2" ref={stageDropdownRef}>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                Etapa do Funil:
              </span>
              <button
                onClick={() => onToggleStage()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all hover:opacity-80"
                style={{ background: `${stage.color}18`, color: stage.color, borderColor: `${stage.color}35` }}
                title="Clique para trocar a etapa do funil"
              >
                {stage.emoji} {stage.label}
                <ChevronDown size={10} className="opacity-60" />
              </button>
              {showStageDropdown && (
                <div className="absolute top-full right-0 mt-1 bg-card border border-border rounded-xl shadow-xl w-56 py-1" style={{ zIndex: 9999 }}>
                  <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Etapa do Funil</p>
                  {CRM_STAGES.map(s => (
                    <button
                      key={s.id}
                      onClick={() => onChangeStage(s.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 text-[12px] ${normalizeStage(leadStage) === s.id ? 'font-semibold' : ''}`}
                      style={{ color: normalizeStage(leadStage) === s.id ? s.color : undefined }}
                    >
                      <span>{s.emoji}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </header>

    {/* ── Barra de tarefa ativa — aparece sempre que houver activeTask ── */}
    {activeTask && (
      <div className={`flex items-center gap-2 px-3 md:px-6 py-2 border-b ${
        isOverdue ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20'
      }`}>
        <Clock size={13} className={`shrink-0 ${isOverdue ? 'text-red-400 animate-pulse' : 'text-amber-400'}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold truncate ${isOverdue ? 'text-red-400' : 'text-amber-300'}`}>
            {activeTask.title}
            {activeTask.dueAt && (
              <span className={`ml-2 text-[10px] font-bold ${isOverdue ? 'text-red-500' : 'opacity-60'}`}>
                {formatTaskDate(activeTask.dueAt)}
              </span>
            )}
          </p>
          {(activeTask.postponeCount ?? 0) > 0 && (
            <p className="text-[9px] text-amber-500/60 font-medium">
              {activeTask.postponeCount}ª vez adiando
            </p>
          )}
        </div>

        {/* Concluir */}
        <button
          onClick={() => { setCompleteNote(''); setShowCompleteModal(true); }}
          className="px-2.5 py-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
        >
          ✓ Concluir
        </button>

        {/* Adiar */}
        <button
          onClick={() => { setPostponeDate(''); setPostponeReason(''); setShowPostponeModal(true); }}
          className="px-2.5 py-1 text-[11px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition-colors whitespace-nowrap"
        >
          ⏰ Adiar
        </button>

        {/* Nova tarefa */}
        <button
          onClick={onNewTask}
          className="px-2.5 py-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors whitespace-nowrap"
          title="Criar nova tarefa para este contato"
        >
          + Nova
        </button>
      </div>
    )}

    {/* ── Modal: Concluir tarefa ── */}
    {showCompleteModal && activeTask && (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setShowCompleteModal(false)}
      >
        <div
          className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">✅</span>
            <h3 className="font-bold text-sm">Concluir tarefa</h3>
          </div>
          <p className="text-xs text-amber-400/80 mb-4 truncate font-medium">{activeTask.title}</p>

          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Como foi? <span className="text-muted-foreground/40 font-normal normal-case">(opcional)</span>
          </label>
          <textarea
            value={completeNote}
            onChange={e => setCompleteNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Ex: Cliente confirmou que vai enviar os documentos amanhã"
            className="w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none text-foreground placeholder:text-muted-foreground/40"
          />

          <div className="flex gap-2 mt-4 justify-end">
            <button
              onClick={() => setShowCompleteModal(false)}
              className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                onCompleteTask?.(completeNote.trim());
                setShowCompleteModal(false);
                setCompleteNote('');
              }}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              ✓ Confirmar conclusão
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal: Adiar tarefa ── */}
    {showPostponeModal && activeTask && (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setShowPostponeModal(false)}
      >
        <div
          className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">⏰</span>
            <h3 className="font-bold text-sm">Adiar tarefa</h3>
          </div>
          <p className="text-xs text-amber-400/80 mb-1 truncate font-medium">{activeTask.title}</p>
          {(activeTask.postponeCount ?? 0) > 0 && (
            <p className="text-[10px] text-amber-500 font-semibold mb-3">
              {activeTask.postponeCount}ª vez adiando esta tarefa
            </p>
          )}

          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Nova data e hora
          </label>
          <input
            type="datetime-local"
            value={postponeDate}
            onChange={e => setPostponeDate(e.target.value)}
            className="w-full mb-4 px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground [color-scheme:dark]"
          />

          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Motivo <span className="text-red-400">*</span>
          </label>
          <textarea
            value={postponeReason}
            onChange={e => setPostponeReason(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Ex: Cliente não atendeu, ligarei novamente amanhã"
            className="w-full px-3 py-2 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none text-foreground placeholder:text-muted-foreground/40"
          />

          <div className="flex gap-2 mt-4 justify-end">
            <button
              onClick={() => setShowPostponeModal(false)}
              className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (postponeDate && postponeReason.trim()) {
                  onPostponeTask?.(postponeDate, postponeReason.trim());
                  setShowPostponeModal(false);
                  setPostponeDate('');
                  setPostponeReason('');
                }
              }}
              disabled={!postponeDate || !postponeReason.trim()}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⏰ Confirmar adiamento
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
