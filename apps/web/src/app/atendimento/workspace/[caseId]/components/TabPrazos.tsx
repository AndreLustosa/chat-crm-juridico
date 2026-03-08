'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, CheckCircle2, Clock, Loader2, AlertTriangle, Calendar,
  Trash2, X, Timer,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface CaseDeadline {
  id: string;
  type: string;
  title: string;
  description: string | null;
  due_at: string;
  alert_days: number;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  created_by: { id: string; name: string };
  calendar_event: { id: string; status: string } | null;
}

const DEADLINE_TYPES = [
  { id: 'CONTESTACAO', label: 'Contestação' },
  { id: 'RECURSO', label: 'Recurso' },
  { id: 'IMPUGNACAO', label: 'Impugnação' },
  { id: 'MANIFESTACAO', label: 'Manifestação' },
  { id: 'AUDIENCIA', label: 'Audiência' },
  { id: 'PERICIA', label: 'Perícia' },
  { id: 'OUTRO', label: 'Outro' },
];

function daysUntil(date: string): number {
  const diff = new Date(date).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function getUrgencyColor(days: number): string {
  if (days < 0) return 'text-error';
  if (days <= 2) return 'text-error';
  if (days <= 5) return 'text-warning';
  return 'text-success';
}

export default function TabPrazos({ caseId }: { caseId: string }) {
  const [deadlines, setDeadlines] = useState<CaseDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  // New deadline form
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState('OUTRO');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDueAt, setNewDueAt] = useState('');
  const [newAlertDays, setNewAlertDays] = useState('2');
  const [creating, setCreating] = useState(false);

  const fetchDeadlines = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (!showCompleted) params.completed = 'false';
      const res = await api.get(`/case-deadlines/${caseId}`, { params });
      setDeadlines(res.data || []);
    } catch {
      showError('Erro ao carregar prazos');
    } finally {
      setLoading(false);
    }
  }, [caseId, showCompleted]);

  useEffect(() => {
    fetchDeadlines();
  }, [fetchDeadlines]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newDueAt) return;
    setCreating(true);
    try {
      await api.post(`/case-deadlines/${caseId}`, {
        type: newType,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        due_at: new Date(newDueAt).toISOString(),
        alert_days: parseInt(newAlertDays) || 2,
      });
      showSuccess('Prazo criado');
      setNewTitle('');
      setNewDesc('');
      setNewDueAt('');
      setShowNew(false);
      fetchDeadlines();
    } catch {
      showError('Erro ao criar prazo');
    } finally {
      setCreating(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await api.patch(`/case-deadlines/${id}/complete`);
      showSuccess('Prazo cumprido');
      fetchDeadlines();
    } catch {
      showError('Erro ao marcar como cumprido');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja remover este prazo?')) return;
    try {
      await api.delete(`/case-deadlines/${id}`);
      showSuccess('Prazo removido');
      fetchDeadlines();
    } catch {
      showError('Erro ao remover prazo');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          Prazos Processuais
        </h2>
        <button
          onClick={() => setShowNew(!showNew)}
          className="btn btn-primary btn-sm gap-1"
        >
          <Plus className="h-4 w-4" />
          Novo prazo
        </button>
      </div>

      {/* Toggle completed */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="checkbox checkbox-xs checkbox-primary"
          checked={showCompleted}
          onChange={(e) => setShowCompleted(e.target.checked)}
        />
        <span className="text-xs text-base-content/60">Mostrar prazos cumpridos</span>
      </label>

      {/* New deadline form */}
      {showNew && (
        <div className="bg-base-200/50 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Tipo</label>
              <select
                className="select select-bordered select-sm w-full"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                {DEADLINE_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Título</label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Ex: Contestação na RT"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="label text-xs">Data limite</label>
              <input
                type="date"
                className="input input-bordered input-sm w-full"
                value={newDueAt}
                onChange={(e) => setNewDueAt(e.target.value)}
              />
            </div>
            <div>
              <label className="label text-xs">Alertar X dias antes</label>
              <input
                type="number"
                className="input input-bordered input-sm w-full"
                value={newAlertDays}
                onChange={(e) => setNewAlertDays(e.target.value)}
                min={0}
              />
            </div>
          </div>
          <textarea
            className="textarea textarea-bordered textarea-sm w-full"
            placeholder="Descrição (opcional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="btn btn-ghost btn-sm">
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim() || !newDueAt || creating}
              className="btn btn-primary btn-sm gap-1"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar prazo
            </button>
          </div>
        </div>
      )}

      {/* Deadline list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : deadlines.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <Clock className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>Nenhum prazo {showCompleted ? '' : 'pendente'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {deadlines.map(dl => {
            const days = daysUntil(dl.due_at);
            const urgencyClass = dl.completed ? 'text-base-content/40' : getUrgencyColor(days);
            const typeLabel = DEADLINE_TYPES.find(t => t.id === dl.type)?.label || dl.type;

            return (
              <div
                key={dl.id}
                className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  dl.completed
                    ? 'bg-base-200/30 opacity-60'
                    : days < 0
                      ? 'bg-error/5 border border-error/20'
                      : days <= 2
                        ? 'bg-warning/5 border border-warning/20'
                        : 'bg-base-200/50 hover:bg-base-200'
                }`}
              >
                {/* Urgency indicator */}
                <div className={`shrink-0 text-center ${urgencyClass}`}>
                  {dl.completed ? (
                    <CheckCircle2 className="h-6 w-6 text-success" />
                  ) : days < 0 ? (
                    <div>
                      <AlertTriangle className="h-5 w-5 mx-auto" />
                      <span className="text-[10px] font-bold">VENCIDO</span>
                    </div>
                  ) : (
                    <div>
                      <span className="text-lg font-bold">{days}</span>
                      <br />
                      <span className="text-[10px]">{days === 1 ? 'dia' : 'dias'}</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${dl.completed ? 'line-through' : ''}`}>
                    {dl.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-base-content/50">
                    <span className="badge badge-xs badge-outline">{typeLabel}</span>
                    <span className="flex items-center gap-0.5">
                      <Calendar className="h-3 w-3" />
                      {formatDate(dl.due_at)}
                    </span>
                    <span>por {dl.created_by.name}</span>
                  </div>
                  {dl.description && (
                    <p className="text-xs text-base-content/40 mt-0.5">{dl.description}</p>
                  )}
                </div>

                {/* Actions */}
                {!dl.completed && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleComplete(dl.id)}
                      className="btn btn-ghost btn-xs gap-1 text-success"
                      title="Marcar como cumprido"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(dl.id)}
                      className="btn btn-ghost btn-xs text-error"
                      title="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
