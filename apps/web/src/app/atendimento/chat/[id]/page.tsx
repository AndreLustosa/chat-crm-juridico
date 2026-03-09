'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Bot, BotOff, Download, Mic, FileText, Paperclip, X, CheckCheck, Check, Eye, XCircle, Trash2, Reply, Pencil, UserCheck, ChevronDown, CornerUpLeft, ClipboardList } from 'lucide-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { AudioRecorder } from '@/components/AudioRecorder';
import { EmojiPickerButton } from '@/components/EmojiPickerButton';
import { SophIAButton } from '@/components/SophIAButton';
import { LinkPreview } from '@/components/LinkPreview';
import FichaTrabalhista from '@/components/FichaTrabalhista';
import { playNotificationSound } from '@/lib/notificationSounds';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import { formatPhone } from '@/lib/utils';

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

function StatusIcon({ status, isOut }: { status: string; isOut: boolean }) {
  if (!isOut) return null;
  if (status === 'lido') return <CheckCheck size={12} className="text-blue-400" />;
  if (status === 'entregue') return <CheckCheck size={12} className="text-primary-foreground/60" />;
  return <Check size={12} className="text-primary-foreground/60" />;
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
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Tipo declarado fora do componente para evitar problemas com Turbopack
type ChatRenderItem =
  | { kind: 'sep'; label: string; key: string }
  | { kind: 'msg'; msg: any; idx: number };

export default function ChatPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [lead, setLead] = useState<any>(null);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [convoStatus, setConvoStatus] = useState<string>('ABERTO');
  const [aiMode, setAiMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [docPreview, setDocPreview] = useState<{ url: string; name: string; mime: string } | null>(null);
  const [transcribing, setTranscribing] = useState<Record<string, boolean>>({});
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null);
  const [legalArea, setLegalArea] = useState<string | null>(null);
  const [fichaVisible, setFichaVisible] = useState(false);
  const [assignedLawyer, setAssignedLawyer] = useState<{ id: string; name: string } | null>(null);
  const [allSpecialists, setAllSpecialists] = useState<{ id: string; name: string; specialties: string[] }[]>([]);
  const [showLawyerDropdown, setShowLawyerDropdown] = useState(false);
  const [originAssignedUserId, setOriginAssignedUserId] = useState<string | null>(null);
  // Contact presence (online/composing/unavailable) — ephemeral, from WhatsApp
  const [contactPresence, setContactPresence] = useState<string>('unavailable');

  // Decode current user ID once from JWT (never changes during session)
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
  const lastPresenceSentRef = useRef(0);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

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

  const isEmojiOnly = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
    return /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(t);
  };

  const extractFirstUrl = (text: string): string | null => {
    const match = text.match(/https?:\/\/[^\s]+/);
    return match ? match[0] : null;
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

  // ── Actions ───────────────────────────────────────────────────────────────

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

  const handleToggleAiMode = async () => {
    if (!convoId) return;
    const newMode = !aiMode;
    try {
      await api.patch(`/conversations/${convoId}/ai-mode`, { ai_mode: newMode });
      setAiMode(newMode);
    } catch (e) {
      console.error('Erro ao alterar modo IA', e);
    }
  };

  const handleCloseConvo = async () => {
    if (!convoId || convoStatus === 'FECHADO') return;
    if (!confirm('Fechar esta conversa?')) return;
    try {
      await api.patch(`/conversations/${convoId}/close`);
      setConvoStatus('FECHADO');
    } catch (e) {
      console.error('Erro ao fechar conversa', e);
    }
  };

  const uploadFile = async (file: File) => {
    if (!convoId) return;
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('conversationId', convoId);
      const res = await api.post('/messages/send-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.id) {
        setMessages(prev => {
          if (prev.some((m: any) => m.id === res.data.id)) return prev;
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
    if (!convoId || isClosed) return;
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
    if (!convoId || isClosed) return;
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!confirm('Apagar esta mensagem para todos?')) return;
    try {
      const res = await api.delete(`/messages/${msgId}`);
      setMessages(prev => prev.map((m: any) => m.id === msgId ? { ...m, ...res.data } : m));
    } catch (e) {
      console.error('Erro ao apagar mensagem', e);
    }
  };

  const handleEditMessage = async (msgId: string, newText: string) => {
    if (!newText.trim()) return;
    try {
      const res = await api.patch(`/messages/${msgId}`, { text: newText.trim() });
      setMessages(prev => prev.map((m: any) => m.id === msgId ? { ...m, ...res.data } : m));
      setEditingMsg(null);
    } catch (e) {
      console.error('Erro ao editar mensagem', e);
    }
  };

  const handleSophIAResult = (result: string) => {
    setText(result);
    requestAnimationFrame(() => inputRef.current?.focus());
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

  const handleTypingPresence = () => {
    if (!convoId) return;
    const now = Date.now();
    if (now - lastPresenceSentRef.current < 3000) return; // debounce 3s
    lastPresenceSentRef.current = now;
    api.post(`/conversations/${convoId}/presence`, { presence: 'composing' }).catch(() => {});
    // Auto-pause after 5s without typing
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      api.post(`/conversations/${convoId}/presence`, { presence: 'paused' }).catch(() => {});
    }, 5000);
  };

  const handleReact = async (msgId: string, emoji: string) => {
    try {
      const res = await api.post(`/messages/${msgId}/react`, { emoji });
      setMessages(prev => prev.map((m: any) => m.id === msgId ? { ...m, reactions: res.data.reactions } : m));
    } catch (e) {
      console.error('Erro ao reagir', e);
    }
  };

  const handleReturnToOrigin = async () => {
    if (!convoId) return;
    if (!confirm('Devolver esta conversa ao atendente comercial de origem?')) return;
    try {
      await api.patch(`/conversations/${convoId}/return-to-origin`);
      router.push('/');
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Erro ao devolver conversa.');
    }
  };

  const handleAssignLawyer = async (lawyerId: string | null) => {
    if (!convoId) return;
    try {
      await api.patch(`/conversations/${convoId}/assign-lawyer`, { lawyerId });
      const lawyer = lawyerId ? (allSpecialists.find((u) => u.id === lawyerId) || null) : null;
      setAssignedLawyer(lawyer ? { id: lawyer.id, name: lawyer.name } : null);
    } catch (e) {
      console.error('Erro ao atribuir especialista', e);
    } finally {
      setShowLawyerDropdown(false);
    }
  };

  const handleSendFormLink = async () => {
    if (!lead?.id || !convoId || sending) return;
    setSending(true);
    try {
      const baseUrl = window.location.origin;
      const formUrl = `${baseUrl}/formulario/trabalhista/${lead.id}`;
      const formText = `Olá! Para agilizar o seu atendimento, por favor preencha a ficha abaixo com as informações do seu caso trabalhista:\n\n${formUrl}\n\nSe tiver dúvidas durante o preenchimento, é só me chamar aqui!`;
      const res = await api.post('/messages/send', { conversationId: convoId, text: formText });
      if (res.data?.id) {
        setMessages(prev => {
          if (prev.some((m: any) => m.id === res.data.id)) return prev;
          return [...prev, res.data];
        });
      }
    } catch (err) {
      console.error('Erro ao enviar formulário:', err);
    } finally {
      setSending(false);
    }
  };

  // ── Foco robusto no textarea (padrão Slack / WhatsApp Web) ──────────────

  // Callback ref: armazena referência quando React anexa ao DOM
  const attachInputRef = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
    if (node) node.focus();
  }, []);

  // Clicar na área de mensagens foca o textarea
  const handleChatAreaClick = useCallback((e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO'].includes(tag)) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea')) return;
    inputRef.current?.focus();
  }, []);

  // ── Global keyboard redirect ──────────────────────────────────────────
  // Intercepta teclas digitadas em qualquer lugar da página e redireciona
  // para o textarea. Mesmo padrão usado pelo Slack, Discord e WhatsApp Web.
  // Isso garante que o usuário pode abrir uma conversa e simplesmente começar
  // a digitar, sem precisar clicar no campo de texto.
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const node = inputRef.current;
      if (!node) return;
      // Se a conversa está fechada, não intercepta
      if (convoStatus === 'FECHADO') return;
      // Se já está no textarea principal, não faz nada
      if (document.activeElement === node) return;
      // Não intercepta se o foco está em outro campo de input (busca, edição, etc.)
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (active.isContentEditable) return;
      }
      // Não intercepta teclas de atalho (Ctrl+C, Cmd+V, Alt+Tab, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Não intercepta teclas especiais (F1-F12, Escape, Tab, Arrow, etc.)
      if (e.key.length > 1 && !['Backspace', 'Delete'].includes(e.key)) return;
      // Foca o textarea — a tecla será processada naturalmente pelo browser
      node.focus();
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [convoStatus]);

  const handleSend = async () => {
    if (!text.trim() || !convoId || sending) return;
    const msgText = text;
    const replyId = replyingTo?.id;
    setSending(true);
    setText('');
    setReplyingTo(null);
    // Reset textarea height after clearing
    if (inputRef.current) { inputRef.current.style.height = '56px'; }
    // Foco síncrono — dentro da call-stack do gesto do usuário (Enter / click)
    inputRef.current?.focus();
    try {
      const res = await api.post('/messages/send', {
        conversationId: convoId,
        text: msgText,
        ...(replyId ? { replyToId: replyId } : {}),
      });
      if (res.data?.id) {
        setMessages(prev => {
          if (prev.some((m: any) => m.id === res.data.id)) return prev;
          return [...prev, res.data];
        });
      }
    } catch (e) {
      console.error('Falha ao enviar mensagem', e);
      setText(msgText);
    } finally {
      setSending(false);
      // Foco após re-render completo
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  // ── Socket + data fetch ───────────────────────────────────────────────────

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }

    const wsUrl = getWsUrl();

    const fetchData = async () => {
      try {
        const convoRes = await api.get(`/conversations/lead/${params.id}`);
        if (convoRes.data && convoRes.data.length > 0) {
          const convo = convoRes.data[0];
          setLead(convo.lead);
          setConvoId(convo.id);
          setConvoStatus(convo.status || 'ABERTO');
          setAiMode(!!convo.ai_mode);
          setMessages(convo.messages || []);
          setLegalArea(convo.legal_area || null);
          setAssignedLawyer(convo.assigned_lawyer || null);
          setOriginAssignedUserId(convo.origin_assigned_user_id || null);

          // Carregar lista de especialistas para o dropdown (agents = sem restrição de role)
          api.get('/users/agents').then((r) => {
            setAllSpecialists(
              (r.data as any[]).filter((u) => u.specialties?.length > 0),
            );
          }).catch(() => {});

          // Mark as read on open (sends blue ticks to contact)
          api.post(`/conversations/${convo.id}/mark-read`).catch(() => {});

          // Sync WhatsApp history on open (background, non-blocking)
          api.post(`/messages/conversation/${convo.id}/sync-history`)
            .then(async (syncRes) => {
              if (syncRes.data?.imported > 0) {
                const msgRes = await api.get(`/messages/conversation/${convo.id}`);
                setMessages(msgRes.data || []);
              }
            })
            .catch(() => { /* silently ignore sync errors */ });

          socketRef.current = io(wsUrl, {
            path: getSocketPath(),
            transports: ['polling', 'websocket'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            timeout: 10000,
            auth: { token: localStorage.getItem('token') || '' },
          });

          socketRef.current.on('connect', () => {
            socketRef.current?.emit('join_conversation', convo.id);
            // Join personal user room so incoming_message_notification reaches this page too
            if (currentUserId) socketRef.current?.emit('join_user', currentUserId);
          });

          // Sound: only plays when the backend targets this specific operator
          socketRef.current.on('incoming_message_notification', () => {
            playNotificationSound();
          });

          socketRef.current.on('newMessage', (msg: any) => {
            setMessages(prev => {
              const exists = prev.some((m: any) => m.id === msg.id || (m.external_message_id && m.external_message_id === msg.external_message_id));
              if (exists) return prev;
              return [...prev, msg];
            });
            if (msg.direction === 'in') {
              playNotificationSound();
              // Auto mark-read since operator is viewing the chat
              api.post(`/conversations/${convo.id}/mark-read`).catch(() => {});
            }
          });

          socketRef.current.on('messageUpdate', (updatedMsg: any) => {
            setMessages(prev => prev.map((m: any) => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
          });

          socketRef.current.on('mediaReady', (updatedMsg: any) => {
            setMessages(prev => prev.map((m: any) => m.id === updatedMsg.id ? updatedMsg : m));
          });

          socketRef.current.on('messageReaction', (data: { messageId: string; reactions: any[] }) => {
            setMessages(prev => prev.map((m: any) => m.id === data.messageId ? { ...m, reactions: data.reactions } : m));
          });

          socketRef.current.on('contact_presence', (data: { presence: string }) => {
            setContactPresence(data.presence);
          });
        }
      } catch (e: any) {
        // 401 handled globally by api.ts interceptor
        console.error('Erro ao inicializar chat:', e);
      }
    };

    fetchData();
    return () => {
      const s = socketRef.current;
      if (s) {
        s.off('connect');
        s.off('incoming_message_notification');
        s.off('newMessage');
        s.off('messageUpdate');
        s.off('mediaReady');
        s.off('messageReaction');
        s.off('contact_presence');
        s.disconnect();
      }
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, [params.id, router]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Render ────────────────────────────────────────────────────────────────

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name?: string) => (name || 'V')[0].toUpperCase();
  const isClosed = convoStatus === 'FECHADO';

  // Lista plana: separa mensagens e separadores de data (type declarado fora do componente)
  const renderItems = useMemo<ChatRenderItem[]>(() => {
    const items: ChatRenderItem[] = [];
    let lastDateKey = '';
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const dateKey = msg.created_at ? getDateKey(msg.created_at) : `__nodate__${i}`;
      if (dateKey !== lastDateKey) {
        items.push({
          kind: 'sep',
          label: msg.created_at ? formatDateLabel(msg.created_at) : '(sem data)',
          key: `sep-${dateKey}-${i}`,
        });
        lastDateKey = dateKey;
      }
      items.push({ kind: 'msg', msg, idx: i });
    }
    // DEBUG — verificar no console do navegador (F12)
    console.log('[Chat] renderItems:', items.length, 'itens,', items.filter(x => x.kind === 'sep').length, 'separadores');
    console.log('[Chat] primeiro msg created_at:', messages[0]?.created_at ?? 'UNDEFINED');
    return items;
  }, [messages]);

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans antialiased text-foreground">
      <div
        className="flex-1 flex flex-col relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && !isClosed && (
          <div className="absolute inset-0 z-40 m-3 rounded-2xl border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <Paperclip size={48} className="text-primary mx-auto mb-3 opacity-80" />
              <p className="text-primary font-bold text-lg">Solte o arquivo aqui</p>
              <p className="text-primary/60 text-sm mt-1">imagem, vídeo ou documento</p>
            </div>
          </div>
        )}
        {/* Header */}
        <header className="min-h-[80px] px-8 py-4 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/')} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={22} />
            </button>
            <div className="w-12 h-12 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] text-white flex items-center justify-center font-bold text-xl shadow-sm">
              {getInitial(lead?.name || lead?.phone)}
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">{lead?.name || formatPhone(lead?.phone) || 'Carregando...'}</h3>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">
                WHATSAPP <span className="mx-1">•</span> {formatPhone(lead?.phone) || ''}
                {isClosed && <span className="ml-2 text-red-400">• FECHADA</span>}
              </div>
              {contactPresence && contactPresence !== 'unavailable' && (
                <span className="text-[10px] font-medium text-emerald-400">
                  {contactPresence === 'composing' ? 'digitando...' : 'online'}
                </span>
              )}
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                  {legalArea && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 text-[10px] font-bold border border-violet-500/20">
                      ⚖️ {legalArea}
                    </span>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => setShowLawyerDropdown(v => !v)}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                        assignedLawyer
                          ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
                          : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                      }`}
                      title={assignedLawyer ? 'Especialista pré-atribuído — clique para trocar' : 'Atribuir especialista'}
                    >
                      <UserCheck size={10} />
                      {assignedLawyer ? assignedLawyer.name : 'Atribuir especialista'}
                    </button>
                    {showLawyerDropdown && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowLawyerDropdown(false)} />
                        <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-xl shadow-xl w-56 py-1 text-[12px]">
                          <p className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Trocar especialista</p>
                          {allSpecialists.length === 0 ? (
                            <p className="px-3 py-2 text-muted-foreground text-[11px] italic">Nenhum especialista cadastrado</p>
                          ) : (
                            allSpecialists.map(u => (
                              <button
                                key={u.id}
                                onClick={() => handleAssignLawyer(u.id)}
                                className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 ${u.id === assignedLawyer?.id ? 'text-primary font-semibold' : 'text-foreground'}`}
                              >
                                <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                                  {u.name.charAt(0)}
                                </span>
                                <div className="min-w-0">
                                  <p className="leading-tight truncate">{u.name}</p>
                                  <p className="text-[9px] text-muted-foreground truncate">{u.specialties.join(', ')}</p>
                                </div>
                              </button>
                            ))
                          )}
                          {assignedLawyer && (
                            <button
                              onClick={() => handleAssignLawyer(null)}
                              className="w-full text-left px-3 py-2 text-muted-foreground hover:bg-accent hover:text-destructive transition-colors text-[11px] border-t border-border mt-1 pt-2"
                            >
                              Remover especialista
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {legalArea?.toLowerCase().includes('trabalhist') && (
              <>
                {!isClosed && (
                  <button
                    onClick={handleSendFormLink}
                    disabled={sending}
                    title="Enviar link do formulário trabalhista ao lead"
                    className="px-3 py-2 text-sm font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <ClipboardList size={16} />
                    Enviar Formulário
                  </button>
                )}
                <button
                  onClick={() => setFichaVisible(true)}
                  title="Visualizar ficha trabalhista"
                  className="px-3 py-2 text-sm font-semibold text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-xl hover:bg-violet-500/20 transition-colors flex items-center gap-2"
                >
                  <Eye size={16} />
                  Visualizar Ficha
                </button>
              </>
            )}
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
            {originAssignedUserId && !isClosed && (
              <button
                onClick={handleReturnToOrigin}
                title="Devolver ao atendente comercial de origem"
                className="px-3 py-2 text-sm font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 transition-colors flex items-center gap-2"
              >
                <CornerUpLeft size={16} />
                Devolver
              </button>
            )}
            {!isClosed && (
              <button
                onClick={handleCloseConvo}
                title="Fechar conversa"
                className="px-3 py-2 text-sm font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl hover:bg-red-500/20 transition-colors flex items-center gap-2"
              >
                <XCircle size={16} />
                Fechar
              </button>
            )}
          </div>
        </header>

        {/* Messages — click em área vazia foca o textarea (UX WhatsApp Web) */}
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar" ref={scrollRef} onClick={handleChatAreaClick}>
          <div className="flex flex-col gap-4 max-w-4xl mx-auto pb-4">
            {renderItems.length === 0 ? (
              <div className="text-center text-muted-foreground py-20">Nenhuma mensagem nesta conversa.</div>
            ) : renderItems.map((item) => {
                if (item.kind === 'sep') {
                  return (
                    <div key={item.key} className="flex items-center gap-3 my-3 select-none">
                      <div className="flex-1 h-px bg-muted-foreground/30" />
                      <span className="text-[11px] font-bold text-foreground/70 px-3 py-1 rounded-full border border-muted-foreground/20 bg-muted capitalize whitespace-nowrap">
                        {item.label}
                      </span>
                      <div className="flex-1 h-px bg-muted-foreground/30" />
                    </div>
                  );
                }
                const { msg, idx } = item;
                const isOut = msg.direction === 'out';
                return (
                  <div key={msg.id || idx} id={`msg-${msg.id}`} className={`w-full flex items-end gap-1 ${isOut ? 'justify-end' : 'justify-start'} group rounded-xl transition-all duration-300`}>
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
                        {msg.type !== 'deleted' && (
                          <div className="relative group/react">
                            <button className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary text-[11px]" title="Reagir">😊</button>
                            <div className="absolute bottom-full left-0 mb-1 hidden group-hover/react:flex bg-card border border-border rounded-full shadow-lg px-1 py-0.5 gap-0.5 z-10">
                              {['👍','❤️','😂','😮','😢','🙏'].map(e => (
                                <button key={e} onClick={() => handleReact(msg.id, e)} className="p-1 hover:bg-muted rounded-full text-sm transition-transform hover:scale-125">{e}</button>
                              ))}
                            </div>
                          </div>
                        )}
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
                      {/* Deleted by contact banner — content preserved */}
                      {msg.status === 'apagado_pelo_contato' && (
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-red-400/80 italic">
                          <span>🚫</span> Apagada pelo contato
                        </div>
                      )}
                      {msg.type === 'deleted' ? (
                        <p className="text-sm italic opacity-50">🚫 Mensagem apagada</p>
                      ) : msg.type === 'text' || !msg.type ? (
                        editingMsg?.id === msg.id ? (
                          <div className="flex flex-col gap-2 min-w-[200px]">
                            <textarea
                              autoFocus
                              className="w-full bg-white/10 text-primary-foreground rounded-lg px-3 py-2 text-[14px] leading-relaxed resize-none border border-white/20 focus:outline-none focus:border-white/50"
                              rows={3}
                              value={editingMsg!.text}
                              onChange={e => setEditingMsg(prev => prev ? { ...prev, text: e.target.value } : null)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMessage(editingMsg!.id, editingMsg!.text); }
                                if (e.key === 'Escape') setEditingMsg(null);
                              }}
                            />
                            <div className="flex justify-end gap-2">
                              <button onClick={() => setEditingMsg(null)} className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-primary-foreground/70">Cancelar</button>
                              <button onClick={() => handleEditMessage(editingMsg!.id, editingMsg!.text)} className="text-[11px] px-2 py-1 rounded bg-white/25 hover:bg-white/35 text-primary-foreground font-medium">Salvar</button>
                            </div>
                          </div>
                        ) : (() => {
                          const t = msg.text || '';
                          const url = extractFirstUrl(t);
                          const isOnlyUrl = url && t.trim() === url;
                          if (isEmojiOnly(t)) {
                            return <p className="text-4xl leading-tight">{t}</p>;
                          }
                          return (
                            <>
                              {!isOnlyUrl && (
                                <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{t}</p>
                              )}
                              {url && <LinkPreview url={url} isOut={isOut} />}
                            </>
                          );
                        })()
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
                          {isOut && (msg.type === 'text' || !msg.type) && !editingMsg && (
                            <button
                              onClick={() => setEditingMsg({ id: msg.id, text: msg.text || '' })}
                              className="p-0.5 rounded hover:bg-white/20 transition-colors"
                              title="Editar mensagem"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          <span>{formatTime(msg.created_at)}</span>
                          <StatusIcon status={msg.status} isOut={isOut} />
                        </div>
                      )}
                      {/* Reactions display */}
                      {msg.reactions && msg.reactions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5 -mb-1">
                          {Object.entries(
                            (msg.reactions as any[]).reduce((acc: Record<string, number>, r: any) => {
                              acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                              return acc;
                            }, {} as Record<string, number>)
                          ).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              onClick={() => handleReact(msg.id, emoji)}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                isOut
                                  ? 'bg-white/10 border-white/20 hover:bg-white/25'
                                  : 'bg-muted/60 border-border hover:bg-muted'
                              }`}
                            >
                              <span>{emoji}</span>
                              {(count as number) > 1 && <span className="text-[10px] font-medium">{count as number}</span>}
                            </button>
                          ))}
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
                        {(msg.type === 'text' || !msg.type) && msg.type !== 'deleted' && (
                          <button
                            onClick={() => setEditingMsg({ id: msg.id, text: msg.text || '' })}
                            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                            title="Editar mensagem"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Apagar mensagem"
                        >
                          <Trash2 size={13} />
                        </button>
                        {msg.type !== 'deleted' && (
                          <div className="relative group/react">
                            <button className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary text-[11px]" title="Reagir">😊</button>
                            <div className="absolute bottom-full right-0 mb-1 hidden group-hover/react:flex bg-card border border-border rounded-full shadow-lg px-1 py-0.5 gap-0.5 z-10">
                              {['👍','❤️','😂','😮','😢','🙏'].map(e => (
                                <button key={e} onClick={() => handleReact(msg.id, e)} className="p-1 hover:bg-muted rounded-full text-sm transition-transform hover:scale-125">{e}</button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
            })}
          </div>
        </div>

        {/* Input */}
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
                disabled={uploadingFile}
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
                <textarea
                  ref={attachInputRef}
                  rows={1}
                  tabIndex={1}
                  autoFocus
                  value={text}
                  onChange={e => {
                    setText(e.target.value);
                    const el = e.target;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                    handleTypingPresence();
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Digite sua mensagem..."
                  className="w-full bg-card border-2 border-primary/40 rounded-xl pl-5 pr-24 py-4 outline-none ring-2 ring-primary/30 focus:border-primary focus:ring-primary/60 shadow-sm text-foreground resize-none overflow-y-auto leading-relaxed"
                  style={{ minHeight: '56px', maxHeight: '160px' }}
                />
                <div className="absolute inset-y-0 right-3 flex items-center gap-1">
                  <EmojiPickerButton onEmojiSelect={handleEmojiSelect} compact />
                  <SophIAButton text={text} onResult={handleSophIAResult} compact />
                </div>
              </div>

              {convoId && !text.trim() && (
                <AudioRecorder
                  conversationId={convoId}
                  onSent={(msg) => {
                    setMessages((prev) => {
                      if (prev.some((m: any) => m.id === msg.id)) return prev;
                      return [...prev, msg];
                    });
                  }}
                  onRecordingStart={() => {
                    if (convoId) api.post(`/conversations/${convoId}/presence`, { presence: 'recording' }).catch(() => {});
                  }}
                />
              )}

              <button
                onClick={handleSend}
                disabled={!text.trim() || sending}
                className="bg-gradient-to-r from-primary to-ring p-4 rounded-xl shadow-lg disabled:opacity-50 hover:-translate-y-1 transition-transform shrink-0"
              >
                <Send size={20} className="text-primary-foreground" />
              </button>
            </div>
          )}
        </footer>
      </div>

      {/* Image Lightbox */}
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
                onClick={() => handleImageDownload(lightbox)}
                className="bg-black/60 hover:bg-black/80 text-white rounded-lg p-2 transition-colors"
                title="Baixar imagem"
              >
                <Download size={16} />
              </button>
              <button
                onClick={() => setLightbox(null)}
                className="bg-black/60 hover:bg-black/80 text-white rounded-lg p-2 transition-colors"
                title="Fechar"
              >
                <X size={16} />
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
                  className="bg-muted hover:bg-muted/80 text-foreground rounded-lg p-2 transition-colors"
                  title="Fechar"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            {docPreview.mime.includes('pdf') ? (
              <iframe src={docPreview.url} className="flex-1 w-full" title={docPreview.name} />
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
      {/* Ficha Trabalhista Slide-over */}
      {fichaVisible && lead?.id && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setFichaVisible(false)}
          />
          <div className="relative w-full max-w-2xl h-full bg-background border-l border-border flex flex-col shadow-2xl overflow-hidden">
            {/* Header do painel */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <ClipboardList size={16} className="text-amber-500" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground text-sm">Ficha Trabalhista</h2>
                  <p className="text-[11px] text-muted-foreground">{lead?.name || lead?.phone}</p>
                </div>
              </div>
              <button
                onClick={() => setFichaVisible(false)}
                className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            {/* Conteúdo da ficha */}
            <div className="flex-1 overflow-y-auto p-4">
              <FichaTrabalhista leadId={lead.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
