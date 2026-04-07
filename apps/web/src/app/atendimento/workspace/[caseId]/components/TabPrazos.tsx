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
  if (days < 0) return 'text-red-400';
  if (days <= 2) return 'text-red-400';
  if (days <= 5) return 'text-amber-400';
  return 'text-emerald-400';
}

function getUrgencyBorder(days: number): string {
  if (days < 0) return 'border-l-red-500';
  if (days <= 2) return 'border-l-red-500';
  if (days <= 5) return 'border-l-amber-500';
  return 'border-l-emerald-500';
}

function getUrgencyBg(days: number): string {
  if (days < 0) return 'bg-red-500/5';
  if (days <= 2) return 'bg-red-500/5';
  if (days <= 5) return 'bg-amber-500/5';
  return '';
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
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-accent/20">
          <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
            <Timer size={14} className="text-primary" />
            Prazos Processuais
          </h2>
          <div className="flex items-center gap-3">
            {/* Toggle completed */}
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => setShowCompleted(!showCompleted)}
                className={`w-8 h-4.5 rounded-full relative cursor-pointer transition-colors ${showCompleted ? 'bg-primary' : 'bg-accent/50 border border-border'}`}
              >
                <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${showCompleted ? 'right-0.5 bg-primary-foreground' : 'left-0.5 bg-muted-foreground/40'}`} />
              </div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cumpridos</span>
            </label>
            <button
              onClick={() => setShowNew(!showNew)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
            >
              {showNew ? <X size={12} /> : <Plus size={12} />}
              {showNew ? 'Fechar' : 'Novo prazo'}
            </button>
          </div>
        </div>

        {/* New deadline form */}
        {showNew && (
          <div className="border-b border-border bg-accent/10 p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock size={11} className="text-primary/60" />
                  Tipo
                </label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                >
                  {DEADLINE_TYPES.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Timer size={11} className="text-primary/60" />
                  Titulo
                </label>
                <input
                  type="text"
                  placeholder="Ex: Contestação na RT"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar size={11} className="text-primary/60" />
                  Data limite
                </label>
                <input
                  type="date"
                  value={newDueAt}
                  onChange={(e) => setNewDueAt(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle size={11} className="text-primary/60" />
                  Alertar X dias antes
                </label>
                <input
                  type="number"
                  value={newAlertDays}
                  onChange={(e) => setNewAlertDays(e.target.value)}
                  min={0}
                  className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Descricao (opcional)</label>
              <textarea
                placeholder="Descrição do prazo..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl bg-accent/30 border border-border text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-y transition-all"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || !newDueAt || creating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-primary/20"
              >
                {creating && <Loader2 size={12} className="animate-spin" />}
                Criar prazo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Deadline list */}
      {loading ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex justify-center py-16">
            <Loader2 size={20} className="animate-spin text-primary" />
          </div>
        </div>
      ) : deadlines.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/30 border border-border flex items-center justify-center">
              <Clock size={24} className="text-muted-foreground/30" />
            </div>
            <p className="text-[13px] font-bold text-foreground mb-1">Nenhum prazo {showCompleted ? '' : 'pendente'}</p>
            <p className="text-[11px] text-muted-foreground">
              {showCompleted ? 'Nenhum prazo cadastrado para este caso.' : 'Todos os prazos foram cumpridos ou nenhum foi cadastrado.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-accent/20 flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <Calendar size={14} className="text-primary" />
              Prazos
            </h2>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {deadlines.length} {deadlines.length === 1 ? 'prazo' : 'prazos'}
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {deadlines.map(dl => {
              const days = daysUntil(dl.due_at);
              const urgencyClass = dl.completed ? 'text-muted-foreground/40' : getUrgencyColor(days);
              const borderClass = dl.completed ? 'border-l-muted-foreground/20' : getUrgencyBorder(days);
              const bgClass = dl.completed ? '' : getUrgencyBg(days);
              const typeLabel = DEADLINE_TYPES.find(t => t.id === dl.type)?.label || dl.type;

              return (
                <div
                  key={dl.id}
                  className={`flex items-center gap-4 px-5 py-3.5 border-l-[3px] transition-colors hover:bg-accent/10 ${borderClass} ${bgClass} ${dl.completed ? 'opacity-50' : ''}`}
                >
                  {/* Urgency countdown */}
                  <div className={`shrink-0 w-14 text-center ${urgencyClass}`}>
                    {dl.completed ? (
                      <CheckCircle2 size={22} className="text-emerald-400 mx-auto" />
                    ) : days < 0 ? (
                      <div className="flex flex-col items-center">
                        <AlertTriangle size={18} className="mx-auto" />
                        <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">Vencido</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <span className="text-[20px] font-bold leading-none">{days}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">{days === 1 ? 'dia' : 'dias'}</span>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-bold text-foreground ${dl.completed ? 'line-through text-muted-foreground' : ''}`}>
                      {dl.title}
                    </p>
                    <div className="flex items-center gap-2.5 mt-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-accent/40 border border-border/50 text-muted-foreground">
                        {typeLabel}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar size={10} />
                        {formatDate(dl.due_at)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        por {dl.created_by.name}
                      </span>
                    </div>
                    {dl.description && (
                      <p className="text-[11px] text-muted-foreground/60 mt-1">{dl.description}</p>
                    )}
                  </div>

                  {/* Actions */}
                  {!dl.completed && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleComplete(dl.id)}
                        title="Marcar como cumprido"
                        className="p-2 rounded-xl text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(dl.id)}
                        title="Remover"
                        className="p-2 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
