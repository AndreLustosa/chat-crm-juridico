'use client';

import { useRouter, usePathname } from 'next/navigation';
import { UserCog, Bot, Building2, Shield, ChevronLeft, MessageSquare, Layout } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';

const settingsMenu = [
  { label: 'Usuários & Perfis', href: '/settings/users', icon: UserCog },
  { label: 'Setores (Inboxes)', href: '/settings/inboxes', icon: Layout },
  { label: 'Ajustes IA', href: '/settings/ai', icon: Bot },
  { label: 'Integração WhatsApp', href: '/settings/whatsapp', icon: MessageSquare },
  { label: 'Escritório', href: '/settings/office', icon: Building2 },
  { label: 'Permissões', href: '/settings/permissions', icon: Shield },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      {/* Sidebar Secundária - Submenus de Configurações */}
      <aside className="w-64 border-r border-border hidden md:flex flex-col bg-card">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Configurações</h3>
            <button
              onClick={() => router.push('/')}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-all rounded-lg"
              title="Voltar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {settingsMenu.map((item) => {
            const isActive = pathname === item.href;
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center px-4 py-3 rounded-xl text-[14px] font-semibold transition-all ${
                  isActive
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
                }`}
              >
                <item.icon className={`w-4 h-4 mr-3 ${isActive ? 'text-primary' : 'opacity-70'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 flex flex-col bg-background overflow-hidden">
        {children}
      </main>
    </div>
  );
}
