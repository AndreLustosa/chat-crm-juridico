'use client';

/**
 * TabDiligencias — lista todas as Tasks vinculadas a este processo.
 *
 * Diferente da TabTarefas (que mostra CalendarEvents tipo TAREFA/PRAZO/
 * AUDIENCIA), esta aba mostra DILIGENCIAS — Tasks delegadas via "Nova
 * diligencia" pra estagiarios. Cada item tem:
 *   - Status (a fazer / em progresso / concluída)
 *   - Responsavel
 *   - Tracking (vista, iniciada, anexos, comentarios)
 *   - Click expande inline o TaskDetailDrawer pra ver chat + timeline
 *
 * Tambem tem botao "+ Nova diligência" que abre o NewDelegationModal
 * com legal_case_id pre-preenchido.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, MessageSquare, Loader2, UserCheck, CheckCircle2,
  Clock, AlertCircle, User, Eye, Play, EyeOff,
} from 'lucide-react';
import api from '@/lib/api';
import { TaskDetailDrawer } from '@/components/TaskDetailDrawer';

interface DiligenciaItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
  viewed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  assigned_user: { id: string; name: string } | null;
  created_by: { id: string; name: string } | null;
  _count?: { comments?: number; attachments?: number };
}

interface TabDiligenciasProps {
  caseId: string;
  /** ID da Task pra abrir automaticamente no drawer (vem do query param
   *  ?openTask= quando o usuário clica numa diligência delegada de outro
   *  painel). Limpo após primeira abertura. */
  initialOpenTaskId?: string | null;
  onClearInitialOpen?: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS: Record<string, { label: string; class: string; icon: any }> = {
  A_FAZER:      { label: 'A fazer',     class: 'bg-blue-500/10 text-blue-400 border-blue-500/30', icon: Clock },
  EM_PROGRESSO: { label: 'Em andamento',class: 'bg-amber-500/10 text-amber-400 border-amber-500/30', icon: Play },
  CONCLUIDA:    { label: 'Concluída',   class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  CANCELADA:    { label: 'Cancelada',   class: 'bg-gray-500/10 text-gray-400 border-gray-500/30', icon: AlertCircle },
};

export default function TabDiligencias({ caseId, initialOpenTaskId, onClearInitialOpen }: TabDiligenciasProps) {
  const [items, setItems] = useState<DiligenciaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  // Carrega usuario atual pra perspective do drawer
  useEffect(() => {
    api.get('/users/me').then(r => setCurrentUserId(r.data?.id || '')).catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Endpoint findByLegalCase ja existe — retorna Tasks vinculadas
      const res = await api.get(`/tasks/legal-case/${caseId}`);
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Abre automaticamente a Task indicada via ?openTask= no URL.
  // Roda quando initialOpenTaskId muda (parent tira do query e passa).
  // Apos abrir, chama onClearInitialOpen pra parent limpar o param.
  useEffect(() => {
    if (initialOpenTaskId) {
      setOpenTaskId(initialOpenTaskId);
      onClearInitialOpen?.();
    }
  }, [initialOpenTaskId, onClearInitialOpen]);

  // Listener pra abrir o NewDelegationModal global com caseId preenchido
  function openNewDelegation() {
    window.dispatchEvent(new CustomEvent('open-new-delegation', {
      detail: { legalCaseId: caseId, bindLabel: 'este processo' },
    }));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={20} />
      </div>
    );
  }

  // Separa ativas das concluidas (concluidas escondem por default)
  const active = items.filter(i => i.status !== 'CONCLUIDA');
  const completed = items.filter(i => i.status === 'CONCLUIDA');

  return (
    <div className="space-y-4">
      {/* Header com totais + botao Nova */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-blue-400" />
          Diligências ({active.length}{completed.length > 0 ? ` + ${completed.length} concluídas` : ''})
        </h2>
        <button
          onClick={openNewDelegation}
          className="btn btn-primary btn-sm gap-1"
        >
          <Plus className="h-4 w-4" />
          Nova diligência
        </button>
      </div>

      {/* Vazio */}
      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <MessageSquare className="mx-auto text-muted-foreground/30 mb-2" size={32} />
          <p className="text-sm font-semibold text-muted-foreground mb-1">
            Nenhuma diligência neste processo
          </p>
          <p className="text-xs text-muted-foreground/70 mb-3">
            Use diligências pra delegar tarefas rápidas pro estagiário (ex: ligar
            pro cliente, pegar documento) sem precisar criar evento processual.
          </p>
          <button
            onClick={openNewDelegation}
            className="text-xs text-primary hover:underline"
          >
            + Criar primeira diligência
          </button>
        </div>
      )}

      {/* Ativas */}
      {active.length > 0 && (
        <div className="space-y-2">
          {active.map(t => (
            <DiligenciaRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} />
          ))}
        </div>
      )}

      {/* Toggle concluídas — discretas pra nao confundir com pendente */}
      {completed.length > 0 && (
        <div>
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCompleted ? <EyeOff size={11} /> : <Eye size={11} />}
            {showCompleted ? 'Ocultar' : 'Ver'} {completed.length} concluída{completed.length === 1 ? '' : 's'}
          </button>
          {showCompleted && (
            <div className="space-y-2 mt-2">
              {completed.map(t => (
                <DiligenciaRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} dimmed />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drawer com timeline + chat + anexos */}
      <TaskDetailDrawer
        open={!!openTaskId}
        taskId={openTaskId}
        perspective="lawyer"
        currentUserId={currentUserId}
        onClose={() => setOpenTaskId(null)}
        onChanged={fetchData}
      />
    </div>
  );
}

function DiligenciaRow({
  task, onOpen, dimmed = false,
}: {
  task: DiligenciaItem;
  onOpen: () => void;
  dimmed?: boolean;
}) {
  const cfg = STATUS[task.status] || STATUS.A_FAZER;
  const isOverdue = task.due_at && task.status !== 'CONCLUIDA' && new Date(task.due_at) < new Date();
  return (
    <div
      onClick={onOpen}
      className={`rounded-xl border p-3 cursor-pointer hover:shadow-sm transition-all ${
        dimmed ? 'opacity-50 hover:opacity-70 border-border bg-muted/20' :
        isOverdue ? 'border-red-500/40 bg-red-500/5' :
        task.status === 'EM_PROGRESSO' ? 'border-amber-500/40 bg-amber-500/5' :
        'border-blue-500/30 bg-blue-500/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Status + prazo */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${cfg.class}`}>
              {cfg.label}
            </span>
            {task.due_at && task.status !== 'CONCLUIDA' && (
              <span className={`text-[10px] font-semibold ${isOverdue ? 'text-red-400' : 'text-muted-foreground'}`}>
                {isOverdue ? '⚠ Atrasada' : `Prazo ${new Date(task.due_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`}
              </span>
            )}
          </div>

          {/* Titulo */}
          <p className="text-[13px] font-bold text-foreground leading-tight">
            {task.title}
          </p>
          {task.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
              {task.description}
            </p>
          )}

          {/* Footer: responsavel + indicadores */}
          <div className="flex items-center justify-between text-[10px] mt-2 pt-2 border-t border-border/40 flex-wrap gap-2">
            <span className="text-muted-foreground flex items-center gap-1">
              <UserCheck size={10} className="text-blue-400" />
              {task.assigned_user?.name || '—'}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {task.viewed_at && task.status !== 'CONCLUIDA' && (
                <span className="text-violet-400" title={`Vista em ${formatDateTime(task.viewed_at)}`}>
                  👁 vista
                </span>
              )}
              {task._count?.comments && task._count.comments > 0 && (
                <span className="text-muted-foreground flex items-center gap-0.5" title={`${task._count.comments} comentário(s)`}>
                  <MessageSquare size={9} /> {task._count.comments}
                </span>
              )}
              {task._count?.attachments && task._count.attachments > 0 && (
                <span className="text-muted-foreground flex items-center gap-0.5" title={`${task._count.attachments} anexo(s)`}>
                  📎 {task._count.attachments}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
