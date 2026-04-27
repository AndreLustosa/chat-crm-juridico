'use client';

/**
 * TaskDetailDrawer — drawer lateral pra visualizar e interagir com uma
 * Task (diligencia). Usado tanto pelo advogado (acompanhar o que delegou)
 * quanto pelo estagiario (ver detalhes do que recebeu).
 *
 * Funcionalidades:
 *   - Timeline visual: criada → vista → iniciada → comentarios → concluida
 *   - Chat real entre advogado e estagiario (TaskComment via socket + push)
 *   - Lista de anexos com download
 *   - Acoes contextuais por papel:
 *       * Advogado (criador): "Cobrar" (push extra), comentar, ver tudo
 *       * Estagiario (responsavel): Iniciar, Concluir (abre modal), comentar
 *
 * Real-time: escuta socket 'task_comment' pra recarregar comentarios sem
 * refresh — chat fluido enquanto ambas as partes estao com o app aberto.
 */

import { useEffect, useRef, useState } from 'react';
import {
  X, Send, Loader2, MessageCircle, Clock, Eye, Play,
  CheckCircle2, Paperclip, Download, User, Scale, FileText, AlertCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { useSocket } from '@/lib/SocketProvider';

interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
  viewed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_note: string | null;
  assigned_user: { id: string; name: string } | null;
  created_by: { id: string; name: string } | null;
  completed_by: { id: string; name: string } | null;
  legal_case: {
    id: string;
    case_number: string | null;
    lead?: { id: string; name: string | null } | null;
  } | null;
  lead: { id: string; name: string | null; phone: string } | null;
}

interface Comment {
  id: string;
  text: string;
  created_at: string;
  user: { id: string; name: string };
}

interface Attachment {
  id: string;
  name: string;
  original_name: string;
  size: number;
  mime_type: string;
  folder: string;
  created_at: string;
  uploaded_by: { id: string; name: string };
}

export interface TaskDetailDrawerProps {
  open: boolean;
  taskId: string | null;
  /** Quem esta abrindo: 'lawyer' = criador (advogado), 'intern' = responsavel.
   *  Modula que botoes aparecem (ex: Iniciar so pra intern). */
  perspective: 'lawyer' | 'intern';
  currentUserId: string;
  onClose: () => void;
  /** Disparado quando algo muda — caller refaz fetch da lista. */
  onChanged?: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABEL: Record<string, { label: string; class: string }> = {
  A_FAZER:      { label: 'A fazer',     class: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  EM_PROGRESSO: { label: 'Em progresso', class: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  CONCLUIDA:    { label: 'Concluída',   class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  CANCELADA:    { label: 'Cancelada',   class: 'bg-gray-500/10 text-gray-400 border-gray-500/30' },
};

export function TaskDetailDrawer({
  open, taskId, perspective, currentUserId, onClose, onChanged,
}: TaskDetailDrawerProps) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const { socket } = useSocket();

  // Carrega tudo (task + comments + attachments) em paralelo ao abrir
  useEffect(() => {
    if (!open || !taskId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/tasks/${taskId}`),
      api.get(`/tasks/${taskId}/comments`),
      api.get(`/tasks/${taskId}/attachments`),
    ])
      .then(([taskRes, commentsRes, attachRes]) => {
        setTask(taskRes.data);
        setComments(commentsRes.data || []);
        setAttachments(attachRes.data || []);
      })
      .catch(e => setError(e?.response?.data?.message || 'Erro ao carregar'))
      .finally(() => setLoading(false));
  }, [open, taskId]);

  // Real-time: socket dispara quando alguem comenta — recarrega comments
  // sem precisar refresh manual. Chat fluido entre advogado e estagiario.
  useEffect(() => {
    if (!socket || !taskId) return;
    const onTaskComment = (data: any) => {
      if (data?.taskId === taskId) {
        api.get(`/tasks/${taskId}/comments`)
          .then(r => setComments(r.data || []))
          .catch(() => {});
      }
    };
    socket.on('task_comment', onTaskComment);
    return () => { socket.off('task_comment', onTaskComment); };
  }, [socket, taskId]);

  // Auto-scroll pro fim da lista de comentarios sempre que muda
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  async function postComment() {
    if (!taskId || !newComment.trim()) return;
    setPosting(true);
    try {
      const res = await api.post(`/tasks/${taskId}/comments`, {
        text: newComment.trim(),
      });
      setComments(prev => [...prev, res.data]);
      setNewComment('');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao enviar comentário');
    } finally {
      setPosting(false);
    }
  }

  async function handleStart() {
    if (!taskId) return;
    try {
      await api.patch(`/tasks/${taskId}/status`, { status: 'EM_PROGRESSO' });
      setTask(prev => prev ? { ...prev, status: 'EM_PROGRESSO', started_at: new Date().toISOString() } : prev);
      showSuccess('Diligência iniciada');
      onChanged?.();
    } catch {
      showError('Erro ao iniciar');
    }
  }

  /**
   * Cobra o estagiario — manda push extra "lembrete: voce ainda nao
   * iniciou a diligencia X". Internamente reusa o mesmo endpoint de
   * comentar com texto padrao + flag visual no histórico.
   */
  async function handlePoke() {
    if (!taskId) return;
    if (!confirm('Enviar cobrança? O responsável receberá uma notificação.')) return;
    try {
      await api.post(`/tasks/${taskId}/comments`, {
        text: '⏰ Lembrete: poderia dar uma andada nessa diligência?',
      });
      // Comentario dispara push automaticamente via NotificationsService
      const res = await api.get(`/tasks/${taskId}/comments`);
      setComments(res.data || []);
      showSuccess('Cobrança enviada');
    } catch {
      showError('Erro ao enviar cobrança');
    }
  }

  async function downloadAttachment(att: Attachment) {
    try {
      const res = await api.get(`/tasks/attachments/${att.id}/download`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = att.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      showError('Erro ao baixar');
    }
  }

  if (!open) return null;

  const statusCfg = task ? (STATUS_LABEL[task.status] || STATUS_LABEL.A_FAZER) : STATUS_LABEL.A_FAZER;
  const isAssignee = !!(task?.assigned_user && task.assigned_user.id === currentUserId);
  const isCreator = !!(task?.created_by && task.created_by.id === currentUserId);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-card border-l border-border flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusCfg.class}`}
              >
                {statusCfg.label}
              </span>
              {task?.due_at && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock size={10} /> {formatDateTime(task.due_at)}
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-foreground leading-tight">
              {task?.title || 'Carregando…'}
            </h2>
            {task?.description && (
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-line">
                {task.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-muted-foreground" size={20} />
            </div>
          ) : error ? (
            <div className="p-5">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-[12px] text-red-400">{error}</p>
              </div>
            </div>
          ) : task ? (
            <div className="p-5 space-y-5">
              {/* Vinculo a processo/cliente */}
              {(task.legal_case || task.lead) && (
                <section className="space-y-1.5">
                  <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Vinculado a
                  </h3>
                  {task.legal_case && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                      <Scale size={14} className="text-violet-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[11px] text-violet-300 truncate">
                          {task.legal_case.case_number || '(sem número)'}
                        </p>
                        {task.legal_case.lead?.name && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {task.legal_case.lead.name}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {task.lead && !task.legal_case && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <User size={14} className="text-amber-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-amber-300 truncate">
                          {task.lead.name || '(sem nome)'}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          {task.lead.phone}
                        </p>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Pessoas */}
              <section className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Delegado por
                  </p>
                  <p className="text-[12px] text-foreground">
                    {task.created_by?.name || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Responsável
                  </p>
                  <p className="text-[12px] text-foreground">
                    {task.assigned_user?.name || '—'}
                  </p>
                </div>
              </section>

              {/* Timeline visual */}
              <section>
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  Linha do tempo
                </h3>
                <div className="space-y-2">
                  <TimelineItem
                    icon={<Clock size={11} />}
                    label="Delegada"
                    timestamp={task.created_at}
                    color="text-blue-400"
                    done
                  />
                  <TimelineItem
                    icon={<Eye size={11} />}
                    label={task.viewed_at ? 'Vista pelo responsável' : 'Aguardando ser vista'}
                    timestamp={task.viewed_at}
                    color="text-violet-400"
                    done={!!task.viewed_at}
                  />
                  <TimelineItem
                    icon={<Play size={11} />}
                    label={task.started_at ? 'Iniciada' : 'Aguardando iniciar'}
                    timestamp={task.started_at}
                    color="text-amber-400"
                    done={!!task.started_at}
                  />
                  <TimelineItem
                    icon={<CheckCircle2 size={11} />}
                    label={task.completed_at ? 'Concluída' : 'Aguardando conclusão'}
                    timestamp={task.completed_at}
                    color="text-emerald-400"
                    done={!!task.completed_at}
                    note={task.completion_note}
                  />
                </div>
              </section>

              {/* Anexos */}
              {attachments.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Paperclip size={10} /> Anexos ({attachments.length})
                  </h3>
                  <div className="space-y-1.5">
                    {attachments.map(a => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-accent/20"
                      >
                        <FileText size={14} className="text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium truncate">{a.name}</p>
                          <p className="text-[9px] text-muted-foreground">
                            {formatSize(a.size)} · {a.uploaded_by.name}
                          </p>
                        </div>
                        <button
                          onClick={() => downloadAttachment(a)}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="Baixar"
                        >
                          <Download size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Chat / comentarios */}
              <section>
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <MessageCircle size={10} /> Conversa ({comments.length})
                </h3>
                {comments.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/70 italic px-2">
                    Sem comentários ainda. Use pra atualizar o status, tirar dúvida ou cobrar.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {comments.map(c => {
                      const isMine = c.user.id === currentUserId;
                      return (
                        <div
                          key={c.id}
                          className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[85%] px-3 py-2 rounded-2xl ${
                              isMine
                                ? 'bg-primary text-primary-foreground rounded-br-sm'
                                : 'bg-accent text-foreground rounded-bl-sm'
                            }`}
                          >
                            <p className="text-[11px] whitespace-pre-line">{c.text}</p>
                          </div>
                          <p className="text-[9px] text-muted-foreground/60 mt-0.5 px-1">
                            {c.user.name} · {formatDateTime(c.created_at)}
                          </p>
                        </div>
                      );
                    })}
                    <div ref={commentsEndRef} />
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>

        {/* Footer com chat input + botoes contextuais */}
        {task && task.status !== 'CONCLUIDA' && task.status !== 'CANCELADA' && (
          <div className="border-t border-border bg-card">
            {/* Botoes contextuais por papel */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
              {/* Estagiario: Iniciar (se A_FAZER) */}
              {isAssignee && task.status === 'A_FAZER' && (
                <button
                  type="button"
                  onClick={handleStart}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px] font-bold hover:bg-amber-500/20 transition-colors"
                >
                  <Play size={11} /> Iniciar
                </button>
              )}
              {/* Advogado: Cobrar (se ainda nao foi vista OU em progresso ha tempo) */}
              {isCreator && (
                <button
                  type="button"
                  onClick={handlePoke}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[11px] font-bold hover:bg-orange-500/20 transition-colors"
                  title="Manda push de lembrete pro responsável"
                >
                  ⏰ Cobrar
                </button>
              )}
            </div>

            {/* Chat input */}
            <div className="flex items-end gap-2 px-4 py-3">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') postComment();
                }}
                placeholder="Escreva uma mensagem… (Cmd/Ctrl+Enter pra enviar)"
                rows={2}
                disabled={posting}
                className="flex-1 px-3 py-2 text-[12px] bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={postComment}
                disabled={posting || !newComment.trim()}
                className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {posting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineItem({
  icon, label, timestamp, color, done, note,
}: {
  icon: React.ReactNode;
  label: string;
  timestamp: string | null;
  color: string;
  done: boolean;
  note?: string | null;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          done ? `${color} bg-current/15` : 'text-muted-foreground/40 bg-muted'
        }`}
      >
        <span className={done ? color : ''}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-semibold ${done ? 'text-foreground' : 'text-muted-foreground/60'}`}>
          {label}
        </p>
        {timestamp && (
          <p className="text-[10px] text-muted-foreground">
            {formatDateTime(timestamp)}
          </p>
        )}
        {note && (
          <p className="text-[10px] text-muted-foreground/80 italic mt-1">
            "{note}"
          </p>
        )}
      </div>
    </div>
  );
}
