'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getWsUrl, getSocketPath, getAuthToken, decodeUserId } from './socketConfig';
import { playNotificationSound, unlockAudioContext } from './notificationSounds';
import { showDesktopNotification } from './desktopNotifications';
import toast from 'react-hot-toast';

// ─── Context ──────────────────────────────────────────────────────
interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  userId: string | null;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  userId: null,
});

// ─── Hooks ────────────────────────────────────────────────────────

/** Retorna o socket compartilhado (nunca crie io() diretamente) */
export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/**
 * Subscribe a um evento do socket com auto-cleanup.
 * O handler é estabilizado via ref para evitar re-subscribes desnecessários.
 */
export function useSocketEvent<T = any>(event: string, handler: (data: T) => void): void {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const wrapped = (data: T) => handlerRef.current(data);
    socket.on(event, wrapped);
    return () => { socket.off(event, wrapped); };
  }, [socket, event]);
}

// ─── Provider ─────────────────────────────────────────────────────

interface SocketProviderProps {
  children: React.ReactNode;
  /** Rota atual do Next.js (para guard de som duplo) */
  pathname: string;
}

export function SocketProvider({ children, pathname }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const pathnameRef = useRef(pathname);

  // Atualiza ref de pathname sem re-render do socket
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // ─── Re-lê token a cada navegação (captura momento pós-login) ──
  useEffect(() => {
    setAuthToken(getAuthToken() || null);
  }, [pathname]);

  // ─── Unlock áudio no primeiro gesto do usuário ─────────────────
  useEffect(() => {
    const unlock = () => unlockAudioContext();
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  // ─── Conexão única do socket ───────────────────────────────────
  useEffect(() => {
    if (!authToken) return;

    const uid = decodeUserId();
    setUserId(uid);

    const s = io(getWsUrl(), {
      path: getSocketPath(),
      transports: ['polling', 'websocket'],
      auth: { token: authToken },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      timeout: 10000,
    });

    s.on('connect', () => {
      setConnected(true);
      if (uid) s.emit('join_user', uid);
    });

    s.on('disconnect', () => setConnected(false));

    // ─── Notificação centralizada de nova mensagem ───────────────
    // ÚNICO ponto que toca som para incoming_message_notification.
    // page.tsx NÃO registra handler próprio nem toca som em newMessage.
    // _prefs vem do backend (NotificationSettingsService) com flags por usuário.
    s.on('incoming_message_notification', (data: { conversationId?: string; contactName?: string; _prefs?: { skipSound?: boolean; skipDesktop?: boolean } }) => {
      const onChatPage = pathnameRef.current === '/atendimento' ||
        pathnameRef.current.startsWith('/atendimento/chat');
      const prefs = data._prefs || {};

      // Sempre atualiza contagem de não-lidas (independe de prefs)
      if (data?.conversationId) {
        try {
          const raw = sessionStorage.getItem('unreadCounts');
          const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
          counts[data.conversationId] = (counts[data.conversationId] || 0) + 1;
          sessionStorage.setItem('unreadCounts', JSON.stringify(counts));
          const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
          window.dispatchEvent(new CustomEvent('unread_count_update', { detail: { total } }));
        } catch {}
      }

      // Som: respeita preferência do servidor
      if (!prefs.skipSound) {
        playNotificationSound();
      }

      // Desktop notification: respeita preferência do servidor
      if (!prefs.skipDesktop) {
        const name = data?.contactName || 'Novo contato';
        showDesktopNotification({
          title: name,
          body: 'Nova mensagem recebida',
          tag: `msg-${data?.conversationId || 'unknown'}`,
        });
      }

      // Toast apenas fora do chat (no chat o user já vê a mensagem inline)
      if (onChatPage) return;
      const name = data?.contactName || 'Novo contato';
      toast(`Nova mensagem de ${name}`, { icon: '💬', duration: 4000 });
    });

    // ─── Transferências: toast + som (respeita _prefs) ──────────
    s.on('transfer_request', (data: { contactName?: string; fromUserName?: string; _prefs?: { skipSound?: boolean; skipDesktop?: boolean } }) => {
      const onChatPage = pathnameRef.current === '/atendimento' ||
        pathnameRef.current.startsWith('/atendimento/chat');
      const prefs = data._prefs || {};

      if (onChatPage) return; // page.tsx já exibe o popup com som próprio

      if (!prefs.skipSound) {
        playNotificationSound();
      }

      toast(`Transferência de ${data?.fromUserName || 'Operador'}: ${data?.contactName || 'Contato'}`, { icon: '📨', duration: 6000 });

      if (!prefs.skipDesktop) {
        showDesktopNotification({
          title: 'Transferência recebida',
          body: `${data?.fromUserName || 'Operador'} transferiu ${data?.contactName || 'um contato'}`,
          tag: 'transfer',
        });
      }
    });

    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [authToken]);

  const value = React.useMemo(() => ({ socket, connected, userId }), [socket, connected, userId]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}
