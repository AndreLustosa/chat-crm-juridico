'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Send, Download, Mic, FileText, Bot, BotOff, Paperclip, X, CheckCheck, Check, Eye, XCircle, Trash2, Reply, UserCheck, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { AudioRecorder } from '@/components/AudioRecorder';
import { EmojiPickerButton } from '@/components/EmojiPickerButton';
import { SophIAButton } from '@/components/SophIAButton';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';

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

function StatusIcon({ status, isOut }: { status: string; isOut: boolean }) {
  if (!isOut) return null;
  if (status === 'lido') return <CheckCheck size={12} className="text-blue-400" />;
  if (status === 'entregue') return <CheckCheck size={12} className="text-primary-foreground/60" />;
  return <Check size={12} className="text-primary-foreground/60" />;
}

function playNotificationSound() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.start(t); osc.stop(t + 0.15);
    });
  } catch { /* audio not supported */ }
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
  const [uploadingFile, setUploadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [transferModal, setTransferModal] = useState(false);
  const [transferGroups, setTransferGroups] = useState<{ inboxId: string; inboxName: string; users: { id: string; name: string }[] }[]>([]);
  const [transferring, setTransferring] = useState(false);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [selectedTransferUserId, setSelectedTransferUserId] = useState<string | null>(null);
  const [transferReason, setTransferReason] = useState('');
  // Incoming transfer popup (for receiving operator)
  const [incomingTransfer, setIncomingTransfer] = useState<{
    conversationId: string; fromUserName: string; contactName: string; reason: string | null;
  } | null>(null);
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [processingTransfer, setProcessingTransfer] = useState(false);
  // Response notification (for sender)
  const [transferResponseMsg, setTransferResponseMsg] = useState<string | null>(null);
  // Sent confirmation banner
  const [transferSentMsg, setTransferSentMsg] = useState<string | null>(null);
  // Pending transfers waiting for current user to accept/decline
  const [pendingTransfers, setPendingTransfers] = useState<{ conversationId: string; contactName: string; fromUserName: string; reason: string | null }[]>([]);
  const [inboxOpen, setInboxOpen] = useState(true);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const selectedInboxIdRef = useRef<string | null>(selectedInboxId);
  const selectedIdRef = useRef<string | null>(selectedId);

  // Keep refs in sync
  useEffect(() => { selectedInboxIdRef.current = selectedInboxId; }, [selectedInboxId]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Sync aiMode when conversation changes
  useEffect(() => {
    const conv = conversations.find(c => c.id === selectedId);
    if (conv) setAiMode(!!conv.aiMode);
  }, [selectedId, conversations]);

  const fetchConversations = useCallback(async (inboxId?: string | null) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) { router.push('/atendimento/login'); return; }
      const res = await api.get('/conversations', {
        params: { inboxId: inboxId || undefined }
      });
      const data = res.data;
      setConversations(data || []);
    } catch (e: any) {
      if (e.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/atendimento/login');
        return;
      }
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  const fetchInboxes = async () => {
    try {
      const res = await api.get('/inboxes');
      setUserInboxes(res.data);
    } catch (error) {
      console.error('Failed to fetch inboxes', error);
    }
  };

  const fetchPendingTransfers = useCallback(async () => {
    try {
      const res = await api.get('/conversations/pending-transfers');
      setPendingTransfers(res.data || []);
    } catch (e) {
      console.error('Failed to fetch pending transfers', e);
    }
  }, []);

  // WebSocket connection (once, does not reconnect on filter changes)
  useEffect(() => {
    const wsUrl = getWsUrl();
    console.log('[SOCKET] Connecting to:', wsUrl);
    const socket = io(wsUrl, {
      path: '/api/socket.io/',
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
      fetchConversations(selectedInboxIdRef.current);
    });

    // Transfer request: incoming popup + sound for target operator
    socket.on('transfer_request', (data: { conversationId: string; fromUserName: string; contactName: string; reason: string | null }) => {
      playNotificationSound();
      setIncomingTransfer(data);
      setShowDeclineInput(false);
      setDeclineReason('');
      fetchPendingTransfers();
    });

    // Transfer response: notification for the sender
    socket.on('transfer_response', (data: { accepted: boolean; userName?: string; reason?: string; contactName: string }) => {
      if (data.accepted) {
        setTransferResponseMsg(`✅ ${data.userName} aceitou a transferência de "${data.contactName}"`);
      } else {
        setTransferResponseMsg(`❌ Transferência de "${data.contactName}" recusada${data.reason ? ': ' + data.reason : '.'}`);
      }
      fetchConversations(selectedInboxIdRef.current);
      setTimeout(() => setTransferResponseMsg(null), 6000);
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
  }, [fetchConversations, fetchPendingTransfers, selectedInboxId]);

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
            setMessages(prev => {
              if (prev.find(m => m.id === msg.id || (m.external_message_id && m.external_message_id === msg.external_message_id))) return prev;
              return [...prev, msg];
            });
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

  const handleOpenTransferModal = async () => {
    if (!selectedId || selectedId.startsWith('demo-')) return;
    setTransferError(null);
    setSelectedTransferUserId(null);
    setTransferReason('');
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
      });
      const destUser = transferGroups.flatMap(g => g.users).find(u => u.id === selectedTransferUserId);
      setTransferSentMsg(`📨 Solicitação enviada para ${destUser?.name || 'operador'}. Aguardando resposta...`);
      setTimeout(() => setTransferSentMsg(null), 6000);
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

  const handleAcceptTransfer = async () => {
    if (!incomingTransfer) return;
    setProcessingTransfer(true);
    try {
      await api.patch(`/conversations/${incomingTransfer.conversationId}/transfer-accept`);
      setIncomingTransfer(null);
      fetchPendingTransfers();
      fetchConversations(selectedInboxIdRef.current);
    } catch (e) {
      console.error('Failed to accept transfer', e);
    } finally {
      setProcessingTransfer(false);
    }
  };

  const handleDeclineTransfer = async () => {
    if (!incomingTransfer) return;
    setProcessingTransfer(true);
    try {
      await api.patch(`/conversations/${incomingTransfer.conversationId}/transfer-decline`, { reason: declineReason.trim() || undefined });
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
      fetchPendingTransfers();
      fetchConversations(selectedInboxIdRef.current);
    } catch (e) {
      console.error('Failed to quick accept transfer', e);
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
    } else if (leadFilter) {
      result = conversations.filter(c => c.status === leadFilter);
    } else {
      result = conversations;
    }
    return result.sort((a, b) => (a.contactName || '').localeCompare(b.contactName || ''));
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

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name?: string) => (name || 'V')[0].toUpperCase();

  const statusBadge = (status: string) => {
    const map: Record<string, { class: string; label: string }> = {
      BOT: { class: 'bg-slate-500/15 text-slate-400 border border-slate-500/20', label: '🤖 SophIA' },
      MONITORING: { class: 'bg-purple-500/15 text-purple-400 border border-purple-500/20', label: '👁 Monitorando' },
      WAITING: { class: 'bg-amber-500/15 text-amber-500 border border-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.15)]', label: '⏳ Aguardando' },
      ACTIVE: { class: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20', label: '🟢 Ativo' },
      CLOSED: { class: 'bg-gray-500/15 text-gray-400 border border-gray-500/20', label: '⬛ Fechado' },
    };
    const badge = map[status] || map.CLOSED;
    return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.class}`}>{badge.label}</span>;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans antialiased text-foreground">

      {/* INBOX */}
      <section className={`flex flex-col bg-card border-r border-border shrink-0 z-40 transition-all duration-300 ${inboxOpen ? 'w-[380px]' : 'w-0 overflow-hidden'}`}>
        <div className="p-5 border-b border-border space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Inbox</h2>
            <button
              onClick={() => setInboxOpen(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title="Fechar painel"
            >
              <PanelLeftClose size={18} />
            </button>
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
              { value: '', label: 'Tudo', count: conversations.length },
              { value: 'BOT', label: 'SophIA', count: conversations.filter(c => c.status === 'BOT').length },
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

        <div className="flex-1 overflow-y-auto w-full custom-scrollbar">
          {loading ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Carregando conversas...</div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Nenhuma conversa encontrada.</div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`flex gap-4 p-4 border-b border-border/50 cursor-pointer transition-colors relative
                  ${selectedId === conv.id ? 'bg-accent/50' : 'hover:bg-accent/30'}
                `}
              >
                {selectedId === conv.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                <div className="w-11 h-11 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                  {conv.profile_picture_url ? (
                    <img src={conv.profile_picture_url} alt={conv.contactName} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-foreground font-bold text-lg">{getInitial(conv.contactName)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-foreground truncate pl-0.5">{conv.contactName || 'Visitante'}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatTime(conv.lastMessageAt)}</span>
                  </div>
                  <div className="mb-1.5 flex items-center gap-2 flex-wrap">
                    {statusBadge(conv.status)}
                    {conv.assignedAgentName && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" />
                        {conv.assignedAgentName}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* INBOX OPEN BUTTON (when collapsed) */}
      {!inboxOpen && (
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
        className="flex-1 flex flex-col bg-background relative"
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
            <header className="h-[80px] px-8 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shadow-sm">
                   {selected.profile_picture_url ? (
                     <img src={selected.profile_picture_url} alt={selected.contactName} className="w-full h-full object-cover" loading="lazy" />
                   ) : (
                     <span className="text-foreground font-bold text-xl">{getInitial(selected.contactName)}</span>
                   )}
                 </div>
                 <div>
                   <h3 className="font-bold text-lg leading-tight">{selected.contactName}</h3>
                   <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">
                     {selected.channel} <span className="mx-1">•</span> {selected.contactPhone}
                   </div>
                 </div>
               </div>
               <div className="flex gap-2 items-center">
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
            </header>

            <div className="flex-1 p-8 overflow-y-auto custom-scrollbar" ref={scrollRef}>
              <div className="flex flex-col gap-4 max-w-4xl mx-auto pb-4">
                {isRealConvo && messages.length > 0 ? (
                  messages.map((msg) => {
                    const isOut = msg.direction === 'out';
                    return (
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
                        <div className={`max-w-[80%] p-4 shadow-sm ${
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
                            isEmojiOnly(msg.text || '') ? (
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
                      </div>
                    );
                  })
                ) : isRealConvo && messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-20">Nenhuma mensagem nesta conversa.</div>
                ) : (
                  <>
                    <div className="w-full flex justify-end">
                      <div className="max-w-[80%] bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground p-4 rounded-2xl rounded-tr-sm shadow-sm relative">
                        <p className="text-[15px] leading-relaxed">Trabalhei 3 anos e 4 meses. Não recebi nada ainda.</p>
                        <span className="text-[10px] text-primary-foreground/70 absolute bottom-1.5 right-3">14:00</span>
                      </div>
                    </div>
                    <div className="w-full flex justify-start">
                      <div className="max-w-[80%] bg-card border border-border p-4 rounded-2xl rounded-tl-sm shadow-sm mt-4">
                        <div className="flex items-center gap-2 mb-2 opacity-80">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">André Lustosa</span>
                        </div>
                        <p className="text-[15px] leading-relaxed font-normal">Certo. Com esse tempo você tem direitos significativos. Vamos agendar uma consulta para analisar toda a documentação?</p>
                        <span className="text-[10px] opacity-60 mt-1 block">14:01</span>
                      </div>
                    </div>
                    <div className="w-full flex justify-end">
                      <div className="max-w-[80%] bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground p-4 rounded-2xl rounded-tr-sm shadow-sm mt-4">
                        <p className="text-[15px] leading-relaxed font-medium">{selected.lastMessage}</p>
                        <span className="text-[10px] text-primary-foreground/60 mt-1 flex justify-end">14:02</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <footer className="px-6 pt-3 pb-6 bg-background shrink-0">
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
                <div className="max-w-4xl mx-auto flex gap-3 items-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isRealConvo || uploadingFile}
                    title="Enviar arquivo"
                    className="p-3 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {uploadingFile ? (
                      <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Paperclip size={20} />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <div className="relative flex-1">
                    <input
                      ref={inputRef}
                      type="text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder={isRealConvo ? "Digite sua mensagem..." : "Selecione uma conversa real para enviar..."}
                      disabled={!isRealConvo || sending}
                      className="w-full bg-card border border-border rounded-xl pl-5 pr-24 py-4 focus:outline-none focus:ring-2 focus:ring-primary shadow-sm text-foreground disabled:opacity-50"
                    />
                    {isRealConvo && (
                      <div className="absolute inset-y-0 right-3 flex items-center gap-1">
                        <EmojiPickerButton onEmojiSelect={handleEmojiSelect} compact />
                        <SophIAButton text={text} onResult={handleSophIAResult} compact />
                      </div>
                    )}
                  </div>
                  {isRealConvo && !text.trim() && (
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
                  <button
                    onClick={handleSend}
                    disabled={!isRealConvo || !text.trim() || sending}
                    className="bg-gradient-to-r from-primary to-ring p-4 rounded-xl shadow-lg disabled:opacity-50 hover:-translate-y-1 transition-transform"
                  >
                    <Send size={20} className="text-primary-foreground" />
                  </button>
                </div>
              )}
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-20 h-20 bg-accent rounded-full flex items-center justify-center mb-6 border border-border">
              <MessageSquare size={32} className="text-muted-foreground opacity-50" />
            </div>
            <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-ring mb-2">LexCRM Inbox</h3>
            <p className="text-muted-foreground font-medium">Selecione uma conversa na lista lateral para iniciar.</p>
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
            className="bg-card border border-border rounded-2xl p-6 w-80 shadow-2xl max-h-[80vh] flex flex-col"
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
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1 shrink-0">Selecione o operador</p>
                <div className="flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                  {transferGroups.filter(g => g.users.length > 0).map(group => (
                    <div key={group.inboxId}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 px-1">{group.inboxName}</p>
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
                    </div>
                  ))}
                </div>
                <div className="mt-3 shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 px-1">Motivo (obrigatório)</p>
                  <textarea
                    value={transferReason}
                    onChange={e => setTransferReason(e.target.value)}
                    placeholder="Explique o motivo da transferência..."
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm resize-none outline-none focus:border-sky-500/50"
                    rows={2}
                  />
                </div>
                <button
                  onClick={handleTransfer}
                  disabled={transferring || !selectedTransferUserId || !transferReason.trim()}
                  className="mt-3 shrink-0 w-full py-2.5 bg-sky-500 text-white rounded-xl font-bold text-sm hover:bg-sky-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {transferring ? 'Enviando...' : 'Solicitar Transferência'}
                </button>
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

      {/* Incoming Transfer Popup */}
      {incomingTransfer && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-card border-2 border-amber-500/40 rounded-2xl p-6 w-96 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">📨</span>
              <div>
                <h3 className="font-bold text-base">Pedido de Transferência</h3>
                <p className="text-xs text-muted-foreground">De: <strong className="text-foreground">{incomingTransfer.fromUserName}</strong></p>
              </div>
            </div>
            <div className="bg-muted/50 rounded-xl p-4 mb-4 space-y-2 text-sm">
              <p><span className="text-muted-foreground">Contato:</span> <strong>{incomingTransfer.contactName}</strong></p>
              {incomingTransfer.reason && (
                <p><span className="text-muted-foreground">Motivo:</span> {incomingTransfer.reason}</p>
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
    </div>
  );
}
