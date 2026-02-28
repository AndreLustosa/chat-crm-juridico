'use client';

import { useRouter, usePathname } from 'next/navigation';
import { LogOut, Inbox, Users, Briefcase, Settings, UserCog, Bot, Building2, Shield, ChevronLeft } from 'lucide-react';

const settingsMenu = [
  { label: 'Usuários & Perfis', href: '/settings/users', icon: UserCog },
  { label: 'Ajustes IA', href: '/settings/ai', icon: Bot },
  { label: 'Escritório', href: '/settings/office', icon: Building2 },
  { label: 'Permissões', href: '/settings/permissions', icon: Shield },
];

const mainNav = [
  { label: 'Inbox (WhatsApp)', href: '/', icon: Inbox },
  { label: 'Leads & CRM', href: '/crm', icon: Users },
  { label: 'Tarefas', href: '/tasks', icon: Briefcase },
  { label: 'Configurações', href: '/settings/users', icon: Settings },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar Principal */}
      <aside className="w-64 border-r dark:border-gray-800 flex flex-col justify-between hidden md:flex">
        <div className="p-6">
          <h2
            className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-500 mb-8 cursor-pointer"
            onClick={() => router.push('/')}
          >
            LexCRM
          </h2>
          <nav className="space-y-2">
            {mainNav.map((item) => {
              const isActive = item.href.startsWith('/settings')
                ? pathname.startsWith('/settings')
                : pathname === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`flex items-center px-4 py-3 rounded-lg font-medium transition-colors ${
                    isActive
                      ? 'text-blue-600 bg-blue-50 dark:bg-gray-700/50'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>
        <div className="p-6">
          <button
            onClick={() => { localStorage.removeItem('token'); router.push('/login'); }}
            className="flex w-full items-center px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sair
          </button>
        </div>
      </aside>

      {/* Sidebar Secundária - Submenus de Configurações */}
      <aside className="w-60 border-r dark:border-gray-800 hidden md:flex flex-col">
        <div className="p-5 border-b dark:border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Configurações</h3>
            <button
              onClick={() => router.push('/')}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {settingsMenu.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-blue-600 bg-blue-50 dark:bg-gray-700/70 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/40 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <item.icon className="w-4 h-4 mr-3" />
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
