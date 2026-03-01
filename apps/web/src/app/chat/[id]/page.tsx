'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Bot, Download, Mic } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { AudioPlayer } from '@/components/AudioPlayer';
import { AudioRecorder } from '@/components/AudioRecorder';
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

export default function ChatPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [lead, setLead] = useState<any>(null);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState<Record<string, boolean>>({});

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const wsUrl = getWsUrl();

    const fetchData = async () => {
       try {
         const convoRes = await api.get(`/conversations/lead/${params.id}`);
         if (convoRes.data && convoRes.data.length > 0) {
           const convo = convoRes.data[0];
           setLead(convo.lead);
           setConvoId(convo.id);
           setMessages(convo.messages || []);

           console.log('[SOCKET] Connecting to ChatRoom:', convo.id, 'at', wsUrl);
           socketRef.current = io(wsUrl, {
             path: '/api/socket.io/',
             transports: ['polling', 'websocket'],
             reconnection: true,
             reconnectionAttempts: Infinity,
             reconnectionDelay: 1000,
             timeout: 10000,
           });

           socketRef.current.on('connect', () => {
             console.log('[SOCKET] ChatRoom Connected ID:', socketRef.current?.id);
             socketRef.current?.emit('join_conversation', convo.id);
           });

           socketRef.current.on('disconnect', () => {
             console.log('[SOCKET] ChatRoom Disconnected');
           });

           socketRef.current.on('connect_error', (err) => {
             console.error('[SOCKET] ChatRoom error:', err);
           });

            socketRef.current.on('newMessage', (msg: any) => {
              console.log('[SOCKET] New message received:', msg);
              // Use functional update to always have the latest messages state
              setMessages(prev => {
                const exists = prev.some((m: any) => m.id === msg.id || (m.external_message_id && m.external_message_id === msg.external_message_id));
                if (exists) return prev;
                return [...prev, msg];
              });
            });

            socketRef.current.on('mediaReady', (updatedMsg: any) => {
              console.log('[SOCKET] mediaReady received:', updatedMsg.id);
              setMessages(prev => prev.map((m: any) => m.id === updatedMsg.id ? updatedMsg : m));
            });

            socketRef.current.on('joined_room', (data: any) => {
              console.log('[SOCKET] Confirmed joined room:', data);
            });
         }
       } catch (e: any) {
         console.error(e);
         if (e.response?.status === 401) {
           localStorage.removeItem('token');
           router.push('/login');
         }
       }
    };

    fetchData();

    return () => {
      socketRef.current?.disconnect();
    };
  }, [params.id, router]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim() || !convoId || sending) return;
    const msgText = text;
    setSending(true);
    setText('');
    try {
      const res = await api.post('/messages/send', { conversationId: convoId, text: msgText });
      // Exibição imediata: adiciona a mensagem retornada pelo backend
      if (res.data?.id) {
        setMessages(prev => {
          if (prev.some((m: any) => m.id === res.data.id)) return prev;
          return [...prev, res.data];
        });
      }
      inputRef.current?.focus();
    } catch (e) {
      console.error('Falha ao enviar mensagem', e);
      setText(msgText); // Restaura o texto em caso de erro
    } finally {
      setSending(false);
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

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name?: string) => (name || 'V')[0].toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans antialiased text-foreground">
      <Sidebar />

      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-[80px] px-8 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
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
              </div>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <button className="px-4 py-2 text-sm font-semibold text-primary bg-primary/10 border border-primary/20 rounded-xl transition-colors flex items-center gap-2 hover:bg-primary/20">
              <Bot size={16} />
              IA Ativa
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar" ref={scrollRef}>
          <div className="flex flex-col gap-4 max-w-4xl mx-auto pb-4">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-20">Nenhuma mensagem nesta conversa.</div>
            ) : (
              messages.map((msg, idx) => {
                const isOut = msg.direction === 'out';
                return (
                  <div key={msg.id || idx} className={`w-full flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-4 shadow-sm ${
                      isOut
                        ? 'bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground rounded-2xl rounded-tr-sm'
                        : 'bg-card border border-border rounded-2xl rounded-tl-sm'
                    }`}>
                      {msg.type === 'text' || !msg.type ? (
                        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
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
                              className="max-w-[180px] max-h-[180px] object-cover rounded-lg cursor-pointer"
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
                          <a
                            href={`/api/media/${msg.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm underline opacity-80 hover:opacity-100"
                          >
                            📄 Abrir documento
                          </a>
                        ) : (
                          <p className="text-sm italic opacity-70">📄 Documento processando...</p>
                        )
                      ) : (
                        <p className="text-sm italic opacity-70">📎 Anexo: {msg.type}</p>
                      )}
                      <div className={`text-[10px] mt-2 flex justify-end gap-2 ${isOut ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        <span>{formatTime(msg.created_at)}</span>
                        <span>• {msg.status}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Input */}
        <footer className="p-6 bg-background shrink-0">
          <div className="max-w-4xl mx-auto flex gap-3 items-center">
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Digite sua mensagem..."
              disabled={sending}
              className="flex-1 bg-card border border-border rounded-xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary shadow-sm text-foreground disabled:opacity-50"
            />
            {convoId && !text.trim() && (
              <AudioRecorder
                conversationId={convoId}
                onSent={(msg) => {
                  setMessages((prev) => {
                    if (prev.some((m: any) => m.id === msg.id)) return prev;
                    return [...prev, msg];
                  });
                }}
              />
            )}
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="bg-gradient-to-r from-primary to-ring p-4 rounded-xl shadow-lg disabled:opacity-50 hover:-translate-y-1 transition-transform"
            >
              <Send size={20} className="text-primary-foreground" />
            </button>
          </div>
        </footer>
      </div>

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
                onClick={() => handleImageDownload(lightbox)}
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
    </div>
  );
}
