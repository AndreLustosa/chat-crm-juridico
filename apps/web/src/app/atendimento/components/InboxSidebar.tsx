'use client';

import { Search, X, PanelLeftClose, Bell, Clock, UserCheck, UserSearch } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import {
  requestNotificationPermission,
  dismissBanner,
} from '@/lib/desktopNotifications';
import { showSuccess } from '@/lib/toast';
import { normalizeStage } from '@/lib/crmStages';
import type { ConversationSummary } from '../types';

// ─── Saved Filters Type ──────────────────────────────────────

interface SavedFilter {
  id: string;
  name: string;
  inboxId: string | null;
  leadFilter: string;
}

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

function statusBadge(status: string) {
  const map: Record<string, { class: string; label: string }> = {
    BOT: { class: 'bg-slate-500/15 text-slate-400 border border-slate-500/20', label: '🤖 SophIA' },
    WAITING: { class: 'bg-amber-500/15 text-amber-500 border border-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.15)]', label: '⏳ Aguardando' },
    ACTIVE: { class: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20', label: '🟢 Atribuído' },
    CLOSED: { class: 'bg-gray-500/15 text-gray-400 border border-gray-500/20', label: '⬛ Fechado' },
    ADIADO: { class: 'bg-amber-500/15 text-amber-400 border border-amber-500/20', label: '⏰ Adiado' },
  };
  const badge = map[status] || map.CLOSED;
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.class}`}>{badge.label}</span>;
}

// ─── Props ──────────────────────────────────────────────────────

export interface InboxSidebarProps {
  // Data
  conversations: ConversationSummary[];
  adiadoConversations: ConversationSummary[];
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
  // Bulk selection
  selectedBulk?: Set<string>;
  onToggleBulk?: (id: string) => void;
  onClearBulk?: () => void;
  onBulkAction?: (action: 'close' | 'assign', ids: string[]) => void;
  // Callbacks
  clientMode: boolean;
  onSetClientMode: (mode: boolean) => void;
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
  adiadoConversations,
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
  selectedBulk,
  onToggleBulk,
  onClearBulk,
  onBulkAction,
  clientMode,
  onSetClientMode,
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

  // ─── Saved Filters ────────────────────────────────────────────
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveInputValue, setSaveInputValue] = useState('');
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('inbox_saved_filters');
      if (raw) setSavedFilters(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persistSavedFilters = (filters: SavedFilter[]) => {
    setSavedFilters(filters);
    try { localStorage.setItem('inbox_saved_filters', JSON.stringify(filters)); } catch { /* ignore */ }
  };

  const hasNonDefaultFilter = selectedInboxId !== null || leadFilter !== '';

  const handleSaveFilter = () => {
    const name = saveInputValue.trim();
    if (!name) return;
    const newFilter: SavedFilter = {
      id: Date.now().toString(),
      name,
      inboxId: selectedInboxId,
      leadFilter,
    };
    persistSavedFilters([...savedFilters, newFilter]);
    setSaveInputValue('');
    setShowSaveInput(false);
  };

  const handleDeleteSavedFilter = (id: string) => {
    persistSavedFilters(savedFilters.filter((f) => f.id !== id));
  };

  const handleApplySavedFilter = (f: SavedFilter) => {
    onSetSelectedInboxId(f.inboxId);
    onSetLeadFilter(f.leadFilter);
  };

  // Focus the save input when shown
  useEffect(() => {
    if (showSaveInput) saveInputRef.current?.focus();
  }, [showSaveInput]);

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

        {/* Toggle Leads / Clientes */}
        <div className="flex rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => onSetClientMode(false)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-semibold transition-colors ${
              !clientMode
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
            }`}
          >
            <UserSearch size={13} />
            Leads
          </button>
          <button
            onClick={() => onSetClientMode(true)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-semibold transition-colors ${
              clientMode
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
            }`}
          >
            <UserCheck size={13} />
            Clientes
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

        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-xl p-1 flex-1 relative">
            {[
              { value: '', label: 'Tudo', count: conversations.filter(c => normalizeStage(c.leadStage) !== 'PERDIDO').length },
              { value: 'MINE', label: 'Minhas', count: conversations.filter(c => c.assignedAgentId === currentUserId && c.status !== 'CLOSED' && normalizeStage(c.leadStage) !== 'PERDIDO').length },
              { value: 'WAITING', label: 'Espera', count: conversations.filter(c => c.status === 'WAITING' && normalizeStage(c.leadStage) !== 'PERDIDO').length },
              { value: 'BOT', label: 'SophIA', count: conversations.filter(c => c.aiMode && c.assignedAgentId === currentUserId && normalizeStage(c.leadStage) !== 'PERDIDO').length },
              { value: 'ADIADO', label: 'Adiados', count: adiadoConversations.filter(c => normalizeStage(c.leadStage) !== 'PERDIDO').length },
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

          {/* Save filter button — only shown when a non-default filter is active */}
          {hasNonDefaultFilter && (
            <button
              onClick={() => setShowSaveInput((v) => !v)}
              className="shrink-0 text-base leading-none px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Salvar filtro atual"
              aria-label="Salvar filtro"
            >
              💾
            </button>
          )}
        </div>

        {/* Inline save input */}
        {showSaveInput && (
          <div className="flex items-center gap-2">
            <input
              ref={saveInputRef}
              type="text"
              value={saveInputValue}
              onChange={(e) => setSaveInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveFilter();
                if (e.key === 'Escape') { setShowSaveInput(false); setSaveInputValue(''); }
              }}
              placeholder="Nome do filtro…"
              className="flex-1 px-3 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all"
            />
            <button
              onClick={handleSaveFilter}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-[11px] font-bold hover:opacity-90 transition-opacity"
            >
              Salvar
            </button>
            <button
              onClick={() => { setShowSaveInput(false); setSaveInputValue(''); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Cancelar"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Saved filter chips */}
        {savedFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {savedFilters.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-semibold text-primary/80 cursor-pointer hover:bg-primary/20 transition-colors group"
                onClick={() => handleApplySavedFilter(f)}
                title={`Aplicar filtro: ${f.name}`}
              >
                <span>{f.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSavedFilter(f.id); }}
                  className="text-primary/50 hover:text-primary transition-colors ml-0.5"
                  aria-label={`Remover filtro ${f.name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
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
              const isBulkSelected = selectedBulk?.has(conv.id) ?? false;
              const inBulkMode = (selectedBulk?.size ?? 0) > 0;
              return (
                <div key={conv.id}>
                  {showDateSep && convDate && (
                    <DateSeparator label={formatDateLabel(convDate)} />
                  )}
                  <div
                    onClick={() => {
                      if (inBulkMode) {
                        onToggleBulk?.(conv.id);
                        return;
                      }
                      onSelectConversation(conv.id);
                      onSetUnreadCounts(prev => { const n = { ...prev }; delete n[conv.id]; return n; });
                    }}
                    className={`group flex gap-4 p-4 border-b border-border/50 cursor-pointer transition-colors relative
                      ${selectedId === conv.id ? 'bg-accent/50' : 'hover:bg-accent/30'}
                      ${isBulkSelected ? 'bg-primary/10' : ''}
                    `}
                  >
                    {selectedId === conv.id && !inBulkMode && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                    {/* Checkbox (visible on hover or in bulk mode) + Avatar + score badge */}
                    <div className="flex flex-col items-center gap-0.5 shrink-0 relative">
                      <div
                        className={`absolute -left-1 top-0 z-10 transition-opacity ${inBulkMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                        onClick={(e) => { e.stopPropagation(); onToggleBulk?.(conv.id); }}
                      >
                        <input
                          type="checkbox"
                          checked={isBulkSelected}
                          onChange={() => onToggleBulk?.(conv.id)}
                          className="w-4 h-4 rounded accent-primary cursor-pointer"
                          aria-label={`Selecionar ${conv.contactName || conv.contactPhone}`}
                        />
                      </div>
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
                        {/* Badge SLA: aguardando resposta há mais de 15min */}
                        {(() => {
                          const unread = unreadCounts[conv.id] || 0;
                          if (unread === 0 || conv.status === 'CLOSED' || conv.status === 'ADIADO') return null;
                          const waitingMins = conv.lastMessageAt
                            ? Math.floor((Date.now() - new Date(conv.lastMessageAt).getTime()) / 60000)
                            : 0;
                          if (waitingMins < 15) return null;
                          const isUrgent = waitingMins >= 60;
                          return (
                            <span
                              title={`Cliente aguardando resposta há ${waitingMins >= 60 ? `${Math.floor(waitingMins / 60)}h${waitingMins % 60 > 0 ? `${waitingMins % 60}min` : ''}` : `${waitingMins}min`}`}
                              className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${isUrgent ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}`}
                            >
                              ⏱ {waitingMins >= 60 ? `${Math.floor(waitingMins / 60)}h` : `${waitingMins}min`}
                            </span>
                          );
                        })()}
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
                      {/* Etiquetas do lead */}
                      {conv.leadTags && conv.leadTags.length > 0 && (
                        <div className="mb-1 flex items-center gap-1 flex-wrap">
                          {conv.leadTags.slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 border border-primary/20"
                            >
                              {tag}
                            </span>
                          ))}
                          {conv.leadTags.length > 3 && (
                            <span className="text-[9px] text-muted-foreground/60">+{conv.leadTags.length - 3}</span>
                          )}
                        </div>
                      )}
                      {conv.status === 'ADIADO' && conv.activeTask && (() => {
                        const isOverdue = conv.activeTask.dueAt ? new Date(conv.activeTask.dueAt) < new Date() : false;
                        return (
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Clock size={11} className={isOverdue ? 'text-red-400' : 'text-amber-400'} />
                            <span className={`text-[10px] font-medium truncate max-w-[120px] ${isOverdue ? 'text-red-400' : 'text-amber-400'}`}>
                              {conv.activeTask.title}
                            </span>
                            {conv.activeTask.dueAt && (
                              <span className={`text-[9px] font-bold whitespace-nowrap ${isOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
                                {formatTaskDate(conv.activeTask.dueAt)}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="flex items-center gap-2">
                        <p className={`text-sm truncate flex-1 ${(unreadCounts[conv.id] || 0) > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          {conv.lastMessage}
                        </p>
                        {/* Chip de dormência: sem atividade há mais de 2 dias */}
                        {(() => {
                          if (!conv.lastMessageAt || conv.status === 'CLOSED' || conv.status === 'ADIADO') return null;
                          const stage = normalizeStage(conv.leadStage || '');
                          if (stage === 'PERDIDO' || stage === 'FINALIZADO') return null;
                          const days = Math.floor((Date.now() - new Date(conv.lastMessageAt).getTime()) / 86400000);
                          if (days < 2) return null;
                          return (
                            <span
                              title={`Sem atividade há ${days} dia${days > 1 ? 's' : ''}`}
                              className="shrink-0 text-[9px] font-bold text-muted-foreground/70 bg-muted/60 border border-border/60 rounded-full px-1.5 py-0.5"
                            >
                              💤 {days}d
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            });
          })()
        )}
      </div>

      {/* Bulk action bar */}
      {(selectedBulk?.size ?? 0) > 0 && (
        <div className="shrink-0 border-t border-border bg-card p-3 flex items-center gap-2">
          <span className="text-xs font-bold text-foreground flex-1">{selectedBulk!.size} selecionada{selectedBulk!.size > 1 ? 's' : ''}</span>
          <button onClick={() => onBulkAction?.('close', [...selectedBulk!])} className="px-3 py-1.5 text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors">Encerrar</button>
          <button onClick={() => onClearBulk?.()} className="px-3 py-1.5 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors">Cancelar</button>
        </div>
      )}
    </section>
  );
}
