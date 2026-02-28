'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, Users, Briefcase, Settings, Palette, Check, MessageSquare } from 'lucide-react';
import { useTheme } from 'next-themes';

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navItems = [
    { label: 'Inbox (WhatsApp)', href: '/', icon: <MessageSquare size={22} strokeWidth={2} />, match: (p: string) => p === '/' || p.startsWith('/chat') },
    { label: 'Leads & CRM', href: '/crm', icon: <Briefcase size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/crm') },
    { label: 'Contatos', href: '/contacts', icon: <Users size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/contacts') },
    { label: 'Tarefas', href: '/tasks', icon: <Check size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/tasks') },
    { label: 'Configurações', href: '/settings', icon: <Settings size={22} strokeWidth={2} />, match: (p: string) => p.startsWith('/settings') },
  ];

  return (
      <aside className="w-[72px] flex flex-col items-center py-6 bg-card border-r border-border relative z-50 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#a1773d] to-[#eae2a1] flex items-center justify-center font-bold text-black shadow-[0_0_15px_rgba(161,119,61,0.2)] mb-8 shrink-0 cursor-pointer group relative" onClick={() => router.push('/')}>
          AL
          <div className="absolute left-[56px] px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl border border-border flex items-center z-[200] before:content-[''] before:absolute before:-left-[5px] before:top-1/2 before:-translate-y-1/2 before:border-y-[5px] before:border-y-transparent before:border-r-[5px] before:border-r-border">
            Página Inicial
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-4 w-full px-3">
          {navItems.map((item) => {
            const isActive = item.match(pathname);
            return (
              <button key={item.href} onClick={() => router.push(item.href)} className={`w-full aspect-square rounded-xl flex items-center justify-center relative shadow-sm group transition-colors ${isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}>
                {item.icon}
                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-md"></div>}
                
                <div className="absolute left-[64px] px-3 py-2 bg-card text-foreground text-[13px] font-semibold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl border border-border flex items-center z-[200] before:content-[''] before:absolute before:-left-[5px] before:top-1/2 before:-translate-y-1/2 before:border-y-[5px] before:border-y-transparent before:border-r-[5px] before:border-r-border">
                  {item.label}
                </div>
              </button>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-4 w-full px-3 relative" ref={themeMenuRef}>
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

          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] absolute right-[22px] bottom-[68px]"></div>

          <button 
            onClick={() => { localStorage.removeItem('token'); router.push('/login'); }}
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
