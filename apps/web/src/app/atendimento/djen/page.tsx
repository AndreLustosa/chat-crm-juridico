'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RouteGuard } from '@/components/RouteGuard';
import {
  Bell, RefreshCw, Archive, ArchiveRestore, CheckCheck, ExternalLink,
  ChevronRight, Loader2, Plus, Link2, CheckCircle2, Eye,
  Gavel, AlertTriangle, Calendar, Sparkles, X, Clock,
  ArrowRight, CheckSquare, AlertCircle, ChevronDown,
} from 'lucide-react';
import api from '@/lib/api';

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
  INSTRUCAO: 'Instrução', JULGAMENTO: 'Julgamento', RECURSO: 'Recurso',
  TRANSITADO: 'Transitado em Julgado', EXECUCAO: 'Execução', ENCERRADO: 'Encerrado',
};

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
  onCreateProcess: (id: string) => Promise<void>;
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
            <p className="text-[10px] text-primary truncate mt-0.5 flex items-center gap-1">
              <Link2 size={8} />
              {pub.legal_case.lead?.name || pub.legal_case.case_number}
            </p>
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
                disabled={loading === 'create'}
                onClick={() => handle('create', () => onCreateProcess(pub.id))}
                className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 px-2 py-1 rounded border border-emerald-500/30 hover:bg-emerald-500/5 transition-colors disabled:opacity-50"
              >
                {loading === 'create' ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
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
  onCreateProcess: (id: string) => Promise<void>;
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
                      onClick={() => onCreateProcess(pub.id)}
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

type Tab = 'unread' | 'all' | 'archived';

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

  const fetchPubs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string> = { days: String(days), limit: '100' };
      if (tab === 'unread') { params.viewed = 'false'; params.archived = 'false'; }
      else if (tab === 'archived') { params.archived = 'true'; }
      else { params.archived = 'false'; }

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

  const handleCreateProcess = async (id: string) => {
    await api.post(`/djen/${id}/create-process`);
    await fetchPubs(true);
    router.push('/atendimento/processos');
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
    { id: 'all',      label: 'Todas' },
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
                {tab === 'unread' ? 'Nenhuma publicação não lida' :
                 tab === 'archived' ? 'Nenhuma publicação arquivada' :
                 'Nenhuma publicação encontrada'}
              </p>
              <p className="text-[12px] mt-1 opacity-70">
                {tab === 'unread' ? 'Tudo em dia!' : 'Tente sincronizar ou ampliar o período'}
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
                  onCreateProcess={handleCreateProcess}
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
            onCreateProcess={handleCreateProcess}
            onMoveStage={handleMoveStage}
          />
        )}
      </div>
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
