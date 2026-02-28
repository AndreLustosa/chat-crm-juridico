'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Inbox, Users, Briefcase, Settings, MessageCircle } from 'lucide-react';
import api from '@/lib/api';

export default function Dashboard() {
  const router = useRouter();
  const [leads, setLeads] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const fetchLeads = async () => {
      try {
        const res = await api.get('/leads');
        setLeads(res.data);
      } catch (e: any) {
        console.error('Failed to fetch leads');
        if (e.response?.status === 401) {
          localStorage.removeItem('token');
          router.push('/login');
        }
      }
    };
    fetchLeads();
  }, [router]);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col justify-between hidden md:flex">
        <div className="p-6">
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-500 mb-8">LexCRM</h2>
          <nav className="space-y-2">
            <a href="#" className="flex items-center px-4 py-3 text-blue-600 bg-blue-50 dark:bg-gray-700/50 rounded-lg font-medium transition-colors">
              <Inbox className="w-5 h-5 mr-3" />
              Inbox (WhatsApp)
            </a>
            <a href="#" className="flex items-center px-4 py-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg font-medium transition-colors">
              <Users className="w-5 h-5 mr-3" />
              Leads & CRM
            </a>
            <a href="#" className="flex items-center px-4 py-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg font-medium transition-colors">
              <Briefcase className="w-5 h-5 mr-3" />
              Tarefas
            </a>
            <a href="#" className="flex items-center px-4 py-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg font-medium transition-colors">
              <Settings className="w-5 h-5 mr-3" />
              Ajustes IA
            </a>
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

      {/* Main Content -> Inbox view for MVP */}
      <main className="flex-1 flex flex-col pt-8 px-8 overflow-y-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Caixa de Entrada / Leads</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gerencie conversas do WhatsApp e interações da IA.</p>
        </header>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 flex-1 overflow-hidden">
          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <MessageCircle className="w-12 h-12 mb-4 opacity-50" />
              <p>Nenhuma conversa encontrada</p>
            </div>
          ) : (
            <ul className="divide-y dark:divide-gray-700">
              {leads.map((lead) => (
                <li key={lead.id}>
                  <a href={`/chat/${lead.id}`} className="block hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-200 font-bold mr-4">
                          {lead.name?.charAt(0) || lead.phone.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{lead.name || lead.phone}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">Clique para abrir o chat...</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 uppercase tracking-widest">
                          {lead.stage}
                        </span>
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
