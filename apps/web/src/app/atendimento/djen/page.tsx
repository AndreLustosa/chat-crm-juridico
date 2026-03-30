'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, RefreshCw, Archive, ArchiveRestore, CheckCheck, ExternalLink,
  ChevronDown, ChevronRight, Loader2, Plus, Link2, CheckCircle2, Eye,
  Gavel, FileText, AlertTriangle, Calendar,
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

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const TIPO_COLORS: Record<string, { bg: string; text: string }> = {
  'Intimação':        { bg: 'bg-blue-500/10',   text: 'text-blue-400' },
  'Citação':          { bg: 'bg-red-500/10',     text: 'text-red-400' },
  'Sentença':         { bg: 'bg-purple-500/10',  text: 'text-purple-400' },
  'Despacho':         { bg: 'bg-amber-500/10',   text: 'text-amber-400' },
  'Acórdão':          { bg: 'bg-violet-500/10',  text: 'text-violet-400' },
  'Lista de distribuição': { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
};

function getTipoColor(tipo: string | null) {
  if (!tipo) return { bg: 'bg-muted/50', text: 'text-muted-foreground' };
  for (const key of Object.keys(TIPO_COLORS)) {
    if (tipo.toLowerCase().includes(key.toLowerCase())) return TIPO_COLORS[key];
  }
  return { bg: 'bg-slate-500/10', text: 'text-slate-400' };
}

// ─── PublicationCard ──────────────────────────────────────────

function PublicationCard({
  pub,
  onMarkViewed,
  onArchive,
  onUnarchive,
  onCreateProcess,
  onViewProcess,
}: {
  pub: DjenPublication;
  onMarkViewed: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onUnarchive: (id: string) => Promise<void>;
  onCreateProcess: (id: string) => Promise<void>;
  onViewProcess: (caseId: string) => void;
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
        isUnread
          ? 'border-amber-500/30 bg-amber-500/[0.03]'
          : pub.archived
          ? 'border-border/50 bg-card/30 opacity-70'
          : 'border-border bg-card'
      }`}
    >
      {/* Header row */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-accent/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Unread dot */}
        <div className="pt-1 shrink-0">
          {isUnread ? (
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-transparent border border-muted-foreground/30" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Top row: date + tipo + status */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Calendar size={10} />
              {formatDate(pub.data_disponibilizacao)}
            </span>
            {pub.tipo_comunicacao && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tipoColor.bg} ${tipoColor.text}`}>
                {pub.tipo_comunicacao}
              </span>
            )}
            {!pub.legal_case_id && !pub.archived && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 flex items-center gap-0.5">
                <AlertTriangle size={9} /> Não vinculado
              </span>
            )}
            {pub.archived && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                Arquivado
              </span>
            )}
          </div>

          {/* Process number */}
          <p className="text-[13px] font-mono font-semibold text-foreground truncate">
            {pub.numero_processo || '(sem número)'}
          </p>

          {/* Subject */}
          {pub.assunto && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{pub.assunto}</p>
          )}

          {/* Linked case */}
          {pub.legal_case && (
            <p className="text-[11px] text-primary mt-0.5 flex items-center gap-1">
              <Link2 size={9} />
              {pub.legal_case.lead?.name || pub.legal_case.case_number || 'Processo vinculado'}
              {pub.legal_case.legal_area && (
                <span className="text-muted-foreground">· {pub.legal_case.legal_area}</span>
              )}
            </p>
          )}

          {/* Auto task created */}
          {pub.auto_task_id && (
            <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
              <CheckCircle2 size={10} />
              Tarefa criada automaticamente
            </p>
          )}
        </div>

        <ChevronRight
          size={14}
          className={`text-muted-foreground shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-accent/5">
          {pub.conteudo && (
            <div className="mb-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Conteúdo da Publicação
              </p>
              <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto custom-scrollbar">
                {pub.conteudo.slice(0, 1000)}{pub.conteudo.length > 1000 ? '…' : ''}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Ver processo */}
            {pub.legal_case_id && (
              <button
                onClick={() => onViewProcess(pub.legal_case_id!)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary/80 px-2.5 py-1.5 rounded-lg border border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <ExternalLink size={11} /> Ver Processo
              </button>
            )}

            {/* Criar processo (se não vinculado) */}
            {!pub.legal_case_id && !pub.archived && (
              <button
                disabled={loading === 'create'}
                onClick={() => handle('create', () => onCreateProcess(pub.id))}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/5 transition-colors disabled:opacity-50"
              >
                {loading === 'create' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Criar Processo
              </button>
            )}

            {/* Marcar como visto */}
            {isUnread && (
              <button
                disabled={loading === 'viewed'}
                onClick={() => handle('viewed', () => onMarkViewed(pub.id))}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loading === 'viewed' ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
                Marcar como visto
              </button>
            )}

            {/* Arquivar / Desarquivar */}
            {!pub.archived ? (
              <button
                disabled={loading === 'archive'}
                onClick={() => handle('archive', () => onArchive(pub.id))}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                {loading === 'archive' ? <Loader2 size={11} className="animate-spin" /> : <Archive size={11} />}
                Arquivar
              </button>
            ) : (
              <button
                disabled={loading === 'unarchive'}
                onClick={() => handle('unarchive', () => onUnarchive(pub.id))}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 hover:text-amber-300 px-2.5 py-1.5 rounded-lg border border-amber-500/30 hover:bg-amber-500/5 transition-colors disabled:opacity-50"
              >
                {loading === 'unarchive' ? <Loader2 size={11} className="animate-spin" /> : <ArchiveRestore size={11} />}
                Restaurar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────

type Tab = 'unread' | 'all' | 'archived';

export default function DjenPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('unread');
  const [pubs, setPubs] = useState<DjenPublication[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [days, setDays] = useState(30);

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
  };

  const handleUnarchive = async (id: string) => {
    await api.patch(`/djen/${id}/unarchive`);
    setPubs(prev => prev.filter(p => p.id !== id));
  };

  const handleCreateProcess = async (id: string) => {
    const res = await api.post(`/djen/${id}/create-process`);
    await fetchPubs(true);
    if (res.data?.id) {
      router.push(`/atendimento/processos`);
    }
  };

  const handleViewProcess = (caseId: string) => {
    router.push(`/atendimento/processos`);
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'unread', label: 'Não visualizadas', badge: unreadCount },
    { id: 'all',    label: 'Todas' },
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
          {/* Days filter */}
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

          {/* Mark all viewed */}
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

          {/* Sync */}
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

      {/* Content */}
      <main className="flex-1 overflow-y-auto custom-scrollbar">
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
          <div className="px-6 py-5 space-y-3 max-w-3xl">
            <p className="text-[11px] text-muted-foreground mb-1">
              {total} publicação{total !== 1 ? 'ões' : ''} encontrada{total !== 1 ? 's' : ''}
            </p>
            {pubs.map(pub => (
              <PublicationCard
                key={pub.id}
                pub={pub}
                onMarkViewed={handleMarkViewed}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
                onCreateProcess={handleCreateProcess}
                onViewProcess={handleViewProcess}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
