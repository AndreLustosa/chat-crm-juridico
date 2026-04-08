'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { Search, User, Phone, Loader2, X, MessageSquare, Calendar, Brain, ChevronDown, ChevronUp, Mail, Pencil, Check, UserCheck, FolderOpen, FileText, Image as ImageIcon, Mic, Video, Download, Trash2, RotateCcw, AlertCircle, ClipboardList, StickyNote, Plus, Send, Scale, CheckSquare, ExternalLink, Clock, ArrowRight, DollarSign } from 'lucide-react';
import FichaTrabalhista from '@/components/FichaTrabalhista';
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
  return <FileText size={15} className="text-amber-400" />;
}

const CASE_STAGE_MAP: Record<string, { label: string; color: string }> = {
  VIABILIDADE:  { label: 'Viabilidade',  color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  ANDAMENTO:    { label: 'Em Andamento', color: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
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
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [resettingMemory, setResettingMemory] = useState(false);
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
  const factsJson = lead?.memory?.facts_json as any;

  const handleResetMemory = async () => {
    if (!lead) return;
    if (!window.confirm('Resetar a memória da IA para este contato? A IA começará do zero na próxima conversa.')) return;
    setResettingMemory(true);
    try {
      await api.delete(`/leads/${lead.id}/memory`);
      setLead(prev => prev ? { ...prev, memory: undefined } : prev);
    } catch {
      alert('Erro ao resetar memória. Tente novamente.');
    } finally {
      setResettingMemory(false);
    }
  };

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
          <h2 className="text-[15px] font-bold text-foreground">Painel do Cliente</h2>
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

            {/* Histórico de Atendimento */}
            {lead.memory && (
              <div className="border-b border-border">
                <div className="flex items-center">
                  <button className="flex-1 px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors" onClick={() => setMemoryOpen(!memoryOpen)}>
                    <div className="flex items-center gap-2.5">
                      <Brain size={15} className="text-violet-400" />
                      <span className="text-[13px] font-bold text-foreground">Histórico de Atendimento</span>
                      <span className="text-[10px] text-muted-foreground font-mono">v{lead.memory.version}</span>
                    </div>
                    {memoryOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
                  </button>
                  <button onClick={handleResetMemory} disabled={resettingMemory} title="Resetar memória da IA" className="mr-4 p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50">
                    {resettingMemory ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  </button>
                </div>
                {memoryOpen && (
                  <div className="px-6 pb-5 flex flex-col gap-4">
                    {lead.memory.summary && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Resumo</p>
                        <p className="text-[13px] text-foreground leading-relaxed bg-foreground/[0.03] rounded-xl p-3 border border-border">{lead.memory.summary}</p>
                      </div>
                    )}
                    {factsJson && (
                      <div className="grid grid-cols-2 gap-3">
                        {factsJson.case?.area && (
                          <div className="bg-foreground/[0.03] rounded-xl p-3 border border-border">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Área</p>
                            <p className="text-[13px] font-semibold text-foreground">{factsJson.case.area}</p>
                          </div>
                        )}
                        {factsJson.case?.status && (
                          <div className="bg-foreground/[0.03] rounded-xl p-3 border border-border">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Status</p>
                            <p className="text-[13px] font-semibold text-foreground">{factsJson.case.status}</p>
                          </div>
                        )}
                        {factsJson.facts?.current?.main_issue && (
                          <div className="col-span-2 bg-foreground/[0.03] rounded-xl p-3 border border-border">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Problema Principal</p>
                            <p className="text-[13px] text-foreground">{factsJson.facts.current.main_issue}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {factsJson?.facts?.core_facts?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Fatos-chave</p>
                        <ul className="flex flex-col gap-1.5">
                          {factsJson.facts.core_facts.slice(0, 6).map((fact: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-[12px] text-foreground">
                              <span className="text-primary mt-0.5 shrink-0">•</span>
                              <span>{fact}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {factsJson?.open_questions?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Perguntas em Aberto</p>
                        <ul className="flex flex-col gap-1.5">
                          {factsJson.open_questions.slice(0, 4).map((q: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-[12px] text-amber-400">
                              <span className="mt-0.5 shrink-0">?</span>
                              <span>{q}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">Atualizado em {formatDate(lead.memory.last_updated_at)}</p>
                  </div>
                )}
              </div>
            )}

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
                      onClick={() => setCreatingCase(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-violet-500/30 text-violet-400 hover:bg-violet-500/5 transition-colors text-[11px] font-medium"
                    >
                      <Plus size={12} />
                      Novo Caso Jurídico
                    </button>
                  ) : (
                    <div className="bg-foreground/[0.03] border border-violet-500/30 rounded-xl p-3.5 flex flex-col gap-2.5">
                      <select
                        value={newCaseArea}
                        onChange={(e) => setNewCaseArea(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500"
                      >
                        <option value="">Área jurídica (opcional)</option>
                        <option value="TRABALHISTA">Trabalhista</option>
                        <option value="CIVIL">Civil</option>
                        <option value="PREVIDENCIARIO">Previdenciário</option>
                        <option value="PENAL">Penal</option>
                        <option value="TRIBUTARIO">Tributário</option>
                        <option value="ADMINISTRATIVO">Administrativo</option>
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setCreatingCase(false); setNewCaseArea(''); }}
                          className="flex-1 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:bg-accent/30 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const res = await api.post('/legal-cases', {
                                lead_id: lead.id,
                                conversation_id: resolvedConvId || undefined,
                                legal_area: newCaseArea || undefined,
                              });
                              setCreatingCase(false);
                              setNewCaseArea('');
                              router.push(`/atendimento/workspace/${res.data.id}`);
                            } catch {
                              // silently fail
                            }
                          }}
                          className="flex-1 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-medium hover:bg-violet-500 transition-colors"
                        >
                          Criar Caso
                        </button>
                      </div>
                    </div>
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
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-center">
                        <p className="text-[9px] text-amber-400 uppercase tracking-wider font-medium">Pendente</p>
                        <p className="text-sm font-bold text-amber-400 mt-0.5">
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
                  <StickyNote size={15} className="text-amber-400" />
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
                      className="flex-1 resize-none bg-foreground/[0.04] border border-border rounded-xl px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-amber-400/30"
                    />
                    <button
                      onClick={submitNote}
                      disabled={!noteText.trim() || addingNote}
                      className="h-9 px-3 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 text-[12px] font-medium shrink-0"
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
                            <span className="text-[11px] font-bold text-amber-400">{note.user.name}</span>
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
                                : 'border-amber-500/40 bg-amber-500/10'
                            }`}>
                              {item.type === 'stage_change'
                                ? <ArrowRight size={10} className="text-sky-400" />
                                : <StickyNote size={10} className="text-amber-400" />
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
                                <p className="text-[12px] text-foreground bg-amber-500/5 border border-amber-500/15 rounded-lg px-2.5 py-1.5 leading-snug">
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
                      <ClipboardList size={15} className="text-amber-500" />
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
