'use client';

import { useRouter, usePathname } from 'next/navigation';
import { UserCog, Bot, Building2, Shield, ChevronLeft, MessageSquare, Layout, Briefcase, Bell } from 'lucide-react';

const settingsMenu = [
  { label: 'Setores (Inboxes)', href: '/atendimento/settings/inboxes', icon: Layout },
  { label: 'Departamentos', href: '/atendimento/settings/sectors', icon: Briefcase },
  { label: 'Usuários & Perfis', href: '/atendimento/settings/users', icon: UserCog },
  { label: 'Ajustes IA', href: '/atendimento/settings/ai', icon: Bot },
  { label: 'Integração WhatsApp', href: '/atendimento/settings/whatsapp', icon: MessageSquare },
  { label: 'Escritório', href: '/atendimento/settings/office', icon: Building2 },
  { label: 'Permissões', href: '/atendimento/settings/permissions', icon: Shield },
  { label: 'Notificações', href: '/atendimento/settings/notifications', icon: Bell },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex h-full bg-background overflow-hidden">

      {/* Sidebar Secundária - Submenus de Configurações */}
      <aside className="w-64 border-r border-border hidden md:flex flex-col bg-card">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Configurações</h3>
            <button
              onClick={() => router.push('/atendimento')}
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
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
