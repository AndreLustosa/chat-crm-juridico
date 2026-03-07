'use client';

import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { MessageSquare, Send, Download, Mic, FileText, Bot, BotOff, Paperclip, X, CheckCheck, Check, Eye, XCircle, Trash2, Reply, UserCheck, PanelLeftClose, PanelLeftOpen, CornerDownLeft, Inbox, Pencil, Search, ChevronDown, ClipboardList, ArrowLeft, MoreVertical, ChevronRight } from 'lucide-react';
import FichaTrabalhista from '@/components/FichaTrabalhista';
import { AudioPlayer } from '@/components/AudioPlayer';
import { AudioRecorder } from '@/components/AudioRecorder';
import { TransferAudioRecorder } from '@/components/TransferAudioRecorder';
import { AuthAudioPlayer } from '@/components/AuthAudioPlayer';
import { EmojiPickerButton } from '@/components/EmojiPickerButton';
import { SophIAButton } from '@/components/SophIAButton';
import { playNotificationSound } from '@/lib/notificationSounds';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import { CRM_STAGES, findStage, normalizeStage } from '@/lib/crmStages';

interface ConversationSummary {
  id: string;
  leadId: string;
  contactName: string;
  contactPhone: string;
  channel: string;
  status: string;
  lastMessage: string;
  lastMessageAt: string;
  assignedAgentId?: string | null;
  assignedAgentName: string | null;
  aiMode: boolean;
  profile_picture_url?: string | null;
  inboxId?: string | null;
  legalArea?: string | null;
  assignedLawyerId?: string | null;
  assignedLawyerName?: string | null;
  originAssignedUserId?: string | null;
  originAssignedUserName?: string | null;
  leadStage?: string | null;
}

interface MessageItem {
  id: string;
  conversation_id: string;
  external_message_id?: string | null;
  direction: 'in' | 'out';
  type: string;
  text: string | null;
  status: string;
  created_at: string;
  reply_to_id?: string | null;
  reply_to_text?: string | null;
  media?: { original_url?: string; mime_type?: string; duration?: number | null; original_name?: string | null } | null;
}

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
  if (apiUrl.startsWith('http')) {
    try { return new URL(apiUrl).origin; } catch { /* fall through */ }
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** Em dev o socket.io está diretamente em /socket.io/ (sem proxy).
 *  Em produção o Nginx proxia /api/ → API, então o path é /api/socket.io/ */
function getSocketPath(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_PATH) return process.env.NEXT_PUBLIC_SOCKET_PATH;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const isDev = apiUrl.includes('localhost') || /https?:\/\/[^/]+:\d{4,}/.test(apiUrl);
  return isDev ? '/socket.io/' : '/api/socket.io/';
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

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 select-none sticky top-0 z-10 bg-card/80 backdrop-blur-sm">
      <div className="flex-1 h-px bg-border/60" />
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function StatusIcon({ status, isOut }: { status: string; isOut: boolean }) {
  if (!isOut) return null;
  if (status === 'lido') return <CheckCheck size={12} className="text-blue-400" />;
  if (status === 'entregue') return <CheckCheck size={12} className="text-primary-foreground/60" />;
  return <Check size={12} className="text-primary-foreground/60" />;
}


export default function Dashboard() {
  const router = useRouter();
  const [leadFilter, setLeadFilter] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [userInboxes, setUserInboxes] = useState<any[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
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
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
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

  // Sync aiMode when conversation changes
  useEffect(() => {
    const conv = conversations.find(c => c.id === selectedId);
    if (conv) setAiMode(!!conv.aiMode);
    // NÃO fechar o dropdown aqui — conversations muda via socket e fecharia prematuramente
  }, [selectedId, conversations]);

  // Fechar dropdown ao trocar de conversa
  useEffect(() => {
    setShowLawyerDropdown(false);
    setShowDetailsPanel(false);
  }, [selectedId]);

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
        params: { inboxId: inboxId || undefined },
        // silent=true: chamadas de background (inboxUpdate) não disparam redirect global de 401
        ...( silent ? { _silent401: true } as any : {} ),
      });
      setConversations(res.data || []);
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

  // WebSocket connection (once, does not reconnect on filter changes)
  useEffect(() => {
    const wsUrl = getWsUrl();
    console.log('[SOCKET] Connecting to:', wsUrl);
    const socket = io(wsUrl, {
      path: getSocketPath(),
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      console.log('[SOCKET] Connected to dashboard ID:', socket.id);
      // Re-join current conversation room on reconnect
      const currentConvoId = selectedIdRef.current;
      if (currentConvoId && !currentConvoId.startsWith('demo-')) {
        socket.emit('join_conversation', currentConvoId);
      }
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
    });

    socket.on('connect_error', (err) => {
      console.error('[SOCKET] Connection error:', err);
    });

    socket.on('inboxUpdate', () => {
      console.log('[SOCKET] inboxUpdate received, fetching conversations...');
      // silent=true: 401 nestas chamadas de background não redireciona todos os usuários
      fetchConversations(selectedInboxIdRef.current, true);
      fetchPendingTransfers(true);
    });

    // Incoming message notification — broadcast to all; each client filters by assignedUserId
    socket.on('incoming_message_notification', (data: { conversationId: string; assignedUserId?: string | null }) => {
      const myId = currentUserIdRef.current;
      // Skip if assigned to someone else. Play if: assigned to me, unassigned, or can't determine current user
      if (myId && data?.assignedUserId && data.assignedUserId !== myId) return;
      playNotificationSound();
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

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchConversations]);

  // Initial data load + refetch on inbox filter change
  useEffect(() => {
    fetchInboxes();
    fetchConversations(selectedInboxId);
    fetchPendingTransfers();
    fetchSpecialists();
  }, [fetchConversations, fetchPendingTransfers, selectedInboxId]);

  // Auto-abrir conversa vinda do CRM (via sessionStorage 'crm_open_conv')
  useEffect(() => {
    if (!conversations.length) return;
    const pendingConvId = sessionStorage.getItem('crm_open_conv');
    if (pendingConvId) {
      const match = conversations.find(c => c.id === pendingConvId);
      if (match) {
        setSelectedId(pendingConvId);
        sessionStorage.removeItem('crm_open_conv');
      }
    }
  }, [conversations]);

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
      return;
    }

    const prevId = selectedIdRef.current;

    const fetchDetail = async () => {
      try {
        const res = await api.get(`/conversations/${selectedId}`);
        setMessages(res.data?.messages || []);

        if (socketRef.current) {
          // Leave previous room before joining new one
          if (prevId && prevId !== selectedId) {
            socketRef.current.emit('leave_conversation', prevId);
          }
          socketRef.current.emit('join_conversation', selectedId);
          socketRef.current.off('newMessage');
          socketRef.current.on('newMessage', (msg: MessageItem) => {
            // Guard: ignore messages that belong to a different conversation
            if (msg.conversation_id && msg.conversation_id !== selectedIdRef.current) return;
            setMessages(prev => {
              if (prev.find(m => m.id === msg.id || (m.external_message_id && m.external_message_id === msg.external_message_id))) return prev;
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
        }
      } catch (e) {
        console.error('Failed to fetch conversation', e);
      }
    };

    fetchDetail();
  }, [selectedId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim() || !selectedId || selectedId.startsWith('demo-') || sending) return;
    const msgText = text;
    const replyId = replyingTo?.id;
    setSending(true);
    setText('');
    setReplyingTo(null);
    try {
      const res = await api.post('/messages/send', {
        conversationId: selectedId,
        text: msgText,
        ...(replyId ? { replyToId: replyId } : {}),
      });
      // Exibição imediata: adiciona a mensagem retornada pelo backend
      if (res.data?.id) {
        setMessages(prev => {
          if (prev.find(m => m.id === res.data.id)) return prev;
          return [...prev, res.data];
        });
      }
      inputRef.current?.focus();
    } catch (e) {
      console.error('Failed to send message', e);
      setText(msgText); // Restaura o texto em caso de erro
    } finally {
      setSending(false);
    }
  };

  const handleAccept = async () => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    try {
      await api.patch(`/conversations/${selectedId}/assign`);
      fetchConversations();
    } catch (e) {
      console.error('Failed to accept', e);
    }
  };

  const handleClose = async () => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    if (!confirm('Fechar esta conversa?')) return;
    try {
      await api.patch(`/conversations/${selectedId}/close`);
      setSelectedId(null);
      fetchConversations();
    } catch (e) {
      console.error('Failed to close', e);
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
      fetchConversations(selectedInboxIdRef.current);
    } catch (e: any) {
      console.error('Failed to return to origin', e);
    }
  };

  const handleKeepInInbox = async () => {
    if (!selectedId) return;
    try {
      await api.patch(`/conversations/${selectedId}/keep-in-inbox`);
      fetchConversations(selectedInboxIdRef.current);
    } catch (e: any) {
      console.error('Failed to keep in inbox', e);
    }
  };

  const handleAssignLawyerInbox = async (lawyerId: string | null) => {
    const convId = selectedIdRef.current || selectedId;
    if (!convId) return;
    setShowLawyerDropdown(false);
    try {
      await api.patch(`/conversations/${convId}/assign-lawyer`, { lawyerId });
      fetchConversations(selectedInboxIdRef.current);
    } catch (e: any) {
      console.error('Failed to assign lawyer', e);
      alert('Erro ao atribuir especialista: ' + (e?.response?.data?.message || e?.message || 'Tente novamente'));
    }
  };

  const handleChangeLeadStage = async (newStage: string) => {
    const conv = conversations.find(c => c.id === selectedId);
    if (!conv?.leadId) return;
    setLeadStage(newStage); // otimista
    setShowStageDropdown(false);
    // Atualiza leadStage no objeto local para o filtro reagir imediatamente
    setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, leadStage: newStage } : c));
    // Se marcado como Perdido, arquiva: sai da conversa e painel
    if (newStage === 'PERDIDO') {
      setSelectedId(null);
      setShowDetailsPanel(false);
    }
    try {
      await api.patch(`/leads/${conv.leadId}/stage`, { stage: newStage });
    } catch (e: any) {
      console.error('Failed to change lead stage', e);
    }
  };

  const handleAcceptTransfer = async () => {
    if (!incomingTransfer) return;
    setProcessingTransfer(true);
    try {
      await api.patch(`/conversations/${incomingTransfer.conversationId}/transfer-accept`);
      shownTransferIdsRef.current.delete(incomingTransfer.conversationId);
      // Salvar contexto (motivo + áudios) para exibir no chat após aceitar
      if (incomingTransfer.reason || incomingTransfer.audioIds?.length) {
        setTransferContextMap(prev => ({
          ...prev,
          [incomingTransfer.conversationId]: {
            fromUserName: incomingTransfer.fromUserName,
            reason: incomingTransfer.reason,
            audioIds: incomingTransfer.audioIds || [],
          },
        }));
      }
      setIncomingTransfer(null);
      fetchPendingTransfers();
      fetchConversations(selectedInboxIdRef.current);
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
      fetchConversations(selectedInboxIdRef.current);
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

  const handleQuickAcceptTransfer = async (conversationId: string) => {
    try {
      await api.patch(`/conversations/${conversationId}/transfer-accept`);
      shownTransferIdsRef.current.delete(conversationId);
      fetchPendingTransfers();
      fetchConversations(selectedInboxIdRef.current);
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
      fetchConversations();
    } catch (e) {
      console.error('Erro ao alterar modo IA', e);
    }
  };

  const uploadFile = async (file: File) => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
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

  const filteredConversations = (() => {
    let result: ConversationSummary[];
    if (leadFilter === 'ACTIVE') {
      result = conversations.filter(myActiveConvs);
    } else if (leadFilter === 'BOT') {
      // SophIA: somente conversas com IA ativa atribuídas ao usuário logado
      result = conversations.filter(c => c.aiMode && c.assignedAgentId === currentUserId);
    } else if (leadFilter) {
      result = conversations.filter(c => c.status === leadFilter);
    } else {
      result = conversations;
    }
    // Ocultar contatos arquivados (marcados como Perdido no CRM)
    result = result.filter(c => normalizeStage(c.leadStage) !== 'PERDIDO');
    // Filtro de busca: nome do contato, telefone ou conteúdo da última mensagem
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
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
  })();

  const selected = conversations.find((c) => c.id === selectedId);
  const isDemo = selectedId?.startsWith('demo-');
  const isRealConvo = selectedId && !isDemo;
  const isClosed = selected?.status === 'CLOSED';

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

  const isEmojiOnly = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
    return /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(t);
  };

  const handleTranscribe = async (msgId: string) => {
    setTranscribing(prev => ({ ...prev, [msgId]: true }));
    try {
      const res = await api.post(`/messages/${msgId}/transcribe`);
      setMessages(prev => prev.map((m: any) => m.id === msgId ? { ...m, text: res.data.transcription } : m));
    } catch (e) {
      console.error('Erro ao transcrever áudio', e);
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
    } catch (e) { console.error('Erro ao editar mensagem', e); }
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name?: string) => (name || 'V')[0].toUpperCase();

  const statusBadge = (status: string) => {
    const map: Record<string, { class: string; label: string }> = {
      BOT: { class: 'bg-slate-500/15 text-slate-400 border border-slate-500/20', label: '🤖 SophIA' },
      WAITING: { class: 'bg-amber-500/15 text-amber-500 border border-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.15)]', label: '⏳ Aguardando' },
      ACTIVE: { class: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20', label: '🟢 Atribuído' },
      CLOSED: { class: 'bg-gray-500/15 text-gray-400 border border-gray-500/20', label: '⬛ Fechado' },
    };
    const badge = map[status] || map.CLOSED;
    return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.class}`}>{badge.label}</span>;
  };

  return (
    <div className="flex h-full overflow-hidden bg-background font-sans antialiased text-foreground">

      {/* INBOX */}
      <section className={`flex flex-col bg-card border-r border-border shrink-0 z-40 transition-all duration-300 ${isMobile ? (selectedId ? 'hidden' : 'w-full') : (inboxOpen ? 'w-[380px]' : 'w-0 overflow-hidden')}`}>
        <div className="p-5 border-b border-border space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Inbox</h2>
            <button
              onClick={() => setInboxOpen(false)}
              className="hidden md:block p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Fechar painel"
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
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar contato ou mensagem…"
              className="w-full pl-8 pr-7 py-1.5 text-[12px] bg-accent/50 border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                title="Limpar busca"
              >
                <X size={12} />
              </button>
            )}
          </div>

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
                        onClick={() => handleQuickAcceptTransfer(pt.conversationId)}
                        className="px-2 py-1 bg-emerald-500 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-600 transition-colors"
                        title="Aceitar transferência"
                      >✓</button>
                      <button
                        onClick={() => { setIncomingTransfer(pt); setShowDeclineInput(false); setDeclineReason(''); }}
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
                onClick={() => setSelectedInboxId(null)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${!selectedInboxId ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'}`}
              >
                Todos Setores
              </button>
              {userInboxes.map((inbox) => (
                <button
                  key={inbox.id}
                  onClick={() => setSelectedInboxId(inbox.id)}
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
                onClick={() => setLeadFilter(tab.value)}
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
                  setSelectedId(conv.id);
                  // Clear unread count when opening the conversation
                  setUnreadCounts(prev => { const n = { ...prev }; delete n[conv.id]; return n; });
                }}
                className={`flex gap-4 p-4 border-b border-border/50 cursor-pointer transition-colors relative
                  ${selectedId === conv.id ? 'bg-accent/50' : 'hover:bg-accent/30'}
                `}
              >
                {selectedId === conv.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                <div
                  className={`w-11 h-11 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0 shadow-sm ${conv.profile_picture_url ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                  onClick={conv.profile_picture_url ? (e) => { e.stopPropagation(); setLightbox(conv.profile_picture_url!); } : undefined}
                  title={conv.profile_picture_url ? 'Ver foto ampliada' : undefined}
                >
                  {conv.profile_picture_url ? (
                    <img src={conv.profile_picture_url} alt={conv.contactName} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-foreground font-bold text-lg">{getInitial(conv.contactName)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <span className={`font-semibold truncate pl-0.5 ${(unreadCounts[conv.id] || 0) > 0 ? 'text-foreground' : 'text-foreground'}`}>
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
                    {/* Aten. = atendente comercial original (ou atual se não transferido ao adv.) */}
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
                      {/* Adv. = advogado atual (assignedAgentName quando transferido) ou pré-atribuído */}
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

      {/* INBOX OPEN BUTTON (when collapsed) - desktop only */}
      {!inboxOpen && !isMobile && (
        <button
          onClick={() => setInboxOpen(true)}
          className="shrink-0 w-10 flex flex-col items-center justify-start gap-2 pt-4 bg-card border-r border-border z-40 hover:bg-accent/50 transition-all"
          title="Abrir painel de inbox"
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
            <header className="min-h-[60px] md:min-h-[80px] py-2 md:py-3 px-3 md:px-8 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
               <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                 {/* Botão Voltar - mobile only */}
                 {isMobile && (
                   <button
                     onClick={() => { setSelectedId(null); setMobileMoreOpen(false); }}
                     className="p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                   >
                     <ArrowLeft size={20} />
                   </button>
                 )}
                 <div
                   className={`w-10 h-10 md:w-12 md:h-12 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shadow-sm shrink-0 ${selected.profile_picture_url ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                   onClick={() => selected.profile_picture_url && setLightbox(selected.profile_picture_url)}
                   title={selected.profile_picture_url ? 'Ver foto ampliada' : undefined}
                 >
                   {selected.profile_picture_url ? (
                     <img src={selected.profile_picture_url} alt={selected.contactName} className="w-full h-full object-cover" loading="lazy" />
                   ) : (
                     <span className="text-foreground font-bold text-lg md:text-xl">{getInitial(selected.contactName)}</span>
                   )}
                 </div>
                 <div
                   className="min-w-0 flex-1 cursor-pointer active:opacity-70 transition-opacity"
                   onClick={() => {
                     if (isMobile) {
                       setShowDetailsPanel(true);
                     } else {
                       router.push(`/atendimento/contacts?lead=${selected.leadId}`);
                     }
                   }}
                 >
                   <div className="flex items-center gap-1">
                     <h3 className="font-bold text-base md:text-lg leading-tight truncate">{selected.contactName || selected.contactPhone}</h3>
                     <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                   </div>
                   <div className="text-[11px] md:text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-0.5 md:mt-1 truncate">
                     {selected.channel} <span className="mx-1">•</span> {selected.contactPhone}
                   </div>
                   {/* Área jurídica + especialista pré-atribuído — hidden on mobile */}
                   {(selected.legalArea || selected.assignedLawyerId) && (
                     <div className="hidden md:flex items-center gap-2 flex-wrap mt-1.5">
                       {selected.legalArea && (
                         <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 text-[10px] font-bold border border-violet-500/20">
                           ⚖️ {selected.legalArea}
                         </span>
                       )}
                       {fichaFinalizada && (
                         <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                           ✅ Ficha Finalizada
                         </span>
                       )}
                       {selected.legalArea && (
                         <div className="relative" ref={lawyerDropdownRef}>
                           <button
                             onClick={() => setShowLawyerDropdown(v => !v)}
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
                       )}
                     </div>
                   )}
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
                           onClick={handleSendFormLink}
                           title="Enviar link do formulário trabalhista ao lead"
                           className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/20 hover:bg-amber-500/25 transition-colors"
                         >
                           <ClipboardList size={10} />
                           Enviar Formulário
                         </button>
                       )}
                       <button
                         onClick={() => setFichaInboxVisible(true)}
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
                       onClick={handleToggleAiMode}
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
                       onClick={handleAccept}
                       className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-ring text-primary-foreground font-bold text-sm shadow-[0_0_15px_rgba(var(--primary),0.3)] hover:shadow-[0_0_20px_rgba(var(--primary),0.4)] hover:-translate-y-0.5 transition-all"
                     >
                       Aceitar Atendimento
                     </button>
                   )}
                   {!isClosed && isRealConvo && (
                     <button
                       onClick={handleOpenTransferModal}
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
                         onClick={() => openReasonPopup('return', selected?.originAssignedUserName || 'atendente de origem')}
                         title="Devolver conversa ao atendente de origem"
                         className="px-3 py-2 text-sm font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 transition-colors flex items-center gap-2"
                       >
                         <CornerDownLeft size={16} />
                         Devolver
                       </button>
                       <button
                         onClick={handleKeepInInbox}
                         title="Manter conversa no meu inbox"
                         className="px-3 py-2 text-sm font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl hover:bg-emerald-500/20 transition-colors flex items-center gap-2"
                       >
                         <Inbox size={16} />
                         Manter Aqui
                       </button>
                     </>
                   )}
                   {!isClosed && isRealConvo && (
                     <button
                       onClick={handleClose}
                       title="Fechar conversa"
                       className="px-3 py-2 text-sm font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl hover:bg-red-500/20 transition-colors flex items-center gap-2"
                     >
                       <XCircle size={16} />
                       Fechar
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
                         onClick={() => setShowStageDropdown(v => !v)}
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
                               onClick={() => handleChangeLeadStage(s.id)}
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
            <div className="absolute inset-0 px-1 sm:px-6 md:px-8 py-3 sm:py-5 md:py-8 overflow-y-auto custom-scrollbar" ref={scrollRef}>
              <div className="flex flex-col gap-3 md:gap-4 max-w-4xl mx-auto pb-4 relative z-10">
                {isRealConvo && messages.length > 0 ? (
                  (() => {
                    let lastMsgDateKey = '';
                    return messages.map((msg, msgIdx) => {
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
                      <div id={`msg-${msg.id}`} key={msg.id} className={`w-full flex items-end gap-1 ${isOut ? 'justify-end' : 'justify-start'} group rounded-xl transition-all duration-300`}>
                        {!isOut && (
                          <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mb-1">
                            <button
                              onClick={() => { setReplyingTo(msg); inputRef.current?.focus(); }}
                              className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                              title="Responder"
                            >
                              <Reply size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              title="Apagar mensagem"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                        <div className={`max-w-[74%] md:max-w-[65%] min-w-[60px] p-3 md:p-4 shadow-sm break-words overflow-hidden ${
                          isOut
                            ? 'bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground rounded-2xl rounded-tr-sm'
                            : 'bg-card border border-border rounded-2xl rounded-tl-sm'
                        }`}>
                          {msg.reply_to_text && msg.type !== 'deleted' && (
                            <div
                              className={`mb-2 pl-3 border-l-2 rounded-sm cursor-pointer ${isOut ? 'border-white/40 bg-white/10' : 'border-primary/50 bg-primary/5'}`}
                              onClick={() => {
                                const el = document.getElementById(`msg-${msg.reply_to_id}`);
                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el?.classList.add('ring-2', 'ring-primary/50');
                                setTimeout(() => el?.classList.remove('ring-2', 'ring-primary/50'), 1500);
                              }}
                            >
                              <p className={`text-[11px] py-1 pr-2 line-clamp-2 ${isOut ? 'text-white/60' : 'text-muted-foreground'}`}>{msg.reply_to_text}</p>
                            </div>
                          )}
                          {msg.type === 'deleted' ? (
                            <p className="text-sm italic opacity-50">🚫 Mensagem apagada</p>
                          ) : msg.type === 'text' || !msg.type ? (
                            editingMsg?.id === msg.id ? (
                              <div className="flex flex-col gap-2 min-w-[200px]">
                                <textarea
                                  autoFocus
                                  rows={3}
                                  value={editingMsg.text}
                                  onChange={e => setEditingMsg(prev => prev ? { ...prev, text: e.target.value } : null)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMessage(editingMsg.id, editingMsg.text); }
                                    if (e.key === 'Escape') setEditingMsg(null);
                                  }}
                                  className="w-full bg-white/10 text-primary-foreground rounded-lg p-2 text-[14px] resize-none outline-none border border-white/30 focus:border-white/60"
                                />
                                <div className="flex justify-end gap-2">
                                  <button onClick={() => setEditingMsg(null)} className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-primary-foreground/70">Cancelar</button>
                                  <button onClick={() => handleEditMessage(editingMsg.id, editingMsg.text)} className="text-[11px] px-2 py-1 rounded bg-white/25 hover:bg-white/35 text-primary-foreground font-medium">Salvar</button>
                                </div>
                              </div>
                            ) : isEmojiOnly(msg.text || '') ? (
                              <p className="text-4xl leading-tight">{msg.text}</p>
                            ) : (
                              <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                            )
                          ) : msg.type === 'audio' ? (
                            msg.media ? (
                              <div>
                                <AudioPlayer
                                  src={`/api/media/${msg.id}`}
                                  duration={msg.media.duration}
                                  isOutgoing={isOut}
                                />
                                {msg.text ? (
                                  <p className={`text-[12px] mt-2 leading-snug italic ${isOut ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                    {msg.text}
                                  </p>
                                ) : (
                                  <button
                                    onClick={() => handleTranscribe(msg.id)}
                                    disabled={transcribing[msg.id]}
                                    className={`mt-2 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors disabled:opacity-50 ${isOut ? 'bg-white/15 hover:bg-white/25 text-white/80' : 'bg-primary/10 hover:bg-primary/20 text-primary'}`}
                                  >
                                    <Mic size={11} />
                                    {transcribing[msg.id] ? 'Transcrevendo...' : 'Transcrever'}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 w-48 animate-pulse">
                                <div className="w-8 h-8 rounded-full bg-current opacity-20 shrink-0" />
                                <div className="flex-1 space-y-1.5">
                                  <div className="h-1 rounded bg-current opacity-20" />
                                  <div className="h-1 rounded bg-current opacity-10 w-3/4" />
                                </div>
                              </div>
                            )
                          ) : msg.type === 'image' ? (
                            msg.media ? (
                              <div className="relative group inline-block">
                                <img
                                  src={`/api/media/${msg.id}`}
                                  alt="Imagem"
                                  className="max-w-[220px] max-h-[220px] object-cover rounded-lg cursor-pointer"
                                  onClick={() => setLightbox(`/api/media/${msg.id}`)}
                                />
                                <button
                                  onClick={() => handleImageDownload(`/api/media/${msg.id}`)}
                                  className="absolute bottom-1.5 right-1.5 bg-black/50 hover:bg-black/70 text-white rounded-md p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Baixar imagem"
                                >
                                  <Download size={13} />
                                </button>
                              </div>
                            ) : (
                              <p className="text-sm italic opacity-70">🖼️ Imagem processando...</p>
                            )
                          ) : msg.type === 'video' ? (
                            msg.media ? (
                              <video
                                src={`/api/media/${msg.id}`}
                                controls
                                className="max-w-full rounded-lg"
                              />
                            ) : (
                              <p className="text-sm italic opacity-70">🎬 Vídeo processando...</p>
                            )
                          ) : msg.type === 'document' ? (
                            msg.media ? (
                              <div
                                className={`flex items-center gap-3 cursor-pointer rounded-xl p-3 min-w-[200px] transition-colors ${isOut ? 'bg-white/10 hover:bg-white/20' : 'bg-muted/60 hover:bg-muted'}`}
                                onClick={() => setDocPreview({ url: `/api/media/${msg.id}`, name: msg.media!.original_name || 'documento', mime: msg.media!.mime_type || '' })}
                              >
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isOut ? 'bg-white/20' : 'bg-primary/10'}`}>
                                  <FileText size={20} className={isOut ? 'text-white' : 'text-primary'} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{msg.media!.original_name || 'Documento'}</p>
                                  <p className={`text-[11px] uppercase font-semibold mt-0.5 ${isOut ? 'text-white/50' : 'text-muted-foreground'}`}>{getDocLabel(msg.media!.mime_type || '', msg.media!.original_name || '')}</p>
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); handleDocDownload(`/api/media/${msg.id}`, msg.media!.original_name || 'documento'); }}
                                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${isOut ? 'hover:bg-white/20 text-white/70' : 'hover:bg-primary/10 text-muted-foreground'}`}
                                  title="Baixar"
                                >
                                  <Download size={14} />
                                </button>
                              </div>
                            ) : (
                              <p className="text-sm italic opacity-70">📄 Documento processando...</p>
                            )
                          ) : msg.type === 'sticker' ? (
                            msg.media ? (
                              <img
                                src={`/api/media/${msg.id}`}
                                alt="Figurinha"
                                className="max-w-[140px] max-h-[140px] object-contain"
                              />
                            ) : (
                              <p className="text-sm italic opacity-70">🎭 Figurinha processando...</p>
                            )
                          ) : (
                            <p className="text-sm italic opacity-70">📎 Anexo: {msg.type}</p>
                          )}
                          {msg.type !== 'deleted' && (
                            <div className={`text-[10px] mt-2 flex justify-end items-center gap-1.5 ${isOut ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                              <span>{formatTime(msg.created_at)}</span>
                              <StatusIcon status={msg.status} isOut={isOut} />
                            </div>
                          )}
                        </div>
                        {isOut && (
                          <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mb-1">
                            <button
                              onClick={() => { setReplyingTo(msg); inputRef.current?.focus(); }}
                              className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                              title="Responder"
                            >
                              <Reply size={16} />
                            </button>
                            {(msg.type === 'text' || !msg.type) && msg.type !== 'deleted' && (
                              <button
                                onClick={() => setEditingMsg({ id: msg.id, text: msg.text || '' })}
                                className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                                title="Editar mensagem"
                              >
                                <Pencil size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              title="Apagar mensagem"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                        </Fragment>
                      );
                    });
                  })()
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

            {/* ═══ MINIMAL MOBILE ACTION BAR ═══ */}
            {isMobile && selectedId && selected && isRealConvo && (
              <div className="shrink-0 bg-card/95 backdrop-blur-md border-t border-border flex items-center justify-between px-3 py-2">
                {/* IA pill */}
                <button
                  onClick={handleToggleAiMode}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    aiMode
                      ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                      : 'text-muted-foreground bg-muted/30 border-border'
                  }`}
                >
                  {aiMode ? <Bot size={14} /> : <BotOff size={14} />}
                  {aiMode ? 'IA On' : 'IA Off'}
                </button>

                {/* Aceitar — só WAITING */}
                {selected.status === 'WAITING' && (
                  <button
                    onClick={handleAccept}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-primary bg-primary/10 border border-primary/20 active:bg-primary/20"
                  >
                    <Check size={14} />
                    Aceitar
                  </button>
                )}

                {/* Ações → abre painel */}
                <button
                  onClick={() => setShowDetailsPanel(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-muted-foreground bg-muted/30 border border-border active:bg-accent transition-colors"
                >
                  Ações
                  <ChevronRight size={14} />
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
                      {selected.legalArea && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Área</span>
                          <span className="font-medium text-violet-400">⚖️ {selected.legalArea}</span>
                        </div>
                      )}
                      {selected.assignedAgentName && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Atendente</span>
                          <span className="font-medium">{selected.assignedAgentName}</span>
                        </div>
                      )}
                      {selected.assignedLawyerName && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Especialista</span>
                          <span className="font-medium text-amber-400">{selected.assignedLawyerName}</span>
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
                  <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X size={13} />
                  </button>
                </div>
              )}

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
                      className="p-2.5 md:p-3 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 shrink-0 mb-0.5"
                    >
                      {uploadingFile
                        ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <Paperclip size={20} />}
                    </button>
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
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder={isRealConvo ? "Digite sua mensagem..." : "Selecione uma conversa..."}
                      disabled={!isRealConvo || sending}
                      className={`w-full bg-card border border-border rounded-2xl py-3 md:py-4 focus:outline-none focus:ring-2 focus:ring-primary shadow-sm text-foreground disabled:opacity-50 text-sm md:text-base resize-none leading-normal overflow-hidden pl-4 ${
                        isRealConvo ? (isMobile ? 'pr-[7rem]' : 'pr-24') : 'pr-4'
                      }`}
                    />
                    {/* Ícones internos (direita) */}
                    {isRealConvo && (
                      <div className="absolute bottom-2 right-2 flex items-center gap-0.5">
                        {/* Clip — mobile */}
                        {isMobile && (
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingFile}
                            title="Arquivo"
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
                    disabled={!isRealConvo || !text.trim() || sending}
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
              >
                <Download size={16} />
              </button>
              <button
                onClick={() => setLightbox(null)}
                className="bg-black/60 hover:bg-black/80 text-white rounded-lg p-2 transition-colors text-lg leading-none"
                title="Fechar"
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
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={() => setDocPreview(null)}
                  className="bg-muted hover:bg-muted/80 text-foreground rounded-lg p-2 transition-colors text-base leading-none"
                  title="Fechar"
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

      {/* Transfer Modal */}
      {transferModal && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm"
          onClick={() => setTransferModal(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <UserCheck size={18} className="text-sky-400" />
              <h3 className="font-bold text-base">Solicitar Transferência</h3>
            </div>
            {transferError && (
              <p className="text-red-400 text-sm mb-3 px-1">{transferError}</p>
            )}
            {loadingOperators ? (
              <p className="text-muted-foreground text-sm py-4 text-center">Carregando operadores...</p>
            ) : transferGroups.every(g => g.users.length === 0) || transferGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm py-2">Nenhum operador cadastrado.</p>
            ) : (
              <>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1 shrink-0">Selecione o destino</p>
                <div className="flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                  {transferGroups.filter(g => g.users.length > 0 || (g.type === 'SECTOR' && g.auto_route)).map(group => (
                    <div key={group.id}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 px-1">
                        {group.type === 'SECTOR' ? (group.auto_route ? '⚖️' : '🏢') : '📥'} {group.name}
                        {group.auto_route && <span className="ml-1 text-violet-400">(auto)</span>}
                      </p>
                      {group.type === 'SECTOR' && group.auto_route ? (
                        <div className="space-y-2">
                          {selected?.assignedLawyerId ? (
                            /* Advogado atribuído → botão que abre popup de motivo */
                            (() => {
                              const lawyer = group.users.find(u => u.id === selected.assignedLawyerId);
                              const lawyerName = lawyer?.name || selected.assignedLawyerName || 'Advogado vinculado';
                              return (
                                <button
                                  onClick={() => openReasonPopup('lawyer', lawyerName)}
                                  className="w-full py-3 bg-violet-500/10 border border-violet-500/30 text-violet-300 rounded-xl font-bold text-sm hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-2"
                                >
                                  ⚖️ Transferir para {lawyerName}{selected.legalArea ? ` (${selected.legalArea})` : ''}
                                </button>
                              );
                            })()
                          ) : (
                            /* Sem advogado atribuído → lista manual */
                            group.users.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {group.users.map(user => (
                                  <button
                                    key={user.id}
                                    onClick={() => setSelectedTransferUserId(user.id)}
                                    className={`w-full text-left px-4 py-2.5 rounded-xl border transition-colors font-medium text-sm ${
                                      selectedTransferUserId === user.id
                                        ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                                        : 'bg-muted/30 hover:bg-sky-500/10 hover:text-sky-400 border-border hover:border-sky-500/30'
                                    }`}
                                  >
                                    {selectedTransferUserId === user.id && <span className="mr-2">✓</span>}
                                    {user.name}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground text-center py-2 px-1 italic">
                                Nenhum advogado especialista cadastrado.
                              </p>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {group.users.map(user => (
                            <button
                              key={user.id}
                              onClick={() => setSelectedTransferUserId(user.id)}
                              className={`w-full text-left px-4 py-2.5 rounded-xl border transition-colors font-medium text-sm ${
                                selectedTransferUserId === user.id
                                  ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                                  : 'bg-muted/30 hover:bg-sky-500/10 hover:text-sky-400 border-border hover:border-sky-500/30'
                              }`}
                            >
                              {selectedTransferUserId === user.id && <span className="mr-2">✓</span>}
                              {user.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {selectedTransferUserId && (
                  <button
                    onClick={() => {
                      const destUser = transferGroups.flatMap(g => g.users).find(u => u.id === selectedTransferUserId);
                      openReasonPopup('operator', destUser?.name || 'Operador');
                    }}
                    className="mt-3 shrink-0 w-full py-2.5 bg-sky-500 text-white rounded-xl font-bold text-sm hover:bg-sky-600 transition-colors"
                  >
                    Solicitar Transferência
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => setTransferModal(false)}
              className="mt-2 shrink-0 w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Popup de Motivo de Transferência ── */}
      {showReasonPopup && (
        <div
          className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={closeReasonPopup}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[360px] mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`px-5 pt-5 pb-3 border-b border-border/60 ${
              reasonPopupContext === 'lawyer' ? 'bg-violet-500/5' :
              reasonPopupContext === 'return' ? 'bg-amber-500/5' :
              'bg-sky-500/5'
            }`}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
                {reasonPopupContext === 'lawyer' ? '⚖️ Transferência para especialista' :
                 reasonPopupContext === 'return' ? '↩ Devolver contato' :
                 '📨 Solicitar transferência'}
              </p>
              <h3 className="font-bold text-sm text-foreground">
                {reasonPopupContext === 'return' ? `Para: ${reasonPopupTargetName}` : reasonPopupTargetName}
              </h3>
            </div>

            {/* Caixa unificada: textarea + gravador de áudio */}
            <div className={`m-4 rounded-xl border bg-muted/40 overflow-hidden transition-colors ${
              reasonPopupContext === 'return' ? 'border-amber-500/30 focus-within:border-amber-500/60' :
              'border-border focus-within:border-violet-500/50'
            }`}>
              <textarea
                autoFocus
                value={transferReason}
                onChange={e => setTransferReason(e.target.value)}
                placeholder={
                  reasonPopupContext === 'return'
                    ? `Observações para ${reasonPopupTargetName} (opcional)...`
                    : `Explique o motivo para ${reasonPopupTargetName}...`
                }
                className="w-full bg-transparent px-4 pt-3 pb-2 text-sm resize-none outline-none min-h-[80px]"
                rows={3}
              />
              {/* Divisor + gravador dentro da mesma caixa */}
              <div className="border-t border-border/50 px-3 py-2.5 bg-muted/20">
                <TransferAudioRecorder
                  conversationId={selectedId!}
                  onAudioIdsChange={setTransferAudioIds}
                />
              </div>
            </div>

            {/* Erro */}
            {transferError && (
              <p className="text-red-400 text-xs px-4 pb-2">{transferError}</p>
            )}

            {/* Botões */}
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={closeReasonPopup}
                className="flex-1 py-2.5 bg-muted border border-border text-muted-foreground rounded-xl text-sm font-semibold hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={
                  reasonPopupContext === 'lawyer' ? handleTransferToLawyer :
                  reasonPopupContext === 'return' ? handleReturnWithReason :
                  handleTransfer
                }
                disabled={
                  transferring ||
                  (reasonPopupContext !== 'return' && !transferReason.trim() && transferAudioIds.length === 0)
                }
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  reasonPopupContext === 'lawyer'
                    ? 'bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25'
                    : reasonPopupContext === 'return'
                    ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-sky-500 text-white hover:bg-sky-600'
                }`}
              >
                {transferring ? '⏳ Enviando...' :
                 reasonPopupContext === 'lawyer' ? '⚖️ Confirmar' :
                 reasonPopupContext === 'return' ? '↩ Devolver' :
                 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incoming Transfer Popup */}
      {incomingTransfer && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-card border-2 border-amber-500/40 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh]">
            {/* Header fixo */}
            <div className="flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
              <span className="text-2xl">📨</span>
              <div>
                <h3 className="font-bold text-base">Pedido de Transferência</h3>
                <p className="text-xs text-muted-foreground">De: <strong className="text-foreground">{incomingTransfer.fromUserName}</strong></p>
              </div>
            </div>

            {/* Corpo rolável */}
            <div className="overflow-y-auto px-6 flex-1 min-h-0">
              <div className="bg-muted/50 rounded-xl p-4 mb-4 space-y-3 text-sm">
                <p><span className="text-muted-foreground">Contato:</span> <strong>{incomingTransfer.contactName}</strong></p>
                {incomingTransfer.reason && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Motivo:</p>
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{incomingTransfer.reason}</p>
                  </div>
                )}
                {incomingTransfer.audioIds && incomingTransfer.audioIds.length > 0 && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1.5">Áudios explicativos ({incomingTransfer.audioIds.length}):</p>
                    <div className="space-y-1.5">
                      {incomingTransfer.audioIds.map((aid, i) => (
                        <div key={aid} className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground shrink-0">#{i + 1}</span>
                          <AuthAudioPlayer
                            audioId={aid}
                            className="h-7 w-full"
                            style={{ filter: 'hue-rotate(240deg) brightness(0.9)' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {showDeclineInput && (
                <textarea
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  placeholder="Justificativa para recusa (opcional)..."
                  className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm mb-3 resize-none outline-none focus:border-red-500/50"
                  rows={2}
                  autoFocus
                />
              )}
            </div>

            {/* Botões fixos no rodapé */}
            <div className="px-6 pb-6 pt-2 shrink-0">
              <div className="flex gap-2">
                {!showDeclineInput ? (
                  <>
                    <button
                      onClick={handleAcceptTransfer}
                      disabled={processingTransfer}
                      className="flex-1 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                      ✓ Aceitar
                    </button>
                    <button
                      onClick={() => setShowDeclineInput(true)}
                      disabled={processingTransfer}
                      className="flex-1 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl font-bold text-sm hover:bg-red-500/20 transition-colors"
                    >
                      ✗ Recusar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowDeclineInput(false)}
                      className="py-2.5 px-4 text-muted-foreground text-sm rounded-xl hover:bg-accent transition-colors"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={handleDeclineTransfer}
                      disabled={processingTransfer}
                      className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      {processingTransfer ? 'Enviando...' : 'Confirmar Recusa'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Sent Banner */}
      {transferSentMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-card border border-sky-500/30 rounded-2xl px-5 py-3 shadow-2xl text-sm font-medium flex items-center gap-3">
          {transferSentMsg}
          <button onClick={() => setTransferSentMsg(null)} className="text-muted-foreground hover:text-foreground ml-2"><X size={14} /></button>
        </div>
      )}

      {/* Transfer Response Banner (for sender) */}
      {transferResponseMsg && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] bg-card border border-border rounded-2xl px-5 py-3 shadow-2xl text-sm font-medium flex items-center gap-3">
          {transferResponseMsg}
          <button onClick={() => setTransferResponseMsg(null)} className="text-muted-foreground hover:text-foreground ml-2">
            <X size={14} />
          </button>
        </div>
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
    </div>
  );
}
