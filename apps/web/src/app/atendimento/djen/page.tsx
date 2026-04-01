'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RouteGuard } from '@/components/RouteGuard';
import {
  Bell, RefreshCw, Archive, ArchiveRestore, CheckCheck, ExternalLink,
  ChevronRight, Loader2, Plus, Link2, CheckCircle2, Eye,
  Gavel, AlertTriangle, Calendar, Sparkles, X, Clock,
  ArrowRight, CheckSquare, AlertCircle, ChevronDown,
  Search, User, UserCheck, Scale,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';

// ─── Types ────────────────────────────────────────────────────

interface DjenPublication {
  id: string;
  comunicacao_id: number;
  data_disponibilizacao: string;
  numero_processo: string;
  classe_processual: string | null;
  assunto: string | null;
  tipo_comunicacao: string | null;
  conteudo: string;
  nome_advogado: string | null;
  legal_case_id: string | null;
  viewed_at: string | null;
  archived: boolean;
  auto_task_id: string | null;
  legal_case?: {
    id: string;
    case_number: string | null;
    legal_area: string | null;
    tracking_stage: string | null;
    lead: { name: string | null };
  } | null;
  created_at: string;
}

interface AiAnalysis {
  resumo: string;
  urgencia: 'URGENTE' | 'NORMAL' | 'BAIXA';
  tipo_acao: string;
  prazo_dias: number;
  estagio_sugerido: string | null;
  tarefa_titulo: string;
  tarefa_descricao: string;
  orientacoes: string;
  model_used?: string;
  // Dados extraídos da publicação
  parte_autora?: string | null;
  parte_rea?: string | null;
  juizo?: string | null;
  area_juridica?: string | null;
  valor_causa?: string | null;
  data_audiencia?: string | null;
}

interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  profile_picture_url?: string | null;
  conversations?: {
    legal_area: string | null;
    assigned_lawyer?: { id: string; name: string | null } | null;
  }[];
}

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const TIPO_COLORS: Record<string, { bg: string; text: string }> = {
  'Intimação':        { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
  'Citação':          { bg: 'bg-red-500/10',      text: 'text-red-400' },
  'Sentença':         { bg: 'bg-purple-500/10',   text: 'text-purple-400' },
  'Despacho':         { bg: 'bg-amber-500/10',    text: 'text-amber-400' },
  'Acórdão':          { bg: 'bg-violet-500/10',   text: 'text-violet-400' },
  'Lista de distribuição': { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
};

function getTipoColor(tipo: string | null) {
  if (!tipo) return { bg: 'bg-muted/50', text: 'text-muted-foreground' };
  for (const key of Object.keys(TIPO_COLORS)) {
    if (tipo.toLowerCase().includes(key.toLowerCase())) return TIPO_COLORS[key];
  }
  return { bg: 'bg-slate-500/10', text: 'text-slate-400' };
}

const URGENCIA_CONFIG = {
  URGENTE: { label: 'URGENTE', bg: 'bg-red-500/10',   text: 'text-red-400',   border: 'border-red-500/30',   icon: AlertCircle },
  NORMAL:  { label: 'NORMAL',  bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', icon: Clock },
  BAIXA:   { label: 'BAIXA',   bg: 'bg-gray-500/10',  text: 'text-gray-400',  border: 'border-gray-500/30',  icon: CheckCircle2 },
};

const STAGE_LABELS: Record<string, string> = {
  DISTRIBUIDO: 'Distribuído', CITACAO: 'Citação/Intimação', CONTESTACAO: 'Contestação',
  REPLICA: 'Réplica', INSTRUCAO: 'Audiência/Instrução', JULGAMENTO: 'Julgamento',
  RECURSO: 'Recurso', TRANSITADO: 'Transitado em Julgado', EXECUCAO: 'Execução', ENCERRADO: 'Encerrado',
};

const TRACKING_STAGES_DJEN = [
  { id: 'DISTRIBUIDO',  label: 'Distribuído',           color: '#6366f1', emoji: '📬' },
  { id: 'CITACAO',      label: 'Citação/Intimação',     color: '#f59e0b', emoji: '📨' },
  { id: 'CONTESTACAO',  label: 'Contestação',           color: '#ef4444', emoji: '⚔️' },
  { id: 'REPLICA',      label: 'Réplica',               color: '#06b6d4', emoji: '↩️' },
  { id: 'INSTRUCAO',    label: 'Audiência/Instrução',   color: '#8b5cf6', emoji: '🎙️' },
  { id: 'JULGAMENTO',   label: 'Julgamento/Sentença',   color: '#8b5cf6', emoji: '⚖️' },
  { id: 'RECURSO',      label: 'Recurso',               color: '#ec4899', emoji: '📤' },
  { id: 'TRANSITADO',   label: 'Trânsito em Julgado',   color: '#10b981', emoji: '✅' },
  { id: 'EXECUCAO',     label: 'Execução',              color: '#f97316', emoji: '⚡' },
  { id: 'ENCERRADO',    label: 'Encerrado',             color: '#6b7280', emoji: '🏁' },
] as const;

// ─── TaskSuggestion (sub-componente usado dentro do modal) ────

function TaskSuggestion({ analysis, pubId }: { analysis: AiAnalysis; pubId: string }) {
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [err, setErr] = useState(false);

  if (skipped) return null;

  const createTask = async () => {
    setCreating(true);
    setErr(false);
    try {
      const today = new Date();
      let due = new Date(today);
      let added = 0;
      while (added < analysis.prazo_dias) {
        due.setDate(due.getDate() + 1);
        const dow = due.getDay();
        if (dow !== 0 && dow !== 6) added++;
      }
      await api.post('/calendar/events', {
        type: 'TAREFA',
        title: `[DJEN] ${analysis.tarefa_titulo}`,
        description: analysis.tarefa_descricao,
        start_at: due.toISOString(),
        end_at: new Date(due.getTime() + 30 * 60_000).toISOString(),
        priority: analysis.urgencia,
      });
      setDone(true);
    } catch { setErr(true); }
    finally { setCreating(false); }
  };

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${
      done ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-border bg-card/60'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <CheckSquare size={9} /> Tarefa sugerida pela IA
          </p>
          <p className="text-[12px] font-semibold text-foreground truncate">{analysis.tarefa_titulo}</p>
          {analysis.tarefa_descricao && (
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{analysis.tarefa_descricao}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
            <Clock size={9} /> Prazo: {analysis.prazo_dias} dias úteis
          </p>
        </div>
      </div>

      {done ? (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 size={11} /> Tarefa criada com sucesso!
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={createTask}
            disabled={creating}
            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/15 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={10} className="animate-spin" /> : <CheckSquare size={10} />}
            {creating ? 'Criando…' : 'Criar esta tarefa'}
          </button>
          <button
            onClick={() => setSkipped(true)}
            className="px-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
            title="Pular tarefa"
          >
            <X size={11} />
          </button>
        </div>
      )}
      {err && <p className="text-[10px] text-red-400">Erro ao criar tarefa. Tente novamente.</p>}
    </div>
  );
}

// ─── Helper: normaliza área jurídica livre → enum ─────────────
function normalizeArea(raw: string): string {
  const s = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/trabalhist/.test(s)) return 'TRABALHISTA';
  if (/previd|inss/.test(s)) return 'PREVIDENCIARIO';
  if (/tribut|fiscal/.test(s)) return 'TRIBUTARIO';
  if (/famil|divorcio/.test(s)) return 'FAMILIA';
  if (/crimin/.test(s)) return 'CRIMINAL';
  if (/consumi/.test(s)) return 'CONSUMIDOR';
  if (/empresar/.test(s)) return 'EMPRESARIAL';
  if (/administrat/.test(s)) return 'ADMINISTRATIVO';
  if (/civil|civel/.test(s)) return 'CIVIL';
  // se já vier no formato enum, retorna como está (maiúsculo)
  const upper = raw.trim().toUpperCase();
  const known = ['CIVIL','TRABALHISTA','PREVIDENCIARIO','TRIBUTARIO','FAMILIA','CRIMINAL','CONSUMIDOR','EMPRESARIAL','ADMINISTRATIVO'];
  return known.includes(upper) ? upper : '';
}

// ─── Modal: Criar Processo ────────────────────────────────────

function CreateProcessModal({
  pub,
  preloadedAnalysis,
  onClose,
  onSuccess,
}: {
  pub: DjenPublication;
  preloadedAnalysis?: AiAnalysis | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const { isAdmin } = useRole();

  // Modo do cliente: buscar existente ou cadastrar novo
  const [clientMode, setClientMode] = useState<'search' | 'new'>('search');

  // Busca de cliente existente
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<Lead[]>([]);
  const [searchingLead, setSearchingLead] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);
  const leadDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadInputRef = useRef<HTMLInputElement>(null);

  // Dados de novo cliente
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // AI analysis
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(preloadedAnalysis || null);
  const [analyzingAi, setAnalyzingAi] = useState(!preloadedAnalysis);
  const [aiError, setAiError] = useState(false);

  // Kanban stage
  const [selectedStage, setSelectedStage] = useState<string>(
    preloadedAnalysis?.estagio_sugerido || 'DISTRIBUIDO'
  );

  // Área jurídica extraída pela IA
  const [legalArea, setLegalArea] = useState<string>(
    preloadedAnalysis?.area_juridica ? normalizeArea(preloadedAnalysis.area_juridica) : ''
  );

  // Advogado (ADMIN only)
  const [lawyers, setLawyers] = useState<{ id: string; name: string | null }[]>([]);
  const [selectedLawyerId, setSelectedLawyerId] = useState('');

  // Submitting
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Validação: cliente é obrigatório
  const hasValidClient =
    clientMode === 'search'
      ? selectedLead !== null
      : newName.trim().length > 0 && newPhone.trim().length > 0;

  // Carrega lista de advogados (ADMIN only)
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/users/lawyers').then(res => setLawyers(res.data || [])).catch(() => {});
  }, [isAdmin]);

  // Auto-analyze se não tiver preloadedAnalysis
  useEffect(() => {
    if (preloadedAnalysis) return;
    let cancelled = false;
    setAnalyzingAi(true);
    api.post(`/djen/${pub.id}/analyze`)
      .then(res => {
        if (cancelled) return;
        const data: AiAnalysis = res.data;
        setAnalysis(data);
        if (data.estagio_sugerido) setSelectedStage(data.estagio_sugerido);
        if (data.area_juridica) setLegalArea(normalizeArea(data.area_juridica));
      })
      .catch(() => { if (!cancelled) setAiError(true); })
      .finally(() => { if (!cancelled) setAnalyzingAi(false); });
    return () => { cancelled = true; };
  }, [pub.id, preloadedAnalysis]);

  // Debounce lead search
  useEffect(() => {
    if (clientMode !== 'search') return;
    if (leadDebounce.current) clearTimeout(leadDebounce.current);
    if (!leadSearch.trim()) { setLeadResults([]); setShowLeadDropdown(false); return; }
    leadDebounce.current = setTimeout(async () => {
      setSearchingLead(true);
      try {
        const res = await api.get('/leads', { params: { search: leadSearch.trim(), limit: 6 } });
        const items: Lead[] = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.data || []);
        setLeadResults(items);
        setShowLeadDropdown(items.length > 0);
      } catch { setLeadResults([]); }
      finally { setSearchingLead(false); }
    }, 300);
  }, [leadSearch, clientMode]);

  const selectLead = (lead: Lead) => {
    setSelectedLead(lead);
    setLeadSearch(lead.name);
    setShowLeadDropdown(false);
    setLeadResults([]);

    // Aproveita dados da última conversa do lead ──────────────
    const conv = lead.conversations?.[0];
    // Área jurídica: só preenche se ainda não identificada pela IA da publicação
    if (conv?.legal_area && !legalArea) {
      setLegalArea(normalizeArea(conv.legal_area));
    }
    // Advogado: pré-seleciona o advogado atribuído na conversa (ADMIN pode mudar)
    if (isAdmin && conv?.assigned_lawyer?.id && !selectedLawyerId) {
      setSelectedLawyerId(conv.assigned_lawyer.id);
    }
  };

  const clearLead = () => {
    setSelectedLead(null);
    setLeadSearch('');
    setLeadResults([]);
    setShowLeadDropdown(false);
    // Reseta para valores da IA (ou vazio se IA também não identificou)
    setLegalArea(analysis?.area_juridica ? normalizeArea(analysis.area_juridica) : '');
    setSelectedLawyerId('');
    setTimeout(() => leadInputRef.current?.focus(), 50);
  };

  const switchMode = (mode: 'search' | 'new') => {
    setClientMode(mode);
    setSelectedLead(null);
    setLeadSearch('');
    setLeadResults([]);
    setShowLeadDropdown(false);
    setNewName('');
    setNewPhone('');
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (!hasValidClient) {
      setSubmitError('Informe o cliente para continuar.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await api.post(`/djen/${pub.id}/create-process`, {
        leadId: clientMode === 'search' ? selectedLead?.id : undefined,
        leadName: clientMode === 'new' ? newName.trim() : undefined,
        leadPhone: clientMode === 'new' ? newPhone.trim() : undefined,
        trackingStage: selectedStage,
        legalArea: legalArea.trim() || undefined,
        lawyerId: isAdmin && selectedLawyerId ? selectedLawyerId : undefined,
      });
      onSuccess();
      const caseId = res?.data?.id;
      router.push(caseId ? `/atendimento/processos?openCase=${caseId}` : '/atendimento/processos');
    } catch (e: any) {
      setSubmitError(e?.response?.data?.message || 'Erro ao criar processo. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const urgConf = analysis ? URGENCIA_CONFIG[analysis.urgencia] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Gavel size={15} className="text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground">Criar Processo</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">{pub.numero_processo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">

          {/* Publicação info */}
          <div className="rounded-xl bg-accent/30 border border-border p-3 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Calendar size={9} /> {formatDate(pub.data_disponibilizacao)}
              </span>
              {pub.tipo_comunicacao && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${getTipoColor(pub.tipo_comunicacao).bg} ${getTipoColor(pub.tipo_comunicacao).text}`}>
                  {pub.tipo_comunicacao}
                </span>
              )}
            </div>
            {pub.assunto && (
              <p className="text-[11px] text-foreground/80 line-clamp-2">{pub.assunto}</p>
            )}
          </div>

          {/* ── Cliente (obrigatório) ─────────────────────────────── */}
          <div>
            {/* Label + toggle de modo */}
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <User size={11} />
                Cliente
                <span className="text-red-400">*</span>
              </label>
              <div className="flex rounded-lg border border-border overflow-hidden text-[10px] font-semibold">
                <button
                  onClick={() => switchMode('search')}
                  className={`px-2.5 py-1 transition-colors ${clientMode === 'search' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  <Search size={10} className="inline mr-1" />
                  Buscar existente
                </button>
                <button
                  onClick={() => switchMode('new')}
                  className={`px-2.5 py-1 transition-colors border-l border-border ${clientMode === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  <Plus size={10} className="inline mr-1" />
                  Novo cliente
                </button>
              </div>
            </div>

            {/* Modo: busca de existente */}
            {clientMode === 'search' && (
              <div className="relative">
                {selectedLead ? (
                  /* Cliente selecionado — card destacado */
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-emerald-500/50 bg-emerald-500/5">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 overflow-hidden">
                      {selectedLead.profile_picture_url
                        ? <img src={selectedLead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                        : <UserCheck size={18} className="text-emerald-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-foreground">{selectedLead.name || 'Sem nome'}</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{selectedLead.phone}</p>
                    </div>
                    <button
                      onClick={clearLead}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                      title="Trocar cliente"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  /* Campo de busca */
                  <>
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background">
                      {searchingLead
                        ? <Loader2 size={13} className="text-muted-foreground shrink-0 animate-spin" />
                        : <Search size={13} className="text-muted-foreground shrink-0" />
                      }
                      <input
                        ref={leadInputRef}
                        type="text"
                        value={leadSearch}
                        onChange={e => setLeadSearch(e.target.value)}
                        onFocus={() => leadResults.length > 0 && setShowLeadDropdown(true)}
                        placeholder="Digite o nome ou telefone do cliente…"
                        className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none"
                      />
                    </div>
                    {showLeadDropdown && leadResults.length > 0 && (
                      <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                        {leadResults.map(lead => (
                          <button
                            key={lead.id}
                            onClick={() => selectLead(lead)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left"
                          >
                            <div className="w-7 h-7 rounded-full bg-accent border border-border flex items-center justify-center shrink-0 overflow-hidden">
                              {lead.profile_picture_url
                                ? <img src={lead.profile_picture_url} alt="" className="w-full h-full object-cover" />
                                : <User size={12} className="text-muted-foreground" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-foreground">{lead.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{lead.phone}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {!leadSearch && (
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        Busque pelo nome ou número de telefone do cliente cadastrado.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Modo: cadastrar novo */}
            {clientMode === 'new' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background">
                  <User size={13} className="text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Nome completo do cliente *"
                    className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background">
                  <Search size={13} className="text-muted-foreground shrink-0" />
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    placeholder="Telefone com DDD (ex: 82 99999-9999) *"
                    className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  O cliente será cadastrado e vinculado ao processo automaticamente.
                </p>
              </div>
            )}
          </div>

          {/* ── Advogado Responsável (ADMIN only) ─────────────────── */}
          {isAdmin && lawyers.length > 0 && (
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                👨‍⚖️ Advogado Responsável
              </label>
              {selectedLead?.conversations?.[0]?.assigned_lawyer && (
                <p className="text-[10px] text-emerald-400 mb-2 flex items-center gap-1">
                  <UserCheck size={9} /> Do atendimento: <strong>{selectedLead.conversations[0].assigned_lawyer.name}</strong>
                </p>
              )}
              <select
                value={selectedLawyerId}
                onChange={e => setSelectedLawyerId(e.target.value)}
                className="w-full text-[12px] bg-accent/40 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Atribuir automaticamente (padrão)</option>
                {lawyers.map(l => (
                  <option key={l.id} value={l.id}>{l.name || l.id}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Se não selecionado, o processo será atribuído ao usuário logado.
              </p>
            </div>
          )}

          {/* AI Analysis + Tarefa sugerida */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles size={11} className="text-violet-400" /> Análise IA
            </label>
            {analyzingAi && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-violet-500/5 border border-violet-500/20">
                <div className="w-4 h-4 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin shrink-0" />
                <p className="text-[11px] text-violet-300">Analisando publicação com IA…</p>
              </div>
            )}
            {aiError && !analyzingAi && (
              <div className="px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <p className="text-[11px] text-amber-400">Análise IA indisponível — selecione a etapa manualmente.</p>
              </div>
            )}
            {analysis && !analyzingAi && (
              <div className="space-y-2">
                {/* Urgência + Resumo */}
                {urgConf && (
                  <div className={`px-3 py-3 rounded-xl border ${urgConf.bg} ${urgConf.border} space-y-2`}>
                    <div className="flex items-center gap-2">
                      <urgConf.icon size={13} className={`${urgConf.text} shrink-0`} />
                      <p className={`text-[11px] font-bold ${urgConf.text}`}>{urgConf.label} · {analysis.prazo_dias} dias úteis</p>
                    </div>
                    <p className="text-[11px] text-foreground/80 leading-relaxed">{analysis.resumo}</p>
                    {analysis.tipo_acao && (
                      <p className="text-[10px] text-muted-foreground font-medium border-t border-white/10 pt-2">
                        Ação: <span className="text-foreground/70">{analysis.tipo_acao}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* Dados extraídos da publicação */}
                {(analysis.parte_autora || analysis.parte_rea || analysis.juizo || analysis.area_juridica || analysis.valor_causa || analysis.data_audiencia) && (
                  <div className="rounded-xl border border-border bg-accent/20 px-3 py-2.5 space-y-1.5">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Dados identificados
                    </p>
                    {analysis.parte_autora && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Autor:</span>
                        <span className="text-foreground font-medium">{analysis.parte_autora}</span>
                      </div>
                    )}
                    {analysis.parte_rea && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Réu:</span>
                        <span className="text-foreground font-medium">{analysis.parte_rea}</span>
                      </div>
                    )}
                    {analysis.juizo && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Juízo:</span>
                        <span className="text-foreground font-medium">{analysis.juizo}</span>
                      </div>
                    )}
                    {analysis.area_juridica && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Área:</span>
                        <span className="text-foreground font-medium">{analysis.area_juridica}</span>
                      </div>
                    )}
                    {analysis.valor_causa && (
                      <div className="flex items-start gap-2 text-[11px]">
                        <span className="text-muted-foreground shrink-0 w-20">Valor:</span>
                        <span className="text-foreground font-medium">{analysis.valor_causa}</span>
                      </div>
                    )}
                    {analysis.data_audiencia && (
                      <div className="flex items-start gap-2 text-[11px] mt-1 pt-1.5 border-t border-border/50">
                        <span className="text-amber-400 shrink-0 w-20 font-semibold">📅 Audiência:</span>
                        <span className="text-amber-300 font-semibold">
                          {new Date(analysis.data_audiencia).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {/* Tarefa sugerida */}
                <TaskSuggestion analysis={analysis} pubId={pub.id} />
              </div>
            )}
          </div>

          {/* Kanban stage selector */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ArrowRight size={11} /> Etapa de Entrada no Kanban
            </label>
            {analysis?.estagio_sugerido && (
              <p className="text-[10px] text-violet-400 mb-2 flex items-center gap-1">
                <Sparkles size={9} /> IA sugere: <strong>{STAGE_LABELS[analysis.estagio_sugerido] || analysis.estagio_sugerido}</strong>
              </p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {TRACKING_STAGES_DJEN.map(s => {
                const isSelected = selectedStage === s.id;
                const isSuggested = analysis?.estagio_sugerido === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStage(s.id)}
                    className={`relative flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-center transition-all ${
                      isSelected
                        ? 'border-2 bg-card shadow-sm'
                        : 'border-border bg-accent/20 hover:bg-accent/40'
                    }`}
                    style={isSelected ? { borderColor: s.color, boxShadow: `0 0 0 2px ${s.color}22` } : undefined}
                  >
                    <span className="text-base leading-none">{s.emoji}</span>
                    <span
                      className="text-[9px] font-semibold leading-tight"
                      style={{ color: isSelected ? s.color : undefined }}
                    >
                      {s.label}
                    </span>
                    {isSuggested && (
                      <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-violet-500 flex items-center justify-center">
                        <Sparkles size={7} className="text-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Área Jurídica */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Scale size={11} /> Área Jurídica
            </label>
            {analysis?.area_juridica ? (
              <p className="text-[10px] text-violet-400 mb-2 flex items-center gap-1">
                <Sparkles size={9} /> IA identificou na publicação: <strong>{analysis.area_juridica}</strong>
              </p>
            ) : selectedLead?.conversations?.[0]?.legal_area ? (
              <p className="text-[10px] text-emerald-400 mb-2 flex items-center gap-1">
                <UserCheck size={9} /> Do atendimento do cliente: <strong>{selectedLead.conversations[0].legal_area}</strong>
              </p>
            ) : null}
            <select
              value={legalArea}
              onChange={e => setLegalArea(e.target.value)}
              className="w-full text-[12px] bg-accent/40 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Selecione a área jurídica…</option>
              <option value="CIVIL">Cível</option>
              <option value="TRABALHISTA">Trabalhista</option>
              <option value="PREVIDENCIARIO">Previdenciário</option>
              <option value="TRIBUTARIO">Tributário</option>
              <option value="CRIMINAL">Criminal</option>
              <option value="FAMILIA">Família</option>
              <option value="CONSUMIDOR">Consumidor</option>
              <option value="EMPRESARIAL">Empresarial</option>
              <option value="ADMINISTRATIVO">Administrativo</option>
            </select>
          </div>

          {/* Error message */}
          {submitError && (
            <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-[12px] text-red-400">{submitError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 text-[12px] font-semibold px-4 py-2 rounded-xl border border-border text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !hasValidClient}
            title={!hasValidClient ? 'Informe o cliente para continuar' : undefined}
            className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-500/90 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? <><Loader2 size={13} className="animate-spin" /> Criando…</>
              : <><Plus size={13} /> Criar Processo</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PublicationCard ──────────────────────────────────────────

function PublicationCard({
  pub,
  isSelected,
  onSelect,
  onMarkViewed,
  onArchive,
  onUnarchive,
  onCreateProcess,
}: {
  pub: DjenPublication;
  isSelected: boolean;
  onSelect: (pub: DjenPublication) => void;
  onMarkViewed: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onUnarchive: (id: string) => Promise<void>;
  onCreateProcess: (id: string, analysis?: AiAnalysis | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const tipoColor = getTipoColor(pub.tipo_comunicacao);
  const isUnread = !pub.viewed_at && !pub.archived;

  const handle = async (action: string, fn: () => Promise<void>) => {
    setLoading(action);
    try { await fn(); } finally { setLoading(null); }
  };

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all ${
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
          : isUnread
          ? 'border-amber-500/30 bg-amber-500/[0.03]'
          : pub.archived
          ? 'border-border/50 bg-card/30 opacity-60'
          : 'border-border bg-card hover:border-border/80'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-3.5">
        {/* Unread dot */}
        <div className="pt-1 shrink-0">
          {isUnread
            ? <div className="w-2 h-2 rounded-full bg-amber-500" />
            : <div className="w-2 h-2 rounded-full border border-muted-foreground/30" />
          }
        </div>

        {/* Content */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Calendar size={9} /> {formatDate(pub.data_disponibilizacao)}
            </span>
            {pub.tipo_comunicacao && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tipoColor.bg} ${tipoColor.text}`}>
                {pub.tipo_comunicacao}
              </span>
            )}
            {!pub.legal_case_id && !pub.archived && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 flex items-center gap-0.5">
                <AlertTriangle size={8} /> Não vinculado
              </span>
            )}
            {pub.legal_case_id && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-0.5">
                <Link2 size={8} /> Vinculado
              </span>
            )}
            {pub.auto_task_id && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-0.5">
                <CheckCircle2 size={8} /> Tarefa criada
              </span>
            )}
          </div>
          <p className="text-[12px] font-mono font-semibold text-foreground truncate">
            {pub.numero_processo || '(sem número)'}
          </p>
          {pub.assunto && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{pub.assunto}</p>
          )}
          {pub.legal_case && (
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                <Link2 size={8} />
                {pub.legal_case.lead?.name || '—'}
              </span>
              {pub.legal_case.case_number && (
                <span className="text-[9px] font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded">
                  {pub.legal_case.case_number}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Analisar IA + expand */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onSelect(pub)}
            title="Analisar com IA"
            className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
              isSelected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'text-violet-400 border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10'
            }`}
          >
            <Sparkles size={10} />
            {isSelected ? 'IA' : 'IA'}
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-muted-foreground hover:text-foreground">
            <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-3.5 py-3 bg-accent/5">
          {pub.conteudo && (
            <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto custom-scrollbar mb-3">
              {pub.conteudo.slice(0, 600)}{pub.conteudo.length > 600 ? '…' : ''}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {pub.legal_case_id && (
              <button
                onClick={() => window.open('/atendimento/processos', '_self')}
                className="flex items-center gap-1 text-[10px] font-semibold text-primary px-2 py-1 rounded border border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <ExternalLink size={10} /> Ver Processo
              </button>
            )}
            {!pub.legal_case_id && !pub.archived && (
              <button
                onClick={() => onCreateProcess(pub.id, null)}
                className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 px-2 py-1 rounded border border-emerald-500/30 hover:bg-emerald-500/5 transition-colors"
              >
                <Plus size={10} />
                Criar Processo
              </button>
            )}
            {isUnread && (
              <button
                disabled={loading === 'viewed'}
                onClick={() => handle('viewed', () => onMarkViewed(pub.id))}
                className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground px-2 py-1 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loading === 'viewed' ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />}
                Marcar como visto
              </button>
            )}
            {!pub.archived ? (
              <button
                disabled={loading === 'archive'}
                onClick={() => handle('archive', () => onArchive(pub.id))}
                className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground px-2 py-1 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loading === 'archive' ? <Loader2 size={10} className="animate-spin" /> : <Archive size={10} />}
                Arquivar
              </button>
            ) : (
              <button
                disabled={loading === 'unarchive'}
                onClick={() => handle('unarchive', () => onUnarchive(pub.id))}
                className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 px-2 py-1 rounded border border-amber-500/30 hover:bg-amber-500/5 transition-colors disabled:opacity-50"
              >
                {loading === 'unarchive' ? <Loader2 size={10} className="animate-spin" /> : <ArchiveRestore size={10} />}
                Restaurar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AI Analysis Panel ────────────────────────────────────────

function AiPanel({
  pub,
  onClose,
  onCreateProcess,
  onMoveStage,
}: {
  pub: DjenPublication;
  onClose: () => void;
  onCreateProcess: (id: string, analysis?: AiAnalysis | null) => void;
  onMoveStage: (caseId: string, stage: string) => Promise<void>;
}) {
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskCreated, setTaskCreated] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [stageMoved, setStageMoved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setTaskCreated(false);
    setStageMoved(false);

    api.post(`/djen/${pub.id}/analyze`)
      .then(res => { if (!cancelled) setAnalysis(res.data); })
      .catch(() => { if (!cancelled) setError('Erro ao analisar. Verifique se a OPENAI_API_KEY está configurada.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [pub.id]);

  const handleCreateTask = async () => {
    if (!analysis) return;
    setCreatingTask(true);
    try {
      // Calcular prazo em dias úteis a partir de hoje
      const today = new Date();
      let due = new Date(today);
      let added = 0;
      while (added < analysis.prazo_dias) {
        due.setDate(due.getDate() + 1);
        const dow = due.getDay();
        if (dow !== 0 && dow !== 6) added++;
      }
      await api.post('/calendar/events', {
        type: 'TAREFA',
        title: `[DJEN] ${analysis.tarefa_titulo}`,
        description: analysis.tarefa_descricao,
        start_at: due.toISOString(),
        end_at: new Date(due.getTime() + 30 * 60000).toISOString(),
        legal_case_id: pub.legal_case_id || undefined,
        priority: analysis.urgencia,
      });
      setTaskCreated(true);
    } catch { /* silencioso */ } finally { setCreatingTask(false); }
  };

  const handleMoveStage = async () => {
    if (!analysis?.estagio_sugerido || !pub.legal_case_id) return;
    setMovingStage(true);
    try {
      await onMoveStage(pub.legal_case_id, analysis.estagio_sugerido);
      setStageMoved(true);
    } catch { /* silencioso */ } finally { setMovingStage(false); }
  };

  const urgConf = analysis ? URGENCIA_CONFIG[analysis.urgencia] : null;

  return (
    <div className="w-1/2 shrink-0 border-l border-border flex flex-col bg-card/60 overflow-hidden">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <Sparkles size={13} className="text-violet-400" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-foreground">Análise IA</p>
            <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
              {pub.numero_processo}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Content: scrollable grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <div className="w-8 h-8 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
            <p className="text-[12px]">Analisando publicação…</p>
          </div>
        )}

        {error && (
          <div className="p-4">
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-[12px] text-red-400">{error}</p>
            </div>
          </div>
        )}

        {analysis && !loading && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Col 1: Resumo + Urgência + Ação */}
            <div className="space-y-3">
              {analysis.model_used && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Sparkles size={9} className="text-violet-400" />
                  <span>Analisado por <strong className="text-foreground">{analysis.model_used}</strong></span>
                </div>
              )}
              {urgConf && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${urgConf.bg} ${urgConf.border}`}>
                  <urgConf.icon size={14} className={urgConf.text} />
                  <span className={`text-[11px] font-bold ${urgConf.text}`}>{urgConf.label}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{analysis.prazo_dias} dias úteis</span>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Resumo</p>
                <p className="text-[12px] text-foreground leading-relaxed">{analysis.resumo}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Ação Necessária</p>
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-accent/40 border border-border">
                  <ArrowRight size={13} className="text-primary mt-0.5 shrink-0" />
                  <p className="text-[12px] text-foreground font-medium">{analysis.tipo_acao}</p>
                </div>
              </div>
            </div>

            {/* Col 2: Tarefa sugerida */}
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Tarefa Sugerida</p>
                <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <p className="text-[12px] font-semibold text-foreground">{analysis.tarefa_titulo}</p>
                  {analysis.tarefa_descricao && (
                    <p className="text-[11px] text-muted-foreground">{analysis.tarefa_descricao}</p>
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock size={10} />
                    Prazo: {analysis.prazo_dias} dias úteis
                  </div>
                  <button
                    onClick={handleCreateTask}
                    disabled={creatingTask || taskCreated}
                    className={`w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg transition-colors ${
                      taskCreated
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
                    }`}
                  >
                    {creatingTask ? (
                      <><Loader2 size={11} className="animate-spin" /> Criando…</>
                    ) : taskCreated ? (
                      <><CheckCircle2 size={11} /> Tarefa criada!</>
                    ) : (
                      <><CheckSquare size={11} /> Criar esta tarefa</>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Col 3: Processo + Orientações */}
            <div className="space-y-3">
              {analysis.estagio_sugerido && pub.legal_case_id && (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Mover Processo</p>
                  <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground">Mover para o estágio:</p>
                    <p className="text-[13px] font-bold text-foreground">
                      {STAGE_LABELS[analysis.estagio_sugerido] || analysis.estagio_sugerido}
                    </p>
                    {pub.legal_case && (
                      <p className="text-[10px] text-muted-foreground">
                        Processo: {pub.legal_case.lead?.name || pub.legal_case.case_number}
                      </p>
                    )}
                    <button
                      onClick={handleMoveStage}
                      disabled={movingStage || stageMoved}
                      className={`w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg transition-colors ${
                        stageMoved
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-card border border-primary/40 text-primary hover:bg-primary/5 disabled:opacity-50'
                      }`}
                    >
                      {movingStage ? (
                        <><Loader2 size={11} className="animate-spin" /> Movendo…</>
                      ) : stageMoved ? (
                        <><CheckCircle2 size={11} /> Processo movido!</>
                      ) : (
                        <><ArrowRight size={11} /> Mover para {STAGE_LABELS[analysis.estagio_sugerido]}</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {analysis.estagio_sugerido && !pub.legal_case_id && (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Cadastrar Processo</p>
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      Publicação não vinculada. Sugerido cadastrar no estágio:
                    </p>
                    <p className="text-[12px] font-bold text-amber-400">
                      {STAGE_LABELS[analysis.estagio_sugerido] || analysis.estagio_sugerido}
                    </p>
                    <button
                      onClick={() => onCreateProcess(pub.id, analysis)}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                    >
                      <Plus size={11} /> Criar Processo
                    </button>
                  </div>
                </div>
              )}

              {analysis.orientacoes && (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Orientações</p>
                  <div className="rounded-xl border border-border bg-accent/20 p-3">
                    <p className="text-[11px] text-foreground/80 leading-relaxed">{analysis.orientacoes}</p>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────

type Tab = 'unread' | 'viewed' | 'archived';

function DjenPageContent() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('unread');
  const [pubs, setPubs] = useState<DjenPublication[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [days, setDays] = useState(30);
  const [selectedPub, setSelectedPub] = useState<DjenPublication | null>(null);

  // Modal de criação de processo
  const [createModalPub, setCreateModalPub] = useState<DjenPublication | null>(null);
  const [createModalAnalysis, setCreateModalAnalysis] = useState<AiAnalysis | null>(null);

  const fetchPubs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string> = { days: String(days), limit: '100' };
      if (tab === 'unread')   { params.viewed = 'false'; params.archived = 'false'; }
      else if (tab === 'viewed')   { params.viewed = 'true';  params.archived = 'false'; }
      else if (tab === 'archived') { params.archived = 'true'; }

      const res = await api.get('/djen/all', { params });
      setPubs(res.data.items || []);
      setTotal(res.data.total || 0);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (e) {
      console.warn('Erro ao buscar publicações DJEN', e);
    } finally {
      setLoading(false);
    }
  }, [tab, days]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    fetchPubs();
  }, [router, fetchPubs]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/djen/sync');
      await fetchPubs(true);
    } catch {} finally { setSyncing(false); }
  };

  const handleMarkAllViewed = async () => {
    setMarkingAll(true);
    try {
      await api.patch('/djen/mark-all-viewed');
      await fetchPubs(true);
    } catch {} finally { setMarkingAll(false); }
  };

  const handleMarkViewed = async (id: string) => {
    await api.patch(`/djen/${id}/viewed`);
    setPubs(prev => prev.map(p => p.id === id ? { ...p, viewed_at: new Date().toISOString() } : p));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const handleArchive = async (id: string) => {
    await api.patch(`/djen/${id}/archive`);
    setPubs(prev => prev.filter(p => p.id !== id));
    setTotal(c => Math.max(0, c - 1));
    if (selectedPub?.id === id) setSelectedPub(null);
  };

  const handleUnarchive = async (id: string) => {
    await api.patch(`/djen/${id}/unarchive`);
    setPubs(prev => prev.filter(p => p.id !== id));
  };

  // Abre o modal de criação, com análise IA opcional já carregada (do AiPanel)
  const handleOpenCreateModal = (id: string, analysis?: AiAnalysis | null) => {
    const pub = pubs.find(p => p.id === id);
    if (!pub) return;
    setCreateModalPub(pub);
    setCreateModalAnalysis(analysis ?? null);
  };

  const handleMoveStage = async (caseId: string, stage: string) => {
    await api.patch(`/legal-cases/${caseId}/tracking-stage`, { trackingStage: stage });
    await fetchPubs(true);
  };

  const handleSelectForAnalysis = (pub: DjenPublication) => {
    if (selectedPub?.id === pub.id) {
      setSelectedPub(null);
    } else {
      setSelectedPub(pub);
      // Auto-mark as viewed when analyzing
      if (!pub.viewed_at) {
        api.patch(`/djen/${pub.id}/viewed`).then(() => {
          setPubs(prev => prev.map(p => p.id === pub.id ? { ...p, viewed_at: new Date().toISOString() } : p));
          setUnreadCount(c => Math.max(0, c - 1));
        }).catch(() => {});
      }
    }
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'unread',   label: 'Não visualizadas', badge: unreadCount },
    { id: 'viewed',   label: 'Visualizadas' },
    { id: 'archived', label: 'Arquivadas' },
  ];

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* Header */}
      <header className="px-6 py-4 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Gavel size={20} className="text-amber-500" />
            DJEN — Publicações
            {unreadCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400 border border-amber-500/20">
                {unreadCount} não lida{unreadCount !== 1 ? 's' : ''}
              </span>
            )}
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Diário da Justiça Eletrônico — publicações do escritório
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-[11px] bg-card border border-border rounded-lg px-2 py-1.5 text-foreground"
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={15}>Últimos 15 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllViewed}
              disabled={markingAll}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
            >
              {markingAll ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
              Marcar tudo como visto
            </button>
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-500 hover:text-amber-400 px-3 py-1.5 border border-amber-500/30 rounded-lg hover:bg-amber-500/5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            Sincronizar
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-6 border-b border-border shrink-0 flex gap-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-[12px] font-semibold border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold leading-[18px] text-center">
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main — list + AI panel (horizontal 50/50 split) */}
      <div className="flex-1 flex overflow-hidden">

        {/* Publications list */}
        <main className={`overflow-y-auto custom-scrollbar transition-all ${selectedPub ? 'w-1/2' : 'flex-1'}`}>
          {loading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-[13px]">
              <Loader2 size={16} className="animate-spin" />
              Carregando publicações…
            </div>
          ) : pubs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 text-muted-foreground">
              <Bell size={32} className="mb-3 opacity-25" />
              <p className="text-[14px] font-semibold">
                {tab === 'unread'   ? 'Nenhuma publicação não lida' :
                 tab === 'viewed'   ? 'Nenhuma publicação visualizada' :
                 tab === 'archived' ? 'Nenhuma publicação arquivada' :
                 'Nenhuma publicação encontrada'}
              </p>
              <p className="text-[12px] mt-1 opacity-70">
                {tab === 'unread' ? 'Tudo em dia!' : tab === 'viewed' ? 'Nenhuma publicação foi visualizada ainda' : 'Tente sincronizar ou ampliar o período'}
              </p>
            </div>
          ) : (
            <div className="px-4 py-4 space-y-2 max-w-2xl">
              <p className="text-[10px] text-muted-foreground mb-2">
                {total} publicação{total !== 1 ? 'ões' : ''}
              </p>
              {pubs.map(pub => (
                <PublicationCard
                  key={pub.id}
                  pub={pub}
                  isSelected={selectedPub?.id === pub.id}
                  onSelect={handleSelectForAnalysis}
                  onMarkViewed={handleMarkViewed}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  onCreateProcess={handleOpenCreateModal}
                />
              ))}
            </div>
          )}
        </main>

        {/* AI Analysis Panel */}
        {selectedPub && (
          <AiPanel
            pub={selectedPub}
            onClose={() => setSelectedPub(null)}
            onCreateProcess={handleOpenCreateModal}
            onMoveStage={handleMoveStage}
          />
        )}
      </div>

      {/* Modal: Criar Processo */}
      {createModalPub && (
        <CreateProcessModal
          pub={createModalPub}
          preloadedAnalysis={createModalAnalysis}
          onClose={() => { setCreateModalPub(null); setCreateModalAnalysis(null); }}
          onSuccess={() => {
            setCreateModalPub(null);
            setCreateModalAnalysis(null);
            fetchPubs(true);
          }}
        />
      )}
    </div>
  );
}

export default function DjenPage() {
  return (
    <RouteGuard allowedRoles={['ADMIN', 'ADVOGADO', 'ESTAGIARIO']}>
      <DjenPageContent />
    </RouteGuard>
  );
}
