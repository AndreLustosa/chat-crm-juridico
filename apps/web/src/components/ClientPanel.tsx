'use client';

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { Search, User, Phone, Loader2, X, MessageSquare, Calendar, ChevronDown, ChevronUp, Mail, Pencil, Check, UserCheck, FolderOpen, FileText, Image as ImageIcon, Mic, Video, Download, Trash2, AlertCircle, ClipboardList, StickyNote, Plus, Send, Scale, CheckSquare, ExternalLink, Clock, ArrowRight, DollarSign, Handshake, CreditCard, CalendarClock } from 'lucide-react';
import { EventActionButton } from '@/components/EventActionButton';
import FichaTrabalhista from '@/components/FichaTrabalhista';
import { LeadMemoryPanel } from '@/components/LeadMemoryPanel';
import { useRouter } from 'next/navigation';
import api, { getMediaUrl } from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { formatPhone } from '@/lib/utils';

interface LeadDetail {
  id: string;
  name?: string;
  phone: string;
  email?: string;
  origin?: string;
  stage: string;
  tags: string[];
  created_at: string;
  profile_picture_url?: string;
  google_drive_folder_id?: string | null;
  memory?: {
    summary: string;
    facts_json: any;
    last_updated_at: string;
    version: number;
  };
  conversations: Array<{
    id: string;
    status: string;
    legal_area?: string;
    ai_mode: boolean;
    last_message_at: string;
    next_step?: string;
    ai_notes?: string;
    assigned_user?: { id: string; name: string };
    messages: Array<{ text?: string; direction: string; created_at: string }>;
  }>;
  legal_cases?: LegalCaseItem[];
  _count?: { conversations: number };
}

interface LegalCaseItem {
  id: string;
  stage: string;
  legal_area: string | null;
  case_number: string | null;
  created_at: string;
  lawyer: { id: string; name: string } | null;
}

interface AgentUser {
  id: string;
  name: string;
}

interface LeadNote {
  id: string;
  text: string;
  created_at: string;
  user: { id: string; name: string };
}

interface DocItem {
  messageId: string;
  filename: string;
  mimeType: string;
  size?: number;
  createdAt: string;
}

interface TimelineItem {
  type: 'stage_change' | 'note';
  id: string;
  from_stage?: string | null;
  to_stage?: string;
  actor?: { id: string; name: string } | null;
  loss_reason?: string | null;
  text?: string;
  author?: { id: string; name: string } | null;
  created_at: string;
}

const STAGE_LABEL: Record<string, string> = {
  INICIAL: 'Inicial',
  QUALIFICANDO: 'Qualificando',
  AGUARDANDO_FORM: 'Aguardando Formulário',
  REUNIAO_AGENDADA: 'Reunião Agendada',
  AGUARDANDO_DOCS: 'Aguardando Documentos',
  AGUARDANDO_PROC: 'Aguardando Processo',
  FINALIZADO: 'Finalizado',
  PERDIDO: 'Perdido',
  NOVO: 'Novo',
  QUALIFICADO: 'Qualificado',
  EM_ATENDIMENTO: 'Em Atendimento',
};

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <ImageIcon size={15} className="text-blue-400" />;
  if (mimeType.startsWith('audio/')) return <Mic size={15} className="text-purple-400" />;
  if (mimeType.startsWith('video/')) return <Video size={15} className="text-emerald-400" />;
  return <FileText size={15} className="text-sky-400" />;
}

const CASE_STAGE_MAP: Record<string, { label: string; color: string }> = {
  VIABILIDADE:  { label: 'Viabilidade',  color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  ANDAMENTO:    { label: 'Em Andamento', color: 'bg-sky-500/15 text-sky-400 border-sky-500/20' },
  CONCLUSAO:    { label: 'Conclusão',    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  ARQUIVADO:    { label: 'Arquivado',    color: 'bg-gray-500/15 text-gray-400 border-gray-500/20' },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatCpfCnpj(v: string): string {
  const clean = v.replace(/\D/g, '');
  if (clean.length === 11) return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (clean.length === 14) return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
}

function InlineInput({ value, onSave, onCancel, placeholder }: { value: string; onSave: (v: string) => void; onCancel: () => void; placeholder?: string }) {
  const [val, setVal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSave(val.trim());
    if (e.key === 'Escape') onCancel();
  };
  return (
    <div className="flex items-center gap-1.5 flex-1">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className="flex-1 bg-background border border-primary/40 rounded-lg px-2.5 py-1 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/20"
      />
      <button onClick={() => onSave(val.trim())} className="w-6 h-6 flex items-center justify-center rounded-md bg-primary/15 text-primary hover:bg-primary/25 transition-colors">
        <Check size={12} />
      </button>
      <button onClick={onCancel} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground transition-colors">
        <X size={12} />
      </button>
    </div>
  );
}

export function ClientPanel({
  leadId,
  onClose,
  onLightbox,
  isAdmin = false,
  onDeleteSuccess,
  zBase = 100,
}: {
  leadId: string;
  onClose: () => void;
  onLightbox: (url: string) => void;
  isAdmin?: boolean;
  onDeleteSuccess?: (id: string) => void;
  /** Z-index base do modal (backdrop usa zBase-10). Padrão: 100 */
  zBase?: number;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // memoryOpen/resettingMemory removidos em 2026-04-20 — bloco "Histórico de
  // Atendimento" (AiMemory legado) foi substituído pelo LeadMemoryPanel.
  const [editing, setEditing] = useState<'name' | 'email' | 'cpf_cnpj' | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolvedAgent, setResolvedAgent] = useState<{ id: string; name: string } | null>(null);
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [docViewer, setDocViewer] = useState<{ url: string; mimeType: string; filename: string } | null>(null);

  // Casos jurídicos
  const [casesOpen, setCasesOpen] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [newCaseArea, setNewCaseArea] = useState('');

  // Próximos eventos do cliente (agenda + prazos + tarefas)
  const [events, setEvents] = useState<Array<{
    id: string;
    type: string;
    title: string;
    start_at: string;
    status: string;
    location?: string | null;
    completion_note?: string | null;
    completed_by?: { id: string; name: string } | null;
    completed_at?: string | null;
  }>>([]);
  const [eventsOpen, setEventsOpen] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [newCaseSubject, setNewCaseSubject] = useState('');
  const [newCaseUrgency, setNewCaseUrgency] = useState<'BAIXA' | 'NORMAL' | 'URGENTE'>('NORMAL');
  const [submittingCase, setSubmittingCase] = useState(false);

  /** Abre form de novo caso ja expandindo a secao de Casos Juridicos */
  const openNewCaseForm = () => {
    setCasesOpen(true);
    setCreatingCase(true);
    setNewCaseSubject('');
    setNewCaseArea('');
    setNewCaseUrgency('NORMAL');
  };

  // Modal de nova tarefa
  const [taskModal, setTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskAssignedId, setTaskAssignedId] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const [agents, setAgents] = useState<AgentUser[]>([]);

  // Resumo financeiro
  const [financeOpen, setFinanceOpen] = useState(false);
  const [financeSummary, setFinanceSummary] = useState<{ contracted: number; received: number; pending: number; overdue: number } | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);

  // Honorários negociados
  const [negHonOpen, setNegHonOpen] = useState(false);
  const [negHonorarios, setNegHonorarios] = useState<any[]>([]);
  const [negHonLoading, setNegHonLoading] = useState(false);
  const [showNegHonForm, setShowNegHonForm] = useState(false);
  const [negHonType, setNegHonType] = useState('CONTRATUAL');
  const [negHonValue, setNegHonValue] = useState('');
  const [negHonNotes, setNegHonNotes] = useState('');
  const [negHonSaving, setNegHonSaving] = useState(false);
  const [negHonParcelas, setNegHonParcelas] = useState<Array<{ amount: string; due_date: string }>>([{ amount: '', due_date: '' }]);
  const [negHonCharging, setNegHonCharging] = useState<string | null>(null);
  const [negHonChargeResult, setNegHonChargeResult] = useState<Record<string, any>>({});

  // Notas internas
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // Histórico de transferências
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [transfers, setTransfers] = useState<{ id: string; text: string; created_at: string }[]>([]);

  // Histórico de atividades (timeline)
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Histórico de conversas anteriores
  const [convHistory, setConvHistory] = useState<any[]>([]);
  const [convHistoryOpen, setConvHistoryOpen] = useState(false);

  // Google Drive
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null);
  const [creatingDriveFolder, setCreatingDriveFolder] = useState(false);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [loadingDriveFiles, setLoadingDriveFiles] = useState(false);

  useEffect(() => {
    setLoading(true);
    setResolvedAgent(null);
    setResolvedConvId(null);
    setDocuments([]);
    api.get(`/leads/${leadId}`).then(r => {
      setLead(r.data);
      setDriveFolderId(r.data.google_drive_folder_id ?? null);
      // Buscar arquivos do Drive se tem pasta
      if (r.data.google_drive_folder_id) {
        setLoadingDriveFiles(true);
        api.get(`/google-drive/leads/${leadId}/files`).then(dr => {
          setDriveFiles(dr.data || []);
        }).catch(() => {}).finally(() => setLoadingDriveFiles(false));
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;
    api.get(`/conversations/lead/${leadId}`).then(r => {
      const convs = r.data as any[];
      const withMessages = convs.filter((c: any) => (c.messages?.length || 0) > 0);
      const pool = withMessages.length > 0 ? withMessages : convs;
      const sortedConvs = [...pool].sort((a: any, b: any) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bTime - aTime;
      });
      if (sortedConvs?.[0]?.id) setResolvedConvId(sortedConvs[0].id);
      const agent = sortedConvs?.[0]?.assigned_user;
      if (agent) setResolvedAgent(agent);
      // Guardar histórico de conversas (exceto a mais recente que está ativa)
      setConvHistory(sortedConvs.slice(1).filter((c: any) => c.status === 'CLOSED' || c.status === 'MONITORING'));
      const docs: DocItem[] = [];
      convs.forEach((conv: any) => {
        conv.messages?.forEach((msg: any) => {
          if (msg.direction === 'in' && msg.media) {
            const mime = msg.media.mime_type || '';
            const ext = (msg.media.s3_key?.split('.').pop() || 'bin').split(';')[0].trim();
            let defaultName = `arquivo.${ext}`;
            if (mime.startsWith('image/')) defaultName = `imagem.${ext}`;
            else if (mime.startsWith('audio/')) defaultName = `audio.${ext}`;
            else if (mime.startsWith('video/')) defaultName = `video.${ext}`;
            docs.push({
              messageId: msg.id,
              filename: msg.media.original_name || defaultName,
              mimeType: mime,
              size: msg.media.size,
              createdAt: msg.created_at,
            });
          }
        });
      });
      docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setDocuments(docs);
    }).catch(() => {});
  }, [leadId]);

  // Buscar agentes ao abrir modal de tarefa
  useEffect(() => {
    if (!taskModal || agents.length > 0) return;
    api.get('/users/agents').then(r => setAgents(r.data || [])).catch(() => {});
  }, [taskModal, agents.length]);

  // Buscar eventos do cliente (proximos 30 dias + atrasados de ate 7 dias)
  const fetchClientEvents = useCallback(async () => {
    if (!leadId) return;
    setLoadingEvents(true);
    try {
      const start = new Date(Date.now() - 7 * 86400000).toISOString();  // 7d atras (vencidos recentes)
      const end = new Date(Date.now() + 30 * 86400000).toISOString();   // 30d futuros
      const res = await api.get('/calendar/events', {
        params: { leadId, start, end, showAll: 'true' },
      });
      const items = (res.data || [])
        .filter((e: any) => !['CANCELADO', 'CONCLUIDO'].includes(e.status))
        .sort((a: any, b: any) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      setEvents(items);
    } catch {
      // silently fail
    } finally {
      setLoadingEvents(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchClientEvents();
  }, [fetchClientEvents]);

  const submitTask = async () => {
    if (!taskTitle.trim() || !leadId) return;
    setSavingTask(true);
    try {
      await api.post('/tasks', {
        title: taskTitle.trim(),
        lead_id: leadId,
        conversation_id: lead?.conversations?.[0]?.id ?? undefined,
        due_at: taskDueAt || undefined,
        assigned_user_id: taskAssignedId || undefined,
      });
      setTaskModal(false);
      setTaskTitle('');
      setTaskDueAt('');
      setTaskAssignedId('');
    } catch { /* silencioso */ } finally { setSavingTask(false); }
  };

  // Buscar resumo financeiro quando seção abrir
  useEffect(() => {
    if (!financeOpen || !leadId || financeSummary) return;
    setFinanceLoading(true);
    api.get(`/financeiro/transactions`, { params: { leadId, limit: 200 } })
      .then(r => {
        const txs: any[] = r.data?.data || r.data || [];
        const sum = { contracted: 0, received: 0, pending: 0, overdue: 0 };
        txs.forEach((t: any) => {
          if (t.type !== 'RECEITA') return;
          const amt = parseFloat(t.amount) || 0;
          if (t.status === 'PAGO') sum.received += amt;
          else if (t.status === 'PENDENTE' && t.due_date && new Date(t.due_date) < new Date()) sum.overdue += amt;
          else if (t.status === 'PENDENTE') sum.pending += amt;
          sum.contracted += amt;
        });
        setFinanceSummary(sum);
      })
      .catch(() => setFinanceSummary({ contracted: 0, received: 0, pending: 0, overdue: 0 }))
      .finally(() => setFinanceLoading(false));
  }, [financeOpen, leadId, financeSummary]);

  // Buscar honorários negociados quando seção abrir
  useEffect(() => {
    if (!negHonOpen || !leadId) return;
    setNegHonLoading(true);
    api.get(`/leads/${leadId}/honorarios-negociados`)
      .then(r => setNegHonorarios(r.data || []))
      .catch(() => {})
      .finally(() => setNegHonLoading(false));
  }, [negHonOpen, leadId]);

  // Buscar notas quando seção abrir
  useEffect(() => {
    if (!notesOpen || !leadId) return;
    api.get(`/leads/${leadId}/notes`).then(r => setNotes(r.data || [])).catch(() => {});
  }, [notesOpen, leadId]);

  // Buscar histórico de transferências quando seção abrir
  useEffect(() => {
    if (!transfersOpen || !lead?.conversations?.length) return;
    const convId = lead.conversations[0]?.id;
    if (!convId) return;
    api.get(`/messages/conversation/${convId}`, { params: { limit: 500 } })
      .then(r => {
        const msgs = Array.isArray(r.data) ? r.data : (r.data?.data || []);
        setTransfers(msgs.filter((m: any) => m.type === 'transfer_event').map((m: any) => ({
          id: m.id,
          text: m.text || '',
          created_at: m.created_at,
        })));
      })
      .catch(() => {});
  }, [transfersOpen, lead]);

  // Buscar timeline quando seção abrir
  useEffect(() => {
    if (!timelineOpen || !leadId || timeline.length > 0) return;
    setTimelineLoading(true);
    api.get(`/leads/${leadId}/timeline`)
      .then(r => setTimeline(r.data || []))
      .catch(() => {})
      .finally(() => setTimelineLoading(false));
  }, [timelineOpen, leadId, timeline.length]);

  const submitNote = async () => {
    if (!noteText.trim() || !leadId) return;
    setAddingNote(true);
    try {
      const res = await api.post(`/leads/${leadId}/notes`, { text: noteText.trim() });
      setNotes(prev => [res.data, ...prev]);
      setNoteText('');
    } catch { /* silencioso */ } finally { setAddingNote(false); }
  };

  const deleteNote = async (noteId: string) => {
    if (!window.confirm('Excluir esta nota?')) return;
    setDeletingNoteId(noteId);
    try {
      await api.delete(`/leads/${leadId}/notes/${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch { /* silencioso */ } finally { setDeletingNoteId(null); }
  };

  // ─── Honorários negociados handlers ───
  const fmtBRL = (v: number | string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(typeof v === 'string' ? parseFloat(v) : v);
  const fmtDt = (d: string) => { if (!d) return '--'; const dt = new Date(d); return `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}/${dt.getUTCFullYear()}`; };

  const resetNegHonForm = () => {
    setNegHonType('CONTRATUAL'); setNegHonValue(''); setNegHonNotes('');
    setNegHonParcelas([{ amount: '', due_date: '' }]);
  };

  const handleDividirIgual = () => {
    const total = parseFloat(negHonValue);
    const count = negHonParcelas.length;
    if (!total || count === 0) return;
    const base = Math.floor((total * 100) / count) / 100;
    const last = Math.round((total - base * (count - 1)) * 100) / 100;
    const now = new Date();
    setNegHonParcelas(negHonParcelas.map((p, i) => {
      const dt = new Date(now);
      dt.setMonth(dt.getMonth() + i);
      return { amount: String(i === count - 1 ? last : base), due_date: dt.toISOString().slice(0, 10) };
    }));
  };

  const createNegHonorario = async () => {
    const total = parseFloat(negHonValue);
    if (!total || total <= 0 || !leadId) return;
    const payments = negHonParcelas.map(p => ({ amount: parseFloat(p.amount) || 0, due_date: p.due_date || undefined }));
    if (payments.some(p => !p.amount)) { showError('Preencha o valor de todas as parcelas'); return; }
    setNegHonSaving(true);
    try {
      const res = await api.post(`/leads/${leadId}/honorarios-negociados`, {
        type: negHonType, total_value: total, notes: negHonNotes || undefined, payments,
      });
      setNegHonorarios(prev => [res.data, ...prev]);
      setShowNegHonForm(false);
      resetNegHonForm();
      showSuccess('Honorário negociado salvo');
    } catch (e: any) { showError(e?.response?.data?.message || 'Erro ao salvar honorário'); }
    finally { setNegHonSaving(false); }
  };

  const updateNegHonStatus = async (id: string, newStatus: string) => {
    try {
      const res = await api.patch(`/leads/${leadId}/honorarios-negociados/${id}`, { status: newStatus });
      setNegHonorarios(prev => prev.map(h => h.id === id ? res.data : h));
    } catch { showError('Erro ao atualizar status'); }
  };

  const deleteNegHonorario = async (id: string) => {
    if (!window.confirm('Excluir este honorário negociado?')) return;
    try {
      await api.delete(`/leads/${leadId}/honorarios-negociados/${id}`);
      setNegHonorarios(prev => prev.filter(h => h.id !== id));
    } catch { showError('Erro ao excluir'); }
  };

  const markNegPaymentPaid = async (paymentId: string) => {
    try {
      await api.patch(`/leads/honorarios-negociados/payments/${paymentId}/mark-paid`, {});
      // Refresh honorários
      const res = await api.get(`/leads/${leadId}/honorarios-negociados`);
      setNegHonorarios(res.data || []);
      showSuccess('Pagamento registrado');
    } catch { showError('Erro ao marcar como pago'); }
  };

  const deleteNegPayment = async (paymentId: string) => {
    if (!window.confirm('Excluir esta parcela?')) return;
    try {
      await api.delete(`/leads/honorarios-negociados/payments/${paymentId}`);
      const res = await api.get(`/leads/${leadId}/honorarios-negociados`);
      setNegHonorarios(res.data || []);
    } catch { showError('Erro ao excluir parcela'); }
  };

  const createDriveFolder = async () => {
    if (creatingDriveFolder) return;
    setCreatingDriveFolder(true);
    try {
      const r = await api.post(`/google-drive/leads/${leadId}/folder`);
      setDriveFolderId(r.data.folderId);
      showSuccess('Pasta criada no Google Drive!');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao criar pasta no Drive');
    } finally {
      setCreatingDriveFolder(false);
    }
  };

  const deleteDoc = (messageId: string) => {
    if (!confirm('Remover do Banco de Documentos?\n(O arquivo permanece no chat e no banco de dados)')) return;
    setDocuments(prev => prev.filter(d => d.messageId !== messageId));
  };

  const saveField = async (field: 'name' | 'email' | 'cpf_cnpj', value: string) => {
    if (!lead) return;
    setSaving(true);
    try {
      await api.patch(`/leads/${leadId}`, { [field]: value });
      setLead(prev => prev ? { ...prev, [field]: value } : prev);
    } catch (e) { console.error(e); } finally { setSaving(false); setEditing(null); }
  };

  const currentAgent = resolvedAgent ?? lead?.conversations?.[0]?.assigned_user ?? null;
  // factsJson/handleResetMemory removidos em 2026-04-20 — reset da memória agora
  // é feito via LeadMemoryPanel (atua em LeadProfile + Memory entries).

  const handleDeleteContact = async () => {
    if (!lead) return;
    setDeleting(true);
    try {
      await api.delete(`/leads/${lead.id}`);
      onDeleteSuccess?.(lead.id);
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Erro ao excluir contato. Tente novamente.');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-[3px]" style={{ zIndex: zBase - 10 }} onClick={onClose} />

      {/* Modal grande */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[780px] max-w-[95vw] max-h-[90vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200" style={{ zIndex: zBase }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-[15px] font-bold text-foreground">{lead?.stage === 'FINALIZADO' ? 'Painel do Cliente' : 'Painel do Lead'}</h2>
          <div className="flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !lead ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Erro ao carregar contato.</div>
        ) : (
          <div className="flex-1 overflow-y-auto">

            {/* Identidade */}
            <div className="px-6 py-6 border-b border-border">
              <div className="flex items-start gap-4">
                <div
                  className={`w-20 h-20 rounded-2xl bg-primary/10 border border-border flex items-center justify-center overflow-hidden shrink-0 shadow-md ${lead.profile_picture_url ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                  onClick={lead.profile_picture_url ? () => onLightbox(lead.profile_picture_url!) : undefined}
                >
                  {lead.profile_picture_url ? (
                    <img src={lead.profile_picture_url} alt={lead.name || ''} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-primary font-bold text-3xl">{(lead.name || '?').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="group flex items-center gap-2 min-w-0">
                    {editing === 'name' ? (
                      <InlineInput value={lead.name || ''} placeholder="Nome do contato" onSave={v => saveField('name', v)} onCancel={() => setEditing(null)} />
                    ) : (
                      <>
                        <h3 className="text-[18px] font-bold text-foreground leading-tight truncate">{lead.name || 'Sem Nome'}</h3>
                        <button onClick={() => setEditing('name')} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0">
                          <Pencil size={13} />
                        </button>
                      </>
                    )}
                  </div>
                  {/* Atalhos: badge de triagem + botao novo caso */}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {(() => {
                      const viabilidadeCases = (lead.legal_cases || []).filter(c => c.stage === 'VIABILIDADE');
                      if (viabilidadeCases.length === 0) return null;
                      // Detecta casos novos (< 24h) — abertos hoje pela IA
                      const now = Date.now();
                      const newCount = viabilidadeCases.filter(c =>
                        c.created_at && (now - new Date(c.created_at).getTime()) < 24 * 3600 * 1000
                      ).length;
                      return (
                        <button
                          onClick={() => setCasesOpen(true)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px] font-bold hover:bg-amber-500/15 transition-colors"
                          title={`${viabilidadeCases.length} caso(s) aguardando avaliacao de viabilidade`}
                        >
                          <Scale size={11} />
                          {viabilidadeCases.length} em triagem
                          {newCount > 0 && (
                            <span className="ml-1 px-1.5 py-0 rounded-full bg-amber-400/30 text-amber-200 text-[9px] font-bold leading-tight">
                              {newCount} nov{newCount !== 1 ? 'os' : 'o'}
                            </span>
                          )}
                        </button>
                      );
                    })()}
                    {/* Botao atalho: abre form de novo caso ja expandido */}
                    <button
                      onClick={openNewCaseForm}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400 text-[11px] font-bold hover:bg-violet-500/15 transition-colors"
                      title="Abrir um novo caso juridico pra este cliente"
                    >
                      <Plus size={11} />
                      Novo caso
                    </button>
                  </div>
                  <div className="mt-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Phone size={13} className="shrink-0" />
                      <span className="font-mono">{formatPhone(lead.phone)}</span>
                    </div>
                    <div className="group flex items-center gap-2 text-[13px] text-muted-foreground min-w-0">
                      <Mail size={13} className="shrink-0" />
                      {editing === 'email' ? (
                        <InlineInput value={lead.email || ''} placeholder="email@exemplo.com" onSave={v => saveField('email', v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <>
                          <span className="truncate">{lead.email || <span className="italic opacity-50">Sem e-mail</span>}</span>
                          <button onClick={() => setEditing('email')} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0">
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="group flex items-center gap-2 text-[13px] text-muted-foreground min-w-0">
                      <FileText size={13} className="shrink-0" />
                      {editing === 'cpf_cnpj' ? (
                        <InlineInput value={(lead as any).cpf_cnpj || ''} placeholder="000.000.000-00" onSave={v => saveField('cpf_cnpj', v.replace(/\D/g, ''))} onCancel={() => setEditing(null)} />
                      ) : (
                        <>
                          <span className="truncate font-mono text-[12px]">{(lead as any).cpf_cnpj ? formatCpfCnpj((lead as any).cpf_cnpj) : <span className="italic opacity-50">Sem CPF/CNPJ</span>}</span>
                          <button onClick={() => setEditing('cpf_cnpj')} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0">
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <UserCheck size={13} className="shrink-0" />
                      {currentAgent ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
                          <span className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-bold">{currentAgent.name.charAt(0).toUpperCase()}</span>
                          {currentAgent.name}
                        </span>
                      ) : (
                        <span className="italic opacity-40">Sem atendente</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Calendar size={13} className="shrink-0" />
                      <span>Desde {formatDateShort(lead.created_at)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sistema de Memória Inteligente — substituiu "Histórico de Atendimento" (AiMemory legado) em 2026-04-20 */}
            {lead && <LeadMemoryPanel leadId={lead.id} canEdit={isAdmin} />}

            {/* Banco de Documentos */}
            <div className="border-t border-border">
              <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors" onClick={() => setDocsOpen(!docsOpen)}>
                <div className="flex items-center gap-2.5">
                  <FolderOpen size={15} className="text-primary" />
                  <span className="text-[13px] font-bold text-foreground">Banco de Documentos</span>
                  {documents.length > 0 && (
                    <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">{documents.length}</span>
                  )}
                </div>
                {docsOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>

              {/* Ações Google Drive */}
              <div className="px-6 pb-3 flex items-center gap-2">
                {driveFolderId ? (
                  <a
                    href={`https://drive.google.com/drive/folders/${driveFolderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors font-medium"
                  >
                    <FolderOpen size={13} />
                    Abrir pasta no Drive
                    <ExternalLink size={11} className="opacity-60" />
                  </a>
                ) : (
                  <button
                    onClick={createDriveFolder}
                    disabled={creatingDriveFolder}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium disabled:opacity-50"
                  >
                    {creatingDriveFolder ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
                    {creatingDriveFolder ? 'Criando pasta...' : 'Criar pasta no Drive'}
                  </button>
                )}
              </div>

              {docsOpen && (
                <div className="px-6 pb-5">
                  {/* Arquivos do Google Drive */}
                  {driveFiles.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">📁 Arquivos no Drive</p>
                      <div className="space-y-1.5">
                        {driveFiles.map((f: any) => (
                          <a key={f.id} href={f.webViewLink || `https://drive.google.com/file/d/${f.id}`} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/20 hover:bg-accent/40 transition-colors group">
                            <span className="text-sm">{f.mimeType?.startsWith('image/') ? '🖼️' : f.mimeType?.includes('pdf') ? '📄' : f.mimeType?.includes('document') || f.mimeType?.includes('word') ? '📝' : f.mimeType?.includes('sheet') ? '📊' : '📁'}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-foreground truncate">{f.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('pt-BR') : ''}
                                {f.size ? ` · ${(parseInt(f.size) / 1024).toFixed(0)} KB` : ''}
                              </p>
                            </div>
                            <ExternalLink size={11} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {loadingDriveFiles && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground ml-2">Carregando arquivos do Drive...</span>
                    </div>
                  )}

                  {/* Arquivos do Chat */}
                  {documents.length === 0 && driveFiles.length === 0 && !loadingDriveFiles ? (
                    <p className="text-[13px] text-muted-foreground text-center py-6 opacity-40 italic">Nenhum documento enviado</p>
                  ) : (() => {
                    const getCategory = (mime: string) => {
                      if (mime.startsWith('image/')) return 'Imagens';
                      if (mime.startsWith('audio/')) return 'Áudios';
                      if (mime.startsWith('video/')) return 'Vídeos';
                      return 'Arquivos';
                    };
                    const categoryOrder = ['Arquivos', 'Imagens', 'Vídeos', 'Áudios'];
                    const grouped = documents.reduce<Record<string, DocItem[]>>((acc, doc) => {
                      const cat = getCategory(doc.mimeType);
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(doc);
                      return acc;
                    }, {});
                    return (
                      <div className="flex flex-col gap-5">
                        {categoryOrder.filter(cat => grouped[cat]?.length).map(cat => (
                          <div key={cat}>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{cat} <span className="font-mono font-normal normal-case">({grouped[cat].length})</span></p>
                            {cat === 'Imagens' && (
                              <div className="grid grid-cols-4 gap-2">
                                {grouped[cat].map(doc => (
                                  <div key={doc.messageId} className="relative aspect-square group">
                                    <button onClick={() => onLightbox(getMediaUrl(doc.messageId))} className="w-full h-full rounded-xl overflow-hidden border border-border bg-foreground/[0.04] hover:opacity-90 transition-opacity" title={doc.filename}>
                                      <img src={getMediaUrl(doc.messageId)} alt={doc.filename} className="w-full h-full object-cover" loading="lazy" />
                                    </button>
                                    <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <a href={getMediaUrl(doc.messageId, true)} target="_blank" rel="noopener noreferrer" title="Baixar imagem" onClick={e => e.stopPropagation()} className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"><Download size={11} /></a>
                                      <button onClick={e => { e.stopPropagation(); deleteDoc(doc.messageId); }} title="Excluir imagem" className="w-6 h-6 flex items-center justify-center rounded-lg bg-red-600/80 text-white hover:bg-red-700 transition-colors"><Trash2 size={11} /></button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {cat === 'Vídeos' && (
                              <div className="flex flex-col gap-2">
                                {grouped[cat].map(doc => (
                                  <div key={doc.messageId} className="rounded-xl border border-border bg-foreground/[0.02] overflow-hidden group">
                                    <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                                      <div className="w-8 h-8 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0"><Video size={15} className="text-emerald-400" /></div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-medium text-foreground truncate leading-tight">{doc.filename}</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">{formatBytes(doc.size)}{doc.size ? ' · ' : ''}{formatDateShort(doc.createdAt)}</p>
                                      </div>
                                      <a href={getMediaUrl(doc.messageId, true)} target="_blank" rel="noopener noreferrer" title="Baixar" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 shrink-0"><Download size={13} /></a>
                                      <button onClick={() => deleteDoc(doc.messageId)} title="Remover do banco" className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0"><Trash2 size={13} /></button>
                                    </div>
                                    <div className="px-3 pb-3">
                                      <video controls preload="none" src={getMediaUrl(doc.messageId)} className="w-full rounded-lg" style={{ maxHeight: '220px' }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {cat === 'Arquivos' && (
                              <div className="flex flex-col gap-3">
                                {grouped[cat].map(doc => {
                                  const isPdf = doc.mimeType === 'application/pdf';
                                  return (
                                    <div key={doc.messageId} className="rounded-xl border border-border bg-foreground/[0.02] overflow-hidden group">
                                      <button onClick={() => setDocViewer({ url: getMediaUrl(doc.messageId), mimeType: doc.mimeType, filename: doc.filename })} title="Clique para visualizar" className="block w-full text-left relative">
                                        {isPdf ? (
                                          <div className="relative w-full h-[180px] bg-foreground/[0.04] overflow-hidden">
                                            <iframe src={`${getMediaUrl(doc.messageId)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title={doc.filename} className="absolute inset-0 w-full h-full pointer-events-none border-0" loading="lazy" />
                                            <div className="absolute inset-0 hover:bg-black/10 transition-colors flex items-end pb-2 justify-center">
                                              <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">Clique para abrir</span>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="w-full h-[80px] bg-foreground/[0.04] flex items-center justify-center gap-2 hover:bg-foreground/[0.07] transition-colors">
                                            <DocIcon mimeType={doc.mimeType} />
                                            <span className="text-[11px] text-muted-foreground">Clique para visualizar</span>
                                          </div>
                                        )}
                                      </button>
                                      <div className="flex items-center gap-3 px-3 py-2.5 border-t border-border">
                                        <div className="w-7 h-7 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0"><DocIcon mimeType={doc.mimeType} /></div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[12px] font-medium text-foreground truncate leading-tight">{doc.filename}</p>
                                          <p className="text-[10px] text-muted-foreground">{formatBytes(doc.size)}{doc.size ? ' · ' : ''}{formatDateShort(doc.createdAt)}</p>
                                        </div>
                                        <a href={getMediaUrl(doc.messageId, true)} target="_blank" rel="noopener noreferrer" title="Baixar arquivo" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 shrink-0" onClick={e => e.stopPropagation()}><Download size={13} /></a>
                                        <button onClick={() => deleteDoc(doc.messageId)} title="Excluir arquivo" className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0"><Trash2 size={13} /></button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {cat === 'Áudios' && (
                              <div className="flex flex-col gap-2">
                                {grouped[cat].map(doc => (
                                  <div key={doc.messageId} className="rounded-xl border border-border bg-foreground/[0.02] overflow-hidden group">
                                    <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                                      <div className="w-8 h-8 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0"><Mic size={15} className="text-purple-400" /></div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-medium text-foreground truncate leading-tight">{doc.filename}</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">{formatBytes(doc.size)}{doc.size ? ' · ' : ''}{formatDateShort(doc.createdAt)}</p>
                                      </div>
                                      <a href={getMediaUrl(doc.messageId, true)} target="_blank" rel="noopener noreferrer" title="Baixar" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 shrink-0"><Download size={13} /></a>
                                      <button onClick={() => deleteDoc(doc.messageId)} title="Remover do banco" className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0"><Trash2 size={13} /></button>
                                    </div>
                                    <div className="px-3 pb-3">
                                      <audio controls preload="none" src={getMediaUrl(doc.messageId)} className="w-full h-8" style={{ colorScheme: 'dark' }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Casos Jurídicos */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setCasesOpen(!casesOpen)}
              >
                <div className="flex items-center gap-2.5">
                  <Scale size={15} className="text-violet-400" />
                  <span className="text-[13px] font-bold text-foreground">Casos Jurídicos</span>
                  <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">{lead.legal_cases?.length ?? 0}</span>
                </div>
                {casesOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>
              {casesOpen && (
                <div className="px-6 pb-5 flex flex-col gap-2.5">
                  {/* Lista de casos existentes */}
                  {(lead.legal_cases || []).map(c => {
                    const stageBadge = CASE_STAGE_MAP[c.stage] ?? { label: c.stage, color: 'bg-gray-500/15 text-gray-400 border-gray-500/20' };
                    return (
                      <div key={c.id} className="bg-foreground/[0.03] border border-border rounded-xl p-3.5 flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${stageBadge.color}`}>
                            {stageBadge.label}
                          </span>
                          {c.case_number && (
                            <span className="text-[10px] text-muted-foreground font-mono">#{c.case_number}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.legal_area && (
                            <span className="text-[11px] text-violet-400 font-medium">{c.legal_area}</span>
                          )}
                          {c.lawyer && (
                            <span className="text-[11px] text-blue-400">
                              <UserCheck size={10} className="inline mr-0.5" />
                              {c.lawyer.name.replace(/^(Dra?\.?)\s+/i, '')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-[10px] text-muted-foreground/60">Criado em {formatDateShort(c.created_at)}</p>
                          <button
                            onClick={(e) => { e.stopPropagation(); router.push(`/atendimento/workspace/${c.id}`); }}
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-400 hover:text-violet-300 transition-colors"
                          >
                            <ExternalLink size={10} />
                            Workspace
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Criar novo caso */}
                  {!creatingCase ? (
                    <button
                      onClick={openNewCaseForm}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-violet-500/30 text-violet-400 hover:bg-violet-500/5 transition-colors text-[11px] font-medium"
                    >
                      <Plus size={12} />
                      Novo Caso Jurídico
                    </button>
                  ) : (
                    <div className="bg-foreground/[0.03] border border-violet-500/30 rounded-xl p-3.5 flex flex-col gap-2.5">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Descrição do caso *
                        </label>
                        <textarea
                          value={newCaseSubject}
                          onChange={(e) => setNewCaseSubject(e.target.value)}
                          placeholder="Ex: Disputa com vizinho sobre cerca no terreno; cliente quer entender responsabilidades e próximos passos."
                          rows={3}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                          autoFocus
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Área jurídica
                          </label>
                          <select
                            value={newCaseArea}
                            onChange={(e) => setNewCaseArea(e.target.value)}
                            className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500"
                          >
                            <option value="">A definir</option>
                            <option value="TRABALHISTA">Trabalhista</option>
                            <option value="CIVIL">Civil</option>
                            <option value="PREVIDENCIARIO">Previdenciário</option>
                            <option value="CONSUMIDOR">Consumidor</option>
                            <option value="FAMILIA">Família</option>
                            <option value="PENAL">Penal</option>
                            <option value="TRIBUTARIO">Tributário</option>
                            <option value="EMPRESARIAL">Empresarial</option>
                            <option value="ADMINISTRATIVO">Administrativo</option>
                          </select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Urgência
                          </label>
                          <select
                            value={newCaseUrgency}
                            onChange={(e) => setNewCaseUrgency(e.target.value as 'BAIXA' | 'NORMAL' | 'URGENTE')}
                            className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500"
                          >
                            <option value="BAIXA">🔵 Baixa</option>
                            <option value="NORMAL">🟡 Normal</option>
                            <option value="URGENTE">🔴 Urgente</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-2 mt-1">
                        <button
                          onClick={() => { setCreatingCase(false); setNewCaseArea(''); setNewCaseSubject(''); setNewCaseUrgency('NORMAL'); }}
                          disabled={submittingCase}
                          className="flex-1 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:bg-accent/30 transition-colors disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          disabled={submittingCase || !newCaseSubject.trim()}
                          onClick={async () => {
                            if (!newCaseSubject.trim()) return;
                            setSubmittingCase(true);
                            try {
                              const res = await api.post('/legal-cases', {
                                lead_id: lead.id,
                                conversation_id: resolvedConvId || undefined,
                                legal_area: newCaseArea || undefined,
                                subject: newCaseSubject.trim(),
                                priority: newCaseUrgency,
                              });
                              setCreatingCase(false);
                              setNewCaseSubject('');
                              setNewCaseArea('');
                              setNewCaseUrgency('NORMAL');
                              router.push(`/atendimento/workspace/${res.data.id}`);
                            } catch {
                              // silently fail
                            } finally {
                              setSubmittingCase(false);
                            }
                          }}
                          className="flex-1 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-medium hover:bg-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {submittingCase ? 'Criando...' : 'Criar Caso'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Próximos eventos do cliente — audiencias, pericias, prazos, tarefas */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setEventsOpen(!eventsOpen)}
              >
                <div className="flex items-center gap-2.5">
                  <CalendarClock size={15} className="text-sky-400" />
                  <span className="text-[13px] font-bold text-foreground">Próximos eventos</span>
                  <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">
                    {events.length}
                  </span>
                </div>
                {eventsOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>
              {eventsOpen && (
                <div className="px-6 pb-5 flex flex-col gap-2">
                  {loadingEvents ? (
                    <div className="text-center py-4 text-[11px] text-muted-foreground flex items-center justify-center gap-2">
                      <Loader2 size={12} className="animate-spin" />
                      Carregando eventos...
                    </div>
                  ) : events.length === 0 ? (
                    <div className="text-center py-4 text-[11px] text-muted-foreground/70 italic">
                      Nenhum evento agendado
                    </div>
                  ) : (
                    events.map(ev => {
                      const eventDate = new Date(ev.start_at);
                      const isOverdue = eventDate < new Date();
                      const diffMs = eventDate.getTime() - Date.now();
                      const diffDays = Math.round(diffMs / 86400000);
                      const isToday = diffDays === 0 && diffMs > 0;
                      const isTomorrow = diffDays === 1;

                      const typeIcons: Record<string, string> = {
                        AUDIENCIA: '⚖️', PERICIA: '🔬', PRAZO: '⏰',
                        TAREFA: '✅', CONSULTA: '📞', OUTRO: '📅',
                      };
                      const typeColors: Record<string, string> = {
                        AUDIENCIA: 'text-red-400',
                        PERICIA: 'text-violet-400',
                        PRAZO: 'text-amber-400',
                        TAREFA: 'text-emerald-400',
                        CONSULTA: 'text-blue-400',
                        OUTRO: 'text-muted-foreground',
                      };

                      let dateLabel: string;
                      if (isOverdue) {
                        const daysOverdue = Math.abs(diffDays);
                        dateLabel = daysOverdue === 0 ? 'Atrasado (hoje)' : `Atrasado há ${daysOverdue}d`;
                      } else if (isToday) {
                        dateLabel = `Hoje às ${eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                      } else if (isTomorrow) {
                        dateLabel = `Amanhã às ${eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                      } else {
                        dateLabel = eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
                          ` ${eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                      }

                      return (
                        <div
                          key={ev.id}
                          className={`bg-foreground/[0.03] border rounded-xl p-3 flex flex-col gap-2 ${
                            isOverdue ? 'border-red-500/30 bg-red-500/5' : 'border-border'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`text-[10px] font-bold ${typeColors[ev.type] || 'text-muted-foreground'}`}>
                                  {typeIcons[ev.type] || '📅'} {ev.type}
                                </span>
                                <span className={`text-[10px] font-semibold ${isOverdue ? 'text-red-400' : isToday ? 'text-amber-400' : 'text-muted-foreground'}`}>
                                  {dateLabel}
                                </span>
                              </div>
                              <p className="text-[12px] font-semibold text-foreground mt-1 leading-snug">
                                {ev.title}
                              </p>
                              {ev.location && (
                                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                  📍 {ev.location}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0">
                              <EventActionButton
                                type="CALENDAR"
                                id={ev.id}
                                currentStatus={ev.status}
                                compact
                                completionNote={ev.completion_note}
                                completedBy={ev.completed_by}
                                completedAt={ev.completed_at}
                                onActionComplete={fetchClientEvents}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Nova Tarefa rápida */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setTaskModal(true)}
              >
                <div className="flex items-center gap-2.5">
                  <CheckSquare size={15} className="text-emerald-400" />
                  <span className="text-[13px] font-bold text-foreground">Nova Tarefa</span>
                </div>
                <Plus size={15} className="text-muted-foreground" />
              </button>
            </div>

            {/* Resumo Financeiro */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setFinanceOpen(!financeOpen)}
              >
                <div className="flex items-center gap-2.5">
                  <DollarSign size={15} className="text-emerald-400" />
                  <span className="text-[13px] font-bold text-foreground">Resumo Financeiro</span>
                </div>
                {financeOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>
              {financeOpen && (
                <div className="px-6 pb-5">
                  {financeLoading ? (
                    <div className="text-center py-4"><Loader2 size={16} className="animate-spin text-muted-foreground mx-auto" /></div>
                  ) : financeSummary ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 text-center">
                        <p className="text-[9px] text-blue-400 uppercase tracking-wider font-medium">Contratado</p>
                        <p className="text-sm font-bold text-blue-400 mt-0.5">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financeSummary.contracted)}
                        </p>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5 text-center">
                        <p className="text-[9px] text-emerald-400 uppercase tracking-wider font-medium">Recebido</p>
                        <p className="text-sm font-bold text-emerald-400 mt-0.5">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financeSummary.received)}
                        </p>
                      </div>
                      <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-2.5 text-center">
                        <p className="text-[9px] text-sky-400 uppercase tracking-wider font-medium">Pendente</p>
                        <p className="text-sm font-bold text-sky-400 mt-0.5">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financeSummary.pending)}
                        </p>
                      </div>
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 text-center">
                        <p className="text-[9px] text-red-400 uppercase tracking-wider font-medium">Atrasado</p>
                        <p className="text-sm font-bold text-red-400 mt-0.5">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financeSummary.overdue)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">Sem dados financeiros</p>
                  )}
                </div>
              )}
            </div>

            {/* Honorários Negociados */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setNegHonOpen(!negHonOpen)}
              >
                <div className="flex items-center gap-2.5">
                  <Handshake size={15} className="text-sky-400" />
                  <span className="text-[13px] font-bold text-foreground">Honorários Negociados</span>
                  {negHonorarios.length > 0 && (
                    <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">{negHonorarios.length}</span>
                  )}
                </div>
                {negHonOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>
              {negHonOpen && (
                <div className="px-6 pb-5 space-y-3">
                  {negHonLoading ? (
                    <div className="text-center py-4"><Loader2 size={16} className="animate-spin text-muted-foreground mx-auto" /></div>
                  ) : (
                    <>
                      {negHonorarios.length === 0 && !showNegHonForm && (
                        <p className="text-xs text-muted-foreground text-center py-2">Nenhum honorário negociado</p>
                      )}

                      {/* Lista de honorários com parcelas */}
                      {negHonorarios.map((h: any) => {
                        const statusColors: Record<string, string> = {
                          NEGOCIANDO: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
                          ACEITO: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                          RECUSADO: 'bg-red-500/15 text-red-400 border-red-500/30',
                          CONVERTIDO: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
                        };
                        const typeLabels: Record<string, string> = { CONTRATUAL: 'Contratual', ENTRADA: 'Entrada', ACORDO: 'Acordo' };
                        const nextStatus: Record<string, string> = { NEGOCIANDO: 'ACEITO', ACEITO: 'RECUSADO', RECUSADO: 'NEGOCIANDO' };
                        const payments: any[] = h.payments || [];

                        return (
                          <div key={h.id} className="bg-accent/30 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-semibold bg-foreground/[0.06] px-2 py-0.5 rounded text-muted-foreground">
                                  {typeLabels[h.type] || h.type}
                                </span>
                                <button
                                  onClick={() => h.status !== 'CONVERTIDO' && updateNegHonStatus(h.id, nextStatus[h.status] || 'NEGOCIANDO')}
                                  disabled={h.status === 'CONVERTIDO'}
                                  className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${statusColors[h.status] || 'bg-gray-500/15 text-gray-400'} ${h.status !== 'CONVERTIDO' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                                  title={h.status !== 'CONVERTIDO' ? 'Clique para alterar status' : 'Convertido em honorário do caso'}
                                >
                                  {h.status}
                                </button>
                              </div>
                              {h.status !== 'CONVERTIDO' && (
                                <button onClick={() => deleteNegHonorario(h.id)} className="text-muted-foreground hover:text-red-400 transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                            <div className="flex items-baseline gap-3">
                              <span className="text-sm font-bold text-foreground">{fmtBRL(h.total_value)}</span>
                              {payments.length > 1 && <span className="text-[11px] text-muted-foreground">{payments.length}x</span>}
                            </div>
                            {h.notes && <p className="text-[11px] text-muted-foreground leading-relaxed">{h.notes}</p>}

                            {/* Parcelas */}
                            {payments.length > 0 && (
                              <div className="space-y-1 pt-1 border-t border-border/40">
                                {payments.map((pay: any, idx: number) => (
                                  <div key={pay.id} className="flex items-center justify-between text-[11px]">
                                    <div className="flex items-center gap-2">
                                      <span className="text-muted-foreground w-4">{idx + 1}.</span>
                                      <span className="font-medium text-foreground">{fmtBRL(pay.amount)}</span>
                                      <span className="text-muted-foreground">{pay.due_date ? fmtDt(pay.due_date) : <span className="italic text-muted-foreground/50">Ao final</span>}</span>
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${
                                        pay.status === 'PAGO' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                                        pay.status === 'ATRASADO' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                                        'bg-sky-500/15 text-sky-400 border-sky-500/20'
                                      }`}>{pay.status}</span>
                                    </div>
                                    {pay.status !== 'PAGO' && h.status !== 'CONVERTIDO' && (
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => markNegPaymentPaid(pay.id)} className="text-emerald-400 hover:text-emerald-300 text-[10px] font-semibold" title="Marcar como pago">
                                          <Check size={12} />
                                        </button>
                                        <button onClick={() => deleteNegPayment(pay.id)} className="text-muted-foreground hover:text-red-400" title="Excluir parcela">
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Botão Gerar Cobrança / Badge Cobrança Gerada */}
                            {payments.length > 0 && h.status !== 'CONVERTIDO' && payments.some((p: any) => p.status !== 'PAGO') && (
                              <div className="pt-2 border-t border-border/40">
                                {negHonChargeResult[h.id] ? (
                                  <div className="space-y-1.5">
                                    <span className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-semibold inline-flex items-center gap-1">
                                      <Check size={10} /> Cobrança Gerada
                                    </span>
                                    {negHonChargeResult[h.id].boleto?.url && (
                                      <a href={negHonChargeResult[h.id].boleto.url} target="_blank" rel="noopener noreferrer"
                                        className="text-[11px] text-primary hover:underline flex items-center gap-1">
                                        <ExternalLink size={10} /> Abrir Boleto
                                      </a>
                                    )}
                                    {negHonChargeResult[h.id].pix?.copyPaste && (
                                      <button onClick={() => { navigator.clipboard.writeText(negHonChargeResult[h.id].pix.copyPaste); showSuccess('PIX copiado!'); }}
                                        className="text-[11px] text-primary hover:underline flex items-center gap-1">
                                        <CreditCard size={10} /> Copiar PIX
                                      </button>
                                    )}
                                    {negHonChargeResult[h.id].invoice_url && (
                                      <a href={negHonChargeResult[h.id].invoice_url} target="_blank" rel="noopener noreferrer"
                                        className="text-[11px] text-primary hover:underline flex items-center gap-1">
                                        <ExternalLink size={10} /> Ver Fatura
                                      </a>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={async () => {
                                      setNegHonCharging(h.id);
                                      try {
                                        const res = await api.post('/payment-gateway/charges/installment', {
                                          leadHonorarioId: h.id,
                                          billingType: 'BOLETO',
                                        });
                                        setNegHonChargeResult(prev => ({ ...prev, [h.id]: res.data }));
                                        showSuccess(`Cobrança gerada! ${payments.length}x`);
                                      } catch (err: any) { showError(err?.response?.data?.message || 'Erro ao gerar cobrança'); }
                                      finally { setNegHonCharging(null); }
                                    }}
                                    disabled={negHonCharging === h.id}
                                    className="w-full text-[11px] py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                                  >
                                    {negHonCharging === h.id ? <Loader2 size={11} className="animate-spin" /> : <CreditCard size={11} />}
                                    Gerar Cobrança Asaas {payments.length > 1 ? `(${payments.length}x)` : ''}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Formulário de criação com parcelas individuais */}
                      {showNegHonForm ? (
                        <div className="bg-accent/30 rounded-lg p-3 space-y-2.5">
                          <select
                            value={negHonType}
                            onChange={e => setNegHonType(e.target.value)}
                            className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-foreground"
                          >
                            <option value="CONTRATUAL">Contratual</option>
                            <option value="ENTRADA">Entrada</option>
                            <option value="ACORDO">Acordo</option>
                          </select>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase">Valor Total (R$)</label>
                            <input type="number" step="0.01" min="0" value={negHonValue} onChange={e => setNegHonValue(e.target.value)}
                              placeholder="5000.00" className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-foreground mt-0.5" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] text-muted-foreground uppercase">Parcelas</label>
                              <button onClick={handleDividirIgual} disabled={!negHonValue} className="text-[10px] text-sky-400 hover:text-sky-300 disabled:opacity-30">
                                Dividir igual
                              </button>
                            </div>
                            <div className="space-y-1.5">
                              {negHonParcelas.map((p, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-muted-foreground w-3">{i + 1}.</span>
                                  <input type="number" step="0.01" min="0" value={p.amount}
                                    onChange={e => { const arr = [...negHonParcelas]; arr[i] = { ...arr[i], amount: e.target.value }; setNegHonParcelas(arr); }}
                                    placeholder="R$" className="flex-1 text-xs bg-background border border-border rounded-md px-2 py-1.5 text-foreground" />
                                  <input type="date" value={p.due_date}
                                    onChange={e => { const arr = [...negHonParcelas]; arr[i] = { ...arr[i], due_date: e.target.value }; setNegHonParcelas(arr); }}
                                    className="text-xs bg-background border border-border rounded-md px-2 py-1.5 text-foreground" />
                                  {negHonParcelas.length > 1 && (
                                    <button onClick={() => setNegHonParcelas(negHonParcelas.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-400">
                                      <X size={12} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                            <button onClick={() => setNegHonParcelas([...negHonParcelas, { amount: '', due_date: '' }])}
                              className="text-[10px] text-sky-400 hover:text-sky-300 mt-1 flex items-center gap-1">
                              <Plus size={10} /> Adicionar parcela
                            </button>
                            {negHonValue && (
                              <p className={`text-[10px] mt-1 ${
                                Math.abs(negHonParcelas.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) - parseFloat(negHonValue)) <= 0.02
                                  ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                Total parcelas: {fmtBRL(negHonParcelas.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0))}
                                {Math.abs(negHonParcelas.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) - parseFloat(negHonValue)) <= 0.02 ? ' ✓' : ` (esperado: ${fmtBRL(negHonValue)})`}
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase">Observações</label>
                            <textarea value={negHonNotes} onChange={e => setNegHonNotes(e.target.value)}
                              placeholder="Ex: Combinado 3x sem juros..." rows={2}
                              className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-foreground mt-0.5 resize-none" />
                          </div>
                          <div className="flex items-center gap-2 justify-end">
                            <button onClick={() => { setShowNegHonForm(false); resetNegHonForm(); }}
                              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">Cancelar</button>
                            <button onClick={createNegHonorario} disabled={negHonSaving || !negHonValue}
                              className="text-xs bg-sky-600 hover:bg-sky-500 text-white px-4 py-1.5 rounded-md disabled:opacity-50 flex items-center gap-1.5">
                              {negHonSaving && <Loader2 size={12} className="animate-spin" />} Salvar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setShowNegHonForm(true)}
                          className="w-full flex items-center justify-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 py-2 border border-dashed border-sky-500/30 rounded-lg hover:bg-sky-500/5 transition-colors">
                          <Plus size={13} /> Adicionar Honorário
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Histórico de Transferências */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setTransfersOpen(!transfersOpen)}
              >
                <div className="flex items-center gap-2.5">
                  <ArrowRight size={15} className="text-sky-400" />
                  <span className="text-[13px] font-bold text-foreground">Transferências</span>
                  {transfers.length > 0 && (
                    <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">{transfers.length}</span>
                  )}
                </div>
                {transfersOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>
              {transfersOpen && (
                <div className="px-6 pb-5">
                  {transfers.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground/50 italic text-center py-3">Nenhuma transferência registrada</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {transfers.map(t => (
                        <div key={t.id} className="flex items-start gap-2.5 py-2 border-b border-border/50 last:border-0">
                          <span className="text-sky-400 text-sm shrink-0 mt-0.5">{t.text.startsWith('↩') ? '↩' : '📨'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-foreground leading-relaxed">{t.text}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              {new Date(t.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Notas Internas */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setNotesOpen(!notesOpen)}
              >
                <div className="flex items-center gap-2.5">
                  <StickyNote size={15} className="text-sky-400" />
                  <span className="text-[13px] font-bold text-foreground">Notas Internas</span>
                  {notes.length > 0 && (
                    <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">{notes.length}</span>
                  )}
                </div>
                {notesOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>
              {notesOpen && (
                <div className="px-6 pb-5 flex flex-col gap-3">
                  {/* Input de nova nota */}
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitNote(); }}
                      placeholder="Adicionar nota interna… (Ctrl+Enter para enviar)"
                      rows={2}
                      className="flex-1 resize-none bg-foreground/[0.04] border border-border rounded-xl px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-sky-400/30"
                    />
                    <button
                      onClick={submitNote}
                      disabled={!noteText.trim() || addingNote}
                      className="h-9 px-3 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/20 hover:bg-sky-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 text-[12px] font-medium shrink-0"
                    >
                      {addingNote ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    </button>
                  </div>

                  {/* Lista de notas */}
                  {notes.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground/50 italic text-center py-3">Nenhuma nota ainda</p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {notes.map(note => (
                        <div key={note.id} className="group bg-foreground/[0.03] border border-border rounded-xl p-3.5 relative">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[11px] font-bold text-sky-400">{note.user.name}</span>
                            <span className="text-[10px] text-muted-foreground/60">{formatDate(note.created_at)}</span>
                          </div>
                          <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{note.text}</p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            disabled={deletingNoteId === note.id}
                            className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md text-red-400 hover:bg-red-400/10 transition-all"
                            title="Excluir nota"
                          >
                            {deletingNoteId === note.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Histórico de Atividades (Timeline) */}
            <div className="border-t border-border">
              <button
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                onClick={() => setTimelineOpen(!timelineOpen)}
              >
                <div className="flex items-center gap-2.5">
                  <Clock size={15} className="text-sky-400" />
                  <span className="text-[13px] font-bold text-foreground">Histórico</span>
                  {timeline.length > 0 && (
                    <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">{timeline.length}</span>
                  )}
                </div>
                {timelineOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
              </button>
              {timelineOpen && (
                <div className="px-6 pb-5">
                  {timelineLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 size={16} className="animate-spin text-muted-foreground" />
                    </div>
                  ) : timeline.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground/50 italic text-center py-3">Nenhuma atividade registrada ainda</p>
                  ) : (
                    <div className="relative">
                      {/* Linha vertical da timeline */}
                      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                      <div className="space-y-4">
                        {timeline.map(item => (
                          <div key={item.id} className="flex gap-3 items-start pl-8 relative">
                            {/* Ícone da timeline */}
                            <div className={`absolute left-0 w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${
                              item.type === 'stage_change'
                                ? 'border-sky-500/40 bg-sky-500/10'
                                : 'border-sky-500/40 bg-sky-500/10'
                            }`}>
                              {item.type === 'stage_change'
                                ? <ArrowRight size={10} className="text-sky-400" />
                                : <StickyNote size={10} className="text-sky-400" />
                              }
                            </div>

                            {/* Conteúdo */}
                            <div className="flex-1 min-w-0">
                              {item.type === 'stage_change' ? (
                                <p className="text-[12px] text-foreground leading-snug">
                                  {item.from_stage ? (
                                    <>
                                      <span className="text-muted-foreground">{STAGE_LABEL[item.from_stage] ?? item.from_stage}</span>
                                      <span className="mx-1.5 text-muted-foreground/50">→</span>
                                      <span className={`font-semibold ${
                                        item.to_stage === 'PERDIDO' ? 'text-red-400' :
                                        item.to_stage === 'FINALIZADO' ? 'text-emerald-400' : 'text-sky-400'
                                      }`}>
                                        {STAGE_LABEL[item.to_stage!] ?? item.to_stage}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      Iniciado em <span className="text-foreground font-semibold">{STAGE_LABEL[item.to_stage!] ?? item.to_stage}</span>
                                    </span>
                                  )}
                                  {item.loss_reason && (
                                    <span className="ml-1 text-red-400 text-[11px]">— {item.loss_reason}</span>
                                  )}
                                </p>
                              ) : (
                                <p className="text-[12px] text-foreground bg-sky-500/5 border border-sky-500/15 rounded-lg px-2.5 py-1.5 leading-snug">
                                  {item.text}
                                </p>
                              )}
                              <p className="text-[10px] text-muted-foreground/50 mt-1">
                                {item.type === 'stage_change'
                                  ? (item.actor?.name ?? 'Sistema')
                                  : (item.author?.name ?? '')
                                }
                                {' · '}
                                {new Date(item.created_at).toLocaleString('pt-BR', {
                                  day: '2-digit', month: 'short', year: 'numeric',
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Conversas anteriores */}
            {convHistory.length > 0 && (
              <div className="border-t border-border">
                <button
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                  onClick={() => setConvHistoryOpen(!convHistoryOpen)}
                >
                  <div className="flex items-center gap-2.5">
                    <MessageSquare size={15} className="text-blue-400" />
                    <span className="text-[13px] font-bold text-foreground">Conversas anteriores</span>
                    <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      {convHistory.length}
                    </span>
                  </div>
                  {convHistoryOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
                </button>
                {convHistoryOpen && (
                  <div className="px-4 pb-4 flex flex-col gap-2">
                    {convHistory.map((c: any) => {
                      const lastMsg = c.messages?.at(-1);
                      const dateStr = c.last_message_at
                        ? new Date(c.last_message_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                        : '—';
                      const assignedName = c.assigned_user?.name || c.assignedAgentName || null;
                      return (
                        <div key={c.id} className="flex flex-col gap-1 p-3 rounded-xl bg-muted/40 border border-border/60">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-muted-foreground">{dateStr}</span>
                            {assignedName && (
                              <span className="text-[10px] text-muted-foreground truncate">@{assignedName}</span>
                            )}
                          </div>
                          {lastMsg?.text && (
                            <p className="text-[12px] text-foreground/80 truncate">
                              {lastMsg.direction === 'out' ? '↪ ' : ''}{lastMsg.text}
                            </p>
                          )}
                          {c.legal_area && (
                            <span className="text-[10px] text-violet-400 font-medium">⚖️ {c.legal_area}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Ficha Trabalhista */}
            {lead && (() => {
              const hasTrabalhistaArea = lead.conversations?.some((c: any) => c.legal_area?.toLowerCase().includes('trabalhist'));
              if (!hasTrabalhistaArea) return null;
              return (
                <div className="border-t border-border">
                  <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors" onClick={() => setFichaOpen(!fichaOpen)}>
                    <div className="flex items-center gap-2.5">
                      <ClipboardList size={15} className="text-sky-400" />
                      <span className="text-[13px] font-bold text-foreground">Ficha Trabalhista</span>
                    </div>
                    {fichaOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
                  </button>
                  {fichaOpen && (
                    <div className="px-4 pb-5">
                      <FichaTrabalhista leadId={lead.id} />
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        )}

        {/* Footer */}
        {lead && (
          <div className="px-6 py-4 border-t border-border shrink-0 space-y-2">
            <button
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors shadow-sm"
              onClick={async () => {
                let convId = resolvedConvId || lead.conversations?.[0]?.id;
                // Se não tem conversa, criar uma
                if (!convId && lead.phone) {
                  try {
                    const res = await api.post('/conversations', { lead_id: lead.id, channel: 'whatsapp', instance_name: 'whatsapp' });
                    convId = res.data?.id;
                  } catch {
                    // Fallback: tenta buscar conversa existente
                    try {
                      const res = await api.get(`/conversations?leadId=${lead.id}&limit=1`);
                      const convs = res.data?.data || res.data || [];
                      if (convs.length > 0) convId = convs[0].id;
                    } catch {}
                  }
                }
                if (convId) {
                  sessionStorage.setItem('crm_open_conv', convId);
                  router.push('/atendimento');
                  onClose();
                } else {
                  showError('Nao foi possivel abrir o chat. Verifique se o contato tem telefone valido.');
                }
              }}
            >
              <MessageSquare size={15} />
              Abrir no Chat
            </button>
            {isAdmin && (
              <>
                {!showDeleteConfirm ? (
                  <button onClick={() => setShowDeleteConfirm(true)} className="w-full py-2 rounded-xl border border-destructive/30 text-destructive text-[12px] font-semibold flex items-center justify-center gap-2 hover:bg-destructive/10 transition-colors">
                    <Trash2 size={13} />
                    Excluir Contato
                  </button>
                ) : (
                  <div className="p-3 bg-destructive/5 border border-destructive/30 rounded-xl space-y-2">
                    <p className="text-[11px] font-bold text-destructive flex items-center gap-1.5"><AlertCircle size={13} /> Atenção: ação irreversível</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Serão excluídos: contato, <strong>todas as conversas</strong>, mensagens, memória IA, documentos, casos jurídicos e tarefas.</p>
                    <div className="flex gap-2">
                      <button onClick={handleDeleteContact} disabled={deleting} className="flex-1 py-2 text-[12px] font-bold bg-destructive text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-opacity">
                        {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        {deleting ? 'Excluindo…' : 'Confirmar Exclusão'}
                      </button>
                      <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="px-4 py-2 text-[12px] text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors">Cancelar</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal de nova tarefa */}
      {taskModal && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" style={{ zIndex: zBase + 10 }} onClick={() => setTaskModal(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[95vw] bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4" style={{ zIndex: zBase + 20 }}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-foreground flex items-center gap-2">
                <CheckSquare size={16} className="text-emerald-400" />
                Nova Tarefa
              </h3>
              <button onClick={() => setTaskModal(false)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                <X size={15} />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Título *</label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitTask(); }}
                  placeholder="Descreva a tarefa…"
                  autoFocus
                  className="w-full bg-foreground/[0.04] border border-border rounded-xl px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Prazo</label>
                  <input
                    type="datetime-local"
                    value={taskDueAt}
                    onChange={e => setTaskDueAt(e.target.value)}
                    className="w-full bg-foreground/[0.04] border border-border rounded-xl px-3 py-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Atribuir a</label>
                  <select
                    value={taskAssignedId}
                    onChange={e => setTaskAssignedId(e.target.value)}
                    className="w-full bg-foreground/[0.04] border border-border rounded-xl px-3 py-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
                  >
                    <option value="">Ninguém</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setTaskModal(false)}
                className="px-4 py-2 text-[12px] rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={submitTask}
                disabled={!taskTitle.trim() || savingTask}
                className="px-4 py-2 text-[12px] rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {savingTask ? <Loader2 size={13} className="animate-spin" /> : <CheckSquare size={13} />}
                Criar Tarefa
              </button>
            </div>
          </div>
        </>
      )}

      {/* Viewer de documentos */}
      {docViewer && (
        <>
          <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm" onClick={() => setDocViewer(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[150] w-[900px] max-w-[95vw] h-[85vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-[13px] font-medium text-foreground truncate max-w-[55%]">{docViewer.filename}</span>
              <div className="flex items-center gap-2 shrink-0">
                <a href={`${docViewer.url}?dl=1`} target="_blank" rel="noopener noreferrer" title="Baixar" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground/[0.08] text-muted-foreground hover:text-foreground text-[12px] transition-colors"><Download size={13} />Baixar</a>
                <button onClick={() => setDocViewer(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"><X size={16} /></button>
              </div>
            </div>
            <iframe src={docViewer.url} title={docViewer.filename} className="flex-1 border-0 w-full" />
          </div>
        </>
      )}
    </>
  );
}
