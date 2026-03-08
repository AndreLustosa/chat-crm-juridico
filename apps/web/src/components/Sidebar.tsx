'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, Users, Briefcase, Settings, Palette, Check, MessageSquare, Megaphone, Scale, BookOpen, Calendar, LayoutDashboard } from 'lucide-react';
import { useTheme } from 'next-themes';
import { API_BASE_URL } from '@/lib/api';

const THEMES = [
  { id: 'logo-dark', name: 'Dark (Logo)', color: '#000000' },
  { id: 'logo-light', name: 'Light (Logo)', color: '#fafafa' },
  { id: 'modern-dark', name: 'Modern Dark', color: '#0a0a0f' },
  { id: 'modern-light', name: 'Modern Light', color: '#f8fafc' },
  { id: 'rose-light', name: 'Rose Light', color: '#fff1f2' },
];

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const [dbStatus, setDbStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [unreadTotal, setUnreadTotal] = useState<number>(0);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const checkDb = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health/db`);
        const data = await res.json();
        setDbStatus(data.status === 'ok' ? 'online' : 'offline');
      } catch (error) {
        setDbStatus('offline');
      }
    };

    checkDb();
    const interval = setInterval(checkDb, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      setUnreadTotal((e as CustomEvent).detail?.total ?? 0);
    };
    window.addEventListener('unread_count_update', handler);
    return () => window.removeEventListener('unread_count_update', handler);
  }, []);

  const navItems = [
    { label: 'Dashboard', href: '/atendimento/dashboard', icon: <LayoutDashboard size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/dashboard') },
    { label: 'Inbox (WhatsApp)', href: '/atendimento', icon: <MessageSquare size={22} strokeWidth={2} />, match: (p: string) => p === '/atendimento' || p.startsWith('/atendimento/chat'), badge: unreadTotal },
    { label: 'Leads & CRM', href: '/atendimento/crm', icon: <Briefcase size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/crm') },
    { label: 'Contatos', href: '/atendimento/contacts', icon: <Users size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/contacts') },
    { label: 'Agenda', href: '/atendimento/agenda', icon: <Calendar size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/agenda') },
    { label: 'Advogado', href: '/atendimento/advogado', icon: <Scale size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/advogado') },
    { label: 'Processos', href: '/atendimento/processos', icon: <BookOpen size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/processos') },
    { label: 'Analytics', href: '/atendimento/marketing/analytics', icon: <Megaphone size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/marketing') },
    { label: 'Configurações', href: '/atendimento/settings', icon: <Settings size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/atendimento/settings') },
  ];

  return (
      <aside className="w-[72px] flex flex-col items-center py-6 bg-card border-r border-border relative z-50 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-[#111] flex items-center justify-center shadow-[0_0_15px_rgba(161,119,61,0.3)] mb-8 shrink-0 cursor-pointer group relative overflow-hidden" onClick={() => router.push('/atendimento/dashboard')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/LOGO SEM FUNDO.png" alt="André Lustosa" className="w-full h-full object-contain p-1" draggable={false} />
          <div className="absolute left-[56px] px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl border border-border flex items-center z-[200] before:content-[''] before:absolute before:-left-[5px] before:top-1/2 before:-translate-y-1/2 before:border-y-[5px] before:border-y-transparent before:border-r-[5px] before:border-r-border">
            Página Inicial
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-4 w-full px-3">
          {navItems.map((item) => {
            const isActive = item.match(pathname);
            return (
              <button key={item.href} onClick={() => { if (!isActive) router.push(item.href); }} className={`w-full aspect-square rounded-xl flex items-center justify-center relative shadow-sm group transition-colors ${isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}>
                {item.icon}
                {(item as any).badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center shadow-md">
                    {(item as any).badge > 99 ? '99+' : (item as any).badge}
                  </span>
                )}
                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-md"></div>}
                
                <div className="absolute left-[64px] px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl border border-border flex items-center z-[200] before:content-[''] before:absolute before:-left-[5px] before:top-1/2 before:-translate-y-1/2 before:border-y-[5px] before:border-y-transparent before:border-r-[5px] before:border-r-border">
                  {item.label}
                </div>
              </button>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-4 w-full px-3 relative" ref={themeMenuRef}>
          <div className="relative group w-full flex justify-center py-1">
            <div className={`w-3 h-3 rounded-full transition-all duration-500 shadow-sm ${
              dbStatus === 'online' ? 'bg-emerald-500 shadow-emerald-500/20' : 
              dbStatus === 'offline' ? 'bg-red-500 shadow-red-500/20 animate-pulse' : 
              'bg-amber-500 shadow-amber-500/20 animate-spin-slow'
            }`} />
            
            <div className="absolute left-[64px] px-3 py-2 bg-card text-foreground text-[11px] font-bold uppercase tracking-widest rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl border border-border flex items-center z-[200] before:content-[''] before:absolute before:-left-[5px] before:top-1/2 before:-translate-y-1/2 before:border-y-[5px] before:border-y-transparent before:border-r-[5px] before:border-r-border">
              Banco: <span className={dbStatus === 'online' ? 'text-emerald-500 ml-1' : 'text-red-500 ml-1'}>
                {dbStatus === 'online' ? 'Online' : dbStatus === 'offline' ? 'Offline' : 'Verificando...'}
              </span>
            </div>
          </div>

          <button 
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            className={`w-full aspect-square rounded-xl flex items-center justify-center relative shadow-sm group transition-colors ${showThemeMenu ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
          >
            <Palette size={20} strokeWidth={2} />
            
            {!showThemeMenu && (
              <div className="absolute left-[64px] px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl border border-border flex items-center z-[200] before:content-[''] before:absolute before:-left-[5px] before:top-1/2 before:-translate-y-1/2 before:border-y-[5px] before:border-y-transparent before:border-r-[5px] before:border-r-border">
                Aparência
              </div>
            )}
          </button>

          {showThemeMenu && (
            <div className="absolute bottom-[60px] left-[70px] bg-card border border-border rounded-xl p-3 flex flex-col gap-2 w-48 shadow-2xl z-[100]">
              <p className="text-[11px] font-bold text-muted-foreground uppercase ml-1 mb-1 tracking-wider">Temas</p>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTheme(t.id); setShowThemeMenu(false); }}
                  className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-foreground transition-colors hover:bg-accent ${theme === t.id ? 'bg-accent' : 'bg-transparent'}`}
                >
                   <div className="flex items-center gap-3">
                     <div className="w-3.5 h-3.5 rounded-full border border-border shadow-inner" style={{ background: t.color }} />
                     {t.name}
                   </div>
                   {theme === t.id && <Check size={14} className="text-primary" />}
                </button>
              ))}
            </div>
          )}

          <button 
            onClick={() => { localStorage.removeItem('token'); router.push('/atendimento/login'); }}
            className="w-full aspect-square rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex items-center justify-center relative shadow-sm group transition-colors"
          >
            <LogOut size={20} strokeWidth={2} />
            <div className="absolute left-[64px] px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl border border-border flex items-center z-[200] before:content-[''] before:absolute before:-left-[5px] before:top-1/2 before:-translate-y-1/2 before:border-y-[5px] before:border-y-transparent before:border-r-[5px] before:border-r-border">
              Sair
            </div>
          </button>
        </div>
      </aside>
  );
}
