'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, CheckCircle2, Circle, Briefcase } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
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
    } catch (e: any) {
      console.warn('Backend offline - Mock Mode ativado (sem tarefas reais)');
      if (e.response?.status === 401 && process.env.NODE_ENV !== 'development') {
        localStorage.removeItem('token');
        router.push('/login');
      }
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
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
        <header className="px-8 mb-6 shrink-0">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Gerenciador de Tarefas</h1>
          <p className="text-[13px] text-muted-foreground mt-1">Acompanhe seus prazos e pendências.</p>
        </header>

        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <div className="rounded-xl border border-border bg-card shadow-sm p-6 max-w-4xl mx-auto lg:mx-0">
            <form onSubmit={handleCreateTask} className="flex gap-4 mb-8">
              <input 
                type="text" 
                placeholder="Adicionar nova tarefa..." 
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                className="flex-1 px-4 py-3 border border-border rounded-lg bg-foreground/[0.03] text-foreground focus:ring-2 focus:ring-primary outline-none transition-all"
              />
              <button type="submit" className="px-6 py-3 btn-primary font-medium rounded-lg flex items-center transition-all hover:scale-[1.02] active:scale-[0.98]">
                <Plus className="w-5 h-5 mr-2" />
                Criar
              </button>
            </form>

            <div className="space-y-3">
              {tasks.map(task => (
                <div key={task.id} className="flex items-center p-4 border border-foreground/[0.06] bg-foreground/[0.02] rounded-xl hover:bg-foreground/[0.04] hover:border-foreground/10 transition-all group">
                  <button onClick={() => toggleTask(task.id, task.status)} className="flex-shrink-0 mr-4 text-muted-foreground hover:text-primary transition-colors">
                    {task.status === 'CONCLUIDO' ? (
                      <CheckCircle2 className="w-6 h-6 text-[#34d399]" />
                    ) : (
                      <Circle className="w-6 h-6 opacity-40 group-hover:opacity-100" />
                    )}
                  </button>
                  <div className="flex-1">
                    <p className={`text-[15px] font-semibold transition-all ${task.status === 'CONCLUIDO' ? 'text-muted-foreground line-through opacity-50' : 'text-foreground'}`}>
                      {task.title}
                    </p>
                    {task.lead && (
                       <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                         <span className="opacity-60">Lead:</span> 
                         <span className="font-medium">{task.lead.name || task.lead.phone}</span>
                       </p>
                    )}
                  </div>
                </div>
              ))}
              
              {tasks.length === 0 && (
                <div className="text-center py-16 opacity-40">
                  <div className="mb-2 flex justify-center">
                    <Briefcase className="w-12 h-12 stroke-[1.5]" />
                  </div>
                  <p className="text-sm font-medium">Nenhuma tarefa cadastrada.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
