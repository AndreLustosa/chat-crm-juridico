'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Inbox, Users, Briefcase, Settings, Plus, CheckCircle2, Circle } from 'lucide-react';
import api from '@/lib/api';

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<any[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    fetchTasks();
  }, [router]);

  const fetchTasks = async () => {
    try {
      const res = await api.get('/tasks');
      setTasks(res.data);
    } catch (e) {
      console.error('Failed to fetch tasks');
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      await api.post('/tasks', {
        title: newTaskTitle
      });
      setNewTaskTitle('');
      fetchTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleTask = async (id: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'CONCLUIDO' ? 'A_FAZER' : 'CONCLUIDO';
      await api.patch(`/tasks/${id}/status`, {
        status: newStatus
      });
      fetchTasks();
    } catch (e) {
      console.error(e);
    }
  };

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
            <a href="/crm" className="flex items-center px-4 py-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg font-medium transition-colors">
              <Users className="w-5 h-5 mr-3" />
              Leads & CRM
            </a>
            <a href="/tasks" className="flex items-center px-4 py-3 text-blue-600 bg-blue-50 dark:bg-gray-700/50 rounded-lg font-medium transition-colors">
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

      {/* Main Content */}
      <main className="flex-1 flex flex-col pt-8 px-8 overflow-y-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Gerenciador de Tarefas</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Acompanhe seus prazos e pendências.</p>
        </header>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-6 flex-1">
          <form onSubmit={handleCreateTask} className="flex gap-4 mb-8">
            <input 
              type="text" 
              placeholder="Adicionar nova tarefa..." 
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              className="flex-1 px-4 py-3 border dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button type="submit" className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center transition-colors">
              <Plus className="w-5 h-5 mr-2" />
              Criar
            </button>
          </form>

          <div className="space-y-4">
            {tasks.map(task => (
              <div key={task.id} className="flex items-center p-4 border dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <button onClick={() => toggleTask(task.id, task.status)} className="flex-shrink-0 mr-4 text-gray-400 hover:text-blue-500 transition-colors">
                  {task.status === 'CONCLUIDO' ? (
                    <CheckCircle2 className="w-7 h-7 text-green-500" />
                  ) : (
                    <Circle className="w-7 h-7" />
                  )}
                </button>
                <div className="flex-1">
                  <p className={`text-lg font-medium ${task.status === 'CONCLUIDO' ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}>
                    {task.title}
                  </p>
                  {task.lead && (
                     <p className="text-sm text-gray-500 mt-1">Lead: {task.lead.name || task.lead.phone}</p>
                  )}
                </div>
              </div>
            ))}
            
            {tasks.length === 0 && (
              <p className="text-center text-gray-500 dark:text-gray-400 py-12">Nenhuma tarefa cadastrada.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
