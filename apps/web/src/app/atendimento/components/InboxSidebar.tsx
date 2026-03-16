'use client';

import { Search, X, PanelLeftClose, Bell } from 'lucide-react';
import {
  requestNotificationPermission,
  dismissBanner,
} from '@/lib/desktopNotifications';
import { showSuccess } from '@/lib/toast';
import { normalizeStage } from '@/lib/crmStages';
import type { ConversationSummary } from '../types';

// ─── Helpers ────────────────────────────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 select-none sticky top-0 z-10 bg-card/80 backdrop-blur-sm">
      <div className="flex-1 h-px bg-border/60" />
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function getDateKey(dateStr: string): string {
  return new Date(dateStr).toDateString();
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getInitial(name?: string) {
  return (name || 'V')[0].toUpperCase();
}

// ─── Lead Score ──────────────────────────────────────────────────

const STAGE_BASE_SCORES: Record<string, number> = {
  NOVO: 10, INICIAL: 15, EM_ATENDIMENTO: 25, QUALIFICANDO: 35, QUALIFICADO: 40,
  AGUARDANDO_FORM: 50, REUNIAO_AGENDADA: 65, AGUARDANDO_DOCS: 70,
  AGUARDANDO_PROC: 80, FINALIZADO: 100, PERDIDO: 0,
};

function computeScore(conv: ConversationSummary): number {
  const stage = normalizeStage(conv.leadStage || '');
  let score = STAGE_BASE_SCORES[stage] ?? 20;
  if (conv.legalArea) score += 8;
  if (conv.assignedLawyerId) score += 5;
  if (conv.nextStep && conv.nextStep !== 'duvidas') score += 5;
  if (conv.stageEnteredAt) {
    const days = Math.floor((Date.now() - new Date(conv.stageEnteredAt).getTime()) / 86400000);
    if (days > 3) score -= Math.min(25, (days - 3) * 3);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreStyle(score: number): string {
  if (score >= 70) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (score >= 45) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
  if (score >= 20) return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

function statusBadge(status: string) {
  const map: Record<string, { class: string; label: string }> = {
    BOT: { class: 'bg-slate-500/15 text-slate-400 border border-slate-500/20', label: '🤖 SophIA' },
    WAITING: { class: 'bg-amber-500/15 text-amber-500 border border-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.15)]', label: '⏳ Aguardando' },
    ACTIVE: { class: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20', label: '🟢 Atribuído' },
    CLOSED: { class: 'bg-gray-500/15 text-gray-400 border border-gray-500/20', label: '⬛ Fechado' },
  };
  const badge = map[status] || map.CLOSED;
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.class}`}>{badge.label}</span>;
}

// ─── Props ──────────────────────────────────────────────────────

export interface InboxSidebarProps {
  // Data
  conversations: ConversationSummary[];
  filteredConversations: ConversationSummary[];
  userInboxes: { id: string; name: string }[];
  pendingTransfers: { conversationId: string; contactName: string; fromUserName: string; reason: string | null; audioIds?: string[] }[];
  unreadCounts: Record<string, number>;
  currentUserId: string | null;
  // State
  selectedId: string | null;
  selectedInboxId: string | null;
  searchQuery: string;
  leadFilter: string;
  inboxOpen: boolean;
  loading: boolean;
  isMobile: boolean;
  showNotifBanner: boolean;
  // Callbacks
  onSelectConversation: (id: string) => void;
  onSetSearchQuery: (q: string) => void;
  onSetLeadFilter: (f: string) => void;
  onSetSelectedInboxId: (id: string | null) => void;
  onSetInboxOpen: (open: boolean) => void;
  onSetShowNotifBanner: (show: boolean) => void;
  onSetUnreadCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  onQuickAcceptTransfer: (convId: string) => void;
  onShowTransferPopup: (transfer: { conversationId: string; contactName: string; fromUserName: string; reason: string | null; audioIds?: string[] }) => void;
  onLightbox: (url: string) => void;
  hasDisconnectedInstance?: boolean;
}

// ─── Component ──────────────────────────────────────────────────

export function InboxSidebar({
  conversations,
  filteredConversations,
  userInboxes,
  pendingTransfers,
  unreadCounts,
  currentUserId,
  selectedId,
  selectedInboxId,
  searchQuery,
  leadFilter,
  inboxOpen,
  loading,
  isMobile,
  showNotifBanner,
  onSelectConversation,
  onSetSearchQuery,
  onSetLeadFilter,
  onSetSelectedInboxId,
  onSetInboxOpen,
  onSetShowNotifBanner,
  onSetUnreadCounts,
  onQuickAcceptTransfer,
  onShowTransferPopup,
  onLightbox,
  hasDisconnectedInstance,
}: InboxSidebarProps) {

  const myActiveConvs = (c: ConversationSummary) =>
    (c.status === 'ACTIVE' || c.status === 'MONITORING') && c.assignedAgentId === currentUserId;

  return (
    <section className={`flex flex-col overflow-hidden bg-card border-r border-border shrink-0 z-40 transition-all duration-300 ${isMobile ? (selectedId ? 'hidden' : 'w-full') : (inboxOpen ? 'w-[380px]' : 'w-0')}`}>
      <div className="shrink-0 p-5 border-b border-border space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Inbox</h2>
          <button
            onClick={() => onSetInboxOpen(false)}
            className="hidden md:block p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            title="Fechar painel"
            aria-label="Fechar painel de inbox"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* Barra de pesquisa */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSetSearchQuery(e.target.value)}
            placeholder="Buscar contato ou mensagem…"
            className="w-full pl-8 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSetSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Desktop notification permission banner */}
        {showNotifBanner && (
          <div className="p-2.5 bg-primary/5 border border-primary/20 rounded-xl flex items-center gap-2.5">
            <Bell size={14} className="text-primary shrink-0" />
            <p className="text-[11px] text-foreground flex-1">Ativar notificacoes do navegador?</p>
            <button
              onClick={async () => {
                const result = await requestNotificationPermission();
                onSetShowNotifBanner(false);
                if (result === 'granted') showSuccess('Notificacoes ativadas!');
              }}
              className="text-[10px] font-bold text-primary px-2 py-0.5 rounded-lg hover:bg-primary/10 transition-colors"
            >
              Ativar
            </button>
            <button
              onClick={() => { dismissBanner(); onSetShowNotifBanner(false); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dispensar"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* WhatsApp disconnection banner */}
        {hasDisconnectedInstance && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            WhatsApp desconectado
          </div>
        )}

        {/* Transferências aguardando resposta */}
        {pendingTransfers.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
              <span className="text-amber-500 text-sm">📨</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500">
                Aguardando você ({pendingTransfers.length})
              </span>
            </div>
            <div className="divide-y divide-amber-500/10">
              {pendingTransfers.map(pt => (
                <div key={pt.conversationId} className="flex items-center gap-2 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{pt.contactName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">De: {pt.fromUserName}</p>
                    {pt.reason && <p className="text-[10px] text-amber-400/80 italic truncate">{pt.reason}</p>}
                    {pt.audioIds && pt.audioIds.length > 0 && (
                      <p className="text-[10px] text-violet-400/80">🎙 {pt.audioIds.length} áudio{pt.audioIds.length > 1 ? 's' : ''}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => onQuickAcceptTransfer(pt.conversationId)}
                      className="px-2 py-1 bg-emerald-500 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-600 transition-colors"
                      title="Aceitar transferência"
                    >✓</button>
                    <button
                      onClick={() => onShowTransferPopup(pt)}
                      className="px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[10px] font-bold hover:bg-red-500/20 transition-colors"
                      title="Recusar transferência"
                    >✗</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Seletor de Setores (Inboxes) */}
        {userInboxes.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar no-scrollbar">
            <button
              onClick={() => onSetSelectedInboxId(null)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${!selectedInboxId ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'}`}
            >
              Todos Setores
            </button>
            {userInboxes.map((inbox) => (
              <button
                key={inbox.id}
                onClick={() => onSetSelectedInboxId(inbox.id)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${selectedInboxId === inbox.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'}`}
              >
                {inbox.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex bg-muted rounded-xl p-1 w-full relative">
          {[
            { value: '', label: 'Tudo', count: conversations.filter(c => normalizeStage(c.leadStage) !== 'PERDIDO').length },
            { value: 'BOT', label: 'SophIA', count: conversations.filter(c => c.aiMode && c.assignedAgentId === currentUserId).length },
            { value: 'WAITING', label: 'Espera', count: conversations.filter(c => c.status === 'WAITING').length },
            { value: 'ACTIVE', label: 'Ativas', count: conversations.filter(myActiveConvs).length },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => onSetLeadFilter(tab.value)}
              className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all relative ${leadFilter === tab.value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-background/50'}`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="absolute -top-2.5 -right-2 min-w-[26px] h-[26px] px-1.5 rounded-full bg-red-500 text-white text-[12px] font-bold leading-[26px] text-center shadow-md">
                  {tab.count > 99 ? '99+' : tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto w-full custom-scrollbar ${isMobile && !selectedId ? 'pb-16' : ''}`}>
        {loading ? (
          <div className="p-10 text-center text-muted-foreground text-sm">Carregando conversas...</div>
        ) : filteredConversations.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            {searchQuery.trim() ? `Nenhum resultado para "${searchQuery}".` : 'Nenhuma conversa encontrada.'}
          </div>
        ) : (
          (() => {
            let lastConvDateKey = '';
            return filteredConversations.map((conv) => {
              const convDate = conv.lastMessageAt;
              const dateKey = convDate ? getDateKey(convDate) : '__nodate__';
              const showDateSep = dateKey !== lastConvDateKey;
              if (showDateSep) lastConvDateKey = dateKey;
              return (
                <div key={conv.id}>
                  {showDateSep && convDate && (
                    <DateSeparator label={formatDateLabel(convDate)} />
                  )}
                  <div
                    onClick={() => {
                      onSelectConversation(conv.id);
                      onSetUnreadCounts(prev => { const n = { ...prev }; delete n[conv.id]; return n; });
                    }}
                    className={`flex gap-4 p-4 border-b border-border/50 cursor-pointer transition-colors relative
                      ${selectedId === conv.id ? 'bg-accent/50' : 'hover:bg-accent/30'}
                    `}
                  >
                    {selectedId === conv.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                    {/* Avatar + score badge */}
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <div
                        className={`w-11 h-11 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shadow-sm ${conv.profile_picture_url ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                        onClick={conv.profile_picture_url ? (e) => { e.stopPropagation(); onLightbox(conv.profile_picture_url!); } : undefined}
                        title={conv.profile_picture_url ? 'Ver foto ampliada' : undefined}
                      >
                        {conv.profile_picture_url ? (
                          <img src={conv.profile_picture_url} alt={conv.contactName} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <span className="text-foreground font-bold text-lg">{getInitial(conv.contactName)}</span>
                        )}
                      </div>
                      {(() => {
                        const stage = normalizeStage(conv.leadStage || '');
                        if (stage === 'PERDIDO' || stage === 'FINALIZADO' || !conv.leadStage) return null;
                        const score = computeScore(conv);
                        return (
                          <span
                            className={`text-[9px] font-bold tabular-nums px-1.5 rounded-full border leading-[14px] ${scoreStyle(score)}`}
                            title={`Score do lead: ${score}/100`}
                          >
                            {score}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <span className="font-semibold truncate pl-0.5 text-foreground">
                          {conv.contactName || conv.contactPhone}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-1">
                          {(unreadCounts[conv.id] || 0) > 0 && (
                            <span className="bg-red-500 text-white text-[11px] font-bold rounded-full min-w-[20px] h-[20px] flex items-center justify-center px-1 leading-none shadow-md">
                              {unreadCounts[conv.id] > 99 ? '99+' : unreadCounts[conv.id]}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground">{formatTime(conv.lastMessageAt)}</span>
                        </div>
                      </div>
                      {conv.contactPhone && conv.contactName !== conv.contactPhone && (
                        <p className="text-[11px] text-muted-foreground truncate pl-0.5 mb-0.5">{conv.contactPhone}</p>
                      )}
                      <div className="mb-1 flex items-center gap-2 flex-wrap">
                        {statusBadge(conv.status)}
                        {(conv.originAssignedUserId ? conv.originAssignedUserName : conv.assignedAgentName) && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" />
                            Aten. {conv.originAssignedUserId ? conv.originAssignedUserName : conv.assignedAgentName}
                          </span>
                        )}
                      </div>
                      {conv.legalArea && (
                        <div className="mb-1.5 flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[10px] text-violet-400 font-bold border border-violet-500/20 bg-violet-500/10 rounded-md px-1.5 py-0.5">
                            ⚖️ {conv.legalArea}
                          </span>
                          {(conv.originAssignedUserId ? conv.assignedAgentName : conv.assignedLawyerName) && (
                            <span className="text-[10px] text-violet-300 font-medium truncate">
                              Adv. {conv.originAssignedUserId ? conv.assignedAgentName : conv.assignedLawyerName}
                            </span>
                          )}
                        </div>
                      )}
                      <p className={`text-sm truncate ${(unreadCounts[conv.id] || 0) > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                        {conv.lastMessage}
                      </p>
                    </div>
                  </div>
                </div>
              );
            });
          })()
        )}
      </div>
    </section>
  );
}
