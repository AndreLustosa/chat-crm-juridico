'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, CheckCircle2, Circle, Clock, Loader2, X, ListTodo,
  ChevronDown, ChevronRight, User,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface CaseTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  start_at: string;
  end_at: string | null;
  assigned_user: { id: string; name: string } | null;
  created_by: { id: string; name: string } | null;
  _count?: { comments: number };
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  });
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  AGENDADO: { label: 'Agendado', color: 'badge-info' },
  CONFIRMADO: { label: 'Confirmado', color: 'badge-primary' },
  CONCLUIDO: { label: 'Concluído', color: 'badge-success' },
  CANCELADO: { label: 'Cancelado', color: 'badge-error' },
  ADIADO: { label: 'Adiado', color: 'badge-warning' },
};

export default function TabTarefas({
  caseId,
  lawyerId,
}: {
  caseId: string;
  lawyerId: string;
}) {
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDue, setNewDue] = useState('');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/calendar/events/legal-case/${caseId}`);
      setTasks(res.data || []);
    } catch {
      showError('Erro ao carregar tarefas');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await api.post('/calendar/events', {
        type: 'TAREFA',
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        start_at: newDue || new Date().toISOString(),
        legal_case_id: caseId,
        assigned_user_id: lawyerId,
      });
      showSuccess('Tarefa criada');
      setNewTitle('');
      setNewDesc('');
      setNewDue('');
      setShowNew(false);
      fetchTasks();
    } catch {
      showError('Erro ao criar tarefa');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (task: CaseTask) => {
    const newStatus = task.status === 'CONCLUIDO' ? 'AGENDADO' : 'CONCLUIDO';
    try {
      await api.patch(`/calendar/events/${task.id}`, { status: newStatus });
      fetchTasks();
    } catch {
      showError('Erro ao atualizar tarefa');
    }
  };

  const filteredTasks = tasks.filter(t => {
    if (filter === 'pending') return t.status !== 'CONCLUIDO' && t.status !== 'CANCELADO';
    if (filter === 'done') return t.status === 'CONCLUIDO';
    return true;
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-primary" />
          Tarefas ({tasks.length})
        </h2>
        <button
          onClick={() => setShowNew(!showNew)}
          className="btn btn-primary btn-sm gap-1"
        >
          <Plus className="h-4 w-4" />
          Nova tarefa
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-1">
        {[
          { id: 'all' as const, label: 'Todas' },
          { id: 'pending' as const, label: 'Pendentes' },
          { id: 'done' as const, label: 'Concluídas' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`btn btn-xs ${filter === f.id ? 'btn-primary' : 'btn-ghost'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* New task form */}
      {showNew && (
        <div className="bg-base-200/50 rounded-lg p-4 space-y-3">
          <input
            className="input input-bordered input-sm w-full"
            placeholder="Título da tarefa"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <textarea
            className="textarea textarea-bordered textarea-sm w-full"
            placeholder="Descrição (opcional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            rows={2}
          />
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              className="input input-bordered input-sm"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
            />
            <div className="flex-1" />
            <button onClick={() => setShowNew(false)} className="btn btn-ghost btn-sm">
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim() || creating}
              className="btn btn-primary btn-sm gap-1"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <ListTodo className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhuma tarefa {filter === 'pending' ? 'pendente' : filter === 'done' ? 'concluída' : ''}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map(task => {
            const isDone = task.status === 'CONCLUIDO';
            const statusInfo = STATUS_MAP[task.status] || { label: task.status, color: 'badge-ghost' };

            return (
              <div
                key={task.id}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                  isDone ? 'bg-base-200/30 opacity-60' : 'bg-base-200/50 hover:bg-base-200'
                }`}
              >
                <button
                  onClick={() => handleToggle(task)}
                  className="mt-0.5 shrink-0"
                  title={isDone ? 'Reabrir' : 'Concluir'}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <Circle className="h-5 w-5 text-base-content/30 hover:text-primary" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isDone ? 'line-through' : ''}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="text-xs text-base-content/50 mt-0.5">{task.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-xs text-base-content/40">
                    <span className={`badge badge-xs ${statusInfo.color}`}>{statusInfo.label}</span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {formatDate(task.start_at)}
                    </span>
                    {task.assigned_user && (
                      <span className="flex items-center gap-0.5">
                        <User className="h-3 w-3" />
                        {task.assigned_user.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
