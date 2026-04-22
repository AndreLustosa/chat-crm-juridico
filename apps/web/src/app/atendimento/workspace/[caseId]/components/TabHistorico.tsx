'use client';

/**
 * TabHistorico — Historico unificado de cumprimento de eventos do caso.
 *
 * Consome GET /events/history?legal_case_id=X que agrega os 3 modelos
 * (CalendarEvent, Task, CaseDeadline) ja terminados (CONCLUIDO/CANCELADO)
 * em uma lista unica ordenada por quando foram cumpridos.
 *
 * Mostra: tipo, titulo, nota de cumprimento (se houver), quem cumpriu e
 * quando. Permite filtrar por tipo de fonte.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, Clock, Loader2, History as HistoryIcon,
  StickyNote, User as UserIcon, Calendar, Gavel, Scale, FileText,
} from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';

interface HistoryItem {
  source: 'CALENDAR' | 'TASK' | 'DEADLINE';
  id: string;
  type: string;
  title: string;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  completion_note: string | null;
  completed_by: { id: string; name: string } | null;
}

const SOURCE_LABEL: Record<string, { label: string; icon: typeof Calendar; color: string }> = {
  CALENDAR: { label: 'Evento', icon: Calendar, color: 'text-blue-400' },
  TASK: { label: 'Tarefa', icon: CheckCircle2, color: 'text-emerald-400' },
  DEADLINE: { label: 'Prazo', icon: Clock, color: 'text-amber-400' },
};

const TYPE_EMOJI: Record<string, string> = {
  AUDIENCIA: '⚖️', PERICIA: '🔬', PRAZO: '⏰', TAREFA: '✅',
  CONSULTA: '📞', CONTESTACAO: '📝', RECURSO: '📄', IMPUGNACAO: '📝',
  MANIFESTACAO: '📝', OUTRO: '📌',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function relativeDays(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days}d`;
  if (days < 30) return `há ${Math.floor(days / 7)}sem`;
  if (days < 365) return `há ${Math.floor(days / 30)}mes`;
  return `há ${Math.floor(days / 365)}a`;
}

export default function TabHistorico({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'CALENDAR' | 'TASK' | 'DEADLINE'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CONCLUIDO' | 'CANCELADO'>('ALL');

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/events/history', {
        params: { legal_case_id: caseId, limit: 200 },
      });
      setItems(res.data?.items ?? []);
    } catch {
      showError('Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const filteredItems = items.filter(it => {
    if (filter !== 'ALL' && it.source !== filter) return false;
    if (statusFilter !== 'ALL') {
      const isConcluded = ['CONCLUIDO', 'CONCLUIDA'].includes(it.status);
      const isCancelled = ['CANCELADO', 'CANCELADA'].includes(it.status);
      if (statusFilter === 'CONCLUIDO' && !isConcluded) return false;
      if (statusFilter === 'CANCELADO' && !isCancelled) return false;
    }
    return true;
  });

  // Agrupar por data (dia) pra timeline visual
  const groupedByDay = filteredItems.reduce((acc, it) => {
    const d = it.completed_at ? new Date(it.completed_at) : null;
    const key = d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : 'sem-data';
    if (!acc[key]) acc[key] = [];
    acc[key].push(it);
    return acc;
  }, {} as Record<string, HistoryItem[]>);

  const sortedDays = Object.keys(groupedByDay).sort((a, b) => b.localeCompare(a));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2 text-foreground">
            <HistoryIcon size={16} className="text-primary" />
            Histórico de Cumprimento
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {items.length} registro{items.length !== 1 ? 's' : ''} de eventos concluídos/cancelados
          </p>
        </div>
        <button
          onClick={fetchHistory}
          className="text-[11px] font-semibold text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
        >
          Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
          {(['ALL', 'CALENDAR', 'TASK', 'DEADLINE'] as const).map(src => (
            <button
              key={src}
              onClick={() => setFilter(src)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                filter === src
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {src === 'ALL' ? 'Todos' : SOURCE_LABEL[src].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
          {(['ALL', 'CONCLUIDO', 'CANCELADO'] as const).map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                statusFilter === st
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {st === 'ALL' ? 'Todos' : st === 'CONCLUIDO' ? '✅ Concluídos' : '❌ Cancelados'}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" />
          Carregando...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-2xl">
          <HistoryIcon size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground mb-1">Nenhum registro</p>
          <p className="text-sm">
            {filter !== 'ALL' || statusFilter !== 'ALL'
              ? 'Ajuste os filtros para ver mais.'
              : 'Cumpra eventos pra popular o histórico.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDays.map(dayKey => {
            const dayItems = groupedByDay[dayKey];
            const firstDate = dayItems[0].completed_at ? new Date(dayItems[0].completed_at) : null;
            const dayLabel = firstDate
              ? firstDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
              : 'Sem data';
            const rel = firstDate ? relativeDays(firstDate.toISOString()) : '';

            return (
              <div key={dayKey} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    {dayLabel}
                  </h3>
                  {rel && <span className="text-[10px] text-muted-foreground/60">• {rel}</span>}
                  <div className="flex-1 border-t border-border/50" />
                </div>
                <div className="space-y-2">
                  {dayItems.map(it => {
                    const src = SOURCE_LABEL[it.source] ?? SOURCE_LABEL.CALENDAR;
                    const Icon = src.icon;
                    const isConcluded = ['CONCLUIDO', 'CONCLUIDA'].includes(it.status);
                    const isCancelled = ['CANCELADO', 'CANCELADA'].includes(it.status);
                    const typeEmoji = TYPE_EMOJI[it.type] ?? '📌';

                    return (
                      <div
                        key={`${it.source}-${it.id}`}
                        className="bg-card border border-border rounded-xl p-3.5 hover:border-primary/20 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {/* Icone + status visual */}
                          <div className={`shrink-0 mt-0.5 ${isConcluded ? 'text-emerald-400' : isCancelled ? 'text-red-400' : 'text-muted-foreground'}`}>
                            {isConcluded ? <CheckCircle2 size={16} /> : isCancelled ? <XCircle size={16} /> : <Clock size={16} />}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Linha 1: tipo + titulo */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 ${src.color} bg-muted`}>
                                <Icon size={9} />
                                {src.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground">{typeEmoji} {it.type}</span>
                              <p className="text-[13px] font-semibold text-foreground flex-1 min-w-0">
                                {it.title}
                              </p>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                  isConcluded
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}
                              >
                                {isConcluded ? 'CONCLUÍDO' : 'CANCELADO'}
                              </span>
                            </div>

                            {/* Linha 2: nota (se houver) */}
                            {it.completion_note && (
                              <div className="mt-2 flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                                <StickyNote size={11} className="text-amber-400 shrink-0 mt-0.5" />
                                <p className="text-[11px] text-foreground whitespace-pre-wrap break-words leading-relaxed">
                                  {it.completion_note}
                                </p>
                              </div>
                            )}

                            {/* Linha 3: metadados */}
                            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
                              {it.completed_by && (
                                <span className="flex items-center gap-1">
                                  <UserIcon size={9} />
                                  <span className="text-foreground font-medium">{it.completed_by.name}</span>
                                </span>
                              )}
                              {it.completed_at && (
                                <span className="flex items-center gap-1">
                                  <Clock size={9} />
                                  {formatDate(it.completed_at)}
                                </span>
                              )}
                              {it.scheduled_at && it.completed_at && (
                                <span className="text-muted-foreground/60">
                                  (agendado para {formatDate(it.scheduled_at)})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
