'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import {
  LogOut, Users, Briefcase, Settings, Palette, Check,
  MessageSquare, BarChart2, Scale, BookOpen, Calendar,
  LayoutDashboard, Gavel, Wallet, HelpCircle,
  ChevronRight, ClipboardList, Sparkles,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { API_BASE_URL } from '@/lib/api';
import { NotificationCenter } from '@/app/atendimento/components/NotificationCenter';
import { NotificationToggle } from '@/components/NotificationToggle';
import { useRole } from '@/lib/useRole';
import { THEMES } from '@/components/ThemeSwitcher';

// ─── Tooltip Styles (shared) ──────────────────────────────────────
const TOOLTIP_CLS =
  'px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg whitespace-nowrap shadow-xl border border-border flex items-center pointer-events-none';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  match: (p: string) => boolean;
  badge?: number;
  show: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const perms = useRole();

  const [expanded, setExpanded] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [dbStatus, setDbStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [unreadTotal, setUnreadTotal] = useState<number>(0);
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [djenUnread, setDjenUnread] = useState<number>(0);
  const [mounted, setMounted] = useState(false);

  // Fixed-position tooltip state
  const [navTooltip, setNavTooltip] = useState<{ label: React.ReactNode; y: number } | null>(null);

  // Fixed-position menu states
  const [themeMenuPos, setThemeMenuPos] = useState<{ top: number; left: number } | null>(null);

  const themePopupRef = useRef<HTMLDivElement>(null);
  const themeButtonRef = useRef<HTMLButtonElement>(null);

  // Load expanded state + mount
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_expanded');
    if (saved === '1') setExpanded(true);
    setMounted(true);
  }, []);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem('sidebar_expanded', next ? '1' : '0');
    setNavTooltip(null);
  };

  // Click outside → close menus
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

  // DJEN unread badge (a cada 5 min)
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

  // Overdue tasks badge (a cada 5 min)
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
      } catch { /* silencioso */ }
    };
    fetchOverdue();
    const interval = setInterval(fetchOverdue, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Badge para petições devolvidas (estagiário)
  const [internBadge, setInternBadge] = useState(0);
  useEffect(() => {
    if (!perms.isEstagiario) return;
    const fetchBadge = async () => {
      try {
        const res = await fetch('/api/intern/badge-count', {
          headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('token') : ''}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setInternBadge(data.corrections || 0);
      } catch { /* silencioso */ }
    };
    fetchBadge();
    const interval = setInterval(fetchBadge, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [perms.isEstagiario]);

  // ─── Itens por grupo ──────────────────────────────────────────────
  const allItems: Record<string, NavItem> = {
    dashboard: {
      label: 'Dashboard',
      href: '/atendimento/dashboard',
      icon: <LayoutDashboard size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/dashboard'),
      show: perms.canViewDashboard,
    },
    inbox: {
      label: 'Inbox (WhatsApp)',
      href: '/atendimento',
      icon: <MessageSquare size={20} strokeWidth={2} />,
      match: (p) => p === '/atendimento' || p.startsWith('/atendimento/chat'),
      badge: unreadTotal,
      show: true,
    },
    crm: {
      label: 'Leads & CRM',
      href: '/atendimento/crm',
      icon: <Briefcase size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/crm'),
      show: true,
    },
    contacts: {
      label: 'Contatos',
      href: '/atendimento/contacts',
      icon: <Users size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/contacts'),
      show: true,
    },
    agenda: {
      label: 'Agenda & Tarefas',
      href: '/atendimento/agenda',
      icon: <Calendar size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/agenda') || p.startsWith('/atendimento/tasks'),
      badge: overdueCount,
      show: true,
    },
    estagiario: {
      label: 'Meu Painel',
      href: '/atendimento/estagiario',
      icon: <ClipboardList size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/estagiario'),
      badge: internBadge,
      show: perms.isEstagiario,
    },
    advogado: {
      label: 'Triagem & Petições',
      href: '/atendimento/advogado',
      icon: <Scale size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/advogado'),
      show: perms.canViewAdvogado,
    },
    processos: {
      label: 'Processos',
      href: '/atendimento/processos',
      icon: <BookOpen size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/processos'),
      show: perms.canViewLegalCases,
    },
    djen: {
      label: 'DJEN — Publicações',
      href: '/atendimento/djen',
      icon: <Gavel size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/djen'),
      badge: djenUnread,
      show: perms.canViewDjen,
    },
    followup: {
      label: 'Follow-up IA',
      href: '/atendimento/followup',
      icon: <Sparkles size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/followup'),
      show: perms.isAdmin,
    },
    financeiro: {
      label: 'Financeiro',
      href: '/atendimento/financeiro',
      icon: <Wallet size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/financeiro'),
      show: perms.canViewFinanceiro,
    },
    analytics: {
      label: 'Analytics',
      href: '/atendimento/marketing/analytics',
      icon: <BarChart2 size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/marketing'),
      show: perms.canViewAnalytics,
    },
    manual: {
      label: 'Manual',
      href: '/atendimento/manual',
      icon: <HelpCircle size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/manual'),
      show: true,
    },
    settings: {
      label: 'Configurações',
      href: '/atendimento/settings',
      icon: <Settings size={20} strokeWidth={2} />,
      match: (p) => p.startsWith('/atendimento/settings'),
      show: perms.canManageSettings,
    },
  };

  const groups: NavGroup[] = [
    {
      id: 'principal',
      label: 'Principal',
      items: [allItems.dashboard, allItems.inbox, allItems.crm, allItems.contacts, allItems.agenda].filter(i => i.show),
    },
    {
      id: 'juridico',
      label: 'Jurídico',
      items: [allItems.estagiario, allItems.advogado, allItems.processos, allItems.djen].filter(i => i.show),
    },
    {
      id: 'gestao',
      label: 'Gestão',
      items: [allItems.followup, allItems.financeiro, allItems.analytics].filter(i => i.show),
    },
    {
      id: 'sistema',
      label: 'Sistema',
      items: [allItems.manual, allItems.settings].filter(i => i.show),
    },
  ].filter(g => g.items.length > 0);

  // ─── Tooltip helpers (somente quando recolhido) ───────────────────
  const showTooltip = (e: React.MouseEvent, label: React.ReactNode) => {
    if (expanded) return;
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
      const MENU_HEIGHT = 248;
      const MENU_MARGIN = 8;
      const rawTop = rect.top;
      const top = rawTop + MENU_HEIGHT + MENU_MARGIN > window.innerHeight
        ? window.innerHeight - MENU_HEIGHT - MENU_MARGIN
        : rawTop;
      setThemeMenuPos({ top, left: rect.right + 8 });
      setShowThemeMenu(true);
    }
    hideTooltip();
  };

  // ─── DB status label helper ───────────────────────────────────────
  const dbLabel =
    dbStatus === 'online' ? (
      <span className="text-emerald-500">Online</span>
    ) : dbStatus === 'offline' ? (
      <span className="text-red-500">Offline</span>
    ) : (
      <span className="text-sky-400">Verificando</span>
    );

  return (
    <aside
      className={`${expanded ? 'w-[220px]' : 'w-[72px]'} flex flex-col items-center py-3 bg-card border-r border-border relative z-50 shrink-0 h-full overflow-y-auto no-scrollbar transition-[width] duration-200 ease-in-out`}
    >
      {/* ─── Logo + Toggle ─────────────────────────────────────────── */}
      <div className={`flex items-center w-full px-3 mb-3 gap-2 ${expanded ? 'justify-between' : 'flex-col'}`}>
        <div
          className="w-10 h-10 rounded-xl bg-[#111] flex items-center justify-center shadow-[0_0_15px_rgba(161,119,61,0.3)] shrink-0 cursor-pointer overflow-hidden"
          onClick={() => router.push('/atendimento/dashboard')}
          onMouseEnter={(e) => showTooltip(e, 'Página Inicial')}
          onMouseLeave={hideTooltip}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/LOGO SEM FUNDO.png" alt="Logo" className="w-full h-full object-contain p-1" draggable={false} />
        </div>
        <button
          onClick={toggleExpanded}
          onMouseEnter={(e) => showTooltip(e, expanded ? 'Recolher menu' : 'Expandir menu')}
          onMouseLeave={hideTooltip}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors shrink-0"
          aria-label={expanded ? 'Recolher menu' : 'Expandir menu'}
        >
          <ChevronRight
            size={15}
            strokeWidth={2.5}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* ─── Navigation Groups ─────────────────────────────────────── */}
      <nav className="flex-1 flex flex-col gap-0 w-full px-3 overflow-y-auto no-scrollbar">
        {groups.map((group, gi) => (
          <div key={group.id} className={gi > 0 ? 'mt-3' : ''}>
            {/* Label de grupo (expandido) ou separador (recolhido) */}
            {expanded ? (
              <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest px-1 mb-1.5">
                {group.label}
              </p>
            ) : gi > 0 ? (
              <div className="h-px bg-border/40 mx-1 mb-2" />
            ) : null}

            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isActive = item.match(pathname);
                const badge = (item as any).badge as number | undefined;
                return (
                  <button
                    key={item.href}
                    onClick={() => { if (!isActive) router.push(item.href); }}
                    onMouseEnter={(e) => showTooltip(e, item.label)}
                    onMouseLeave={hideTooltip}
                    className={`w-full rounded-xl flex items-center relative shadow-sm transition-colors ${
                      expanded ? 'gap-2.5 px-2.5 py-2' : 'aspect-square justify-center'
                    } ${
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                  >
                    <span className="shrink-0">{item.icon}</span>

                    {expanded && (
                      <span className="text-[13px] font-medium truncate flex-1 text-left">
                        {item.label}
                      </span>
                    )}

                    {badge != null && badge > 0 && (
                      <span
                        className={`min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center shadow-md shrink-0 ${
                          expanded ? 'ml-auto' : 'absolute -top-1.5 -right-1.5'
                        }`}
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}

                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-md" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ─── Bottom: DB + Notificações + Tema + Sair ───────────────── */}
      <div className="mt-auto flex flex-col gap-1 w-full px-3 pt-3 border-t border-border/40">

        {/* DB status */}
        <div
          className={`w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 cursor-default text-muted-foreground ${expanded ? '' : 'justify-center'}`}
          onMouseEnter={(e) =>
            showTooltip(e,
              <span className="text-[11px] font-bold uppercase tracking-widest">
                Banco: {dbLabel}
              </span>
            )
          }
          onMouseLeave={hideTooltip}
        >
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-500 ${
              dbStatus === 'online'
                ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]'
                : dbStatus === 'offline'
                ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)] animate-pulse'
                : 'bg-sky-500 animate-pulse'
            }`}
          />
          {expanded && (
            <span className="text-[12px] font-medium">
              Banco: {dbLabel}
            </span>
          )}
        </div>

        {/* Notification Center */}
        <div
          className={`w-full flex items-center ${expanded ? 'gap-2.5 px-2 py-1' : 'justify-center py-1'}`}
          onMouseEnter={(e) => showTooltip(e, 'Notificações')}
          onMouseLeave={hideTooltip}
        >
          <NotificationCenter />
          {expanded && (
            <span className="text-[13px] font-medium text-muted-foreground">Notificações</span>
          )}
        </div>

        {/* Notification on/off toggle (DND permanente) */}
        <NotificationToggle
          variant={expanded ? 'sidebar-expanded' : 'sidebar-collapsed'}
          onMouseEnter={(e) => !expanded && showTooltip(e, 'Notificações')}
          onMouseLeave={hideTooltip}
        />

        {/* Theme picker */}
        <button
          ref={themeButtonRef}
          onClick={toggleThemeMenu}
          onMouseEnter={(e) => { if (!showThemeMenu) showTooltip(e, 'Aparência'); }}
          onMouseLeave={hideTooltip}
          className={`w-full rounded-xl flex items-center gap-2.5 shadow-sm transition-colors ${
            expanded ? 'px-2.5 py-2' : 'aspect-square justify-center'
          } ${
            showThemeMenu
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          <Palette size={18} strokeWidth={2} className="shrink-0" />
          {expanded && <span className="text-[13px] font-medium">Aparência</span>}
        </button>

        {/* Logout */}
        <button
          onClick={() => { localStorage.removeItem('token'); router.push('/atendimento/login'); }}
          onMouseEnter={(e) => showTooltip(e, 'Sair')}
          onMouseLeave={hideTooltip}
          className={`w-full rounded-xl flex items-center gap-2.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shadow-sm transition-colors ${
            expanded ? 'px-2.5 py-2' : 'aspect-square justify-center'
          }`}
        >
          <LogOut size={18} strokeWidth={2} className="shrink-0" />
          {expanded && <span className="text-[13px] font-medium">Sair</span>}
        </button>
      </div>

      {/* ─── Fixed tooltip portal ────────────────────────────────────── */}
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

      {/* ─── Fixed theme popup portal ────────────────────────────────── */}
      {mounted && showThemeMenu && themeMenuPos && createPortal(
        <div
          ref={themePopupRef}
          style={{ position: 'fixed', top: themeMenuPos.top, left: themeMenuPos.left, zIndex: 9999, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
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
