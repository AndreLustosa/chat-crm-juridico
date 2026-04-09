'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { io } from 'socket.io-client';
import { Sidebar } from '@/components/Sidebar';
import { GlobalCommandPalette, useGlobalCommandPalette } from './components/GlobalCommandPalette';
import { TaskAlertPopup } from './components/TaskAlertPopup';
import {
  MessageSquare, Briefcase, Users, Check, FileEdit, BookOpen,
  Megaphone, Settings, Palette, LogOut, MoreHorizontal, X, Calendar,
  LayoutDashboard, FileText, Gavel,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRole } from '@/lib/useRole';
import { playNotificationSound, unlockAudioContext } from '@/lib/notificationSounds';
import toast from 'react-hot-toast';

import { THEMES } from '@/components/ThemeSwitcher';

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
  return '/socket.io/';
}

export default function AtendimentoLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { open: cmdOpen, setOpen: setCmdOpen } = useGlobalCommandPalette();
  const perms = useRole();

  // Mobile states
  const [isMobile, setIsMobile] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // ─── Auth check ───────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('token');
    const isLoginPage = pathname === '/atendimento/login';
    if (!token && !isLoginPage) {
      router.replace('/atendimento/login');
    }
    if (token && isLoginPage) {
      router.replace('/atendimento/dashboard');
    }
  }, [pathname, router]);

  useEffect(() => {
    const handleAuthLogout = (e: Event) => {
      const isLoginPage = pathname === '/atendimento/login';
      if (!isLoginPage) {
        const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
        if (reason) localStorage.setItem('auth_logout_reason', reason);
        router.replace('/atendimento/login');
      }
    };
    window.addEventListener('auth:logout', handleAuthLogout);
    return () => window.removeEventListener('auth:logout', handleAuthLogout);
  }, [pathname, router]);

  // ─── Unlock áudio no primeiro gesto do usuário (necessário para autoplay) ──
  useEffect(() => {
    const unlock = () => unlockAudioContext();
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  // ─── Token reativo (cobre login → dashboard, pois o layout persiste) ───
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    setAuthToken(localStorage.getItem('token'));
  }, [pathname]); // re-lê token a cada navegação (captura momento pós-login)

  // ─── Fetch unread counts do servidor na montagem (fonte de verdade) ──────
  useEffect(() => {
    if (!authToken) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
    fetch(`${apiUrl}/conversations/unread-counts`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(5000),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const total = Object.values(data as Record<string, number>).reduce((s: number, n: number) => s + n, 0);
          setUnreadTotal(total);
          window.dispatchEvent(new CustomEvent('unread_count_update', { detail: { total } }));
          try { sessionStorage.setItem('unreadCounts', JSON.stringify(data)); } catch {}
        }
      })
      .catch(() => {});
  }, [authToken]);

  // ─── Socket global de notificações (persiste em todas as rotas) ──────────
  // page.tsx cuida do som e dos badges quando o usuário está na tela do chat.
  // Este socket garante que o som toque em QUALQUER outra rota do sistema.
  useEffect(() => {
    if (!authToken) return;

    let myId: string | null = null;
    try {
      let b64 = authToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      myId = JSON.parse(atob(b64)).sub || null;
    } catch { /* ignora */ }

    const socket = io(getWsUrl(), {
      path: getSocketPath(),
      transports: ['polling', 'websocket'],
      auth: { token: authToken },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      if (myId) socket.emit('join_user', myId);
    });

    // Backend envia incoming_message_notification para user:${assignedUserId}
    // (ou tenant se sem atribuição). Se chegou, é para mim.
    // Na tela de chat, page.tsx já cuida → evita som duplo.
    socket.on('incoming_message_notification', (data: { conversationId?: string; contactName?: string }) => {
      const onChatPage = pathnameRef.current === '/atendimento' ||
        pathnameRef.current.startsWith('/atendimento/chat');
      if (onChatPage) return;

      playNotificationSound();

      // Persiste unreadCounts em sessionStorage para page.tsx ler ao montar
      if (data?.conversationId) {
        try {
          const raw = sessionStorage.getItem('unreadCounts');
          const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
          counts[data.conversationId] = (counts[data.conversationId] || 0) + 1;
          sessionStorage.setItem('unreadCounts', JSON.stringify(counts));
          const total = Object.values(counts).reduce((s, n) => s + n, 0);
          setUnreadTotal(total);
          // Propaga para o Sidebar (que ouve este evento para atualizar o badge)
          window.dispatchEvent(new CustomEvent('unread_count_update', { detail: { total } }));
        } catch {
          setUnreadTotal(prev => prev + 1);
        }
      }

      // Toast in-app (visível mesmo com a aba focada)
      const name = data?.contactName || 'Novo contato';
      toast(`Nova mensagem de ${name}`, { icon: '💬', duration: 4000 });

      // Desktop notification (browser nativo — só aparece com aba desfocada)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && !document.hasFocus()) {
        const n = new Notification(name, {
          body: 'Nova mensagem recebida',
          silent: true,
        });
        setTimeout(() => n.close(), 6000);
      }
    });

    // Transferências: toast + som em qualquer rota (page.tsx cuida do popup no chat)
    socket.on('transfer_request', (data: { contactName?: string; fromUserName?: string }) => {
      const onChatPage = pathnameRef.current === '/atendimento' ||
        pathnameRef.current.startsWith('/atendimento/chat');
      if (onChatPage) return; // page.tsx já exibe o popup
      playNotificationSound();
      toast(`Transferência de ${data?.fromUserName || 'Operador'}: ${data?.contactName || 'Contato'}`, { icon: '📨', duration: 6000 });
    });

    return () => { socket.disconnect(); };
  }, [authToken]);

  // ─── Mobile detection ─────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Listen for chat open/close from page.tsx
  useEffect(() => {
    const handler = (e: Event) => {
      setMobileChatOpen((e as CustomEvent).detail?.chatOpen ?? false);
    };
    window.addEventListener('mobile-chat-state', handler);
    return () => window.removeEventListener('mobile-chat-state', handler);
  }, []);

  // Unread count
  useEffect(() => {
    const handler = (e: Event) => {
      setUnreadTotal((e as CustomEvent).detail?.total ?? 0);
    };
    window.addEventListener('unread_count_update', handler);
    return () => window.removeEventListener('unread_count_update', handler);
  }, []);

  // Overdue tasks badge (mobile — atualiza a cada 5min)
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
    const fetchOverdue = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) return;
      try {
        const res = await fetch(`${apiUrl}/tasks?limit=500`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const tasks: any[] = data?.data || data || [];
        const now = new Date();
        const count = tasks.filter((t: any) =>
          t.due_at && new Date(t.due_at) < now &&
          (t.status === 'A_FAZER' || t.status === 'EM_PROGRESSO')
        ).length;
        setOverdueCount(count);
      } catch { /* silencioso */ }
    };
    fetchOverdue();
    const interval = setInterval(fetchOverdue, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Click outside to close more menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
        setShowThemes(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus & reset chat state on route change
  useEffect(() => {
    setMoreMenuOpen(false);
    setShowThemes(false);
    setMobileChatOpen(false);
  }, [pathname]);

  const isLoginPage = pathname === '/atendimento/login';

  if (isLoginPage) {
    return <>{children}</>;
  }

  // ─── Bottom nav tabs ──────────────────────────────────────
  const mainTabs = [
    { label: 'CRM', href: '/atendimento/crm', icon: Briefcase, match: (p: string) => p.startsWith('/atendimento/crm') },
    { label: 'Chat', href: '/atendimento', icon: MessageSquare, match: (p: string) => p === '/atendimento' || p.startsWith('/atendimento/chat'), isCenter: true, badge: unreadTotal },
    { label: 'Contatos', href: '/atendimento/contacts', icon: Users, match: (p: string) => p.startsWith('/atendimento/contacts') },
  ];

  const allMoreItems = [
    { label: 'Dashboard', href: '/atendimento/dashboard', icon: LayoutDashboard, match: (p: string) => p.startsWith('/atendimento/dashboard'), show: perms.canViewDashboard },
    { label: 'Agenda & Tarefas', href: '/atendimento/agenda', icon: Calendar, match: (p: string) => p.startsWith('/atendimento/agenda') || p.startsWith('/atendimento/tasks'), badge: overdueCount, show: true },
    { label: 'Triagem e Peticionamento', href: '/atendimento/advogado', icon: FileEdit, match: (p: string) => p.startsWith('/atendimento/advogado'), show: perms.canViewAdvogado },
    { label: 'Processos', href: '/atendimento/processos', icon: BookOpen, match: (p: string) => p.startsWith('/atendimento/processos'), show: perms.canViewLegalCases },
    { label: 'DJEN', href: '/atendimento/djen', icon: Gavel, match: (p: string) => p.startsWith('/atendimento/djen'), show: perms.canViewDjen },
    { label: 'Marketing', href: '/atendimento/marketing/analytics', icon: Megaphone, match: (p: string) => p.startsWith('/atendimento/marketing'), show: perms.canViewAnalytics },
    { label: 'Ajustes', href: '/atendimento/settings', icon: Settings, match: (p: string) => p.startsWith('/atendimento/settings'), show: perms.canManageSettings },
  ];
  const moreItems = allMoreItems.filter(item => item.show);

  const showBottomNav = isMobile && !mobileChatOpen;
  const isMoreActive = moreItems.some(item => item.match(pathname));

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — desktop only */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* ─── Popup de alertas de tarefas (tempo real) ──────── */}
      <TaskAlertPopup />

      {/* ─── Global Command Palette (Ctrl+K) ────────────────── */}
      <GlobalCommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      {/* ─── Mobile Bottom Nav (fixed) ──────────────────────── */}
      {showBottomNav && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-[60]" ref={moreMenuRef}>

          {/* "More" popup panel */}
          {moreMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 bg-card border-t border-border rounded-t-2xl shadow-2xl z-50">
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Menu</span>
                <button
                  onClick={() => { setMoreMenuOpen(false); setShowThemes(false); }}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-2 pb-2 space-y-0.5">
                {/* Nav items */}
                {moreItems.map(item => {
                  const Icon = item.icon;
                  const active = item.match(pathname);
                  const badge = (item as any).badge;
                  return (
                    <button
                      key={item.href}
                      onClick={() => { router.push(item.href); setMoreMenuOpen(false); setShowThemes(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50'
                      }`}
                    >
                      <Icon size={20} strokeWidth={2} />
                      {item.label}
                      {badge > 0 && (
                        <span className="ml-auto text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </button>
                  );
                })}

                <div className="h-px bg-border my-1.5" />

                {/* Theme picker */}
                <button
                  onClick={() => setShowThemes(!showThemes)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground hover:bg-accent/50 transition-colors"
                >
                  <Palette size={20} strokeWidth={2} />
                  Aparência
                </button>
                {showThemes && (
                  <div className="pl-10 pr-3 pb-1 space-y-1">
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => { setTheme(t.id); setShowThemes(false); setMoreMenuOpen(false); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                          theme === t.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
                        }`}
                      >
                        <div className="w-3.5 h-3.5 rounded-full border border-border shadow-inner" style={{ background: t.color }} />
                        {t.name}
                        {theme === t.id && <Check size={14} className="ml-auto text-primary" />}
                      </button>
                    ))}
                  </div>
                )}

                <div className="h-px bg-border my-1.5" />

                {/* Logout */}
                <button
                  onClick={() => { localStorage.removeItem('token'); router.push('/atendimento/login'); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut size={20} strokeWidth={2} />
                  Sair
                </button>
              </div>
            </div>
          )}

          {/* Tab Bar */}
          <nav className="flex items-end justify-around px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {mainTabs.map(tab => {
              const Icon = tab.icon;
              const active = tab.match(pathname);
              return (
                <button
                  key={tab.href}
                  onClick={() => { router.push(tab.href); setMoreMenuOpen(false); }}
                  className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors relative min-w-[60px] ${
                    active ? 'text-primary' : 'text-muted-foreground active:text-foreground'
                  }`}
                >
                  <Icon size={tab.isCenter ? 28 : 22} strokeWidth={active ? 2.5 : 2} />
                  <span className={`text-[10px] ${active ? 'font-bold' : 'font-medium'}`}>{tab.label}</span>
                  {tab.badge != null && tab.badge > 0 && (
                    <span className="absolute -top-0.5 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-[16px] text-center">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
            {/* More button */}
            <button
              onClick={() => { setMoreMenuOpen(!moreMenuOpen); if (moreMenuOpen) setShowThemes(false); }}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors min-w-[60px] ${
                moreMenuOpen || isMoreActive ? 'text-primary' : 'text-muted-foreground active:text-foreground'
              }`}
            >
              <MoreHorizontal size={22} strokeWidth={moreMenuOpen || isMoreActive ? 2.5 : 2} />
              <span className={`text-[10px] ${moreMenuOpen || isMoreActive ? 'font-bold' : 'font-medium'}`}>Mais</span>
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
