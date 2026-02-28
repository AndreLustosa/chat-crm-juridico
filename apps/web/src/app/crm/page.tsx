'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Inbox, Users, Briefcase, Settings } from 'lucide-react';
import api from '@/lib/api';

const stages = ['NOVO', 'ATENDIMENTO', 'NEGOCIANDO', 'FECHADO'];

export default function CrmPage() {
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
      } catch (e) {
        console.error('Failed to fetch leads');
      }
    };
    fetchLeads();
  }, [router]);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col justify-between hidden md:flex">
        <div className="p-6">
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-500 mb-8 cursor-pointer" onClick={() => router.push('/')}>LexCRM</h2>
          <nav className="space-y-2">
            <a href="/" className="flex items-center px-4 py-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg font-medium transition-colors">
              <Inbox className="w-5 h-5 mr-3" />
              Inbox (WhatsApp)
            </a>
            <a href="/crm" className="flex items-center px-4 py-3 text-blue-600 bg-blue-50 dark:bg-gray-700/50 rounded-lg font-medium transition-colors">
              <Users className="w-5 h-5 mr-3" />
              Leads & CRM
            </a>
            <a href="/tasks" className="flex items-center px-4 py-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg font-medium transition-colors">
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

      {/* Main Content -> Kanban Board */}
      <main className="flex-1 flex flex-col pt-8 px-8 overflow-y-auto">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Pipeline de Vendas / Leads</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Acompanhe seus leads no formato Kanban.</p>
          </div>
        </header>

        <div className="flex h-full pb-8 space-x-6 overflow-x-auto">
          {stages.map(stage => {
            const stageLeads = leads.filter(l => (l.stage || 'NOVO').toUpperCase() === stage);
            return (
              <div key={stage} className="flex flex-col bg-gray-100 dark:bg-gray-800/50 rounded-xl min-w-[320px] max-w-[320px] p-4 border dark:border-gray-700">
                <div className="flex justify-between items-center mb-4 px-2">
                  <h3 className="font-semibold text-gray-700 dark:text-gray-200">{stage}</h3>
                  <span className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-1 px-3 rounded-full text-xs font-bold">
                    {stageLeads.length}
                  </span>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                  {stageLeads.map(lead => (
                    <div key={lead.id} onClick={() => router.push(`/chat/${lead.id}`)} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-blue-500 transition-colors">
                      <h4 className="font-medium text-gray-900 dark:text-white mb-1">{lead.name || lead.phone}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{lead.phone}</p>
                      
                      <div className="flex justify-between items-center">
                        <div className="flex space-x-1">
                          {(lead.tags || []).map((tag: string) => (
                             <span key={tag} className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-[10px] font-semibold px-2 py-0.5 rounded">
                               {tag}
                             </span>
                          ))}
                        </div>
                        <span className="text-xs text-gray-400">Há pouco</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
