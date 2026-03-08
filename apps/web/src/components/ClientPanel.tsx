'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { Search, User, Phone, Loader2, X, MessageSquare, Calendar, Brain, ChevronDown, ChevronUp, Mail, Pencil, Check, UserCheck, FolderOpen, FileText, Image as ImageIcon, Mic, Video, Download, Trash2, RotateCcw, AlertCircle, ClipboardList } from 'lucide-react';
import FichaTrabalhista from '@/components/FichaTrabalhista';
import { useRouter } from 'next/navigation';
import api, { getMediaUrl } from '@/lib/api';
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
  _count?: { conversations: number };
}

interface DocItem {
  messageId: string;
  filename: string;
  mimeType: string;
  size?: number;
  createdAt: string;
}

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
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
}: {
  leadId: string;
  onClose: () => void;
  onLightbox: (url: string) => void;
  isAdmin?: boolean;
  onDeleteSuccess?: (id: string) => void;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [resettingMemory, setResettingMemory] = useState(false);
  const [editing, setEditing] = useState<'name' | 'email' | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolvedAgent, setResolvedAgent] = useState<{ id: string; name: string } | null>(null);
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [docViewer, setDocViewer] = useState<{ url: string; mimeType: string; filename: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    setResolvedAgent(null);
    setResolvedConvId(null);
    setDocuments([]);
    api.get(`/leads/${leadId}`).then(r => {
      setLead(r.data);
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

  const deleteDoc = (messageId: string) => {
    if (!confirm('Remover do Banco de Documentos?\n(O arquivo permanece no chat e no banco de dados)')) return;
    setDocuments(prev => prev.filter(d => d.messageId !== messageId));
  };

  const saveField = async (field: 'name' | 'email', value: string) => {
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
      <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[3px]" onClick={onClose} />

      {/* Modal grande */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[780px] max-w-[95vw] max-h-[90vh] z-[100] bg-card border border-border rounded-2xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
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
              {docsOpen && (
                <div className="px-6 pb-5">
                  {documents.length === 0 ? (
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
              onClick={() => {
                const convId = resolvedConvId || lead.conversations?.[0]?.id;
                if (convId) sessionStorage.setItem('crm_open_conv', convId);
                router.push('/atendimento');
                onClose();
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
