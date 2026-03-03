'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { Search, User, Phone, Loader2, RefreshCw, X, MessageSquare, Calendar, Tag, Brain, ChevronDown, ChevronUp, ExternalLink, Mail, Pencil, Check, Plus, UserCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  conversations: number;
  lastMessage: string;
  origin: string;
  instanceName?: string;
  profile_picture_url?: string;
}

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

const STAGE_COLORS: Record<string, string> = {
  'NOVO': 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  'Contato Inicial': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Em Qualificação': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'Aguardando Formulário': 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  'Reunião Agendada': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'Desqualificado': 'bg-red-500/15 text-red-400 border-red-500/20',
  'Finalizado': 'bg-green-500/15 text-green-400 border-green-500/20',
};

const STATUS_COLORS: Record<string, string> = {
  'ABERTO': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'FECHADO': 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  'PENDENTE': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const STAGES = ['NOVO', 'Contato Inicial', 'Em Qualificação', 'Aguardando Formulário', 'Reunião Agendada', 'Desqualificado', 'Finalizado'];

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

function ClientPanel({ leadId, onClose, onLightbox }: { leadId: string; onClose: () => void; onLightbox: (url: string) => void }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [editing, setEditing] = useState<'name' | 'email' | null>(null);
  const [saving, setSaving] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [resolvedAgent, setResolvedAgent] = useState<{ id: string; name: string } | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    setResolvedAgent(null);
    api.get(`/leads/${leadId}`).then(r => {
      setLead(r.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leadId]);

  // Buscar atendente das conversas (fonte mais confiável)
  useEffect(() => {
    if (!leadId) return;
    api.get(`/conversations/lead/${leadId}`).then(r => {
      const convs = r.data as any[];
      const agent = convs?.[0]?.assigned_user;
      if (agent) setResolvedAgent(agent);
    }).catch(() => {});
  }, [leadId]);

  const saveField = async (field: 'name' | 'email', value: string) => {
    if (!lead) return;
    setSaving(true);
    try {
      await api.patch(`/leads/${leadId}`, { [field]: value });
      setLead(prev => prev ? { ...prev, [field]: value } : prev);
    } catch (e) { console.error(e); } finally { setSaving(false); setEditing(null); }
  };

  const saveStage = async (stage: string) => {
    if (!lead) return;
    setSaving(true);
    try {
      await api.patch(`/leads/${leadId}/stage`, { stage });
      setLead(prev => prev ? { ...prev, stage } : prev);
    } catch (e) { console.error(e); } finally { setSaving(false); setStageOpen(false); }
  };

  const addTag = async () => {
    if (!lead || !newTag.trim()) return;
    const tag = newTag.trim();
    if (lead.tags?.includes(tag)) { setNewTag(''); return; }
    const tags = [...(lead.tags || []), tag];
    setSaving(true);
    try {
      await api.patch(`/leads/${leadId}`, { tags });
      setLead(prev => prev ? { ...prev, tags } : prev);
    } catch (e) { console.error(e); } finally { setSaving(false); setNewTag(''); setAddingTag(false); }
  };

  const removeTag = async (tag: string) => {
    if (!lead) return;
    const tags = (lead.tags || []).filter(t => t !== tag);
    setSaving(true);
    try {
      await api.patch(`/leads/${leadId}`, { tags });
      setLead(prev => prev ? { ...prev, tags } : prev);
    } catch (e) { console.error(e); } finally { setSaving(false); }
  };

  // Atendente: resolvedAgent (via /conversations/lead/:id) tem prioridade, fallback para lead.conversations
  const currentAgent = resolvedAgent ?? lead?.conversations?.[0]?.assigned_user ?? null;

  const factsJson = lead?.memory?.facts_json as any;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[3px]" onClick={onClose} />

      {/* Modal centralizado */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] max-h-[88vh] z-[100] bg-card border border-border rounded-2xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header do painel */}
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

            {/* Seção: Identidade */}
            <div className="px-6 py-6 border-b border-border">
              <div className="flex items-start gap-4">
                {/* Foto */}
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

                {/* Info principal */}
                <div className="flex-1 min-w-0">
                  {/* Nome editável */}
                  <div className="group flex items-center gap-2 min-w-0">
                    {editing === 'name' ? (
                      <InlineInput
                        value={lead.name || ''}
                        placeholder="Nome do contato"
                        onSave={v => saveField('name', v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <>
                        <h3 className="text-[18px] font-bold text-foreground leading-tight truncate">{lead.name || 'Sem Nome'}</h3>
                        <button onClick={() => setEditing('name')} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0">
                          <Pencil size={13} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Stage editável */}
                  <div className="relative mt-1.5">
                    <button
                      onClick={() => setStageOpen(!stageOpen)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-opacity hover:opacity-80 ${STAGE_COLORS[lead.stage] || STAGE_COLORS['NOVO']}`}
                    >
                      {lead.stage}
                      <ChevronDown size={10} />
                    </button>
                    {stageOpen && (
                      <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-xl shadow-xl z-10 py-1 min-w-[200px]">
                        {STAGES.map(s => (
                          <button
                            key={s}
                            onClick={() => saveStage(s)}
                            className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-accent transition-colors flex items-center gap-2 ${lead.stage === s ? 'text-primary' : 'text-foreground'}`}
                          >
                            <span className={`w-2 h-2 rounded-full border ${STAGE_COLORS[s] || STAGE_COLORS['NOVO']}`} />
                            {s}
                            {lead.stage === s && <Check size={11} className="ml-auto text-primary" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dados de contato */}
                  <div className="mt-3 flex flex-col gap-1.5">
                    {/* Telefone — não editável */}
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Phone size={13} className="shrink-0" />
                      <span className="font-mono">{formatPhone(lead.phone)}</span>
                    </div>

                    {/* Email editável */}
                    <div className="group flex items-center gap-2 text-[13px] text-muted-foreground min-w-0">
                      <Mail size={13} className="shrink-0" />
                      {editing === 'email' ? (
                        <InlineInput
                          value={lead.email || ''}
                          placeholder="email@exemplo.com"
                          onSave={v => saveField('email', v)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <>
                          <span className="truncate">{lead.email || <span className="italic opacity-50">Sem e-mail</span>}</span>
                          <button onClick={() => setEditing('email')} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0">
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Atendente responsável */}
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <UserCheck size={13} className="shrink-0" />
                      {currentAgent ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
                          <span className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-bold">
                            {currentAgent.name.charAt(0).toUpperCase()}
                          </span>
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

              {/* Tags editáveis */}
              <div className="mt-4 flex flex-wrap gap-2 items-center">
                {(lead.tags || []).map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold border border-primary/20">
                    <Tag size={10} />
                    {tag}
                    <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-red-400 transition-colors">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {addingTag ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={tagInputRef}
                      autoFocus
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') { setAddingTag(false); setNewTag(''); } }}
                      placeholder="nova tag"
                      className="w-24 bg-background border border-primary/40 rounded-full px-2.5 py-0.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/30"
                    />
                    <button onClick={addTag} className="w-5 h-5 flex items-center justify-center rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors">
                      <Check size={10} />
                    </button>
                    <button onClick={() => { setAddingTag(false); setNewTag(''); }} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-accent text-muted-foreground transition-colors">
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTag(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-muted-foreground text-[11px] hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    <Plus size={10} />
                    Tag
                  </button>
                )}
              </div>
            </div>

            {/* Seção: Memória IA */}
            {lead.memory && (
              <div className="border-b border-border">
                <button
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/30 transition-colors"
                  onClick={() => setMemoryOpen(!memoryOpen)}
                >
                  <div className="flex items-center gap-2.5">
                    <Brain size={15} className="text-violet-400" />
                    <span className="text-[13px] font-bold text-foreground">Memória IA</span>
                    <span className="text-[10px] text-muted-foreground font-mono">v{lead.memory.version}</span>
                  </div>
                  {memoryOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
                </button>

                {memoryOpen && (
                  <div className="px-6 pb-5 flex flex-col gap-4">
                    {/* Resumo */}
                    {lead.memory.summary && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Resumo</p>
                        <p className="text-[13px] text-foreground leading-relaxed bg-foreground/[0.03] rounded-xl p-3 border border-border">{lead.memory.summary}</p>
                      </div>
                    )}

                    {/* Dados estruturados */}
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

                    {/* Fatos-chave */}
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

                    {/* Perguntas abertas */}
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

            {/* Seção: Conversas */}
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageSquare size={15} className="text-primary" />
                  <span className="text-[13px] font-bold text-foreground">Conversas</span>
                  <span className="text-[11px] text-muted-foreground bg-foreground/[0.06] px-2 py-0.5 rounded-full font-mono">{lead.conversations?.length ?? 0}</span>
                </div>
              </div>

              {!lead.conversations?.length ? (
                <p className="text-[13px] text-muted-foreground text-center py-8 opacity-50">Nenhuma conversa</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {lead.conversations.map((conv) => {
                    const lastMsg = conv.messages[0];
                    return (
                      <div
                        key={conv.id}
                        className="rounded-xl border border-border bg-foreground/[0.02] hover:bg-accent/30 transition-colors p-4 cursor-pointer group"
                        onClick={() => router.push(`/atendimento/chat/${conv.id}`)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Status + área */}
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${STATUS_COLORS[conv.status] || STATUS_COLORS['ABERTO']}`}>
                                {conv.status}
                              </span>
                              {conv.legal_area && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  {conv.legal_area}
                                </span>
                              )}
                              {conv.ai_mode && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                  IA
                                </span>
                              )}
                            </div>

                            {/* Última mensagem */}
                            {lastMsg?.text && (
                              <p className="text-[12px] text-muted-foreground truncate leading-relaxed">
                                {lastMsg.direction === 'in' ? '' : '→ '}{lastMsg.text}
                              </p>
                            )}

                            {/* Agente + data */}
                            <div className="flex items-center gap-2 mt-2">
                              {conv.assigned_user && (
                                <span className="text-[11px] text-muted-foreground/70">@{conv.assigned_user.name.split(' ')[0]}</span>
                              )}
                              <span className="text-[11px] text-muted-foreground/50">{formatDateShort(conv.last_message_at)}</span>
                            </div>

                            {/* next_step */}
                            {conv.next_step && (
                              <p className="text-[11px] text-primary/70 mt-1.5">Próximo passo: {conv.next_step}</p>
                            )}
                          </div>
                          <ExternalLink size={13} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* Footer com ação rápida */}
        {lead && (
          <div className="px-6 py-4 border-t border-border shrink-0">
            <button
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors shadow-sm"
              onClick={() => {
                if (lead.conversations?.length > 0) {
                  router.push(`/atendimento/chat/${lead.conversations[0].id}`);
                } else {
                  router.push('/atendimento');
                }
              }}
            >
              <MessageSquare size={15} />
              Abrir Conversa
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const fetchAllContacts = async () => {
    try {
      setLoading(true);
      const response = await api.get('/leads');
      const leads = response.data;

      const mappedContacts: Contact[] = leads.map((lead: any) => ({
        id: lead.id,
        name: lead.name || 'Sem Nome',
        phone: lead.phone,
        email: lead.email || '-',
        conversations: lead._count?.conversations || 0,
        lastMessage: lead.conversations?.[0]?.messages?.[0]?.text || '-',
        origin: lead.origin || 'crm',
        profile_picture_url: lead.profile_picture_url,
      }));

      mappedContacts.sort((a, b) => a.name.localeCompare(b.name));
      setContacts(mappedContacts);
    } catch (error) {
      console.error('Erro ao carregar contatos:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllContacts();
  }, []);

  const handleSync = async () => {
    try {
      setSyncing(true);
      const instancesResponse = await api.get('/whatsapp/instances');
      const activeInstances = instancesResponse.data.filter((inst: any) => inst.status === 'open');

      if (activeInstances.length === 0) {
        alert('Nenhuma instância do WhatsApp conectada para sincronizar.');
        return;
      }

      await Promise.all(activeInstances.map(async (inst: any) => {
        try {
          await api.post(`/whatsapp/instances/${inst.instanceName}/sync`);
        } catch (e) {
          console.error(`Erro ao sincronizar instância ${inst.instanceName}:`, e);
        }
      }));

      await fetchAllContacts();
      alert('Sincronização concluída!');
    } catch (error) {
      console.error('Erro na sincronização:', error);
      alert('Erro ao sincronizar contatos.');
    } finally {
      setSyncing(false);
    }
  };

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden text-foreground">
      <main className="flex-1 flex flex-col bg-background overflow-hidden relative">
        {/* Header Section */}
        <header className="px-8 py-6 shrink-0 flex items-center justify-between border-b border-border bg-card/30 backdrop-blur-md z-10">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Contatos</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {loading ? 'Carregando...' : `${contacts.length} contatos sincronizados`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-80 group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input
                type="text"
                placeholder="Buscar por nome ou telefone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-xl text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
              />
            </div>

            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 shadow-sm shadow-primary/20"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </button>
          </div>
        </header>

        {/* Table Section */}
        <div className="flex-1 overflow-y-auto p-8 bg-foreground/[0.01]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="w-10 h-10 animate-spin mb-4" />
              <p className="text-sm font-medium">Carregando contatos...</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <table className="w-full text-left table-auto">
                <thead>
                  <tr className="bg-foreground/[0.02] border-b border-border">
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nome</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Telefone</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Email</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.04]">
                  {filteredContacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-foreground/[0.02] transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <div
                            className={`w-9 h-9 rounded-full bg-primary/10 border border-border flex items-center justify-center overflow-hidden shrink-0 shadow-sm ${contact.profile_picture_url ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                            onClick={contact.profile_picture_url ? (e) => { e.stopPropagation(); setLightbox(contact.profile_picture_url!); } : undefined}
                          >
                            {contact.profile_picture_url ? (
                              <img src={contact.profile_picture_url} alt={contact.name} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <span className="text-primary font-bold text-xs">{contact.name.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          {/* Nome clicável abre o painel */}
                          <span
                            className="text-[14px] font-semibold text-foreground tracking-tight cursor-pointer hover:text-primary transition-colors"
                            onClick={() => setSelectedLeadId(contact.id)}
                          >
                            {contact.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-[13px] text-muted-foreground font-medium">
                        {formatPhone(contact.phone)}
                      </td>
                      <td className="px-6 py-5 text-[13px] text-muted-foreground font-medium">{contact.email || '-'}</td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 text-[10px] font-bold uppercase tracking-wider border border-green-500/20">
                            <Phone className="w-3 h-3" />
                            WhatsApp
                          </span>
                          {contact.instanceName && (
                            <span className="text-[10px] text-muted-foreground font-mono ml-2">
                              via {contact.instanceName}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredContacts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-20 text-center">
                        <div className="flex flex-col items-center opacity-30">
                          <User className="w-12 h-12 mb-3 stroke-[1.2]" />
                          <p className="text-sm font-medium">Nenhum contato encontrado</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Painel do Cliente */}
      {selectedLeadId && (
        <ClientPanel
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onLightbox={setLightbox}
        />
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-sm flex items-center justify-center cursor-pointer"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Foto do contato"
            className="max-w-[80vw] max-h-[80vh] rounded-2xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
