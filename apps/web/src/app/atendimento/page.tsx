'use client';

import { useEffect, useState, useRef, useCallback, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { MessageSquare, Send, Download, Mic, FileText, Bot, BotOff, Paperclip, X, CheckCheck, Check, Eye, XCircle, Trash2, Reply, UserCheck, PanelLeftOpen, CornerDownLeft, Inbox, Pencil, Search, ChevronDown, ClipboardList, ArrowLeft, MoreVertical, Clock } from 'lucide-react';
import FichaTrabalhista from '@/components/FichaTrabalhista';
import { AudioRecorder } from '@/components/AudioRecorder';
import { AuthAudioPlayer } from '@/components/AuthAudioPlayer';
import { EmojiPickerButton } from '@/components/EmojiPickerButton';
import { SophIAButton } from '@/components/SophIAButton';
import { ClientPanel } from '@/components/ClientPanel';
import { playNotificationSound } from '@/lib/notificationSounds';
import {
  isDesktopNotifSupported,
  getDesktopNotifPermission,
  isBannerDismissed,
  showDesktopNotification,
} from '@/lib/desktopNotifications';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import { CRM_STAGES, findStage, normalizeStage } from '@/lib/crmStages';
import { STAGE_TEMPLATES } from '@/lib/crmTemplates';
import { showError, showSuccess } from '@/lib/toast';
import type { ConversationSummary, MessageItem } from './types';
import { MessageBubble } from './components/MessageBubble';
import { TransferModals } from './components/TransferModals';
import { CommandPalette } from './components/CommandPalette';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import ContratoTrabalhistaModal from '@/components/modals/ContratoTrabalhistaModal';
import { InboxSidebar } from './components/InboxSidebar';
import { ChatHeader } from './components/ChatHeader';

// ─── Slash commands estáticos registrados ─────────────────────────────────────
const SLASH_COMMANDS = [
  {
    id: 'contrato_trabalhista',
    label: 'Contrato Trabalhista',
    description: 'Gerar e enviar contrato via WhatsApp',
    Icon: FileText,
  },
] as const;

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
  if (apiUrl.startsWith('http')) {
    try { return new URL(apiUrl).origin; } catch { /* fall through */ }
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** Em dev o socket.io está diretamente em /socket.io/ (sem proxy).
 *  Em produção o Traefik tem um router dedicado (crm-ws) que escuta /socket.io/
 *  e rota diretamente para a API sem nenhum middleware — isso garante que o
 *  upgrade de WebSocket funcione (passar por strip-api/outros middlewares quebra o upgrade). */
function getSocketPath(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_PATH) return process.env.NEXT_PUBLIC_SOCKET_PATH;
  // Sempre usar /socket.io/ direto — o router crm-ws no Traefik cuida disso sem middleware
  return '/socket.io/';
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

const LEGAL_AREAS = [
  'Trabalhista', 'Consumidor', 'Família', 'Previdenciário',
  'Penal', 'Civil', 'Empresarial', 'Imobiliário', 'Outro',
];

const LOSS_REASONS = [
  'Sem interesse',
  'Sem condições financeiras',
  'Contratou outro escritório',
  'Não respondeu',
  'Caso inviável',
];

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 select-none sticky top-0 z-10 bg-card/80 backdrop-blur-sm">
      <div className="flex-1 h-px bg-border/60" />
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}



export default function Dashboard() {
  const router = useRouter();
  const [leadFilter, setLeadFilter] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [userInboxes, setUserInboxes] = useState<any[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [clientMode, setClientMode] = useState(false); // false = Leads, true = Clientes
  const clientModeRef = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [msgTotalPages, setMsgTotalPages] = useState(1);
  const [msgCurrentPage, setMsgCurrentPage] = useState(1);
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [socketConnected, setSocketConnected] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [docPreview, setDocPreview] = useState<{ url: string; name: string; mime: string } | null>(null);
  const [transcribing, setTranscribing] = useState<Record<string, boolean>>({});
  const [aiMode, setAiMode] = useState(false);
  const [fichaInboxVisible, setFichaInboxVisible] = useState(false);
  const [fichaFinalizada, setFichaFinalizada] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null);
  const [transferModal, setTransferModal] = useState(false);
  const [transferGroups, setTransferGroups] = useState<{ id: string; name: string; type: 'INBOX' | 'SECTOR'; auto_route: boolean; users: { id: string; name: string }[] }[]>([]);
  const [transferring, setTransferring] = useState(false);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [selectedTransferUserId, setSelectedTransferUserId] = useState<string | null>(null);
  const [transferReason, setTransferReason] = useState('');
  const [transferAudioIds, setTransferAudioIds] = useState<string[]>([]);
  // Popup de motivo (lawyer, operator ou return)
  const [showReasonPopup, setShowReasonPopup] = useState(false);
  const [reasonPopupContext, setReasonPopupContext] = useState<'lawyer' | 'operator' | 'return' | null>(null);
  const [reasonPopupTargetName, setReasonPopupTargetName] = useState('');
  // Contexto de transferência salvo por conversa (persiste após aceitar / ao receber devolução)
  const [transferContextMap, setTransferContextMap] = useState<Record<string, { fromUserName: string; reason: string | null; audioIds: string[] }>>({});
  const [allSpecialists, setAllSpecialists] = useState<{ id: string; name: string; specialties: string[] }[]>([]);
  const [showLawyerDropdown, setShowLawyerDropdown] = useState(false);
  // CRM stage do lead da conversa selecionada
  const [leadStage, setLeadStage] = useState<string | null>(null);
  const [showStageDropdown, setShowStageDropdown] = useState(false);
  // Incoming transfer popup (for receiving operator)
  const [incomingTransfer, setIncomingTransfer] = useState<{
    conversationId: string; fromUserName: string; contactName: string; reason: string | null; audioIds?: string[];
  } | null>(null);
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [processingTransfer, setProcessingTransfer] = useState(false);
  // Response notification (for sender)
  const [transferResponseMsg, setTransferResponseMsg] = useState<string | null>(null);
  // Sent confirmation banner
  const [transferSentMsg, setTransferSentMsg] = useState<string | null>(null);
  // Pending transfers waiting for current user to accept/decline
  const [pendingTransfers, setPendingTransfers] = useState<{ conversationId: string; contactName: string; fromUserName: string; reason: string | null; audioIds?: string[] }[]>([]);
  const [inboxOpen, setInboxOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreRef = useRef<HTMLDivElement>(null);
  // Command palette (Ctrl+K) e atalhos (?)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Desktop notification banner (show only if permission is 'default' and user hasn't dismissed)
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const [clientPanelLeadId, setClientPanelLeadId] = useState<string | null>(null);
  const [showContratoModal, setShowContratoModal] = useState(false);
  // Modal de motivo de perda (PERDIDO) — exigido pelo backend
  const [lossModal, setLossModal] = useState<{ leadId: string; leadName: string } | null>(null);
  const [lossReason, setLossReason] = useState('');
  // Modal de encerramento de conversa
  const [closeConvModal, setCloseConvModal] = useState(false);
  const [csatOnClose, setCsatOnClose] = useState(false);
  // Modo nota interna (mensagem não enviada ao cliente)
  const [internalNoteMode, setInternalNoteMode] = useState(false);
  // Chave para forçar re-fetch de mensagens (incrementada no reconnect do socket)
  const [msgRefreshKey, setMsgRefreshKey] = useState(0);
  // Modal de criação rápida de tarefa a partir do chat
  const [taskModal, setTaskModal] = useState<{ leadId: string; conversationId: string; leadName: string } | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskAssignedId, setTaskAssignedId] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const [taskAgents, setTaskAgents] = useState<{ id: string; name: string }[]>([]);
  const [adiadoConversations, setAdiadoConversations] = useState<ConversationSummary[]>([]);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [slashMenuPos, setSlashMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  // Respostas rápidas (canned responses) carregadas do servidor
  const [cannedResponses, setCannedResponsesState] = useState<{ id: string; label: string; text: string }[]>([]);
  // Quick snooze dropdown (atalho sem abrir o modal completo)
  const [quickSnoozeOpen, setQuickSnoozeOpen] = useState(false);
  const quickSnoozeRef = useRef<HTMLDivElement>(null);
  // Busca dentro da conversa
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const msgSearchInputRef = useRef<HTMLInputElement>(null);
  // Encaminhar mensagem
  const [forwardMsg, setForwardMsg] = useState<{ id: string; text: string } | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  // Typing indicators
  const [typingUsers, setTypingUsers] = useState<Record<string, { userName: string; timeout: ReturnType<typeof setTimeout> }>>({});
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // WhatsApp instance connection statuses (ephemeral — no DB persistence)
  const [instanceStatuses, setInstanceStatuses] = useState<Record<string, string>>({});
  // Toast de lembrete de tarefa agendada
  const [taskReminderToast, setTaskReminderToast] = useState<{ eventId: string; title: string; type: string; start_at: string; minutesBefore: number } | null>(null);
  // Contact presence (online/composing/unavailable) — ephemeral
  const [contactPresence, setContactPresence] = useState<string>('unavailable');
  const [showLegalAreaDropdown, setShowLegalAreaDropdown] = useState(false);
  const legalAreaDropdownRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Unread message counts per conversation (persisted in sessionStorage to survive same-page navigation)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(sessionStorage.getItem('unreadCounts') || '{}'); } catch { return {}; }
  });
  // Current user ID decoded from JWT (lazy init, never changes)
  const [currentUserId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
    } catch { return null; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  // Drafts persistidos em localStorage (chave: conversationId → texto)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('inbox_drafts') || '{}'); } catch { return {}; }
  });
  // IDs de conversas onde a barra de resposta rápida foi dispensada
  const [dismissedQuickReply, setDismissedQuickReply] = useState<Set<string>>(new Set());
  // Bulk selection de conversas
  const [selectedBulk, setSelectedBulk] = useState<Set<string>>(new Set());
  // Badge de novas mensagens enquanto usuário está scrollado acima
  const [newMsgsWhileScrolled, setNewMsgsWhileScrolled] = useState(0);
  const isScrolledUpRef = useRef(false);
  // Ref de mensagens para acesso em keyboard handlers sem depender de closure
  const messagesRef = useRef<MessageItem[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const lawyerDropdownRef = useRef<HTMLDivElement>(null);
  const stageDropdownRef = useRef<HTMLDivElement>(null);
  const selectedInboxIdRef = useRef<string | null>(selectedInboxId);
  const selectedIdRef = useRef<string | null>(selectedId);
  const currentUserIdRef = useRef<string | null>(currentUserId);
  // IDs de transferências já exibidas no popup (evita re-exibir após fechar)
  const shownTransferIdsRef = useRef<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => { selectedInboxIdRef.current = selectedInboxId; }, [selectedInboxId]);
  useEffect(() => { clientModeRef.current = clientMode; }, [clientMode]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

  // Detect mobile (<768px) for responsive layout
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Notify layout when mobile chat is open/closed (hides bottom nav)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mobile-chat-state', { detail: { chatOpen: isMobile && !!selectedId } }));
  }, [isMobile, selectedId]);

  // Reset textarea height when text is cleared (after send, etc.)
  useEffect(() => {
    if (!text && inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [text]);

  // Close mobile menu on click outside
  useEffect(() => {
    if (!mobileMoreOpen) return;
    const handler = (e: MouseEvent) => {
      if (mobileMoreRef.current && !mobileMoreRef.current.contains(e.target as Node)) setMobileMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mobileMoreOpen]);

  // Persist unreadCounts + broadcast total to Sidebar
  useEffect(() => {
    try { sessionStorage.setItem('unreadCounts', JSON.stringify(unreadCounts)); } catch {}
    const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
    window.dispatchEvent(new CustomEvent('unread_count_update', { detail: { total } }));
  }, [unreadCounts]);

  // Debounce do filtro de busca (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ─── Tab title + favicon dinâmico com badge de não lidos ─────
  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
    document.title = total > 0 ? `(${total}) Atendimento | LexCRM` : 'Atendimento | LexCRM';

    // Favicon dinâmico via Canvas API
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ||
      (() => { const l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); return l; })();

    if (total === 0) {
      link.href = '/favicon.ico';
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Ícone base (texto ⚖ em fundo escuro)
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath(); ctx.arc(16, 16, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚖', 16, 16);
    // Badge vermelho com contador
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(24, 8, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(total > 9 ? '9+' : String(total), 24, 8);
    link.href = canvas.toDataURL('image/png');
  }, [unreadCounts]);

  // ─── Manter messagesRef em sync com o estado ──────────────────
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ─── Draft: salvar em localStorage ao digitar ─────────────────
  useEffect(() => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    setDrafts(prev => {
      const updated = { ...prev };
      if (text.trim()) { updated[selectedId] = text; } else { delete updated[selectedId]; }
      try { localStorage.setItem('inbox_drafts', JSON.stringify(updated)); } catch { /* quota excedida */ }
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, selectedId]);

  // ─── Draft: restaurar texto ao trocar de conversa ─────────────
  useEffect(() => {
    if (selectedId && !selectedId.startsWith('demo-')) {
      const saved = drafts[selectedId] ?? '';
      setText(saved);
    } else {
      setText('');
    }
    // Reset badge de scroll ao trocar de conversa
    setNewMsgsWhileScrolled(0);
    isScrolledUpRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ─── Scroll tracker: detectar se usuário está acima do fundo ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedId) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      isScrolledUpRef.current = !atBottom;
      if (atBottom) setNewMsgsWhileScrolled(0);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [selectedId]);

  // ─── Desktop notification banner check ────────────────────────
  useEffect(() => {
    if (isDesktopNotifSupported() && getDesktopNotifPermission() === 'default' && !isBannerDismissed()) {
      setShowNotifBanner(true);
    }
  }, []);

  // ─── Track recent conversations (for Command Palette) ────────
  useEffect(() => {
    if (!selectedId) return;
    try {
      const key = 'recent_convs';
      const recent: string[] = JSON.parse(sessionStorage.getItem(key) || '[]');
      const updated = [selectedId, ...recent.filter(id => id !== selectedId)].slice(0, 5);
      sessionStorage.setItem(key, JSON.stringify(updated));
    } catch { /* ignore */ }
  }, [selectedId]);

  // ─── Global keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl+K / Cmd+K: toggle command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
        return;
      }

      // ?: abrir overlay de atalhos (apenas fora de inputs)
      if (e.key === '?' && !isInputFocused && !commandPaletteOpen) {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
        return;
      }

      // Escape: close modals in cascade
      if (e.key === 'Escape') {
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (commandPaletteOpen) { setCommandPaletteOpen(false); return; }
        if (lightbox) { setLightbox(null); return; }
        if (docPreview) { setDocPreview(null); return; }
        if (transferModal) { setTransferModal(false); return; }
        if (showReasonPopup) { closeReasonPopup(); return; }
        if (selectedId && !isInputFocused) { setSelectedId(null); return; }
        return;
      }

      // Alt+ArrowUp / Alt+ArrowDown: navigate conversations
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isInputFocused) {
        e.preventDefault();
        const list = filteredConversationsRef.current;
        const currentIdx = list.findIndex(c => c.id === selectedId);
        const nextIdx = e.key === 'ArrowUp'
          ? Math.max(0, currentIdx - 1)
          : Math.min(list.length - 1, currentIdx + 1);
        if (list[nextIdx]) {
          const nextConv = list[nextIdx];
          setSelectedId(nextConv.id);
          setUnreadCounts(prev => { const n = { ...prev }; delete n[nextConv.id]; return n; });
        }
        return;
      }

      // Ctrl+Shift+A: toggle AI mode
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        if (selectedId && !selectedId.startsWith('demo-')) handleToggleAiMode();
        return;
      }

      // Alt+R: responder à última mensagem recebida do cliente
      if (e.altKey && (e.key === 'r' || e.key === 'R') && !isInputFocused) {
        e.preventDefault();
        if (selectedId && !selectedId.startsWith('demo-')) {
          const lastIn = [...messagesRef.current].reverse().find(m => m.direction === 'in');
          if (lastIn) {
            setReplyingTo(lastIn);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }
        return;
      }

      // ── Global keyboard redirect to chat input ──
      if (selectedId && !selectedId.startsWith('demo-')) {
        if (document.activeElement === inputRef.current) return;
        if (isInputFocused) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length > 1 && !['Backspace', 'Delete'].includes(e.key)) return;
        
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandPaletteOpen, lightbox, docPreview, transferModal, showReasonPopup, selectedId]);

  // Sync aiMode when conversation changes
  useEffect(() => {
    const conv = conversations.find(c => c.id === selectedId);
    if (conv) setAiMode(!!conv.aiMode);
    // NÃO fechar o dropdown aqui — conversations muda via socket e fecharia prematuramente
  }, [selectedId, conversations]);

  // Fechar dropdowns ao trocar de conversa
  useEffect(() => {
    setShowLawyerDropdown(false);
    setShowLegalAreaDropdown(false);
    setShowDetailsPanel(false);
    setMsgSearchOpen(false);
    setMsgSearchQuery('');
    setQuickSnoozeOpen(false);
  }, [selectedId]);

  // Quick snooze: fechar ao clicar fora
  useEffect(() => {
    if (!quickSnoozeOpen) return;
    const handler = (e: MouseEvent) => {
      if (quickSnoozeRef.current && !quickSnoozeRef.current.contains(e.target as Node)) {
        setQuickSnoozeOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [quickSnoozeOpen]);

  // Busca: focar input ao abrir
  useEffect(() => {
    if (msgSearchOpen) requestAnimationFrame(() => msgSearchInputRef.current?.focus());
  }, [msgSearchOpen]);

  // Fechar dropdown de área ao clicar fora
  useEffect(() => {
    if (!showLegalAreaDropdown) return;
    const handler = (e: MouseEvent) => {
      if (legalAreaDropdownRef.current && !legalAreaDropdownRef.current.contains(e.target as Node)) {
        setShowLegalAreaDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLegalAreaDropdown]);

  // Fechar dropdown de especialista ao clicar fora
  useEffect(() => {
    if (!showLawyerDropdown) return;
    const handler = (e: MouseEvent) => {
      if (lawyerDropdownRef.current && !lawyerDropdownRef.current.contains(e.target as Node)) {
        setShowLawyerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLawyerDropdown]);

  // Fechar dropdown de etapa CRM ao clicar fora
  useEffect(() => {
    if (!showStageDropdown) return;
    const handler = (e: MouseEvent) => {
      if (stageDropdownRef.current && !stageDropdownRef.current.contains(e.target as Node)) {
        setShowStageDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStageDropdown]);

  const fetchConversations = useCallback(async (inboxId?: string | null, silent = false) => {
    try {
      const res = await api.get('/conversations', {
        params: {
          inboxId: inboxId || undefined,
          clientMode: String(clientModeRef.current),
        },
        // silent=true: chamadas de background (inboxUpdate) não disparam redirect global de 401
        ...( silent ? { _silent401: true } as any : {} ),
      });
      // Suporta resposta paginada { data, total, ... } ou array legado
      const items = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setConversations(items);
    } catch (e: any) {
      if (e.response?.status === 401 && !silent) {
        // Deixa o interceptor global (api.ts) tratar via evento auth:logout
      } else if (e.response?.status !== 401) {
        setConversations([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAdiadoConversations = useCallback(async (inboxId?: string | null) => {
    try {
      const res = await api.get('/conversations', {
        params: { status: 'ADIADO', inboxId: inboxId || undefined },
        ...({ _silent401: true } as any),
      });
      const items = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setAdiadoConversations(items);
    } catch { /* silencioso */ }
  }, []);

  const fetchInboxes = async (silent = false) => {
    try {
      const res = await api.get('/inboxes', {
        ...(silent ? { _silent401: true } as any : {}),
      });
      setUserInboxes(res.data);
    } catch (error) {
      console.error('Failed to fetch inboxes', error);
    }
  };

  const fetchSpecialists = async (silent = false) => {
    try {
      // /users/agents não exige role ADMIN (diferente de /users)
      const res = await api.get('/users/agents', {
        ...(silent ? { _silent401: true } as any : {}),
      });
      setAllSpecialists((res.data || []).filter((u: any) => u.specialties?.length > 0));
    } catch (e) {
      console.error('Failed to fetch specialists', e);
    }
  };

  const fetchPendingTransfers = useCallback(async (silent = false) => {
    try {
      const res = await api.get('/conversations/pending-transfers', {
        ...(silent ? { _silent401: true } as any : {}),
      });
      setPendingTransfers(res.data || []);
    } catch (e: any) {
      if (e.response?.status !== 401 || !silent) {
        console.error('Failed to fetch pending transfers', e);
      }
    }
  }, []);

  // Deteccao offline/online (navigator.onLine + events)
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // WebSocket connection (once, does not reconnect on filter changes)
  useEffect(() => {
    const wsUrl = getWsUrl();
    console.log('[SOCKET] Connecting to:', wsUrl);
    const socket = io(wsUrl, {
      path: getSocketPath(),
      transports: ['polling', 'websocket'],
      auth: { token: localStorage.getItem('token') || '' },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      console.log('[SOCKET] Connected to dashboard ID:', socket.id);
      setSocketConnected(true);
      // Re-join current conversation room on reconnect
      const currentConvoId = selectedIdRef.current;
      if (currentConvoId && !currentConvoId.startsWith('demo-')) {
        socket.emit('join_conversation', currentConvoId);
        // Re-fetch messages to recover any missed during disconnection
        setMsgRefreshKey(k => k + 1);
      }
      // Refresh sidebar to catch up on missed inboxUpdate events
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
      // Join personal user room for transfer notifications
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload?.sub) socket.emit('join_user', payload.sub);
        } catch {}
      }
    });

    socket.on('disconnect', () => {
      console.log('[SOCKET] Disconnected from dashboard');
      setSocketConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('[SOCKET] Connection error:', err);
    });

    socket.on('inboxUpdate', () => {
      console.log('[SOCKET] inboxUpdate received, fetching conversations...');
      // silent=true: 401 nestas chamadas de background não redireciona todos os usuários
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
      fetchPendingTransfers(true);
    });

    // Typing indicator
    socket.on('typing_indicator', (data: { userId: string; userName: string; isTyping: boolean }) => {
      const myId = currentUserIdRef.current;
      if (data.userId === myId) return; // ignore own typing
      setTypingUsers(prev => {
        const next = { ...prev };
        if (data.isTyping) {
          // Clear previous timeout for this user
          if (next[data.userId]) clearTimeout(next[data.userId].timeout);
          const timeout = setTimeout(() => {
            setTypingUsers(p => {
              const n = { ...p };
              delete n[data.userId];
              return n;
            });
          }, 4000);
          next[data.userId] = { userName: data.userName, timeout };
        } else {
          if (next[data.userId]) clearTimeout(next[data.userId].timeout);
          delete next[data.userId];
        }
        return next;
      });
    });

    // Incoming message notification — broadcast to all; each client filters by assignedUserId
    socket.on('incoming_message_notification', (data: { conversationId: string; contactName?: string; assignedUserId?: string | null }) => {
      const myId = currentUserIdRef.current;
      // Skip if assigned to someone else. Play if: assigned to me, unassigned, or can't determine current user
      if (myId && data?.assignedUserId && data.assignedUserId !== myId) return;
      playNotificationSound();
      // Desktop notification (only when tab is not focused)
      showDesktopNotification({
        title: data?.contactName || 'Nova mensagem',
        body: 'Nova mensagem recebida',
        tag: `msg-${data.conversationId}`,
        onClick: () => setSelectedId(data.conversationId),
      });
      // Only mark unread when the user is NOT currently viewing that conversation
      if (data?.conversationId && data.conversationId !== selectedIdRef.current) {
        setUnreadCounts(prev => ({
          ...prev,
          [data.conversationId]: (prev[data.conversationId] || 0) + 1,
        }));
      }
    });

    // Transfer request: incoming popup + sound for target operator
    socket.on('transfer_request', (data: { conversationId: string; fromUserName: string; contactName: string; reason: string | null; audioIds?: string[] }) => {
      playNotificationSound();
      showDesktopNotification({
        title: 'Transferencia recebida',
        body: `${data.fromUserName} transferiu "${data.contactName}"`,
        tag: `transfer-${data.conversationId}`,
        onClick: () => setSelectedId(data.conversationId),
      });
      shownTransferIdsRef.current.add(data.conversationId);
      setIncomingTransfer(data);
      setShowDeclineInput(false);
      setDeclineReason('');
      fetchPendingTransfers(true);
    });

    // Transfer response: notification for the sender
    socket.on('transfer_response', (data: { accepted: boolean; userName?: string; reason?: string; contactName: string }) => {
      if (data.accepted) {
        setTransferResponseMsg(`✅ ${data.userName} aceitou a transferência de "${data.contactName}"`);
      } else {
        setTransferResponseMsg(`❌ Transferência de "${data.contactName}" recusada${data.reason ? ': ' + data.reason : '.'}`);
      }
      fetchConversations(selectedInboxIdRef.current, true);
      setTimeout(() => setTransferResponseMsg(null), 6000);
    });

    socket.on('transfer_returned', (data: { conversationId: string; fromUserName: string; contactName: string; reason: string | null; audioIds?: string[] }) => {
      setTransferResponseMsg(`↩ ${data.fromUserName} devolveu "${data.contactName}"${data.reason ? ': ' + data.reason : ''}`);
      // Guardar contexto de retorno para exibir no chat
      if (data.reason || (data.audioIds && data.audioIds.length > 0)) {
        setTransferContextMap(prev => ({
          ...prev,
          [data.conversationId]: {
            fromUserName: data.fromUserName,
            reason: data.reason,
            audioIds: data.audioIds || [],
          },
        }));
      }
      fetchConversations(selectedInboxIdRef.current, true);
      setTimeout(() => setTransferResponseMsg(null), 8000);
    });

    // Contrato assinado digitalmente (Clicksign)
    socket.on('contract:signed', (data: { conversationId: string; leadName: string; signedAt: string }) => {
      showSuccess(`✅ Contrato assinado por ${data.leadName}!`);
    });

    // Erro biométrico na assinatura (Clicksign) — tutorial enviado ao cliente automaticamente
    socket.on('contract:biometric_error', (data: { conversationId: string; leadName: string; eventName: string; errorType: string }) => {
      showError(`⚠️ Erro de ${data.errorType} para ${data.leadName}. Tutorial enviado ao cliente via WhatsApp.`);
    });

    // WhatsApp instance connection status (connect/disconnect)
    socket.on('connection_status_update', (data: { instanceName: string; state: string }) => {
      setInstanceStatuses(prev => ({ ...prev, [data.instanceName]: data.state }));
      if (data.state === 'close') {
        showError(`WhatsApp desconectado: ${data.instanceName}`);
      } else if (data.state === 'open') {
        showSuccess(`WhatsApp reconectado: ${data.instanceName}`);
      }
    });

    // Lembrete de tarefa agendada (PUSH via calendar cron)
    socket.on('calendar_reminder', (data: { eventId: string; title: string; type: string; start_at: string; minutesBefore: number }) => {
      setTaskReminderToast(data);
      try { playNotificationSound(); } catch {}
      showDesktopNotification({
        title: data.minutesBefore > 0 ? `⏰ Lembrete em ${data.minutesBefore} min` : '⏰ Tarefa agora!',
        body: data.title,
      });
      setTimeout(() => setTaskReminderToast(null), 12000);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchConversations, fetchAdiadoConversations]);

  // Initial data load + refetch on inbox filter change or clientMode change
  useEffect(() => {
    fetchInboxes(true);
    fetchConversations(selectedInboxId, true);
    fetchAdiadoConversations(selectedInboxId);
    fetchPendingTransfers(true);
    fetchSpecialists(true);
  }, [fetchConversations, fetchAdiadoConversations, fetchPendingTransfers, selectedInboxId, clientMode]);

  // Ao trocar clientMode: deseleciona conversa ativa para evitar contexto errado
  useEffect(() => {
    setSelectedId(null);
  }, [clientMode]);

  // Canned responses — fetch once on mount (não depende do inbox)
  useEffect(() => {
    api.get('/settings/canned-responses', { _silent401: true } as any)
      .then(r => setCannedResponsesState(r.data || []))
      .catch(() => {});
  }, []);

  // Auto-abrir conversa vinda do CRM (via sessionStorage 'crm_open_conv')
  // Roda uma vez no mount — não depende da lista de conversas estar carregada.
  // As mensagens são buscadas via API usando o ID diretamente.
  useEffect(() => {
    const pendingConvId = sessionStorage.getItem('crm_open_conv');
    if (pendingConvId) {
      setSelectedId(pendingConvId);
      sessionStorage.removeItem('crm_open_conv');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Buscar stage do lead ao selecionar conversa
  useEffect(() => {
    if (!selectedId) { setLeadStage(null); return; }
    setShowStageDropdown(false);
    const conv = conversations.find(c => c.id === selectedId);
    if (conv?.leadId) {
      api.get(`/leads/${conv.leadId}`, { _silent401: true } as any)
        .then(r => setLeadStage(r.data?.stage || null))
        .catch(() => setLeadStage(null));
    } else {
      setLeadStage(null);
    }
  }, [selectedId]);

  // Buscar status da ficha trabalhista ao selecionar conversa com área Trabalhista
  useEffect(() => {
    setFichaFinalizada(false);
    const conv = conversations.find(c => c.id === selectedId);
    if (!conv?.leadId || !conv?.legalArea?.toLowerCase().includes('trabalhist')) return;
    api.get(`/ficha-trabalhista/${conv.leadId}`, { _silent401: true } as any)
      .then(r => setFichaFinalizada(r.data?.finalizado === true))
      .catch(() => {});
  }, [selectedId, conversations]);

  // Polling de transferências pendentes: fallback quando o evento socket direto é perdido
  // silent=true: nunca causa logout — se o token expirar, só o load inicial ou ação do usuário redireciona
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPendingTransfers(true);
    }, 12000);
    return () => clearInterval(interval);
  }, [fetchPendingTransfers]);

  // Auto-abrir popup para transferências ainda não exibidas ao usuário
  useEffect(() => {
    if (incomingTransfer) return; // já há um popup aberto
    const unseen = pendingTransfers.find(pt => !shownTransferIdsRef.current.has(pt.conversationId));
    if (unseen) {
      shownTransferIdsRef.current.add(unseen.conversationId);
      playNotificationSound();
      setIncomingTransfer({
        conversationId: unseen.conversationId,
        fromUserName: unseen.fromUserName,
        contactName: unseen.contactName,
        reason: unseen.reason,
        audioIds: unseen.audioIds,
      });
      setShowDeclineInput(false);
      setDeclineReason('');
    }
  }, [pendingTransfers, incomingTransfer]);

  // Fetch messages when conversation selected
  useEffect(() => {
    setReplyingTo(null);
    if (!selectedId || selectedId.startsWith('demo-')) {
      setMessages([]);
      setMsgTotalPages(1);
      setMsgCurrentPage(1);
      return;
    }

    const prevId = selectedIdRef.current;

    const fetchDetail = async () => {
      setLoadingMessages(true);
      try {
        // ── 1. Configurar socket ANTES da chamada à API ─────────────────────
        // Garante que nenhuma mensagem enviada durante o carregamento seja perdida.
        if (socketRef.current) {
          // Leave previous room before joining new one
          if (prevId && prevId !== selectedId) {
            socketRef.current.emit('leave_conversation', prevId);
          }
          socketRef.current.emit('join_conversation', selectedId);
          socketRef.current.off('newMessage');
          socketRef.current.on('newMessage', (msg: MessageItem) => {
            // Guard estrito: ignora mensagens de outra conversa
            if (msg.conversation_id !== selectedIdRef.current) return;
            setMessages(prev => {
              // Dedup: já existe pelo ID real
              if (prev.some(m => m.id === msg.id)) return prev;
              // Dedup: já existe pelo external_message_id
              if (msg.external_message_id && prev.some(m => m.external_message_id === msg.external_message_id)) return prev;
              // Se é outgoing, substituir msg otimista correspondente (optimistic UI)
              if (msg.direction === 'out') {
                const optimisticIdx = prev.findIndex(m => typeof m.id === 'string' && m.id.startsWith('optimistic_'));
                if (optimisticIdx >= 0) {
                  return prev.map((m, i) => i === optimisticIdx ? msg : m);
                }
              }
              return [...prev, msg];
            });
            if (msg.direction === 'in') playNotificationSound();
          });
          socketRef.current.off('mediaReady');
          socketRef.current.on('mediaReady', (updatedMsg: MessageItem) => {
            console.log('[SOCKET] mediaReady received:', updatedMsg.id);
            setMessages(prev => prev.map(m => m.id === updatedMsg.id ? updatedMsg : m));
          });
          socketRef.current.off('messageUpdate');
          socketRef.current.on('messageUpdate', (updatedMsg: MessageItem) => {
            setMessages(prev => prev.map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
          });
          socketRef.current.off('contact_presence');
          socketRef.current.on('contact_presence', (data: { presence: string }) => {
            setContactPresence(data.presence);
          });
        }

        // Clear typing users on conversation switch
        setTypingUsers(prev => {
          Object.values(prev).forEach(u => clearTimeout(u.timeout));
          return {};
        });

        // ── 2. Buscar mensagens via API ─────────────────────────────────────
        // O listener já está ativo, então mensagens que chegarem durante o fetch
        // são capturadas e mescladas ao final.
        const msgRes = await api.get(`/messages/conversation/${selectedId}`, {
          params: { page: 1, limit: 100 },
        });
        const apiMessages = Array.isArray(msgRes.data) ? msgRes.data : (msgRes.data?.data || []);

        // Mescla mensagens da API com as que chegaram via socket durante o carregamento
        setMessages(prev => {
          const merged = [...apiMessages];
          for (const m of prev) {
            // Só inclui mensagens desta conversa que ainda não estão no resultado da API
            if (m.conversation_id === selectedId && !merged.some(e => e.id === m.id)) {
              merged.push(m);
            }
          }
          return merged;
        });

        setMsgTotalPages(msgRes.data?.totalPages || 1);
        setMsgCurrentPage(1);
      } catch (e) {
        console.error('Failed to fetch conversation', e);
      } finally {
        setLoadingMessages(false);
      }
    };

    // Reset presence when switching conversations
    setContactPresence('unavailable');
    fetchDetail();

    return () => {
      // Cleanup listeners ao trocar de conversa (evita race condition)
      if (socketRef.current) {
        socketRef.current.off('newMessage');
        socketRef.current.off('mediaReady');
        socketRef.current.off('messageUpdate');
        socketRef.current.off('contact_presence');
      }
    };
  }, [selectedId, msgRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll inteligente: rola ao fundo exceto se usuário está scrollado acima lendo histórico
  useEffect(() => {
    if (!scrollRef.current || loadingMoreMsgs) return;
    const lastMsg = messages[messages.length - 1];
    // Sempre rola se: sem msgs, usuário está no fundo, ou última msg é outgoing (o próprio operador enviou)
    if (!lastMsg || !isScrolledUpRef.current || lastMsg.direction === 'out') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setNewMsgsWhileScrolled(0);
    } else {
      // Usuário está scrollado acima e chegou mensagem do cliente → mostrar badge
      setNewMsgsWhileScrolled(prev => prev + 1);
    }
  }, [messages, loadingMoreMsgs]);

  // Infinite scroll: auto-load ao rolar perto do topo
  const loadMoreMsgsRef = useRef(loadingMoreMsgs);
  loadMoreMsgsRef.current = loadingMoreMsgs;
  const msgCurrentPageRef = useRef(msgCurrentPage);
  msgCurrentPageRef.current = msgCurrentPage;
  const msgTotalPagesRef = useRef(msgTotalPages);
  msgTotalPagesRef.current = msgTotalPages;

  const loadOlderMessages = useCallback(async () => {
    const convId = selectedIdRef.current;
    if (!convId || loadMoreMsgsRef.current) return;
    if (msgCurrentPageRef.current >= msgTotalPagesRef.current) return;
    setLoadingMoreMsgs(true);
    try {
      const nextPage = msgCurrentPageRef.current + 1;
      const res = await api.get(`/messages/conversation/${convId}`, {
        params: { page: nextPage, limit: 100 },
      });
      const olderMsgs = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      const scrollEl = scrollRef.current;
      const prevScrollHeight = scrollEl?.scrollHeight || 0;
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newMsgs = olderMsgs.filter((m: any) => !existingIds.has(m.id));
        return [...newMsgs, ...prev];
      });
      setMsgCurrentPage(nextPage);
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight - prevScrollHeight;
      });
    } catch (e) {
      console.error('Falha ao carregar mensagens anteriores', e);
    } finally {
      setLoadingMoreMsgs(false);
    }
  }, []);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const scrollContainer = scrollRef.current;
    if (!sentinel || !scrollContainer) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadOlderMessages(); },
      { root: scrollContainer, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [selectedId, msgCurrentPage, msgTotalPages, loadOlderMessages]);

  // Protecao contra perda de texto: beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (text.trim()) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [text]);

  // Rascunhos: salvar texto ao trocar de conversa, restaurar ao voltar
  useEffect(() => {
    if (selectedId && drafts[selectedId]) {
      setText(drafts[selectedId]);
      setDrafts(prev => { const n = { ...prev }; delete n[selectedId!]; return n; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Salvar rascunho quando muda de conversa
  const prevSelectedIdForDraft = useRef<string | null>(null);
  useEffect(() => {
    if (prevSelectedIdForDraft.current && prevSelectedIdForDraft.current !== selectedId && text.trim()) {
      const prevId = prevSelectedIdForDraft.current;
      setDrafts(prev => ({ ...prev, [prevId]: text }));
      setText('');
    } else if (selectedId !== prevSelectedIdForDraft.current) {
      // Limpar texto ao trocar (se não tinha rascunho, o useEffect acima já restaurou)
    }
    prevSelectedIdForDraft.current = selectedId;
  }, [selectedId, text]);

  // ─── Slash command menu (estáticos + canned responses dinâmicos) ────────────
  const allSlashItems = useMemo(() => [
    ...SLASH_COMMANDS.map(cmd => ({
      id: cmd.id,
      label: cmd.label,
      description: cmd.description,
      Icon: cmd.Icon,
      isCanned: false as const,
      cannedText: '',
    })),
    ...cannedResponses.map(cr => ({
      id: `canned_${cr.id}`,
      label: cr.label,
      description: cr.text.length > 60 ? cr.text.slice(0, 60) + '…' : cr.text,
      Icon: MessageSquare,
      isCanned: true as const,
      cannedText: cr.text,
    })),
  ], [cannedResponses]);

  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.slice(1).toLowerCase() : null;
  const filteredSlashCommands = slashQuery !== null
    ? allSlashItems.filter(cmd =>
        cmd.id.toLowerCase().includes(slashQuery) || cmd.label.toLowerCase().includes(slashQuery)
      )
    : [];
  const showSlashMenu = slashQuery !== null && filteredSlashCommands.length > 0;

  // Posição do menu: calcula sempre que showSlashMenu muda (portal fixed)
  useEffect(() => {
    if (showSlashMenu && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setSlashMenuPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
    } else {
      setSlashMenuPos(null);
    }
  }, [showSlashMenu]);

  const executeSlashCommand = (cmdId: string) => {
    const item = allSlashItems.find(i => i.id === cmdId);
    setText('');
    setSlashMenuIndex(0);
    if (item?.isCanned) {
      setText(item.cannedText);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (cmdId === 'contrato_trabalhista') setShowContratoModal(true);
  };
  // ──────────────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!text.trim() || !selectedId || selectedId.startsWith('demo-') || sending || text.length > 5000) return;

    // ── Slash command selecionado pelo menu ─────────────────────────────────
    if (slashQuery !== null && filteredSlashCommands.length > 0) {
      executeSlashCommand(filteredSlashCommands[slashMenuIndex]?.id ?? filteredSlashCommands[0].id);
      return;
    }
    // ───────────────────────────────────────────────────────────────────────

    const msgText = text;
    const replyId = replyingTo?.id;
    setSending(true);
    setText('');
    setReplyingTo(null);
    // Stop typing indicator on send
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    socketRef.current?.emit('typing', { conversationId: selectedId, isTyping: false });

    // Optimistic UI: adicionar msg na lista imediatamente
    const optimisticId = `optimistic_${Date.now()}`;
    const optimisticMsg: any = {
      id: optimisticId,
      conversation_id: selectedId,
      direction: 'out',
      type: internalNoteMode ? 'internal_note' : 'text',
      text: msgText,
      created_at: new Date().toISOString(),
      status: 'enviando',
      reply_to_id: replyId || null,
      media: [],
    };
    setMessages(prev => [...prev, optimisticMsg]);
    if (internalNoteMode) setInternalNoteMode(false);

    try {
      const res = await api.post('/messages/send', {
        conversationId: selectedId,
        text: msgText,
        ...(replyId ? { replyToId: replyId } : {}),
        ...(optimisticMsg.type === 'internal_note' ? { isInternal: true } : {}),
      });
      // Substituir msg otimista pela real do servidor
      // Se o WebSocket já substituiu a otimista, o ID real já está na lista — não duplicar
      if (res.data?.id) {
        setMessages(prev => {
          const hasOptimistic = prev.some(m => m.id === optimisticId);
          // Checar se WebSocket já entregou (por id ou external_message_id)
          const hasReal = prev.some(m =>
            m.id === res.data.id ||
            (res.data.external_message_id && m.external_message_id === res.data.external_message_id)
          );
          if (hasReal) {
            // WebSocket já entregou — só remover a otimista se ainda existir
            return hasOptimistic ? prev.filter(m => m.id !== optimisticId) : prev;
          }
          // Substituir otimista pela real
          return hasOptimistic
            ? prev.map(m => m.id === optimisticId ? res.data : m)
            : [...prev, res.data];
        });
      }
      inputRef.current?.focus();
    } catch (e: any) {
      console.error('Failed to send message', e);
      showError(e.response?.data?.message || 'Falha ao enviar mensagem');
      // Remover msg otimista e restaurar texto
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setText(msgText);
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleAccept = async () => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    try {
      await api.patch(`/conversations/${selectedId}/assign`);
      fetchConversations(selectedInboxIdRef.current, true);
      showSuccess('Conversa aceita');
    } catch (e) {
      console.error('Failed to accept', e);
      showError('Falha ao aceitar conversa');
    }
  };

  const handleClose = () => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    setCloseConvModal(true);
  };

  const confirmClose = async () => {
    if (!selectedId) return;
    const convId = selectedId;
    const sendCsat = csatOnClose;
    setCloseConvModal(false);
    try {
      await api.patch(`/conversations/${convId}/close`);
      // Enviar pesquisa de satisfação (CSAT) se habilitado
      if (sendCsat) {
        try {
          await api.post('/messages/send', {
            conversationId: convId,
            text: '⭐ *Como você avalia nosso atendimento?*\n\nResponda com um número de 1 a 5:\n\n1️⃣ Péssimo\n2️⃣ Ruim\n3️⃣ Regular\n4️⃣ Bom\n5️⃣ Excelente\n\nSua avaliação nos ajuda a melhorar! 🙏',
          });
        } catch { /* não bloqueia o encerramento se CSAT falhar */ }
      }
      setSelectedId(null);
      fetchConversations(selectedInboxIdRef.current, true);
      showSuccess(sendCsat ? 'Conversa encerrada e pesquisa enviada' : 'Conversa encerrada');
    } catch (e) {
      console.error('Failed to close', e);
      showError('Falha ao fechar conversa');
    }
  };

  const openReasonPopup = (context: 'lawyer' | 'operator' | 'return', targetName: string) => {
    setTransferReason('');
    setTransferAudioIds([]);
    setTransferError(null);
    setReasonPopupContext(context);
    setReasonPopupTargetName(targetName);
    setShowReasonPopup(true);
  };

  const closeReasonPopup = () => {
    setShowReasonPopup(false);
    setReasonPopupContext(null);
    setTransferReason('');
    setTransferAudioIds([]);
  };

  const handleOpenTransferModal = async () => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    setTransferError(null);
    setSelectedTransferUserId(null);
    setShowReasonPopup(false);
    setTransferReason('');
    setTransferAudioIds([]);
    setLoadingOperators(true);
    setTransferModal(true);
    try {
      const res = await api.get('/inboxes/operators');
      setTransferGroups(res.data || []);
    } catch (e: any) {
      setTransferError('Erro ao carregar operadores. Tente novamente.');
      console.error('Failed to load operators', e);
    } finally {
      setLoadingOperators(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedId || selectedId.startsWith('demo-') || !selectedTransferUserId) return;
    setTransferError(null);
    try {
      setTransferring(true);
      await api.post(`/conversations/${selectedId}/transfer-request`, {
        toUserId: selectedTransferUserId,
        reason: transferReason.trim() || undefined,
        audioIds: transferAudioIds.length > 0 ? transferAudioIds : undefined,
      });
      const destUser = transferGroups.flatMap(g => g.users).find(u => u.id === selectedTransferUserId);
      setTransferSentMsg(`📨 Solicitação enviada para ${destUser?.name || 'operador'}. Aguardando resposta...`);
      setTimeout(() => setTransferSentMsg(null), 6000);
      setShowReasonPopup(false);
      setTransferModal(false);
      setSelectedTransferUserId(null);
      setTransferReason('');
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Erro ao solicitar transferência. Tente novamente.';
      setTransferError(msg);
      console.error('Failed to transfer', e);
    } finally {
      setTransferring(false);
    }
  };

  const handleTransferToLawyer = async () => {
    if (!selectedId) return;
    setTransferring(true);
    setTransferError(null);
    try {
      await api.post(`/conversations/${selectedId}/transfer-to-lawyer`, {
        reason: transferReason.trim() || undefined,
        audioIds: transferAudioIds.length > 0 ? transferAudioIds : undefined,
      });
      setShowReasonPopup(false);
      setTransferModal(false);
      setTransferReason('');
      setTransferAudioIds([]);
      setTransferSentMsg(`⚖️ Solicitação enviada para o advogado especialista. Aguardando resposta...`);
      setTimeout(() => setTransferSentMsg(null), 6000);
    } catch (e: any) {
      setTransferError(e?.response?.data?.message || 'Erro ao transferir para advogado.');
    } finally {
      setTransferring(false);
    }
  };

  const handleReturnToOrigin = async () => {
    if (!selectedId) return;
    try {
      await api.patch(`/conversations/${selectedId}/return-to-origin`);
      fetchConversations(selectedInboxIdRef.current, true);
      showSuccess('Conversa devolvida');
    } catch (e: any) {
      console.error('Failed to return to origin', e);
      showError('Falha ao devolver conversa');
    }
  };

  const handleKeepInInbox = async () => {
    if (!selectedId) return;
    try {
      await api.patch(`/conversations/${selectedId}/keep-in-inbox`);
      fetchConversations(selectedInboxIdRef.current, true);
      showSuccess('Conversa mantida no inbox');
    } catch (e: any) {
      console.error('Failed to keep in inbox', e);
      showError('Falha ao manter no inbox');
    }
  };

  const handleAssignLawyerInbox = async (lawyerId: string | null) => {
    const convId = selectedIdRef.current || selectedId;
    if (!convId) return;
    setShowLawyerDropdown(false);
    // Optimistic update — nome do especialista
    const lawyerName = lawyerId ? allSpecialists.find(s => s.id === lawyerId)?.name || null : null;
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, assignedLawyerId: lawyerId, assignedLawyerName: lawyerName } : c));
    setAdiadoConversations(prev => prev.map(c => c.id === convId ? { ...c, assignedLawyerId: lawyerId, assignedLawyerName: lawyerName } : c));
    try {
      await api.patch(`/conversations/${convId}/assign-lawyer`, { lawyerId });
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
    } catch (e: any) {
      console.error('Failed to assign lawyer', e);
      // Rollback
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
      alert('Erro ao atribuir especialista: ' + (e?.response?.data?.message || e?.message || 'Tente novamente'));
    }
  };

  const handleChangeLeadStage = async (newStage: string) => {
    const conv = conversations.find(c => c.id === selectedId) ?? adiadoConversations.find(c => c.id === selectedId);
    if (!conv?.leadId) return;
    // Bloquear FINALIZADO sem área de atendimento definida
    if (newStage === 'FINALIZADO' && !conv?.legalArea) {
      alert('⚠️ Defina a Área de Atendimento antes de marcar como Finalizado.');
      return;
    }
    setShowStageDropdown(false);
    // PERDIDO exige motivo — abre modal antes de prosseguir
    if (newStage === 'PERDIDO') {
      setLossModal({ leadId: conv.leadId, leadName: conv.contactName || 'Lead' });
      setLossReason('');
      return;
    }
    setLeadStage(newStage); // otimista
    // Atualiza leadStage nos dois arrays (ABERTO + ADIADO) para o filtro reagir imediatamente
    setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, leadStage: newStage } : c));
    setAdiadoConversations(prev => prev.map(c => c.id === selectedId ? { ...c, leadStage: newStage } : c));
    try {
      await api.patch(`/leads/${conv.leadId}/stage`, { stage: newStage });
    } catch (e: any) {
      console.error('Failed to change lead stage', e);
      // Rollback otimismo — ambos os arrays
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, leadStage: conv.leadStage } : c));
      setAdiadoConversations(prev => prev.map(c => c.id === selectedId ? { ...c, leadStage: conv.leadStage } : c));
      setLeadStage(conv.leadStage ?? null);
    }
  };

  // Confirma arquivamento com motivo de perda obrigatório
  const confirmLoss = async () => {
    if (!lossModal || !lossReason.trim()) return;
    const { leadId } = lossModal;
    const conv = conversations.find(c => c.leadId === leadId) ?? adiadoConversations.find(c => c.leadId === leadId);
    const prevStage = conv?.leadStage ?? 'INICIAL';
    setLossModal(null);
    // Otimismo: remove da lista e fecha painel — ambos os arrays
    setLeadStage('PERDIDO');
    setConversations(prev => prev.map(c => c.leadId === leadId ? { ...c, leadStage: 'PERDIDO' } : c));
    setAdiadoConversations(prev => prev.map(c => c.leadId === leadId ? { ...c, leadStage: 'PERDIDO' } : c));
    setSelectedId(null);
    setShowDetailsPanel(false);
    try {
      await api.patch(`/leads/${leadId}/stage`, { stage: 'PERDIDO', loss_reason: lossReason.trim() });
    } catch (e: any) {
      console.error('Failed to mark lead as PERDIDO', e);
      // Rollback — ambos os arrays
      setConversations(prev => prev.map(c => c.leadId === leadId ? { ...c, leadStage: prevStage } : c));
      setAdiadoConversations(prev => prev.map(c => c.leadId === leadId ? { ...c, leadStage: prevStage } : c));
    }
  };

  // Abre o modal de criação rápida de tarefa vinculada ao lead do chat atual
  const openTaskModal = async () => {
    const conv = conversations.find(c => c.id === selectedId) ?? adiadoConversations.find(c => c.id === selectedId);
    if (!conv?.leadId) return;
    setTaskTitle('');
    setTaskDueAt('');
    setTaskAssignedId('');
    setTaskModal({ leadId: conv.leadId, conversationId: conv.id, leadName: conv.contactName || 'Lead' });
    if (taskAgents.length === 0) {
      try {
        const res = await api.get('/users/agents');
        setTaskAgents(res.data || []);
      } catch { /* silencioso */ }
    }
  };

  const createTask = async () => {
    if (!taskModal || !taskTitle.trim() || savingTask) return;
    setSavingTask(true);
    try {
      // Se já tem tarefa ativa (re-adiar), cancelar a antiga
      const existingConv = adiadoConversations.find(c => c.id === taskModal.conversationId);
      if (existingConv?.activeTask) {
        await api.patch(`/tasks/${existingConv.activeTask.id}/status`, { status: 'CANCELADA' });
      }
      // Criar nova tarefa
      await api.post('/tasks', {
        title: taskTitle.trim(),
        lead_id: taskModal.leadId,
        conversation_id: taskModal.conversationId,
        due_at: taskDueAt || undefined,
        assigned_user_id: taskAssignedId || undefined,
      });
      // Adiar a conversa se ainda não está adiada
      if (!existingConv || existingConv.status !== 'ADIADO') {
        await api.patch(`/conversations/${taskModal.conversationId}/defer`);
      }
      setTaskModal(null);
      setSelectedId(null);
      showSuccess('⏰ Atendimento adiado com sucesso!');
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
    } catch {
      showError('Erro ao adiar atendimento');
    } finally {
      setSavingTask(false);
    }
  };

  const handleCompleteTask = async () => {
    const conv = conversations.find(c => c.id === selectedId) ?? adiadoConversations.find(c => c.id === selectedId);
    if (!conv?.activeTask) return;
    try {
      await api.post(`/tasks/${conv.activeTask.id}/complete-reopen`);
      showSuccess('✅ Tarefa concluída! Conversa reaberta.');
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
    } catch {
      showError('Erro ao concluir tarefa');
    }
  };

  const handleQuickSnooze = async (taskTitle: string, dueAt: string) => {
    const conv = conversations.find(c => c.id === selectedId) ?? adiadoConversations.find(c => c.id === selectedId);
    if (!conv?.leadId || !selectedId) return;
    setQuickSnoozeOpen(false);
    try {
      if (conv.activeTask) {
        await api.patch(`/tasks/${conv.activeTask.id}/status`, { status: 'CANCELADA' });
      }
      await api.post('/tasks', {
        title: taskTitle,
        lead_id: conv.leadId,
        conversation_id: selectedId,
        due_at: dueAt,
      });
      if (conv.status !== 'ADIADO') {
        await api.patch(`/conversations/${selectedId}/defer`);
      }
      setSelectedId(null);
      showSuccess('⏰ Atendimento adiado!');
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
    } catch {
      showError('Erro ao adiar atendimento');
    }
  };

  const handleForwardMessage = async (destConversationId: string) => {
    if (!forwardMsg?.text?.trim()) return;
    setForwardMsg(null);
    setForwardSearch('');
    try {
      await api.post('/messages/send', {
        conversationId: destConversationId,
        text: `↪️ *Mensagem encaminhada:*\n${forwardMsg.text}`,
      });
      showSuccess('Mensagem encaminhada');
    } catch {
      showError('Erro ao encaminhar mensagem');
    }
  };

  const handleRescheduleTask = async (newDate: string) => {
    const conv = conversations.find(c => c.id === selectedId) ?? adiadoConversations.find(c => c.id === selectedId);
    if (!conv?.activeTask) return;
    try {
      await api.patch(`/tasks/${conv.activeTask.id}`, { due_at: newDate });
      showSuccess('📅 Prazo atualizado!');
      fetchAdiadoConversations(selectedInboxIdRef.current);
    } catch {
      showError('Erro ao reagendar');
    }
  };

  const handleChangeLegalArea = async (area: string | null) => {
    if (!selectedId) return;
    const prevArea = selected?.legalArea ?? null;
    setShowLegalAreaDropdown(false);
    // Optimistic update — atualizar ambos os arrays (ABERTO + ADIADO)
    setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, legalArea: area } : c));
    setAdiadoConversations(prev => prev.map(c => c.id === selectedId ? { ...c, legalArea: area } : c));
    try {
      await api.patch(`/conversations/${selectedId}/legal-area`, { legalArea: area });
    } catch (e: any) {
      // Rollback — ambos os arrays
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, legalArea: prevArea } : c));
      setAdiadoConversations(prev => prev.map(c => c.id === selectedId ? { ...c, legalArea: prevArea } : c));
      alert('Erro ao atualizar área: ' + (e?.response?.data?.message || e?.message || 'Tente novamente'));
    }
  };

  const handleAcceptTransfer = async () => {
    if (!incomingTransfer) return;
    setProcessingTransfer(true);
    try {
      await api.patch(`/conversations/${incomingTransfer.conversationId}/transfer-accept`);
      shownTransferIdsRef.current.delete(incomingTransfer.conversationId);
      // Salvar contexto (motivo + áudios) para exibir no chat após aceitar
      const baseContext = {
        fromUserName: incomingTransfer.fromUserName,
        reason: incomingTransfer.reason,
        audioIds: incomingTransfer.audioIds || [],
      };
      if (incomingTransfer.reason || incomingTransfer.audioIds?.length) {
        setTransferContextMap(prev => ({ ...prev, [incomingTransfer.conversationId]: baseContext }));
      }
      // #11: Buscar resumo IA do lead para exibir no banner de contexto
      const conv = conversations.find(c => c.id === incomingTransfer.conversationId);
      if (conv?.leadId) {
        api.get(`/leads/${conv.leadId}/summary`, { _silent401: true } as any)
          .then(r => {
            const summary = r.data?.summary;
            if (summary) {
              setTransferContextMap(prev => {
                const existing = prev[incomingTransfer.conversationId] || baseContext;
                return {
                  ...prev,
                  [incomingTransfer.conversationId]: {
                    ...existing,
                    reason: existing.reason
                      ? `${existing.reason}\n\n🤖 Resumo IA: ${summary}`
                      : `🤖 Resumo IA: ${summary}`,
                  },
                };
              });
            }
          })
          .catch(() => { /* resumo é opcional — falha silenciosa */ });
      }
      setIncomingTransfer(null);
      fetchPendingTransfers(true);
      fetchConversations(selectedInboxIdRef.current, true);
    } catch (e) {
      console.error('Failed to accept transfer', e);
    } finally {
      setProcessingTransfer(false);
    }
  };

  const handleReturnWithReason = async () => {
    if (!selectedId) return;
    setTransferring(true);
    try {
      await api.patch(`/conversations/${selectedId}/return-to-origin`, {
        reason: transferReason.trim() || undefined,
        audioIds: transferAudioIds.length > 0 ? transferAudioIds : undefined,
      });
      closeReasonPopup();
      // Limpar contexto desta conversa pois está sendo devolvida
      setTransferContextMap(prev => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
      fetchConversations(selectedInboxIdRef.current, true);
    } catch (e: any) {
      console.error('Failed to return to origin', e);
    } finally {
      setTransferring(false);
    }
  };

  const handleDeclineTransfer = async () => {
    if (!incomingTransfer) return;
    setProcessingTransfer(true);
    try {
      await api.patch(`/conversations/${incomingTransfer.conversationId}/transfer-decline`, { reason: declineReason.trim() || undefined });
      shownTransferIdsRef.current.delete(incomingTransfer.conversationId);
      setIncomingTransfer(null);
      setDeclineReason('');
      setShowDeclineInput(false);
      fetchPendingTransfers();
    } catch (e) {
      console.error('Failed to decline transfer', e);
    } finally {
      setProcessingTransfer(false);
    }
  };

  const toggleBulk = useCallback((id: string) => {
    setSelectedBulk(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkAction = useCallback(async (action: 'close' | 'assign', ids: string[]) => {
    if (action === 'close') {
      try {
        await Promise.all(ids.map(id => api.patch(`/conversations/${id}/status`, { status: 'FECHADO' })));
        setConversations(prev => prev.filter(c => !ids.includes(c.id)));
        setSelectedBulk(new Set());
        showSuccess(`${ids.length} conversa${ids.length > 1 ? 's' : ''} encerrada${ids.length > 1 ? 's' : ''}`);
      } catch { showError('Erro ao encerrar conversas'); }
    }
  }, []);

  const handleQuickAcceptTransfer = async (conversationId: string) => {
    try {
      await api.patch(`/conversations/${conversationId}/transfer-accept`);
      shownTransferIdsRef.current.delete(conversationId);
      fetchPendingTransfers(true);
      fetchConversations(selectedInboxIdRef.current, true);
    } catch (e) {
      console.error('Failed to quick accept transfer', e);
    }
  };

  const handleSendFormLink = async () => {
    if (!selectedId || !selected?.leadId) return;
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const formUrl = `${baseUrl}/formulario/trabalhista/${selected.leadId}`;
    const formText = `Olá! Para agilizar o seu atendimento, por favor preencha a ficha abaixo com as informações do seu caso trabalhista:\n\n${formUrl}\n\nSe tiver dúvidas durante o preenchimento, é só me chamar aqui!`;
    try {
      await api.post('/messages/send', { conversationId: selectedId, text: formText });
    } catch (e) {
      console.error('Erro ao enviar link do formulário', e);
    }
  };

  const handleToggleAiMode = async () => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    const newMode = !aiMode;
    try {
      await api.patch(`/conversations/${selectedId}/ai-mode`, { ai_mode: newMode });
      setAiMode(newMode);
      fetchConversations(selectedInboxIdRef.current, true);
      fetchAdiadoConversations(selectedInboxIdRef.current);
      showSuccess(newMode ? 'IA ativada' : 'IA desativada');
    } catch (e) {
      console.error('Erro ao alterar modo IA', e);
      showError('Falha ao alterar modo IA');
    }
  };

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const ALLOWED_MEDIA = /^(image|video|audio)\//;
  const ALLOWED_DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument', 'application/vnd.ms-excel', 'text/plain', 'application/zip', 'application/x-zip-compressed'];

  const uploadFile = async (file: File) => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    if (file.size > MAX_FILE_SIZE) {
      showError(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Limite: 50MB`);
      return;
    }
    if (!ALLOWED_MEDIA.test(file.type) && !ALLOWED_DOC_TYPES.some(t => file.type.startsWith(t))) {
      showError('Tipo de arquivo não permitido');
      return;
    }
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('conversationId', selectedId);
      const res = await api.post('/messages/send-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.id) {
        setMessages(prev => {
          if (prev.find(m => m.id === res.data.id)) return prev;
          return [...prev, res.data];
        });
      }
    } catch (e) {
      console.error('Falha ao enviar arquivo', e);
      showError('Falha ao enviar arquivo');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await uploadFile(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isRealConvo || isClosed) return;
    dragCounterRef.current++;
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (!isRealConvo || isClosed) return;
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  };

  const handleEmojiSelect = (emoji: string) => {
    if (!inputRef.current) { setText(t => t + emoji); return; }
    const input = inputRef.current;
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const handleSophIAResult = (result: string) => {
    setText(result);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Clicar na área de mensagens foca o textarea
  const handleChatAreaClick = useCallback((e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO'].includes(tag)) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea')) return;
    inputRef.current?.focus();
  }, []);

  const handleDeleteMessage = async (msgId: string) => {
    if (!confirm('Apagar esta mensagem para todos?')) return;
    try {
      const res = await api.delete(`/messages/${msgId}`);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...res.data } : m));
    } catch (e) {
      console.error('Erro ao apagar mensagem', e);
    }
  };

  const myActiveConvs = (c: ConversationSummary) =>
    (c.status === 'ACTIVE' || c.status === 'MONITORING') && c.assignedAgentId === currentUserId;

  const filteredConversations = useMemo(() => {
    if (leadFilter === 'ADIADO') {
      return adiadoConversations
        .filter(c => normalizeStage(c.leadStage) !== 'PERDIDO')
        .sort((a, b) => {
          const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return tb - ta;
        });
    }
    let result: ConversationSummary[];
    if (leadFilter === 'MINE') {
      // Minhas conversas: todas atribuídas ao usuário atual (qualquer status exceto CLOSED)
      result = conversations.filter(c => c.assignedAgentId === currentUserId && c.status !== 'CLOSED');
    } else if (leadFilter === 'ACTIVE') {
      result = conversations.filter(myActiveConvs);
    } else if (leadFilter === 'BOT') {
      result = conversations.filter(c => c.aiMode && c.assignedAgentId === currentUserId);
    } else if (leadFilter) {
      result = conversations.filter(c => c.status === leadFilter);
    } else {
      result = conversations;
    }
    result = result.filter(c => normalizeStage(c.leadStage) !== 'PERDIDO');
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase().trim();
      result = result.filter(c =>
        c.contactName?.toLowerCase().includes(q) ||
        c.contactPhone?.toLowerCase().includes(q) ||
        c.lastMessage?.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return tb - ta;
    });
  }, [conversations, adiadoConversations, leadFilter, debouncedSearch, currentUserId]);

  // Keep ref in sync for keyboard shortcut handler (declared before useMemo)
  const filteredConversationsRef = useRef(filteredConversations);
  useEffect(() => { filteredConversationsRef.current = filteredConversations; }, [filteredConversations]);

  const selected = conversations.find((c) => c.id === selectedId) ?? adiadoConversations.find((c) => c.id === selectedId);
  const isDemo = selectedId?.startsWith('demo-');
  const isRealConvo = selectedId && !isDemo;
  const isClosed = selected?.status === 'CLOSED';

  // Mensagens filtradas pela busca dentro da conversa
  const displayMessages = useMemo(() => {
    if (!msgSearchOpen || !msgSearchQuery.trim()) return messages;
    const q = msgSearchQuery.toLowerCase().trim();
    return messages.filter(m => m.text?.toLowerCase().includes(q));
  }, [messages, msgSearchOpen, msgSearchQuery]);

  const handleImageDownload = async (src: string) => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const ext = (blob.type.split('/')[1] || 'jpg').split(';')[0];
      const filename = `imagem.${ext}`;
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Imagem', accept: { [blob.type]: [`.${ext}`] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error('Erro ao baixar imagem', e);
    }
  };

  const getDocLabel = (mime: string, name?: string) => {
    if (name) { const p = name.split('.'); if (p.length > 1) return p.pop()!.toUpperCase(); }
    const map: Record<string, string> = {
      'application/pdf': 'PDF',
      'application/msword': 'DOC',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
      'application/vnd.ms-excel': 'XLS',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    };
    return map[mime] || 'FILE';
  };

  const handleDocDownload = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({ suggestedName: name });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error('Erro ao baixar documento', e);
    }
  };


  const handleTranscribe = async (msgId: string) => {
    setTranscribing(prev => ({ ...prev, [msgId]: true }));
    try {
      const res = await api.post(`/messages/${msgId}/transcribe`);
      setMessages(prev => prev.map((m: any) => m.id === msgId ? { ...m, text: res.data.transcription } : m));
    } catch (e) {
      console.error('Erro ao transcrever áudio', e);
      showError('Falha ao transcrever áudio');
    } finally {
      setTranscribing(prev => ({ ...prev, [msgId]: false }));
    }
  };

  const handleEditMessage = async (msgId: string, newText: string) => {
    if (!newText.trim()) return;
    try {
      const res = await api.patch(`/messages/${msgId}`, { text: newText.trim() });
      setMessages(prev => prev.map((m: any) => m.id === msgId ? { ...m, ...res.data } : m));
      setEditingMsg(null);
    } catch (e) { console.error('Erro ao editar mensagem', e); showError('Falha ao editar mensagem'); }
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name?: string) => (name || 'V')[0].toUpperCase();

  return (
    <div className="flex h-full overflow-hidden bg-background font-sans antialiased text-foreground">

      {/* INBOX */}
      <InboxSidebar
        conversations={conversations}
        adiadoConversations={adiadoConversations}
        filteredConversations={filteredConversations}
        userInboxes={userInboxes}
        pendingTransfers={pendingTransfers}
        unreadCounts={unreadCounts}
        currentUserId={currentUserId}
        selectedId={selectedId}
        selectedInboxId={selectedInboxId}
        searchQuery={searchQuery}
        leadFilter={leadFilter}
        inboxOpen={inboxOpen}
        loading={loading}
        isMobile={isMobile}
        showNotifBanner={showNotifBanner}
        onSelectConversation={setSelectedId}
        onSetSearchQuery={setSearchQuery}
        onSetLeadFilter={setLeadFilter}
        clientMode={clientMode}
        onSetClientMode={(mode) => { setClientMode(mode); }}
        onSetSelectedInboxId={setSelectedInboxId}
        onSetInboxOpen={setInboxOpen}
        onSetShowNotifBanner={setShowNotifBanner}
        onSetUnreadCounts={setUnreadCounts}
        onQuickAcceptTransfer={handleQuickAcceptTransfer}
        onShowTransferPopup={(pt) => { setIncomingTransfer(pt); setShowDeclineInput(false); setDeclineReason(''); }}
        onLightbox={setLightbox}
        hasDisconnectedInstance={Object.values(instanceStatuses).some(s => s === 'close')}
        selectedBulk={selectedBulk}
        onToggleBulk={toggleBulk}
        onClearBulk={() => setSelectedBulk(new Set())}
        onBulkAction={handleBulkAction}
      />

      {/* INBOX OPEN BUTTON (when collapsed) - desktop only */}
      {!inboxOpen && !isMobile && (
        <button
          onClick={() => setInboxOpen(true)}
          className="shrink-0 w-10 flex flex-col items-center justify-start gap-2 pt-4 bg-card border-r border-border z-40 hover:bg-accent/50 transition-all"
          title="Abrir painel de inbox"
          aria-label="Abrir painel de inbox"
        >
          <PanelLeftOpen size={18} className="text-muted-foreground" />
        </button>
      )}

      {/* MAIN CHAT PANEL */}
      <main
        className={`flex-1 flex flex-col bg-background relative ${isMobile && !selectedId ? 'hidden' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && isRealConvo && !isClosed && (
          <div className="absolute inset-0 z-40 m-3 rounded-2xl border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <Paperclip size={48} className="text-primary mx-auto mb-3 opacity-80" />
              <p className="text-primary font-bold text-lg">Solte o arquivo aqui</p>
              <p className="text-primary/60 text-sm mt-1">imagem, vídeo ou documento</p>
            </div>
          </div>
        )}
        {selected ? (
          <>
            {/* Banner de reconexao WebSocket */}
            {(!isOnline || !socketConnected) && (
              <div className={`text-white text-center text-sm py-1.5 px-4 flex items-center justify-center gap-2 z-50 shrink-0 ${
                !isOnline ? 'bg-red-500' : 'bg-yellow-500'
              }`}>
                <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
                {!isOnline
                  ? 'Sem conexao com a internet'
                  : 'Conexao perdida. Reconectando...'}
              </div>
            )}
            <ChatHeader
              selected={selected}
              selectedId={selectedId!}
              isMobile={isMobile}
              isRealConvo={!!isRealConvo}
              isClosed={!!isClosed}
              aiMode={aiMode}
              leadStage={leadStage}
              fichaFinalizada={fichaFinalizada}
              allSpecialists={allSpecialists}
              currentUserId={currentUserId}
              showLegalAreaDropdown={showLegalAreaDropdown}
              showLawyerDropdown={showLawyerDropdown}
              showStageDropdown={showStageDropdown}
              legalAreaDropdownRef={legalAreaDropdownRef}
              lawyerDropdownRef={lawyerDropdownRef}
              stageDropdownRef={stageDropdownRef}
              onBack={() => { setSelectedId(null); setMobileMoreOpen(false); }}
              onToggleLegalArea={() => setShowLegalAreaDropdown(v => !v)}
              onChangeLegalArea={handleChangeLegalArea}
              onToggleLawyer={() => setShowLawyerDropdown(v => !v)}
              onAssignLawyer={handleAssignLawyerInbox}
              onToggleAiMode={handleToggleAiMode}
              onAccept={handleAccept}
              onOpenTransferModal={handleOpenTransferModal}
              onOpenReasonPopup={openReasonPopup}
              onKeepInInbox={handleKeepInInbox}
              onToggleStage={() => setShowStageDropdown(v => !v)}
              onChangeStage={handleChangeLeadStage}
              onSendFormLink={handleSendFormLink}
              onShowFicha={() => setFichaInboxVisible(true)}
              onShowDetails={() => setShowDetailsPanel(true)}
              onSetClientPanelLeadId={setClientPanelLeadId}
              onLightbox={setLightbox}
              onCreateTask={openTaskModal}
              contactPresence={contactPresence}
              activeTask={selected?.activeTask}
              onCompleteTask={handleCompleteTask}
              onRescheduleTask={handleRescheduleTask}
              onNewTask={openTaskModal}
              leadTags={selected?.leadTags ?? []}
              onUpdateTags={async (tags) => {
                if (!selected) return;
                try {
                  await api.patch(`/leads/${selected.leadId}`, { tags });
                  setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, leadTags: tags } : c));
                } catch { /* silencioso */ }
              }}
            />

            {/* Banner de contexto da transferência (motivo + áudios — persiste após aceitar) */}
            {selectedId && transferContextMap[selectedId] && (() => {
              const ctx = transferContextMap[selectedId];
              return (
                <div className="border-b border-amber-500/20 bg-amber-500/5 px-5 py-3 shrink-0">
                  <div className="flex items-start gap-3 max-w-4xl mx-auto">
                    <span className="text-amber-400 text-base shrink-0 mt-0.5">📋</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-amber-400 mb-1">
                        Contexto da transferência — de {ctx.fromUserName}
                      </p>
                      {ctx.reason && (
                        <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
                          {ctx.reason}
                        </p>
                      )}
                      {ctx.audioIds.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {ctx.audioIds.map((aid, i) => (
                            <div key={aid} className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground shrink-0">#{i + 1}</span>
                              <AuthAudioPlayer audioId={aid} className="h-7 flex-1" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setTransferContextMap(prev => {
                        const next = { ...prev };
                        delete next[selectedId];
                        return next;
                      })}
                      className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                      title="Dispensar"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Barra de busca dentro da conversa */}
            {msgSearchOpen && (
              <div className="px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm shrink-0 flex items-center gap-2">
                <Search size={14} className="text-muted-foreground shrink-0" />
                <input
                  ref={msgSearchInputRef}
                  type="text"
                  value={msgSearchQuery}
                  onChange={e => setMsgSearchQuery(e.target.value)}
                  placeholder="Buscar nas mensagens..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  onKeyDown={e => { if (e.key === 'Escape') { setMsgSearchOpen(false); setMsgSearchQuery(''); } }}
                />
                {msgSearchQuery && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {displayMessages.length} resultado{displayMessages.length !== 1 ? 's' : ''}
                  </span>
                )}
                <button
                  onClick={() => { setMsgSearchOpen(false); setMsgSearchQuery(''); }}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Fechar busca"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Typing indicator */}
            {Object.keys(typingUsers).length > 0 && (
              <div className="px-4 py-1 text-xs text-muted-foreground bg-muted/30 border-b border-border animate-pulse">
                {(() => {
                  const names = Object.values(typingUsers).map(u => u.userName);
                  if (names.length === 1) return `${names[0]} está digitando...`;
                  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando...`;
                  return `${names[0]} e outros estão digitando...`;
                })()}
              </div>
            )}

            {/* Wrapper: watermark fixo + scroll area sobre ele */}
            <div
              className="flex-1 relative overflow-hidden"
              onTouchStart={(e) => {
                touchStartXRef.current = e.touches[0].clientX;
                touchStartYRef.current = e.touches[0].clientY;
              }}
              onTouchEnd={(e) => {
                const diffX = touchStartXRef.current - e.changedTouches[0].clientX;
                const diffY = Math.abs(touchStartYRef.current - e.changedTouches[0].clientY);
                if (diffY < 60 && diffX > 60) setShowDetailsPanel(true);
                else if (diffY < 60 && diffX < -60) setShowDetailsPanel(false);
              }}
            >
              <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center z-0">
                <Image src="/landing/LOGO SEM FUNDO 01.png" alt="" width={883} height={453}
                  style={{ width: '620px', height: 'auto', opacity: 0.13 }} aria-hidden />
              </div>
              {/* Botão scroll-to-bottom: aparece quando há novas mensagens e usuário está acima */}
              {newMsgsWhileScrolled > 0 && (
                <button
                  onClick={() => {
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                    setNewMsgsWhileScrolled(0);
                  }}
                  className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg text-xs font-bold hover:bg-primary/90 transition-all animate-bounce-subtle"
                >
                  ↓ {newMsgsWhileScrolled} nova{newMsgsWhileScrolled > 1 ? 's' : ''} mensagem{newMsgsWhileScrolled > 1 ? 's' : ''}
                </button>
              )}
            <div className="absolute inset-0 px-1 sm:px-6 md:px-8 py-3 sm:py-5 md:py-8 overflow-y-auto custom-scrollbar" ref={scrollRef} onClick={handleChatAreaClick}>
              <div className="flex flex-col gap-3 md:gap-4 max-w-4xl mx-auto pb-4 relative z-10">
                {/* Skeleton de carregamento de mensagens */}
                {loadingMessages && (
                  <div className="flex flex-col gap-4 py-8">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                        <div className={`animate-pulse bg-muted rounded-2xl ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} style={{ height: `${32 + (i % 3) * 16}px` }} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Sentinel para infinite scroll (auto-load mensagens anteriores) */}
                {isRealConvo && msgTotalPages > 1 && msgCurrentPage < msgTotalPages && (
                  <div ref={loadMoreSentinelRef} className="flex justify-center py-3">
                    {loadingMoreMsgs && (
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                )}
                {isRealConvo && displayMessages.length > 0 ? (
                  (() => {
                    let lastMsgDateKey = '';
                    // Fase atual da conversa — exibida no badge de IA
                    const convNextStep = conversations.find(c => c.id === selectedId)?.nextStep || null;
                    // Dedup: remove mensagens com mesmo id (safety net contra race conditions)
                    const seen = new Set<string>();
                    const uniqueMessages = displayMessages.filter(m => {
                      if (seen.has(m.id)) return false;
                      seen.add(m.id);
                      return true;
                    });
                    return uniqueMessages.map((msg, msgIdx) => {
                      const isOut = msg.direction === 'out';
                      const msgDateKey = msg.created_at ? getDateKey(msg.created_at) : `__nodate__${msgIdx}`;
                      const showMsgDateSep = msgDateKey !== lastMsgDateKey;
                      if (showMsgDateSep) lastMsgDateKey = msgDateKey;
                      return (
                        <Fragment key={msg.id || msgIdx}>
                          {showMsgDateSep && (
                            <div className="flex items-center gap-3 my-3 select-none">
                              <div className="flex-1 h-px bg-muted-foreground/30" />
                              <span className="text-[11px] font-bold text-foreground/70 px-3 py-1 rounded-full border border-muted-foreground/20 bg-muted capitalize whitespace-nowrap">
                                {msg.created_at ? formatDateLabel(msg.created_at) : '(sem data)'}
                              </span>
                              <div className="flex-1 h-px bg-muted-foreground/30" />
                            </div>
                          )}
                      <MessageBubble
                        msg={msg}
                        isOut={isOut}
                        editingMsg={editingMsg}
                        transcribing={transcribing}
                        onReply={(m) => { setReplyingTo(m); inputRef.current?.focus(); }}
                        onEdit={handleEditMessage}
                        onSetEditing={setEditingMsg}
                        onDelete={handleDeleteMessage}
                        onTranscribe={handleTranscribe}
                        onLightbox={setLightbox}
                        onDocPreview={setDocPreview}
                        onImageDownload={handleImageDownload}
                        onDocDownload={handleDocDownload}
                        onForward={(m) => { if (m.text) { setForwardMsg({ id: m.id, text: m.text }); setForwardSearch(''); } }}
                        nextStep={convNextStep}
                      />
                        </Fragment>
                      );
                    });
                  })()
                ) : isRealConvo && displayMessages.length === 0 && msgSearchOpen && msgSearchQuery ? (
                  <div className="text-center text-muted-foreground py-20">Nenhum resultado para &ldquo;{msgSearchQuery}&rdquo;</div>
                ) : isRealConvo && messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-20">Nenhuma mensagem nesta conversa.</div>
                ) : (
                  <>
                    <div className="w-full flex justify-end">
                      <div className="max-w-[92%] md:max-w-[80%] bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground p-4 rounded-2xl rounded-tr-sm shadow-sm relative">
                        <p className="text-[15px] leading-relaxed">Trabalhei 3 anos e 4 meses. Não recebi nada ainda.</p>
                        <span className="text-[10px] text-primary-foreground/70 absolute bottom-1.5 right-3">14:00</span>
                      </div>
                    </div>
                    <div className="w-full flex justify-start">
                      <div className="max-w-[92%] md:max-w-[80%] bg-card border border-border p-4 rounded-2xl rounded-tl-sm shadow-sm mt-4">
                        <div className="flex items-center gap-2 mb-2 opacity-80">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">André Lustosa</span>
                        </div>
                        <p className="text-[15px] leading-relaxed font-normal">Certo. Com esse tempo você tem direitos significativos. Vamos agendar uma consulta para analisar toda a documentação?</p>
                        <span className="text-[10px] opacity-60 mt-1 block">14:01</span>
                      </div>
                    </div>
                    <div className="w-full flex justify-end">
                      <div className="max-w-[92%] md:max-w-[80%] bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground p-4 rounded-2xl rounded-tr-sm shadow-sm mt-4">
                        <p className="text-[15px] leading-relaxed font-medium">{selected.lastMessage}</p>
                        <span className="text-[10px] text-primary-foreground/60 mt-1 flex justify-end">14:02</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            </div>{/* end watermark wrapper */}

            {/* ═══ BOTTOM ACTION BAR — mobile only, conversa aberta ═══ */}
            {isMobile && selectedId && selected && isRealConvo && (
              <div className="shrink-0 bg-card/95 backdrop-blur-md border-t border-border flex items-center justify-around px-2 py-1.5">

                {/* IA */}
                <button
                  onClick={handleToggleAiMode}
                  className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg active:bg-accent transition-colors min-w-[56px]"
                >
                  {aiMode
                    ? <Bot size={20} className="text-emerald-400" />
                    : <BotOff size={20} className="text-muted-foreground" />
                  }
                  <span className={`text-[10px] font-medium ${aiMode ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                    {aiMode ? 'IA On' : 'IA Off'}
                  </span>
                </button>

                {/* Ficha — só trabalhista */}
                {selected.legalArea?.toLowerCase().includes('trabalhist') && (
                  <button
                    onClick={() => setFichaInboxVisible(true)}
                    className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg active:bg-accent transition-colors min-w-[56px]"
                  >
                    <ClipboardList size={20} className="text-violet-400" />
                    <span className="text-[10px] font-medium text-violet-400">Ficha</span>
                  </button>
                )}

                {/* Aceitar — só WAITING */}
                {selected.status === 'WAITING' && (
                  <button
                    onClick={handleAccept}
                    className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg active:bg-accent transition-colors min-w-[56px]"
                  >
                    <Check size={20} className="text-primary" />
                    <span className="text-[10px] font-medium text-primary">Aceitar</span>
                  </button>
                )}

                {/* Transferir — não fechada */}
                {!isClosed && (
                  <button
                    onClick={handleOpenTransferModal}
                    className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg active:bg-accent transition-colors min-w-[56px]"
                  >
                    <UserCheck size={20} className="text-sky-400" />
                    <span className="text-[10px] font-medium text-sky-400">Transferir</span>
                  </button>
                )}

                {/* Mais — abre painel de detalhes & ações */}
                <button
                  onClick={() => setShowDetailsPanel(true)}
                  className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg active:bg-accent transition-colors min-w-[56px]"
                >
                  <MoreVertical size={20} className="text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground">Mais</span>
                </button>

              </div>
            )}

            {/* ═══ DETAILS PANEL — deslize ← (mobile) ou clique no nome (desktop) ═══ */}
            {selectedId && selected && (
              <div
                className={`absolute inset-0 z-50 bg-background flex flex-col transition-transform duration-300 ease-in-out ${
                  showDetailsPanel ? 'translate-x-0' : 'translate-x-full'
                }`}
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border shrink-0">
                  <button
                    onClick={() => setShowDetailsPanel(false)}
                    className="p-2 rounded-xl hover:bg-accent text-muted-foreground active:bg-accent"
                    aria-label="Fechar painel de detalhes"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-sm truncate">{selected.contactName}</p>
                    <p className="text-[10px] text-muted-foreground">Detalhes &amp; Ações</p>
                  </div>
                  {/* Badge da etapa CRM — clicável para rolar até a seleção */}
                  {(() => {
                    const stage = findStage(normalizeStage(leadStage));
                    return stage ? (
                      <button
                        onClick={() => document.getElementById('panel-stage-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition-all hover:opacity-80 active:scale-95"
                        style={{ background: `${stage.color}20`, color: stage.color, borderColor: `${stage.color}40` }}
                        title="Clique para alterar a etapa"
                      >
                        <span>{stage.emoji}</span>
                        <span className="hidden sm:inline">{stage.label}</span>
                        <ChevronDown size={11} className="opacity-70" />
                      </button>
                    ) : null;
                  })()}
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">

                  {/* Contato */}
                  <section>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Contato</p>
                    <div className="bg-card border border-border rounded-xl p-3 space-y-2.5">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Telefone</span>
                        <span className="font-medium">{selected.contactPhone}</span>
                      </div>
                      {/* Área — sempre visível, editável via dropdown */}
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Área</span>
                        <div className="relative">
                          <button
                            onClick={() => setShowLegalAreaDropdown(v => !v)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors hover:opacity-80 active:scale-95 ${selected.legalArea ? 'bg-violet-500/15 text-violet-400 border-violet-500/20' : 'bg-muted/40 text-muted-foreground border-border'}`}
                          >
                            ⚖️ {selected.legalArea || 'Definir área'}
                            <ChevronDown size={10} className="opacity-70" />
                          </button>
                          {showLegalAreaDropdown && (
                            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl w-44 py-1 text-[12px] z-[100]">
                              <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Área de Atendimento</p>
                              {LEGAL_AREAS.map(area => (
                                <button
                                  key={area}
                                  onClick={() => handleChangeLegalArea(area)}
                                  className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 ${selected.legalArea === area ? 'text-violet-400 font-semibold' : 'text-foreground'}`}
                                >
                                  ⚖️ {area}
                                </button>
                              ))}
                              {selected.legalArea && (
                                <button
                                  onClick={() => handleChangeLegalArea(null)}
                                  className="w-full text-left px-3 py-2 text-muted-foreground hover:bg-accent hover:text-destructive transition-colors text-[11px] border-t border-border mt-1"
                                >
                                  Remover área
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {selected.assignedAgentName && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Atendente</span>
                          <span className="font-medium">{selected.assignedAgentName}</span>
                        </div>
                      )}
                      {selected.legalArea && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Especialista</span>
                          <div className="relative" ref={lawyerDropdownRef}>
                            <button
                              onClick={() => setShowLawyerDropdown(v => !v)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors hover:opacity-80 active:scale-95 ${selected.assignedLawyerName ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/40 text-muted-foreground border-border'}`}
                            >
                              <UserCheck size={10} />
                              {selected.assignedLawyerName || 'Atribuir especialista'}
                              <ChevronDown size={10} className="opacity-70" />
                            </button>
                            {showLawyerDropdown && (
                              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl w-56 py-1 text-[12px] z-[100]">
                                <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                  {selected.assignedLawyerName ? 'Trocar especialista' : 'Escolher especialista'}
                                </p>
                                {allSpecialists.length === 0 && (
                                  <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhum especialista cadastrado</p>
                                )}
                                {allSpecialists.map(u => (
                                  <button
                                    key={u.id}
                                    onClick={() => handleAssignLawyerInbox(u.id)}
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
                                    onClick={() => handleAssignLawyerInbox(null)}
                                    className="w-full text-left px-3 py-2 text-muted-foreground hover:bg-accent hover:text-destructive transition-colors text-[11px] border-t border-border mt-1"
                                  >
                                    Remover especialista
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* IA Toggle */}
                  {isRealConvo && (
                    <section>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Assistente IA</p>
                      <button
                        onClick={handleToggleAiMode}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
                          aiMode ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-card border-border'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {aiMode
                            ? <Bot size={20} className="text-emerald-400" />
                            : <BotOff size={20} className="text-muted-foreground" />
                          }
                          <div className="text-left">
                            <p className="text-sm font-semibold">{aiMode ? 'IA Ativada' : 'IA Desativada'}</p>
                            <p className="text-[10px] text-muted-foreground">Toque para alternar</p>
                          </div>
                        </div>
                        {/* Toggle switch */}
                        <div className={`w-11 h-6 rounded-full flex items-center px-0.5 transition-colors ${aiMode ? 'bg-emerald-500' : 'bg-muted'}`}>
                          <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${aiMode ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                      </button>
                    </section>
                  )}

                  {/* Etapa do Funil */}
                  <section id="panel-stage-section">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Etapa do Funil</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CRM_STAGES.map(s => (
                        <button
                          key={s.id}
                          onClick={() => handleChangeLeadStage(s.id)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-95 ${
                            normalizeStage(leadStage) === s.id ? 'ring-2 ring-offset-1 ring-offset-background' : 'opacity-60'
                          }`}
                          style={{ background: `${s.color}18`, color: s.color, borderColor: `${s.color}35` }}
                        >
                          {s.emoji} {s.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Ficha Trabalhista */}
                  {selected?.legalArea?.toLowerCase().includes('trabalhist') && (
                    <section>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                        Ficha Trabalhista
                        {fichaFinalizada && (
                          <span className="ml-2 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px]">✅ Finalizada</span>
                        )}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setFichaInboxVisible(true)}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 text-sm font-semibold active:bg-violet-500/20 transition-colors"
                        >
                          <Eye size={17} />
                          Ver Ficha
                        </button>
                        {!isClosed && (
                          <button
                            onClick={handleSendFormLink}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-semibold active:bg-amber-500/20 transition-colors"
                          >
                            <ClipboardList size={17} />
                            Enviar Form.
                          </button>
                        )}
                        {!isClosed && (
                          <button
                            onClick={() => setShowContratoModal(true)}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-semibold active:bg-emerald-500/20 transition-colors"
                            title="Gerar e enviar contrato trabalhista via WhatsApp (/contrato_trabalhista)"
                          >
                            <FileText size={17} />
                            Contrato
                          </button>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Aceitar */}
                  {selected.status === 'WAITING' && isRealConvo && (
                    <button
                      onClick={handleAccept}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-primary to-ring text-primary-foreground font-bold text-sm shadow-lg active:scale-95 transition-transform"
                    >
                      <Check size={18} />
                      Aceitar Conversa
                    </button>
                  )}

                  {/* Ações da conversa */}
                  <section>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Ações</p>
                    <div className="flex flex-col gap-2">
                      {!isClosed && (
                        <button
                          onClick={() => { handleOpenTransferModal(); setShowDetailsPanel(false); }}
                          className="flex items-center gap-3 p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 text-sm font-semibold active:bg-sky-500/20 transition-colors"
                        >
                          <UserCheck size={18} />
                          Transferir Conversa
                        </button>
                      )}
                      {selected?.originAssignedUserId && selected?.assignedAgentId === currentUserId && !isClosed && (
                        <>
                          <button
                            onClick={() => { openReasonPopup('return', selected?.originAssignedUserName || 'atendente de origem'); setShowDetailsPanel(false); }}
                            className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-semibold active:bg-amber-500/20 transition-colors"
                          >
                            <CornerDownLeft size={18} />
                            Devolver ao SDR
                          </button>
                          <button
                            onClick={() => { handleKeepInInbox(); setShowDetailsPanel(false); }}
                            className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-semibold active:bg-emerald-500/20 transition-colors"
                          >
                            <Inbox size={18} />
                            Manter Aqui
                          </button>
                        </>
                      )}
                      {!isClosed && (
                        <button
                          onClick={() => { handleClose(); setShowDetailsPanel(false); }}
                          className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold active:bg-red-500/20 transition-colors"
                        >
                          <XCircle size={18} />
                          Fechar Conversa
                        </button>
                      )}
                    </div>
                  </section>

                </div>
              </div>
            )}

            <footer className="px-3 md:px-6 pt-2 pb-3 md:pt-3 md:pb-6 bg-background shrink-0">
              {/* Reply bar */}
              {replyingTo && !isClosed && (
                <div className="max-w-4xl mx-auto mb-2 flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-xl">
                  <Reply size={13} className="text-primary shrink-0" />
                  <p className="text-xs text-muted-foreground line-clamp-1 flex-1">{replyingTo.text || '[mídia]'}</p>
                  <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Cancelar resposta">
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* ── Barra de resposta rápida por estágio do lead ──────── */}
              {!isClosed && selectedId && selected?.leadStage && (() => {
                const stage = normalizeStage(selected.leadStage);
                const tpl = STAGE_TEMPLATES[stage];
                if (!tpl || dismissedQuickReply.has(selectedId) || text.length > 0) return null;
                return (
                  <div className="max-w-4xl mx-auto mb-2 flex items-center gap-2 px-3 py-2 bg-accent/40 border border-border/60 rounded-xl">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">Sugestão</span>
                    <button
                      onClick={() => {
                        setText(tpl.text);
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      className="flex-1 text-left text-[12px] text-foreground hover:text-primary transition-colors truncate"
                      title={tpl.text}
                    >
                      💬 {tpl.label} — <span className="text-muted-foreground">{tpl.text.slice(0, 60)}…</span>
                    </button>
                    <button
                      onClick={() => setDismissedQuickReply(prev => new Set([...prev, selectedId]))}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                      title="Dispensar sugestão"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })()}

              {isClosed ? (
                <div className="max-w-4xl mx-auto text-center text-sm text-muted-foreground py-3 border border-border rounded-xl bg-card/50">
                  Conversa encerrada. Não é possível enviar mensagens.
                </div>
              ) : (
                <div className="max-w-4xl mx-auto flex gap-2 md:gap-3 items-end">

                  {/* Desktop: clip button inline */}
                  {!isMobile && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!isRealConvo || uploadingFile}
                      title="Enviar arquivo"
                      aria-label="Anexar arquivo"
                      className="p-2.5 md:p-3 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 shrink-0 mb-0.5"
                    >
                      {uploadingFile
                        ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <Paperclip size={20} />}
                    </button>
                  )}
                  {/* Botão nota interna */}
                  {!isMobile && isRealConvo && (
                    <button
                      onClick={() => setInternalNoteMode(prev => !prev)}
                      title={internalNoteMode ? 'Modo nota interna ativo (clique para desativar)' : 'Nota interna — só visível para a equipe'}
                      className={`p-2.5 md:p-3 rounded-xl border transition-colors shrink-0 mb-0.5 ${internalNoteMode ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-card border-border text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/10'}`}
                    >
                      🔒
                    </button>
                  )}
                  {/* Desktop: botão busca dentro da conversa */}
                  {!isMobile && isRealConvo && (
                    <button
                      onClick={() => setMsgSearchOpen(v => !v)}
                      title="Buscar nas mensagens (Ctrl+F)"
                      className={`p-2.5 md:p-3 rounded-xl border transition-colors shrink-0 mb-0.5 ${msgSearchOpen ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    >
                      <Search size={20} />
                    </button>
                  )}
                  {/* Desktop: botão adiar atendimento com quick snooze dropdown */}
                  {!isMobile && selected?.leadId && (
                    <div className="relative shrink-0 mb-0.5" ref={quickSnoozeRef}>
                      <button
                        onClick={() => setQuickSnoozeOpen(v => !v)}
                        title="Adiar atendimento — clique para presets rápidos"
                        className={`p-2.5 md:p-3 rounded-xl border transition-colors ${quickSnoozeOpen ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-card border-border text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/10'}`}
                      >
                        <Clock size={20} />
                      </button>
                      {quickSnoozeOpen && (
                        <div className="absolute bottom-full mb-2 left-0 bg-card border border-border rounded-xl shadow-2xl w-48 py-1 z-50 text-sm">
                          <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Adiar por</p>
                          {[
                            { label: '1 hora', getDate: () => { const d = new Date(); d.setHours(d.getHours() + 1); return d.toISOString(); } },
                            { label: '3 horas', getDate: () => { const d = new Date(); d.setHours(d.getHours() + 3); return d.toISOString(); } },
                            { label: 'Amanhã 9h', getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); } },
                            { label: 'Próxima semana', getDate: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d.toISOString(); } },
                          ].map(p => (
                            <button
                              key={p.label}
                              onClick={() => handleQuickSnooze(`Retornar — ${p.label}`, p.getDate())}
                              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors text-foreground flex items-center gap-2"
                            >
                              ⏰ {p.label}
                            </button>
                          ))}
                          <div className="border-t border-border mt-1 pt-1">
                            <button
                              onClick={() => { setQuickSnoozeOpen(false); openTaskModal(); }}
                              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors text-muted-foreground text-[12px] flex items-center gap-2"
                            >
                              📅 Personalizado...
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                    className="hidden"
                    onChange={handleFileSelect}
                  />

                  {/* ── Textarea + ícones internos ──────────────────── */}
                  <div className="relative flex-1">

                    {/* Slash command picker — renderizado via portal (evita clipping por overflow-hidden) */}

                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={text}
                      onChange={(e) => {
                        const val = e.target.value;
                        setText(val);
                        setSlashMenuIndex(0); // reset seleção ao digitar
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;

                        // ── Auto-disable AI upon typing ──
                        if (aiMode && val.trim().length > 0 && selectedId) {
                          setAiMode(false); // Optimistic UI previne chamadas duplicadas
                          (async () => {
                            try {
                              await api.patch(`/conversations/${selectedId}/ai-mode`, { ai_mode: false });
                              setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, aiMode: false } : c));
                              setAdiadoConversations(prev => prev.map(c => c.id === selectedId ? { ...c, aiMode: false } : c));
                              showSuccess('👤 IA pausada automaticamente pela digitação.');
                            } catch (error) {
                              setAiMode(true); // Rollback
                              console.error('Failed to auto-disable AI:', error);
                            }
                          })();
                        }

                        // Emit typing indicator (debounced 2s)
                        if (selectedId && socketRef.current) {
                          socketRef.current.emit('typing', { conversationId: selectedId, isTyping: true });
                          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                          typingTimeoutRef.current = setTimeout(() => {
                            socketRef.current?.emit('typing', { conversationId: selectedId, isTyping: false });
                          }, 2000);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (showSlashMenu) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSlashMenuIndex(i => Math.min(i + 1, filteredSlashCommands.length - 1));
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSlashMenuIndex(i => Math.max(i - 1, 0));
                            return;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setText('');
                            return;
                          }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder={internalNoteMode ? "🔒 Nota interna — visível só para a equipe..." : (isRealConvo ? "Digite sua mensagem..." : "Selecione uma conversa...")}
                      disabled={!isRealConvo || sending}
                      className={`w-full border rounded-2xl py-3 md:py-4 focus:outline-none focus:ring-2 shadow-sm disabled:opacity-50 text-sm md:text-base resize-none leading-normal overflow-hidden pl-4 ${
                        isRealConvo ? (isMobile ? 'pr-[7rem]' : 'pr-24') : 'pr-4'
                      } ${internalNoteMode
                        ? 'bg-amber-500/10 border-amber-500/40 focus:ring-amber-500/30 text-amber-100 placeholder:text-amber-400/60'
                        : 'bg-card border-border focus:ring-primary text-foreground'
                      }`}
                    />
                    {/* Contador de caracteres */}
                    {text.length > 4500 && (
                      <div className={`absolute -top-5 right-2 text-[10px] font-medium ${text.length > 5000 ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {text.length}/5000
                      </div>
                    )}
                    {/* Ícones internos (direita) */}
                    {isRealConvo && (
                      <div className="absolute bottom-2 right-2 flex items-center gap-0.5">
                        {/* Clip — mobile */}
                        {isMobile && (
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingFile}
                            title="Arquivo"
                            aria-label="Anexar arquivo"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          >
                            {uploadingFile
                              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              : <Paperclip size={17} />}
                          </button>
                        )}
                        {/* Emoji */}
                        <EmojiPickerButton onEmojiSelect={handleEmojiSelect} compact />
                        {/* SophIA correção */}
                        <SophIAButton text={text} onResult={handleSophIAResult} compact />
                        {/* Áudio — quando não há texto */}
                        {!text.trim() && (
                          <AudioRecorder
                            conversationId={selectedId!}
                            disabled={!isRealConvo}
                            onSent={(msg) => {
                              setMessages((prev) => {
                                if (prev.find((m) => m.id === msg.id)) return prev;
                                return [...prev, msg];
                              });
                            }}
                          />
                        )}
                      </div>
                    )}
                    {/* Desktop: emoji + SophIA (se não estão no ícones internos) */}
                    {!isMobile && isRealConvo && false && (
                      <div className="absolute bottom-3 md:bottom-4 right-3 flex items-center gap-1">
                        <EmojiPickerButton onEmojiSelect={handleEmojiSelect} compact />
                        <SophIAButton text={text} onResult={handleSophIAResult} compact />
                      </div>
                    )}
                  </div>

                  {/* Desktop: audio recorder inline */}
                  {!isMobile && isRealConvo && !text.trim() && false && (
                    <AudioRecorder
                      conversationId={selectedId!}
                      disabled={!isRealConvo}
                      onSent={(msg) => {
                        setMessages((prev) => {
                          if (prev.find((m) => m.id === msg.id)) return prev;
                          return [...prev, msg];
                        });
                      }}
                    />
                  )}

                  {/* Botão Enviar */}
                  <button
                    onClick={handleSend}
                    disabled={!isRealConvo || !text.trim() || sending || text.length > 5000}
                    aria-label="Enviar mensagem"
                    className="bg-gradient-to-r from-primary to-ring p-3 md:p-4 rounded-xl shadow-lg disabled:opacity-50 hover:-translate-y-1 transition-transform shrink-0 mb-0.5"
                  >
                    <Send size={18} className="text-primary-foreground md:w-5 md:h-5" />
                  </button>
                </div>
              )}
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/landing/LOGO SEM FUNDO 01.png"
              alt="André Lustosa Advogados"
              style={{ width: '620px', height: 'auto', opacity: 0.85 }}
              className="select-none pointer-events-none"
              draggable={false}
            />
          </div>
        )}
      </main>

      {/* Painel do Cliente — popup ao clicar no nome no desktop */}
      {clientPanelLeadId && (
        <ClientPanel
          leadId={clientPanelLeadId}
          onClose={() => setClientPanelLeadId(null)}
          onLightbox={setLightbox}
        />
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img
              src={lightbox}
              alt="Imagem"
              className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl"
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <button
                onClick={() => handleImageDownload(lightbox!)}
                className="bg-black/60 hover:bg-black/80 text-white rounded-lg p-2 transition-colors"
                title="Baixar imagem"
                aria-label="Baixar imagem"
              >
                <Download size={16} />
              </button>
              <button
                onClick={() => setLightbox(null)}
                className="bg-black/60 hover:bg-black/80 text-white rounded-lg p-2 transition-colors text-lg leading-none"
                title="Fechar"
                aria-label="Fechar visualizacao"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Preview */}
      {docPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setDocPreview(null)}
        >
          <div
            className="relative w-[92vw] h-[90vh] bg-card rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={18} className="text-primary shrink-0" />
                <span className="text-sm font-semibold truncate">{docPreview.name}</span>
                <span className="text-[11px] text-muted-foreground uppercase font-medium shrink-0">{getDocLabel(docPreview.mime, docPreview.name)}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleDocDownload(docPreview.url, docPreview.name)}
                  className="bg-muted hover:bg-muted/80 text-foreground rounded-lg p-2 transition-colors"
                  title="Baixar"
                  aria-label="Baixar documento"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={() => setDocPreview(null)}
                  className="bg-muted hover:bg-muted/80 text-foreground rounded-lg p-2 transition-colors text-base leading-none"
                  title="Fechar"
                  aria-label="Fechar pre-visualizacao"
                >
                  ✕
                </button>
              </div>
            </div>
            {/* Content */}
            {docPreview.mime.includes('pdf') ? (
              <iframe
                src={docPreview.url}
                className="flex-1 w-full"
                title={docPreview.name}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
                <FileText size={64} className="text-muted-foreground/30" />
                <p className="text-muted-foreground font-medium">Visualização não disponível para este tipo de arquivo.</p>
                <button
                  onClick={() => handleDocDownload(docPreview.url, docPreview.name)}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  <Download size={15} /> Baixar arquivo
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <TransferModals
        transferModal={transferModal}
        onCloseTransferModal={() => setTransferModal(false)}
        transferGroups={transferGroups}
        loadingOperators={loadingOperators}
        transferError={transferError}
        selectedTransferUserId={selectedTransferUserId}
        onSelectTransferUser={setSelectedTransferUserId}
        selected={selected || null}
        onOpenReasonPopup={openReasonPopup}
        showReasonPopup={showReasonPopup}
        reasonPopupContext={reasonPopupContext}
        reasonPopupTargetName={reasonPopupTargetName}
        transferReason={transferReason}
        onSetTransferReason={setTransferReason}
        transferring={transferring}
        onCloseReasonPopup={closeReasonPopup}
        onTransferToLawyer={handleTransferToLawyer}
        onReturnWithReason={handleReturnWithReason}
        onTransfer={handleTransfer}
        onSetTransferAudioIds={setTransferAudioIds}
        selectedConversationId={selectedId}
        incomingTransfer={incomingTransfer}
        onCloseIncomingTransfer={() => setIncomingTransfer(null)}
        showDeclineInput={showDeclineInput}
        onSetShowDeclineInput={setShowDeclineInput}
        declineReason={declineReason}
        onSetDeclineReason={setDeclineReason}
        processingTransfer={processingTransfer}
        onAcceptTransfer={handleAcceptTransfer}
        onDeclineTransfer={handleDeclineTransfer}
        transferSentMsg={transferSentMsg}
        onClearTransferSentMsg={() => setTransferSentMsg(null)}
        transferResponseMsg={transferResponseMsg}
        onClearTransferResponseMsg={() => setTransferResponseMsg(null)}
      />


      {/* Command Palette (Ctrl+K) */}
      {commandPaletteOpen && (
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          conversations={conversations}
          selectedId={selectedId}
          onSelectConversation={(id) => {
            setSelectedId(id);
            setUnreadCounts(prev => { const n = { ...prev }; delete n[id]; return n; });
            setCommandPaletteOpen(false);
          }}
          onToggleAI={handleToggleAiMode}
          onOpenTransferModal={handleOpenTransferModal}
          onCloseConversation={handleClose}
        />
      )}

      {/* Overlay de atalhos de teclado (?) */}
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* Slash command picker — portal para evitar clipping por overflow-hidden */}
      {slashMenuPos && typeof document !== 'undefined' && createPortal(
        <div
          className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
          style={{ position: 'fixed', bottom: slashMenuPos.bottom, left: slashMenuPos.left, width: 320, zIndex: 9999 }}
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Atalhos de envio</p>
          </div>
          {filteredSlashCommands.map((cmd, i) => (
            <button
              key={cmd.id}
              onMouseDown={(e) => { e.preventDefault(); executeSlashCommand(cmd.id); }}
              onMouseEnter={() => setSlashMenuIndex(i)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                i === slashMenuIndex ? 'bg-primary/10' : 'hover:bg-accent'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                i === slashMenuIndex ? 'bg-primary/20' : 'bg-foreground/[0.06]'
              }`}>
                <cmd.Icon size={15} className={i === slashMenuIndex ? 'text-primary' : 'text-muted-foreground'} />
              </div>
              <div className="min-w-0">
                <p className={`text-[13px] font-bold ${i === slashMenuIndex ? 'text-primary' : 'text-foreground'}`}>/{cmd.id}</p>
                <p className="text-[11px] text-muted-foreground truncate">{cmd.description}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Modal Contrato Trabalhista */}
      <ContratoTrabalhistaModal
        open={showContratoModal}
        conversationId={selectedId}
        onClose={() => setShowContratoModal(false)}
      />

      {/* Modal Motivo de Perda — portal para garantir z-index acima de tudo */}
      {lossModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm dark">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-in zoom-in-95 duration-200">
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
                className="px-4 py-2 text-sm rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 font-medium hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirmar Perda
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Adiar Atendimento — portal para garantir z-index acima de tudo */}
      {taskModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm dark">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={20} className="text-amber-400 shrink-0" />
              <h3 className="text-lg font-bold text-foreground">Adiar Atendimento</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Crie um lembrete e <strong className="text-foreground">{taskModal.leadName}</strong> será movido para Adiados.
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Título *</label>
                <input
                  type="text"
                  autoFocus
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) createTask(); }}
                  placeholder="Ex: Receber documentação do cliente"
                  className="w-full px-3 py-2.5 text-sm bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Prazo</label>
                <input
                  type="datetime-local"
                  value={taskDueAt}
                  onChange={e => setTaskDueAt(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground [color-scheme:dark]"
                />
              </div>
              {taskAgents.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Atribuir a</label>
                  <select
                    value={taskAssignedId}
                    onChange={e => setTaskAssignedId(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-accent/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground"
                  >
                    <option value="" className="bg-card">Sem atribuição</option>
                    {taskAgents.map(a => (
                      <option key={a.id} value={a.id} className="bg-card">{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setTaskModal(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={createTask}
                disabled={!taskTitle.trim() || savingTask}
                className="px-4 py-2 text-sm rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingTask && <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />}
                Adiar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Ficha Trabalhista Slide-over */}
      {fichaInboxVisible && selected?.leadId && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setFichaInboxVisible(false)}
          />
          <div className="relative w-full max-w-2xl h-full bg-background border-l border-border flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <ClipboardList size={16} className="text-amber-500" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground text-sm">Ficha Trabalhista</h2>
                  <p className="text-[11px] text-muted-foreground">{selected?.contactName}</p>
                </div>
              </div>
              <button
                onClick={() => setFichaInboxVisible(false)}
                className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Fechar ficha trabalhista"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FichaTrabalhista leadId={selected.leadId} onFinalize={() => { setFichaFinalizada(true); setFichaInboxVisible(false); }} />
            </div>
          </div>
        </div>
      )}

      {/* Modal de Encerramento de Conversa */}
      {closeConvModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm dark" onClick={() => setCloseConvModal(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <X size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Encerrar conversa</h3>
                <p className="text-[12px] text-muted-foreground">
                  {selected?.contactName || 'Este atendimento'} será marcado como encerrado.
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              O histórico de mensagens será preservado. A conversa não receberá novas mensagens automáticas.
            </p>
            {/* CSAT toggle */}
            <label className="flex items-center gap-3 mb-5 p-3 rounded-xl border border-border bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors">
              <div className="relative shrink-0">
                <input
                  type="checkbox"
                  checked={csatOnClose}
                  onChange={e => setCsatOnClose(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-9 h-5 rounded-full transition-colors ${csatOnClose ? 'bg-primary' : 'bg-muted'}`} />
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${csatOnClose ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-foreground">Enviar pesquisa de satisfação</p>
                <p className="text-[11px] text-muted-foreground">Envia uma mensagem de avaliação 1–5 ⭐ para o cliente</p>
              </div>
            </label>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setCloseConvModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmClose}
                className="px-4 py-2 text-sm rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 font-bold hover:bg-red-500/20 transition-colors"
              >
                Encerrar{csatOnClose ? ' + CSAT' : ''}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Encaminhar Mensagem */}
      {forwardMsg && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm dark" onClick={() => setForwardMsg(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-foreground">↪️ Encaminhar mensagem</h3>
              <button onClick={() => setForwardMsg(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="text-sm text-muted-foreground bg-accent/30 rounded-lg px-3 py-2 mb-4 line-clamp-3 italic">
              &ldquo;{forwardMsg.text}&rdquo;
            </div>
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={forwardSearch}
                onChange={e => setForwardSearch(e.target.value)}
                placeholder="Buscar conversa..."
                className="w-full pl-8 pr-3 py-2 text-sm bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground"
              />
            </div>
            <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-0.5">
              {conversations
                .filter(c => c.id !== selectedId && (
                  !forwardSearch.trim() ||
                  c.contactName?.toLowerCase().includes(forwardSearch.toLowerCase()) ||
                  c.contactPhone?.toLowerCase().includes(forwardSearch.toLowerCase())
                ))
                .slice(0, 25)
                .map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleForwardMessage(c.id)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent transition-colors flex items-center gap-3"
                  >
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                      {(c.contactName || '?')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.contactName || c.contactPhone}</p>
                      {c.lastMessage && <p className="text-[11px] text-muted-foreground truncate">{c.lastMessage}</p>}
                    </div>
                  </button>
                ))
              }
              {conversations.filter(c => c.id !== selectedId && (!forwardSearch.trim() || c.contactName?.toLowerCase().includes(forwardSearch.toLowerCase()))).length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-4">Nenhuma conversa encontrada</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Toast de Lembrete de Tarefa Agendada */}
      {taskReminderToast && typeof document !== 'undefined' && createPortal(
        <div className="fixed top-4 right-4 z-[10000] w-80 bg-card border border-amber-500/30 rounded-xl shadow-2xl p-4 animate-in slide-in-from-right-5 duration-300">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <Clock size={18} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-0.5">
                {taskReminderToast.minutesBefore > 0 ? `Lembrete em ${taskReminderToast.minutesBefore} min` : 'Tarefa agora!'}
              </p>
              <p className="text-sm font-semibold text-foreground truncate">
                ⏰ {taskReminderToast.title}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(taskReminderToast.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                {' - '}
                {new Date(taskReminderToast.start_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
              </p>
            </div>
            <button onClick={() => setTaskReminderToast(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
