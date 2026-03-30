'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, Users, Briefcase, Settings, Palette, Check, MessageSquare, Megaphone, FileEdit, BookOpen, Calendar, LayoutDashboard, FileText, CheckSquare, Bot, Gavel } from 'lucide-react';
import { useTheme } from 'next-themes';
import { API_BASE_URL } from '@/lib/api';
import { NotificationCenter } from '@/app/atendimento/components/NotificationCenter';

const THEMES = [
  { id: 'logo-dark', name: 'Dark (Logo)', color: '#000000' },
  { id: 'logo-light', name: 'Light (Logo)', color: '#fafafa' },
  { id: 'modern-dark', name: 'Modern Dark', color: '#0a0a0f' },
  { id: 'modern-light', name: 'Modern Light', color: '#f8fafc' },
  { id: 'rose-light', name: 'Rose Light', color: '#fff1f2' },
];

// ─── Tooltip Styles (shared) ──────────────────────────────────────
const TOOLTIP_CLS =
  'px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg whitespace-nowrap shadow-xl border border-border flex items-center pointer-events-none';

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [dbStatus, setDbStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [unreadTotal, setUnreadTotal] = useState<number>(0);
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [djenUnread, setDjenUnread] = useState<number>(0);
  const [mounted, setMounted] = useState(false);

  // Fixed-position tooltip state (escapes overflow container)
  const [navTooltip, setNavTooltip] = useState<{ label: React.ReactNode; y: number } | null>(null);

  // Fixed-position theme menu state
  const [themeMenuPos, setThemeMenuPos] = useState<{ top: number; left: number } | null>(null);
  const themePopupRef = useRef<HTMLDivElement>(null);
  const themeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Click outside → close theme menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        themePopupRef.current && !themePopupRef.current.contains(target) &&
        themeButtonRef.current && !themeButtonRef.current.contains(target)
      ) {
        setShowThemeMenu(false);
        setThemeMenuPos(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // DB health check
  useEffect(() => {
    let retries = 0;
    const MAX_RETRIES = 10;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const checkDb = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${API_BASE_URL}/health/db`, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (data.status === 'ok') {
          setDbStatus('online');
          retries = 0;
        } else {
          throw new Error('not ok');
        }
      } catch {
        clearTimeout(timeoutId);
        if (retries < MAX_RETRIES) {
          retries++;
          retryTimer = setTimeout(checkDb, 3000);
        } else {
          setDbStatus('offline');
        }
      }
    };

    checkDb();
    const interval = setInterval(() => { retries = 0; checkDb(); }, 30000);
    return () => {
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // Unread badge
  useEffect(() => {
    const handler = (e: Event) => {
      setUnreadTotal((e as CustomEvent).detail?.total ?? 0);
    };
    window.addEventListener('unread_count_update', handler);
    return () => window.removeEventListener('unread_count_update', handler);
  }, []);

  // DJEN unread badge (atualiza a cada 5 min)
  useEffect(() => {
    const fetchDjenUnread = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API_BASE_URL}/djen/all?viewed=false&archived=false&limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) return;
        const data = await res.json();
        setDjenUnread(data?.unreadCount ?? 0);
      } catch { /* silencioso */ }
    };
    fetchDjenUnread();
    const interval = setInterval(fetchDjenUnread, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Overdue tasks badge (atualiza a cada 5 min)
  useEffect(() => {
    const fetchOverdue = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API_BASE_URL}/tasks?limit=500`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) return;
        const data = await res.json();
        const tasks: any[] = data?.data || data || [];
        const now = new Date();
        const count = tasks.filter((t: any) =>
          t.due_at &&
          new Date(t.due_at) < now &&
          (t.status === 'A_FAZER' || t.status === 'EM_PROGRESSO')
        ).length;
        setOverdueCount(count);
      } catch { /* silencioso — não bloqueia o sidebar */ }
    };
    fetchOverdue();
    const interval = setInterval(fetchOverdue, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { label: 'Dashboard', href: '/atendimento/dashboard', icon: <LayoutDashboard size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/dashboard') },
    { label: 'Inbox (WhatsApp)', href: '/atendimento', icon: <MessageSquare size={22} strokeWidth={2} />, match: (p: string) => p === '/atendimento' || p.startsWith('/atendimento/chat'), badge: unreadTotal },
    { label: 'Leads & CRM', href: '/atendimento/crm', icon: <Briefcase size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/crm') },
    { label: 'Contatos', href: '/atendimento/contacts', icon: <Users size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/contacts') },
    { label: 'Tarefas', href: '/atendimento/tasks', icon: <CheckSquare size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/tasks'), badge: overdueCount },
    { label: 'Agenda', href: '/atendimento/agenda', icon: <Calendar size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/agenda') },
    { label: 'Follow-up IA', href: '/atendimento/followup', icon: <Bot size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/followup') },
    { label: 'Triagem e Peticionamento', href: '/atendimento/advogado', icon: <FileEdit size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/advogado') },
    { label: 'Processos', href: '/atendimento/processos', icon: <BookOpen size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/processos') },
    { label: 'DJEN — Publicações', href: '/atendimento/djen', icon: <Gavel size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/djen'), badge: djenUnread },

    { label: 'Analytics', href: '/atendimento/marketing/analytics', icon: <Megaphone size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/marketing') },
    { label: 'Configurações', href: '/atendimento/settings', icon: <Settings size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/settings') },
  ];

  // ─── Tooltip helpers ──────────────────────────────────────────────
  const showTooltip = (e: React.MouseEvent, label: React.ReactNode) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setNavTooltip({ label, y: rect.top + rect.height / 2 });
  };
  const hideTooltip = () => setNavTooltip(null);

  // ─── Theme button toggle ──────────────────────────────────────────
  const toggleThemeMenu = (e: React.MouseEvent) => {
    if (showThemeMenu) {
      setShowThemeMenu(false);
      setThemeMenuPos(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setThemeMenuPos({ top: rect.top, left: rect.right + 8 });
      setShowThemeMenu(true);
    }
    hideTooltip();
  };

  return (
    <aside className="w-[72px] flex flex-col items-center py-3 bg-card border-r border-border relative z-50 shrink-0 overflow-y-auto no-scrollbar">

      {/* Logo */}
      <div
        className="w-10 h-10 rounded-xl bg-[#111] flex items-center justify-center shadow-[0_0_15px_rgba(161,119,61,0.3)] mb-4 shrink-0 cursor-pointer overflow-hidden"
        onClick={() => router.push('/atendimento/dashboard')}
        onMouseEnter={(e) => showTooltip(e, 'Página Inicial')}
        onMouseLeave={hideTooltip}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/landing/LOGO SEM FUNDO.png" alt="André Lustosa" className="w-full h-full object-contain p-1" draggable={false} />
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 w-full px-3">
        {navItems.map((item) => {
          const isActive = item.match(pathname);
          return (
            <button
              key={item.href}
              onClick={() => { if (!isActive) router.push(item.href); }}
              onMouseEnter={(e) => showTooltip(e, item.label)}
              onMouseLeave={hideTooltip}
              className={`w-full aspect-square rounded-xl flex items-center justify-center relative shadow-sm transition-colors ${isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
            >
              {item.icon}
              {(item as any).badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center shadow-md">
                  {(item as any).badge > 99 ? '99+' : (item as any).badge}
                </span>
              )}
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-md" />}
            </button>
          );
        })}
      </nav>

      {/* Bottom: DB status + Theme + Logout */}
      <div className="mt-auto flex flex-col gap-2 w-full px-3 pt-2">

        {/* DB status indicator */}
        <div
          className="w-full flex justify-center py-1 cursor-default"
          onMouseEnter={(e) => showTooltip(e,
            <span className="text-[11px] font-bold uppercase tracking-widest">
              Banco:{' '}
              <span className={dbStatus === 'online' ? 'text-emerald-500' : 'text-red-500'}>
                {dbStatus === 'online' ? 'Online' : dbStatus === 'offline' ? 'Offline' : 'Verificando...'}
              </span>
            </span>
          )}
          onMouseLeave={hideTooltip}
        >
          <div className={`w-3 h-3 rounded-full transition-all duration-500 shadow-sm ${
            dbStatus === 'online' ? 'bg-emerald-500 shadow-emerald-500/20' :
            dbStatus === 'offline' ? 'bg-red-500 shadow-red-500/20 animate-pulse' :
            'bg-amber-500 shadow-amber-500/20 animate-spin-slow'
          }`} />
        </div>

        {/* Notification Center */}
        <div
          className="w-full flex justify-center"
          onMouseEnter={(e) => showTooltip(e, 'Notificações')}
          onMouseLeave={hideTooltip}
        >
          <NotificationCenter />
        </div>

        {/* Theme picker */}
        <button
          ref={themeButtonRef}
          onClick={toggleThemeMenu}
          onMouseEnter={(e) => { if (!showThemeMenu) showTooltip(e, 'Aparência'); }}
          onMouseLeave={hideTooltip}
          className={`w-full aspect-square rounded-xl flex items-center justify-center shadow-sm transition-colors ${showThemeMenu ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
        >
          <Palette size={20} strokeWidth={2} />
        </button>

        {/* Logout */}
        <button
          onClick={() => { localStorage.removeItem('token'); router.push('/atendimento/login'); }}
          onMouseEnter={(e) => showTooltip(e, 'Sair')}
          onMouseLeave={hideTooltip}
          className="w-full aspect-square rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex items-center justify-center shadow-sm transition-colors"
        >
          <LogOut size={20} strokeWidth={2} />
        </button>
      </div>

      {/* ─── Fixed tooltip portal (escapes overflow) ─── */}
      {mounted && navTooltip && createPortal(
        <div
          style={{ position: 'fixed', top: navTooltip.y, left: 76, transform: 'translateY(-50%)', zIndex: 9999 }}
          className={TOOLTIP_CLS}
        >
          <span className="absolute -left-[5px] top-1/2 -translate-y-1/2 border-y-[5px] border-y-transparent border-r-[5px] border-r-border" />
          {navTooltip.label}
        </div>,
        document.body
      )}

      {/* ─── Fixed theme popup portal (escapes overflow) ─── */}
      {mounted && showThemeMenu && themeMenuPos && createPortal(
        <div
          ref={themePopupRef}
          style={{ position: 'fixed', top: themeMenuPos.top, left: themeMenuPos.left, zIndex: 9999 }}
          className="bg-card border border-border rounded-xl p-3 flex flex-col gap-2 w-48 shadow-2xl"
        >
          <p className="text-[11px] font-bold text-muted-foreground uppercase ml-1 mb-1 tracking-wider">Temas</p>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); setShowThemeMenu(false); setThemeMenuPos(null); }}
              className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-foreground transition-colors hover:bg-accent ${theme === t.id ? 'bg-accent' : 'bg-transparent'}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 rounded-full border border-border shadow-inner" style={{ background: t.color }} />
                {t.name}
              </div>
              {theme === t.id && <Check size={14} className="text-primary" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </aside>
  );
}
