'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Send } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
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
  assignedAgentName: string | null;
  aiMode: boolean;
}

interface MessageItem {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  type: string;
  text: string | null;
  status: string;
  created_at: string;
  media?: { original_url?: string; mime_type?: string } | null;
}

const DEMO_CONVERSATIONS: ConversationSummary[] = [
  { id: 'demo-1', leadId: 'd1', contactName: 'João Silva', contactPhone: '82999001122', channel: 'WEB', status: 'ACTIVE', lastMessage: 'Preciso de orientação sobre meu caso trabalhista', lastMessageAt: new Date().toISOString(), assignedAgentName: 'André Lustosa', aiMode: false },
  { id: 'demo-2', leadId: 'd2', contactName: 'Maria Santos', contactPhone: '82998776655', channel: 'WHATSAPP', status: 'WAITING', lastMessage: 'Boa tarde, vocês atendem direito de família?', lastMessageAt: new Date(Date.now() - 300000).toISOString(), assignedAgentName: null, aiMode: false },
  { id: 'demo-3', leadId: 'd3', contactName: 'Carlos Oliveira', contactPhone: '82997654321', channel: 'WEB', status: 'BOT', lastMessage: 'Quero saber sobre consulta previdenciária', lastMessageAt: new Date(Date.now() - 600000).toISOString(), assignedAgentName: null, aiMode: true },
  { id: 'demo-4', leadId: 'd4', contactName: 'Ana Pereira', contactPhone: '82996543210', channel: 'INSTAGRAM', status: 'BOT', lastMessage: 'Olá, preciso de um advogado', lastMessageAt: new Date(Date.now() - 1200000).toISOString(), assignedAgentName: null, aiMode: true },
  { id: 'demo-5', leadId: 'd5', contactName: 'Roberto Lima', contactPhone: '82995432109', channel: 'WEB', status: 'CLOSED', lastMessage: 'Muito obrigado pelo atendimento!', lastMessageAt: new Date(Date.now() - 86400000).toISOString(), assignedAgentName: null, aiMode: false },
];

export default function Dashboard() {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) { router.push('/login'); return; }
      const res = await api.get('/conversations');
      const data = res.data;
      if (data && data.length > 0) {
        setConversations(data);
      } else {
        setConversations(DEMO_CONVERSATIONS);
      }
    } catch (e: any) {
      if (e.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
        return;
      }
      setConversations(DEMO_CONVERSATIONS);
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Initial load + WebSocket
  useEffect(() => {
    fetchConversations();

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
    const socket = io(wsUrl, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('inboxUpdate', () => {
      fetchConversations();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchConversations]);

  // Fetch messages when conversation selected
  useEffect(() => {
    if (!selectedId || selectedId.startsWith('demo-')) {
      setMessages([]);
      return;
    }

    const fetchDetail = async () => {
      try {
        const res = await api.get(`/conversations/${selectedId}`);
        setMessages(res.data?.messages || []);

        if (socketRef.current) {
          socketRef.current.emit('join_conversation', selectedId);
          socketRef.current.off('newMessage');
          socketRef.current.on('newMessage', (msg: MessageItem) => {
            setMessages(prev => {
              if (prev.find(m => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
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
    setSending(true);
    try {
      await api.post('/messages/send', { conversationId: selectedId, text });
      setText('');
      inputRef.current?.focus();
    } catch (e) {
      console.error('Failed to send message', e);
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
    try {
      await api.patch(`/conversations/${selectedId}/close`);
      setSelectedId(null);
      fetchConversations();
    } catch (e) {
      console.error('Failed to close', e);
    }
  };

  const filteredConversations = (filter
    ? conversations.filter(c => c.status === filter)
    : conversations).sort((a, b) => (a.contactName || '').localeCompare(b.contactName || ''));

  const selected = conversations.find((c) => c.id === selectedId);
  const isDemo = selectedId?.startsWith('demo-');
  const isRealConvo = selectedId && !isDemo;

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name?: string) => (name || 'V')[0].toUpperCase();

  const statusBadge = (status: string) => {
    const map: Record<string, { class: string; label: string }> = {
      BOT: { class: 'bg-purple-500/15 text-purple-400 dark:text-purple-300 border border-purple-500/20', label: '🤖 Bot' },
      WAITING: { class: 'bg-amber-500/15 text-amber-500 border border-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.15)]', label: '⏳ Aguardando' },
      ACTIVE: { class: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20', label: '🟢 Ativo' },
      CLOSED: { class: 'bg-gray-500/15 text-gray-400 border border-gray-500/20', label: '⬛ Fechado' },
    };
    const badge = map[status] || map.CLOSED;
    return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.class}`}>{badge.label}</span>;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans antialiased text-foreground">

      <Sidebar />

      {/* INBOX */}
      <section className="w-[380px] flex flex-col bg-card border-r border-border shrink-0 z-40">
        <div className="p-5 border-b border-border">
          <h2 className="text-xl font-bold mb-4">Inbox</h2>
          <div className="flex bg-muted rounded-xl p-1 w-full relative">
            {[
              { value: '', label: 'Todas' },
              { value: 'BOT', label: 'Bot' },
              { value: 'WAITING', label: 'Aguardando' },
              { value: 'ACTIVE', label: 'Ativas' },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`flex-1 py-1.5 text-[12px] font-semibold rounded-lg transition-all ${filter === tab.value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-background/50'}`}
              >
                {tab.label}
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
                <div className="w-11 h-11 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] text-white flex items-center justify-center font-bold text-lg shrink-0">
                  {getInitial(conv.contactName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-foreground truncate pl-0.5">{conv.contactName || 'Visitante'}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatTime(conv.lastMessageAt)}</span>
                  </div>
                  <div className="mb-2">
                    {statusBadge(conv.status)}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* MAIN CHAT PANEL */}
      <main className="flex-1 flex flex-col bg-background relative">
        {selected ? (
          <>
            <header className="h-[80px] px-8 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] text-white flex items-center justify-center font-bold text-xl shadow-sm">
                   {getInitial(selected.contactName)}
                 </div>
                 <div>
                   <h3 className="font-bold text-lg leading-tight">{selected.contactName}</h3>
                   <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">
                     {selected.channel} <span className="mx-1">•</span> {selected.contactPhone}
                   </div>
                 </div>
               </div>
               <div className="flex gap-3">
                 {selected.status === 'WAITING' && isRealConvo && (
                   <button
                     onClick={handleAccept}
                     className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-ring text-primary-foreground font-bold text-sm shadow-[0_0_15px_rgba(var(--primary),0.3)] hover:shadow-[0_0_20px_rgba(var(--primary),0.4)] hover:-translate-y-0.5 transition-all"
                   >
                     Aceitar Atendimento
                   </button>
                 )}
                 {selected.status !== 'CLOSED' && isRealConvo && (
                   <button
                     onClick={handleClose}
                     className="px-5 py-2.5 rounded-xl bg-transparent border border-border text-foreground font-semibold text-sm hover:bg-accent transition-colors"
                   >
                     Encerrar
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
                      <div key={msg.id} className={`w-full flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-4 shadow-sm ${
                          isOut
                            ? 'bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground rounded-2xl rounded-tr-sm'
                            : 'bg-card border border-border rounded-2xl rounded-tl-sm'
                        }`}>
                          {msg.type === 'text' || !msg.type ? (
                            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                          ) : (
                            <div>
                              <p className="text-sm italic mb-1">Anexo: {msg.type}</p>
                              {msg.media?.original_url && (
                                <span className="text-xs opacity-80 break-all">{msg.media.original_url}</span>
                              )}
                            </div>
                          )}
                          <div className={`text-[10px] mt-2 flex justify-end gap-2 ${isOut ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                            <span>{formatTime(msg.created_at)}</span>
                            <span>• {msg.status}</span>
                          </div>
                        </div>
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

            <footer className="p-6 bg-background shrink-0">
               <div className="max-w-4xl mx-auto flex gap-3">
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
                    className="flex-1 bg-card border border-border rounded-xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary shadow-sm text-foreground disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!isRealConvo || !text.trim() || sending}
                    className="bg-gradient-to-r from-primary to-ring p-4 rounded-xl shadow-lg disabled:opacity-50 hover:-translate-y-1 transition-transform"
                  >
                     <Send size={20} className="text-primary-foreground" />
                  </button>
               </div>
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

    </div>
  );
}
