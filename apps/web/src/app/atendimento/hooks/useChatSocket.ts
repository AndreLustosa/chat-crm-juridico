import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import api from '@/lib/api';
import { useSocket } from '@/lib/SocketProvider';
import { decodeUserId } from '@/lib/socketConfig';
import { showError } from '@/lib/toast';

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
 * Hook que encapsula toda a logica de fetch de dados e eventos do socket.
 * Usa o socket compartilhado do SocketProvider (sem io() local).
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

  const { socket: sharedSocket } = useSocket();
  const socketRef = useRef<Socket | null>(null);

  // Sincroniza ref para componentes que consomem socketRef
  useEffect(() => { socketRef.current = sharedSocket; }, [sharedSocket]);

  // Fetch de dados + listeners de conversa
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }

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

          // Registrar listeners no socket compartilhado
          if (sharedSocket) {
            sharedSocket.emit('join_conversation', convo.id);

            // Som NÃO toca aqui — SocketProvider já toca via incoming_message_notification

            sharedSocket.on('newMessage', (msg: any) => {
              const addMsg = () => setMessages(prev => {
                const exists = prev.some((m: any) => m.id === msg.id || (m.external_message_id && m.external_message_id === msg.external_message_id));
                if (exists) return prev;
                return [...prev, msg];
              });
              if (msg.direction === 'in') {
                api.post(`/conversations/${convo.id}/mark-read`).catch(() => {});
              }
              if (msg.type === 'audio' && (msg.media?.file_path || msg.media?.s3_key)) {
                import('@/components/AudioPlayer').then(({ preFetchAudio }) => {
                  const timeout = setTimeout(addMsg, 8000);
                  preFetchAudio(msg.id).finally(() => { clearTimeout(timeout); addMsg(); });
                });
              } else {
                addMsg();
              }
            });

            sharedSocket.on('messageUpdate', (updatedMsg: any) => {
              setMessages(prev => prev.map((m: any) => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
            });

            sharedSocket.on('messageReaction', (data: { messageId: string; reactions: any[] }) => {
              setMessages(prev => prev.map((m: any) => m.id === data.messageId ? { ...m, reactions: data.reactions } : m));
            });

            sharedSocket.on('contact_presence', (data: { presence: string }) => {
              setContactPresence(data.presence);
            });
          }
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
      if (sharedSocket) {
        sharedSocket.off('newMessage');
        sharedSocket.off('messageUpdate');
        sharedSocket.off('messageReaction');
        sharedSocket.off('contact_presence');
      }
    };
  }, [leadId, router, currentUserId, sharedSocket]);

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
