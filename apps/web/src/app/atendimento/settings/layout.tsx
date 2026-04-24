'use client';

import { useRouter, usePathname } from 'next/navigation';
import {
  UserCog, Bot, Shield, ChevronLeft, MessageSquare, Layout, Briefcase,
  Bell, DollarSign, Calendar, FileSignature, Plug, Kanban, Zap, GitBranch,
  CreditCard, FileText, Building2, Users, Wallet, Cpu, Link2, HardDrive,
  Brain, AudioLines,
} from 'lucide-react';
import { useRole } from '@/lib/useRole';
import { RouteGuard } from '@/components/RouteGuard';

// ─── Menu organizado por seções ────────────────────────────

type SubItem = { label: string; href: string; icon: React.ElementType };
type MenuItem = { label: string; href: string; icon: React.ElementType; children?: SubItem[] };
type MenuSection = { title: string; items: MenuItem[] };

const settingsSections: MenuSection[] = [
  {
    title: 'Equipe & Acesso',
    items: [
      { label: 'Usuários & Perfis', href: '/atendimento/settings/users', icon: UserCog },
      { label: 'Permissões', href: '/atendimento/settings/permissions', icon: Shield },
      { label: 'Departamentos', href: '/atendimento/settings/sectors', icon: Briefcase },
    ],
  },
  {
    title: 'Atendimento',
    items: [
      { label: 'Setores (Inboxes)', href: '/atendimento/settings/inboxes', icon: Layout },
      { label: 'Respostas Rápidas', href: '/atendimento/settings/canned-responses', icon: Zap },
      { label: 'CRM Pipeline', href: '/atendimento/settings/crm', icon: Kanban },
      { label: 'Notificações', href: '/atendimento/settings/notifications', icon: Bell },
      { label: 'Automações', href: '/atendimento/settings/automations', icon: GitBranch },
    ],
  },
  {
    title: 'Escritório',
    items: [
      { label: 'Agenda & Horários', href: '/atendimento/settings/office', icon: Calendar },
      { label: 'Contratos & Assinatura', href: '/atendimento/settings/contracts', icon: FileSignature },
    ],
  },
  {
    title: 'Financeiro',
    items: [
      { label: 'Gateway de Pagamento', href: '/atendimento/settings/payment-gateway', icon: CreditCard },
      { label: 'Nota Fiscal (NFS-e)', href: '/atendimento/settings/nota-fiscal', icon: FileText },
    ],
  },
  {
    title: 'Inteligência Artificial',
    items: [
      {
        label: 'Ajustes IA',
        href: '/atendimento/settings/ai',
        icon: Bot,
        children: [
          { label: 'Custos IA', href: '/atendimento/settings/costs', icon: DollarSign },
        ],
      },
      { label: 'Base de Conhecimento', href: '/atendimento/settings/knowledge', icon: Brain },
      { label: 'Transcrição', href: '/atendimento/settings/transcricao', icon: AudioLines },
    ],
  },
  {
    title: 'Integrações',
    items: [
      { label: 'WhatsApp (Evolution)', href: '/atendimento/settings/whatsapp', icon: MessageSquare },
      { label: 'Google Drive', href: '/atendimento/settings/google-drive', icon: HardDrive },
      { label: 'Integração MCP', href: '/atendimento/settings/mcp', icon: Plug },
    ],
  },
];

// Rotas restritas a ADMIN
const adminOnlyPaths = new Set([
  '/atendimento/settings/users',
  '/atendimento/settings/permissions',
  '/atendimento/settings/ai',
  '/atendimento/settings/costs',
  '/atendimento/settings/knowledge',
  '/atendimento/settings/whatsapp',
  '/atendimento/settings/automations',
  '/atendimento/settings/google-drive',
  '/atendimento/settings/mcp',
  '/atendimento/settings/payment-gateway',
  '/atendimento/settings/nota-fiscal',
  '/atendimento/settings/transcricao',
]);

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin } = useRole();

  const isItemVisible = (href: string) => isAdmin || !adminOnlyPaths.has(href);
  const isActive = (href: string) => pathname === href;

  return (
    <div className="flex h-full bg-background overflow-hidden">

      {/* Sidebar de Configurações */}
      <aside className="w-64 border-r border-border hidden md:flex flex-col bg-card">
        <div className="p-5 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Configurações</h3>
            <button
              onClick={() => router.push('/atendimento')}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-all rounded-lg"
              title="Voltar ao sistema"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar">
          {settingsSections.map((section) => {
            const visibleItems = section.items.filter(item => isItemVisible(item.href));
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.title} className="py-2">
                {/* Section header */}
                <p className="px-5 py-1.5 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                  {section.title}
                </p>

                {/* Section items */}
                <div className="px-2 space-y-0.5">
                  {visibleItems.map((item) => {
                    const active = isActive(item.href);
                    const childActive = item.children?.some(c => isActive(c.href)) ?? false;
                    const highlight = active || childActive;

                    return (
                      <div key={item.href}>
                        <button
                          onClick={() => router.push(item.href)}
                          className={`w-full flex items-center px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all ${
                            highlight
                              ? 'text-primary bg-primary/10'
                              : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                          }`}
                        >
                          <item.icon className={`w-4 h-4 mr-3 shrink-0 ${highlight ? 'text-primary' : 'opacity-60'}`} />
                          <span className="truncate">{item.label}</span>
                        </button>

                        {/* Submenu children */}
                        {item.children && (active || childActive) && (
                          <div className="ml-5 mt-0.5 mb-1 space-y-0.5 border-l-2 border-primary/20 pl-2">
                            {item.children.filter(c => isItemVisible(c.href)).map((child) => {
                              const subActive = isActive(child.href);
                              return (
                                <button
                                  key={child.href}
                                  onClick={() => router.push(child.href)}
                                  className={`w-full flex items-center px-2.5 py-2 rounded-md text-[12px] font-medium transition-all ${
                                    subActive
                                      ? 'text-primary bg-primary/10'
                                      : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                                  }`}
                                >
                                  <child.icon className={`w-3.5 h-3.5 mr-2 shrink-0 ${subActive ? 'text-primary' : 'opacity-50'}`} />
                                  <span className="truncate">{child.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 overflow-auto">
        <RouteGuard allowedRoles={['ADMIN']}>
          {children}
        </RouteGuard>
      </main>
    </div>
  );
}
