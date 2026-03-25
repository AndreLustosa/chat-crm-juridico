'use client';

import { useRouter, usePathname } from 'next/navigation';
import { UserCog, Bot, Building2, Shield, ChevronLeft, MessageSquare, Layout, Briefcase, Bell, DollarSign, Calendar, FileSignature, Plug, Kanban } from 'lucide-react';

type MenuItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  submenu?: { label: string; href: string; icon: React.ElementType }[];
};

const settingsMenu: MenuItem[] = [
  { label: 'Setores (Inboxes)', href: '/atendimento/settings/inboxes', icon: Layout },
  { label: 'Departamentos', href: '/atendimento/settings/sectors', icon: Briefcase },
  { label: 'Usuários & Perfis', href: '/atendimento/settings/users', icon: UserCog },
  {
    label: 'Ajustes IA',
    href: '/atendimento/settings/ai',
    icon: Bot,
    submenu: [
      { label: 'Custos IA', href: '/atendimento/settings/costs', icon: DollarSign },
    ],
  },
  { label: 'Integração WhatsApp', href: '/atendimento/settings/whatsapp', icon: MessageSquare },
  { label: 'Contratos & Assinatura', href: '/atendimento/settings/contracts', icon: FileSignature },
  { label: 'Agenda & Escritório', href: '/atendimento/settings/office', icon: Calendar },
  { label: 'Permissões', href: '/atendimento/settings/permissions', icon: Shield },
  { label: 'Notificações', href: '/atendimento/settings/notifications', icon: Bell },
  { label: 'CRM Pipeline', href: '/atendimento/settings/crm', icon: Kanban },
  { label: 'Integração MCP', href: '/atendimento/settings/mcp', icon: Plug },
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
            const isParentOfActive = item.submenu?.some((s) => pathname === s.href) ?? false;
            const showSubmenu = isActive || isParentOfActive;

            return (
              <div key={item.href}>
                <button
                  onClick={() => router.push(item.href)}
                  className={`w-full flex items-center px-4 py-3 rounded-xl text-[14px] font-semibold transition-all ${
                    isActive || isParentOfActive
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
                  }`}
                >
                  <item.icon className={`w-4 h-4 mr-3 ${isActive || isParentOfActive ? 'text-primary' : 'opacity-70'}`} />
                  {item.label}
                </button>

                {/* Submenu — visível quando o pai ou um filho está ativo */}
                {item.submenu && showSubmenu && (
                  <div className="ml-4 mt-0.5 mb-0.5 space-y-0.5 border-l-2 border-primary/20 pl-3">
                    {item.submenu.map((sub) => {
                      const isSubActive = pathname === sub.href;
                      return (
                        <button
                          key={sub.href}
                          onClick={() => router.push(sub.href)}
                          className={`w-full flex items-center px-3 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                            isSubActive
                              ? 'text-primary bg-primary/10'
                              : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
                          }`}
                        >
                          <sub.icon className={`w-3.5 h-3.5 mr-2.5 ${isSubActive ? 'text-primary' : 'opacity-60'}`} />
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
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
