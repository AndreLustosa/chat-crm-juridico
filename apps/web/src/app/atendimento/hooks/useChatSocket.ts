import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import api from '@/lib/api';
import { playNotificationSound } from '@/lib/notificationSounds';
import { showError } from '@/lib/toast';

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
  if (apiUrl.startsWith('http')) {
    try { return new URL(apiUrl).origin; } catch { /* fall through */ }
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function getSocketPath(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_PATH) return process.env.NEXT_PUBLIC_SOCKET_PATH;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const isDev = apiUrl.includes('localhost') || /https?:\/\/[^/]+:\d{4,}/.test(apiUrl);
  return isDev ? '/socket.io/' : '/api/socket.io/';
}

function decodeUserId(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
  } catch { return null; }
}

interface UseChatSocketResult {
  messages: any[];
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  lead: any;
  convoId: string | null;
  convoStatus: string;
  setConvoStatus: React.Dispatch<React.SetStateAction<string>>;
  aiMode: boolean;
  setAiMode: React.Dispatch<React.SetStateAction<boolean>>;
  legalArea: string | null;
  setLegalArea: React.Dispatch<React.SetStateAction<string | null>>;
  assignedLawyer: { id: string; name: string } | null;
  setAssignedLawyer: React.Dispatch<React.SetStateAction<{ id: string; name: string } | null>>;
  allSpecialists: { id: string; name: string; specialties: string[] }[];
  originAssignedUserId: string | null;
  contactPresence: string;
  currentUserId: string | null;
  socketRef: React.MutableRefObject<Socket | null>;
  loading: boolean;
}

/**
 * Hook que encapsula toda a logica de conexao, fetch de dados e eventos do socket.
 * Extrai ~120 linhas do page.tsx do chat.
 */
export function useChatSocket(leadId: string): UseChatSocketResult {
  const router = useRouter();
  const [messages, setMessages] = useState<any[]>([]);
  const [lead, setLead] = useState<any>(null);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [convoStatus, setConvoStatus] = useState<string>('ABERTO');
  const [aiMode, setAiMode] = useState(false);
  const [legalArea, setLegalArea] = useState<string | null>(null);
  const [assignedLawyer, setAssignedLawyer] = useState<{ id: string; name: string } | null>(null);
  const [allSpecialists, setAllSpecialists] = useState<{ id: string; name: string; specialties: string[] }[]>([]);
  const [originAssignedUserId, setOriginAssignedUserId] = useState<string | null>(null);
  const [contactPresence, setContactPresence] = useState<string>('unavailable');
  const [loading, setLoading] = useState(true);
  const [currentUserId] = useState<string | null>(decodeUserId);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }

    const wsUrl = getWsUrl();

    const fetchData = async () => {
      try {
        const convoRes = await api.get(`/conversations/lead/${leadId}`);
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

          api.get('/users/agents').then((r) => {
            setAllSpecialists(
              (r.data as any[]).filter((u) => u.specialties?.length > 0),
            );
          }).catch(() => {});

          api.post(`/conversations/${convo.id}/mark-read`).catch(() => {});

          api.post(`/messages/conversation/${convo.id}/sync-history`)
            .then(async (syncRes) => {
              if (syncRes.data?.imported > 0) {
                const msgRes = await api.get(`/messages/conversation/${convo.id}`);
                setMessages(msgRes.data || []);
              }
            })
            .catch(() => {});

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
            if (currentUserId) socketRef.current?.emit('join_user', currentUserId);
          });

          // Backend já filtra por atribuição — se chegou, é para mim.
          socketRef.current.on('incoming_message_notification', (data: any) => {
            if (data?.conversationId !== convo.id) {
              playNotificationSound();
            }
          });

          socketRef.current.on('newMessage', (msg: any) => {
            const addMsg = () => setMessages(prev => {
              const exists = prev.some((m: any) => m.id === msg.id || (m.external_message_id && m.external_message_id === msg.external_message_id));
              if (exists) return prev;
              return [...prev, msg];
            });
            if (msg.direction === 'in') {
              playNotificationSound();
              api.post(`/conversations/${convo.id}/mark-read`).catch(() => {});
            }
            // Áudio com mídia pronta: pré-busca o blob para exibir já reproduzível
            if (msg.type === 'audio' && msg.media?.s3_key) {
              import('@/components/AudioPlayer').then(({ preFetchAudio }) => {
                const timeout = setTimeout(addMsg, 8000); // garante exibição mesmo se pré-fetch demorar
                preFetchAudio(msg.id).finally(() => { clearTimeout(timeout); addMsg(); });
              });
            } else {
              addMsg();
            }
          });

          socketRef.current.on('messageUpdate', (updatedMsg: any) => {
            setMessages(prev => prev.map((m: any) => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
          });

          socketRef.current.on('messageReaction', (data: { messageId: string; reactions: any[] }) => {
            setMessages(prev => prev.map((m: any) => m.id === data.messageId ? { ...m, reactions: data.reactions } : m));
          });

          socketRef.current.on('contact_presence', (data: { presence: string }) => {
            setContactPresence(data.presence);
          });
        }
      } catch (e: any) {
        console.error('Erro ao inicializar chat:', e);
        showError('Erro ao carregar conversa.');
      } finally {
        setLoading(false);
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
        s.off('messageReaction');
        s.off('contact_presence');
        s.disconnect();
      }
    };
  }, [leadId, router, currentUserId]);

  return {
    messages,
    setMessages,
    lead,
    convoId,
    convoStatus,
    setConvoStatus,
    aiMode,
    setAiMode,
    legalArea,
    setLegalArea,
    assignedLawyer,
    setAssignedLawyer,
    allSpecialists,
    originAssignedUserId,
    contactPresence,
    currentUserId,
    socketRef,
    loading,
  };
}
