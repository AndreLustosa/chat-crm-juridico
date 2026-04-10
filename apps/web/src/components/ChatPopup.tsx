'use client';

/**
 * ChatPopup — Chat completo em popup (90% da tela) para falar com o cliente
 * diretamente do menu de Processos, sem sair da página.
 *
 * Funcionalidades:
 *  • Histórico completo de mensagens com MessageBubble (imagem, áudio, vídeo, doc)
 *  • Separadores de data
 *  • Responder, editar, apagar, reagir com emoji
 *  • Transcrição de áudio
 *  • Lightbox de imagens
 *  • Preview de documentos
 *  • Scroll automático + botão "rolar para baixo"
 *  • Tempo real via Socket.io (newMessage, messageUpdate)
 *  • Link para abrir o chat completo em /atendimento
 *  • Fecha com Esc ou clique no overlay
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  X, Send, MessageSquare, Loader2, AlertCircle,
  ChevronDown, ExternalLink, Reply,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import api from '@/lib/api';
import { MessageBubble } from '@/app/atendimento/components/MessageBubble';
import type { MessageItem } from '@/app/atendimento/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
  if (apiUrl.startsWith('http')) {
    try { return new URL(apiUrl).origin; } catch { /* fall through */ }
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function getSocketPath(): string {
  return process.env.NEXT_PUBLIC_SOCKET_PATH || '/socket.io/';
}

function getDateKey(d: string) { return new Date(d).toDateString(); }

function formatDateLabel(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ChatPopupProps {
  leadId: string;
  leadName: string | null;
  conversationId?: string | null;
  /** Número do processo para exibir no header */
  caseNumber?: string | null;
  onClose: () => void;
}

// ─── Lightbox simples ─────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={onClose}>
        <X size={20} />
      </button>
      <img
        src={url}
        alt="Imagem"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Document preview (iframe ou link) ───────────────────────────────────────

function DocPreview({ preview, onClose }: {
  preview: { url: string; name: string; mime: string };
  onClose: () => void;
}) {
  const isPdf = preview.mime === 'application/pdf' || preview.name.toLowerCase().endsWith('.pdf');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[500] flex flex-col items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[85vh] bg-card rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <p className="text-sm font-medium truncate">{preview.name}</p>
          <div className="flex gap-2">
            <a href={preview.url} download={preview.name} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
              Baixar
            </a>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
        {isPdf ? (
          <iframe src={preview.url} className="flex-1 w-full" title={preview.name} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-3">{preview.name}</p>
              <a href={preview.url} download={preview.name} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                Baixar arquivo
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ChatPopup ────────────────────────────────────────────────────────────────

export function ChatPopup({ leadId, leadName, conversationId: initialConvId, caseNumber, onClose }: ChatPopupProps) {
  const router = useRouter();

  // ── Estado principal ──────────────────────────────────────────────────────
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(initialConvId ?? null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [noConversation, setNoConversation] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Input ─────────────────────────────────────────────────────────────────
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);

  // ── Edição / transcrição ──────────────────────────────────────────────────
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null);
  const [transcribing, setTranscribing] = useState<Record<string, boolean>>({});

  // ── Lightbox / doc preview ────────────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [docPreview, setDocPreview] = useState<{ url: string; name: string; mime: string } | null>(null);

  // ── Scroll ────────────────────────────────────────────────────────────────
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const convIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Resolve conversa ──────────────────────────────────────────────────────
  const resolveConversation = useCallback(async (): Promise<string | null> => {
    if (initialConvId) return initialConvId;
    try {
      const res = await api.get(`/conversations/lead/${leadId}`);
      const convs: any[] = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      const active = convs.find((c) => c.status !== 'ENCERRADO') || convs[0];
      return active?.id ?? null;
    } catch { return null; }
  }, [initialConvId, leadId]);

  // ── Busca mensagens ───────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (convId: string) => {
    try {
      const res = await api.get(`/messages/conversation/${convId}`, {
        params: { page: 1, limit: 150 },
      });
      const msgs: MessageItem[] = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setMessages([...msgs].reverse()); // API retorna DESC → invertemos para ASC
    } catch { setFetchError('Erro ao carregar mensagens'); }
  }, []);

  // ── Init: resolve → mensagens → socket ───────────────────────────────────
  useEffect(() => {
    let socket: Socket | null = null;
    let mounted = true;

    const init = async () => {
      setLoading(true);
      setNoConversation(false);
      setFetchError(null);

      const convId = await resolveConversation();
      if (!mounted) return;

      if (!convId) { setNoConversation(true); setLoading(false); return; }

      setResolvedConvId(convId);
      convIdRef.current = convId;
      await fetchMessages(convId);
      if (!mounted) return;
      setLoading(false);

      // Socket
      socket = io(getWsUrl(), {
        path: getSocketPath(),
        transports: ['polling', 'websocket'],
        auth: { token: localStorage.getItem('token') || '' },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
      });
      socketRef.current = socket;

      socket.on('connect', () => { socket?.emit('join_conversation', convId); });

      socket.on('newMessage', (msg: MessageItem) => {
        if (msg.conversation_id !== convIdRef.current) return;
        const addMsg = () => setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id || (msg.external_message_id && m.external_message_id === msg.external_message_id))) return prev;
          return [...prev, msg];
        });
        // Áudio com mídia pronta: pré-busca o blob para exibir já reproduzível
        if ((msg as any).type === 'audio' && (msg as any).media?.s3_key) {
          import('@/components/AudioPlayer').then(({ preFetchAudio }) => {
            const timeout = setTimeout(addMsg, 8000);
            preFetchAudio(msg.id).finally(() => { clearTimeout(timeout); addMsg(); });
          });
        } else {
          addMsg();
        }
      });

      socket.on('messageUpdate', (updated: MessageItem) => {
        if (updated.conversation_id !== convIdRef.current) return;
        setMessages((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m));
      });

    };

    init();
    return () => {
      mounted = false;
      if (socket) {
        if (convIdRef.current) socket.emit('leave_conversation', convIdRef.current);
        socket.disconnect();
      }
    };
  }, [resolveConversation, fetchMessages]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Detecta scroll ────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
  }, []);

  // ── Fechar com Esc ────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lightboxUrl && !docPreview) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, lightboxUrl, docPreview]);

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // ── Enviar mensagem ───────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!text.trim() || !resolvedConvId || sending) return;
    const msgText = text.trim();
    setText('');
    setReplyTo(null);
    setSending(true);
    try {
      await api.post('/messages/send', {
        conversationId: resolvedConvId,
        text: msgText,
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
    } catch { setText(msgText); }
    finally { setSending(false); textareaRef.current?.focus(); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Editar mensagem ───────────────────────────────────────────────────────
  const handleEdit = async (id: string, newText: string) => {
    try {
      await api.patch(`/messages/${id}`, { text: newText });
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, text: newText } : m));
    } catch { /* silently ignore */ }
    setEditingMsg(null);
  };

  // ── Apagar mensagem ───────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/messages/${id}`);
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, type: 'deleted' } : m));
    } catch { /* silently ignore */ }
  };

  // ── Transcrever áudio ─────────────────────────────────────────────────────
  const handleTranscribe = async (id: string) => {
    setTranscribing((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await api.post(`/messages/${id}/transcribe`);
      const transcribed = res.data?.text || '';
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, text: transcribed } : m));
    } catch { /* silently ignore */ }
    finally { setTranscribing((prev) => ({ ...prev, [id]: false })); }
  };

  // ── Reagir com emoji ──────────────────────────────────────────────────────
  const handleReact = async (id: string, emoji: string) => {
    try { await api.post(`/messages/${id}/react`, { emoji }); } catch { /* silently ignore */ }
  };

  // ── Download helpers ──────────────────────────────────────────────────────
  const handleImageDownload = (url: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = 'imagem'; a.target = '_blank'; a.click();
  };
  const handleDocDownload = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = name; a.target = '_blank'; a.click();
  };

  // ── Abrir chat completo ───────────────────────────────────────────────────
  const openFullChat = () => {
    if (resolvedConvId) {
      sessionStorage.setItem('crm_open_conv', resolvedConvId);
    }
    router.push('/atendimento');
    onClose();
  };

  // ── Separadores de data ───────────────────────────────────────────────────
  const renderMessages = () => {
    const items: React.ReactNode[] = [];
    let lastDateKey = '';

    messages.forEach((msg) => {
      const dateKey = getDateKey(msg.created_at);
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        items.push(
          <div key={`date-${dateKey}`} className="flex items-center gap-3 my-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-muted">
              {formatDateLabel(msg.created_at)}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>,
        );
      }

      items.push(
        <MessageBubble
          key={msg.id}
          msg={msg}
          isOut={msg.direction === 'out'}
          editingMsg={editingMsg}
          transcribing={transcribing}
          onReply={setReplyTo}
          onEdit={handleEdit}
          onSetEditing={setEditingMsg}
          onDelete={handleDelete}
          onTranscribe={handleTranscribe}
          onLightbox={setLightboxUrl}
          onDocPreview={setDocPreview}
          onImageDownload={handleImageDownload}
          onDocDownload={handleDocDownload}
          onReact={handleReact}
          nextStep={null}
        />,
      );
    });

    return items;
  };

  const firstName = (leadName || 'Cliente').split(' ')[0];
  const initial = firstName[0]?.toUpperCase() ?? 'C';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[300] flex items-center justify-center p-[5vw]"
        style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Janela 90% × 90% */}
        <div
          className="relative bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          style={{ width: '90vw', height: '90vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-card shrink-0">
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm shrink-0 border border-primary/20">
              {initial}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-foreground">{leadName || 'Cliente'}</p>
                {caseNumber && (
                  <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {caseNumber}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MessageSquare size={10} />
                {loading ? 'Carregando…' : noConversation ? 'Sem conversa ativa' : 'Chat direto'}
              </p>
            </div>

            {/* Ações do header */}
            <div className="flex items-center gap-1 shrink-0">
              {resolvedConvId && (
                <button
                  onClick={openFullChat}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Abrir chat completo"
                >
                  <ExternalLink size={13} /> Abrir completo
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Fechar (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* ── Área de mensagens ── */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-6 py-4 min-h-0"
          >
            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={26} className="animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Sem conversa */}
            {!loading && noConversation && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                  <MessageSquare size={26} className="text-muted-foreground/50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Nenhuma conversa encontrada</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {firstName} ainda não possui histórico de chat.<br />
                    Inicie o contato pelo WhatsApp.
                  </p>
                </div>
              </div>
            )}

            {/* Erro */}
            {!loading && fetchError && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-destructive flex items-center gap-2">
                  <AlertCircle size={16} /> {fetchError}
                </p>
              </div>
            )}

            {/* Mensagens sem histórico */}
            {!loading && !noConversation && !fetchError && messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda</p>
              </div>
            )}

            {/* Mensagens */}
            {!loading && !noConversation && !fetchError && (
              <div className="flex flex-col gap-1">
                {renderMessages()}
              </div>
            )}

            {/* Âncora de scroll */}
            <div ref={bottomRef} />
          </div>

          {/* Botão scroll para baixo */}
          {showScrollBtn && (
            <button
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="absolute bottom-24 right-6 p-2.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all z-10"
              title="Rolar para baixo"
            >
              <ChevronDown size={16} />
            </button>
          )}

          {/* ── Input ── */}
          {!loading && !noConversation && !fetchError && resolvedConvId && (
            <div className="border-t border-border bg-card shrink-0">
              {/* Reply preview */}
              {replyTo && (
                <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border">
                  <Reply size={13} className="text-primary shrink-0" />
                  <p className="text-xs text-muted-foreground flex-1 truncate">
                    <span className="text-primary font-medium">Respondendo: </span>
                    {replyTo.text || '[mídia]'}
                  </p>
                  <button onClick={() => setReplyTo(null)} className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                    <X size={13} />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2 px-4 py-3">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Mensagem… (Enter para enviar, Shift+Enter para nova linha)"
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 overflow-y-auto transition-colors"
                  style={{ minHeight: '42px', maxHeight: '120px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!text.trim() || sending}
                  title="Enviar (Enter)"
                  className="p-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
                >
                  {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Lightbox de imagens ── */}
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      {/* ── Preview de documento ── */}
      {docPreview && <DocPreview preview={docPreview} onClose={() => setDocPreview(null)} />}
    </>
  );
}
