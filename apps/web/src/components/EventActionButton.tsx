'use client';

/**
 * EventActionButton — botoes padronizados de "dar andamento" pra qualquer
 * evento do sistema (CalendarEvent, Task, CaseDeadline).
 *
 * Usa o endpoint unificado /events/complete | /cancel | /postpone, que
 * internamente dispatcha pro service correto baseado no `type`.
 *
 * Sincronizacao automatica: qualquer acao propaga pros outros modelos
 * vinculados (Task -> Calendar -> Deadline e vice-versa).
 *
 * UX: um unico botao "Dar andamento" que abre um menu popover com as
 * 3 opcoes principais. Mantem visualmente enxuto em cards e tabelas.
 */

import { useState, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, Clock, ChevronDown, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

export type EventType = 'CALENDAR' | 'TASK' | 'DEADLINE';

interface Props {
  /** Tipo do evento no banco */
  type: EventType;
  /** ID do evento */
  id: string;
  /** Se ja ta concluido/cancelado, botao desabilita ou mostra estado */
  currentStatus?: string;
  /** Chamado apos a acao terminar com sucesso pra o pai recarregar dados */
  onActionComplete?: () => void;
  /** Variacao compacta pra usar em listas densas (so icone) */
  compact?: boolean;
  /** Label customizado do botao principal (default: "Dar andamento") */
  label?: string;
  /** Classe CSS adicional pro container */
  className?: string;
}

const ALREADY_DONE_STATUSES = new Set([
  'CONCLUIDO', 'CONCLUIDA', 'CANCELADO', 'CANCELADA',
]);

export function EventActionButton({
  type,
  id,
  currentStatus,
  onActionComplete,
  compact = false,
  label = 'Dar andamento',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'complete' | 'cancel' | 'postpone' | null>(null);
  const [showNoteInput, setShowNoteInput] = useState<'complete' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const [showPostpone, setShowPostpone] = useState(false);
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeReason, setPostponeReason] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNoteInput(null);
        setShowPostpone(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isAlreadyDone = currentStatus ? ALREADY_DONE_STATUSES.has(currentStatus) : false;

  const doAction = async (action: 'complete' | 'cancel', noteValue?: string) => {
    setLoading(action);
    try {
      const endpoint = action === 'complete' ? '/events/complete' : '/events/cancel';
      const body: any = { type, id };
      if (action === 'complete' && noteValue) body.note = noteValue;
      if (action === 'cancel' && noteValue) body.reason = noteValue;
      await api.post(endpoint, body);
      showSuccess(action === 'complete' ? 'Marcado como concluído' : 'Cancelado');
      setOpen(false);
      setShowNoteInput(null);
      setNote('');
      onActionComplete?.();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao executar ação');
    } finally {
      setLoading(null);
    }
  };

  const doPostpone = async () => {
    if (!postponeDate) {
      showError('Selecione uma nova data');
      return;
    }
    setLoading('postpone');
    try {
      await api.post('/events/postpone', {
        type,
        id,
        new_date: new Date(postponeDate).toISOString(),
        reason: postponeReason || 'Adiado pelo advogado',
      });
      showSuccess('Evento adiado');
      setOpen(false);
      setShowPostpone(false);
      setPostponeDate('');
      setPostponeReason('');
      onActionComplete?.();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao adiar');
    } finally {
      setLoading(null);
    }
  };

  const doReopen = async () => {
    setLoading('complete'); // reusa mesmo loading
    try {
      await api.post('/events/reopen', { type, id });
      showSuccess('Evento reaberto');
      setOpen(false);
      onActionComplete?.();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao reabrir');
    } finally {
      setLoading(null);
    }
  };

  // Se ja concluido/cancelado, botao de reabrir
  if (isAlreadyDone) {
    return (
      <button
        onClick={doReopen}
        disabled={loading !== null}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 ${className}`}
        title="Reabrir evento"
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Clock size={11} />}
        {!compact && 'Reabrir'}
      </button>
    );
  }

  return (
    <div ref={menuRef} className={`relative inline-block ${className}`}>
      {compact ? (
        <button
          onClick={() => setOpen(!open)}
          disabled={loading !== null}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          title={label}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
        </button>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          disabled={loading !== null}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
          {label}
          <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[260px] bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          {!showNoteInput && !showPostpone && (
            <div className="py-1">
              <button
                onClick={() => setShowNoteInput('complete')}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-emerald-500/10 text-left transition-colors"
              >
                <CheckCircle2 size={13} className="text-emerald-400" />
                Concluir
              </button>
              <button
                onClick={() => setShowPostpone(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-amber-500/10 text-left transition-colors"
              >
                <Clock size={13} className="text-amber-400" />
                Adiar para outra data
              </button>
              <button
                onClick={() => setShowNoteInput('cancel')}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-red-500/10 text-left transition-colors"
              >
                <XCircle size={13} className="text-red-400" />
                Cancelar
              </button>
            </div>
          )}

          {showNoteInput && (
            <div className="p-3 space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {showNoteInput === 'complete' ? 'Nota de cumprimento (opcional)' : 'Motivo do cancelamento (opcional)'}
              </label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={showNoteInput === 'complete' ? 'Ex: Audiência ocorreu, acordo celebrado' : 'Ex: Cliente desistiu'}
                rows={2}
                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowNoteInput(null); setNote(''); }}
                  className="flex-1 py-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-accent transition-colors"
                >
                  Voltar
                </button>
                <button
                  onClick={() => doAction(showNoteInput, note.trim() || undefined)}
                  disabled={loading !== null}
                  className={`flex-1 py-1.5 rounded-md text-[11px] font-medium text-white transition-colors disabled:opacity-50 ${
                    showNoteInput === 'complete'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  {loading ? <Loader2 size={11} className="animate-spin inline" /> : 'Confirmar'}
                </button>
              </div>
            </div>
          )}

          {showPostpone && (
            <div className="p-3 space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Nova data *
              </label>
              <input
                type="datetime-local"
                value={postponeDate}
                onChange={e => setPostponeDate(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Motivo (opcional)
              </label>
              <input
                type="text"
                value={postponeReason}
                onChange={e => setPostponeReason(e.target.value)}
                placeholder="Ex: Advogado indisponível"
                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowPostpone(false); setPostponeDate(''); setPostponeReason(''); }}
                  className="flex-1 py-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-accent transition-colors"
                >
                  Voltar
                </button>
                <button
                  onClick={doPostpone}
                  disabled={loading !== null || !postponeDate}
                  className="flex-1 py-1.5 rounded-md text-[11px] font-medium text-white bg-amber-600 hover:bg-amber-500 transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 size={11} className="animate-spin inline" /> : 'Adiar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
