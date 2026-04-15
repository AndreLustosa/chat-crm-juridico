'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, CheckCircle2, Circle, Search, X, ChevronDown,
  User, Briefcase, MessageSquare, AlertTriangle, Loader2,
  CheckSquare, Filter, RotateCcw, CalendarDays, Sparkles,
  Zap, TrendingDown, LayoutGrid, List, Printer,
} from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/lib/SocketProvider';
import { showError, showSuccess, showInfo } from '@/lib/toast';
import { TaskDrawer } from './TaskDrawer';
import { KanbanBoard } from './KanbanBoard';
import { useRole } from '@/lib/useRole';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  assigned_user: { id: string; name: string } | null;
  lead: { id: string; name: string | null; phone: string } | null;
  legal_case_id: string | null;
  conversation_id: string | null;
  _count?: { comments: number };
}

interface UserOption { id: string; name: string; }

interface WorkloadUser {
  id: string;
  name: string;
  total: number;
  overdue: number;
  urgent: number;
}

interface NbaResult {
  acao: string | null;
  urgencia: 'alta' | 'media' | 'baixa';
  justificativa: string;
  tipo: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  A_FAZER:     { label: 'A Fazer',       color: 'text-blue-400',  bg: 'bg-blue-400/10'  },
  EM_PROGRESSO:{ label: 'Em Progresso',  color: 'text-amber-400', bg: 'bg-amber-400/10' },
  CONCLUIDA:   { label: 'Concluída',     color: 'text-green-400', bg: 'bg-green-400/10' },
  CANCELADA:   { label: 'Cancelada',     color: 'text-red-400',   bg: 'bg-red-400/10'   },
};

const STATUS_CYCLE: Record<string, string> = {
  A_FAZER: 'EM_PROGRESSO',
  EM_PROGRESSO: 'CONCLUIDA',
  CONCLUIDA: 'A_FAZER',
  CANCELADA: 'A_FAZER',
};

const DUE_CHIPS = [
  { id: '', label: 'Todos os prazos' },
  { id: 'today', label: 'Hoje' },
  { id: 'week', label: 'Esta semana' },
  { id: 'overdue', label: '⚠️ Vencidas' },
];

function formatDue(due: string | null) {
  if (!due) return null;
  const d = new Date(due);
  const now = new Date();
  const diff = Math.floor((d.getTime() - now.getTime()) / 86400000);
  if (diff < -1) return { text: `${Math.abs(diff)}d atraso`, overdue: true };
  if (diff === -1) return { text: 'Ontem', overdue: true };
  if (diff === 0) return { text: 'Hoje', overdue: false };
  if (diff === 1) return { text: 'Amanhã', overdue: false };
  return { text: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), overdue: false };
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function TasksPanel() {
  const { socket } = useSocket();
  const { role, isAdmin, isAdvogado } = useRole();
  const canViewAll = isAdmin || isAdvogado;

  // ── Dados
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // ── Filtros
  // Estagiário/Operador: vê apenas suas tarefas por padrão (backend filtra)
  const [statusFilter, setStatusFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Paginação
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  // ── Modal nova tarefa
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newAssigned, setNewAssigned] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Produtividade (contadores gerais, sem filtro)
  const [stats, setStats] = useState({ total: 0, a_fazer: 0, em_progresso: 0, concluida: 0, vencidas: 0 });

  // ── Sprint 5: Task Drawer
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

  // (Deep link para tasks via sessionStorage foi removido — alertas agora abrem na agenda)

  // ── Sprint 6: Visualização (Lista / Kanban)
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');

  // ── Sprint 4: Workload + NBA
  const [workload, setWorkload] = useState<WorkloadUser[]>([]);
  const [nba, setNba] = useState<NbaResult | null>(null);
  const [nbaLoading, setNbaLoading] = useState(false);
  const [overdueAlerts, setOverdueAlerts] = useState<{ taskId: string; title: string; level: string; hoursOverdue: number }[]>([]);

  // ─── Fetch de tasks ───────────────────────────────────────────────────────

  const fetchTasks = useCallback(async (pg = 1, forceMode?: 'list' | 'kanban') => {
    setLoading(true);
    const mode = forceMode ?? viewMode;
    try {
      const params: Record<string, string> = {
        page: String(mode === 'kanban' ? 1 : pg),
        limit: String(mode === 'kanban' ? '500' : String(LIMIT)),
      };
      if (statusFilter) params.status = statusFilter;
      if (assignedFilter) params.assignedUserId = assignedFilter;
      if (dueFilter) params.dueFilter = dueFilter;
      if (search) params.search = search;

      const res = await api.get('/tasks', { params });
      const { data, total: t } = res.data;
      setTasks(pg === 1 || mode === 'kanban' ? data : prev => [...prev, ...data]);
      setTotal(t);
    } catch {
      showError('Erro ao carregar tarefas');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, assignedFilter, dueFilter, search, viewMode]);

  // Fetch de contadores (sem filtros)
  const fetchStats = useCallback(async () => {
    try {
      const [all, overdue] = await Promise.all([
        api.get('/tasks', { params: { limit: '2000' } }),
        api.get('/tasks', { params: { limit: '2000', dueFilter: 'overdue' } }),
      ]);
      const allTasks: Task[] = all.data?.data || [];
      setStats({
        total: all.data?.total ?? allTasks.length,
        a_fazer: allTasks.filter(t => t.status === 'A_FAZER').length,
        em_progresso: allTasks.filter(t => t.status === 'EM_PROGRESSO').length,
        concluida: allTasks.filter(t => t.status === 'CONCLUIDA').length,
        vencidas: overdue.data?.total ?? 0,
      });
    } catch {}
  }, []);

  useEffect(() => {
    api.get('/users?limit=100').then(r => {
      const data = r.data?.data || r.data?.users || r.data || [];
      setUsers(data.filter((u: any) => u.roles?.length > 0 || u.role));
    }).catch(() => {});
    fetchStats();
    // Sprint 4: buscar carga de trabalho
    api.get('/tasks/workload').then(r => setWorkload(r.data || [])).catch(() => {});
  }, [fetchStats]);

  // Sprint 4: Socket.IO — alertas de tarefas vencidas em tempo real (shared socket)
  useEffect(() => {
    if (!socket) return;
    const handler = (data: any) => {
      setOverdueAlerts(prev => {
        if (prev.some(a => a.taskId === data.taskId)) return prev;
        return [data, ...prev].slice(0, 5);
      });
      if (data.level === 'critical') showError(`🚨 Tarefa crítica em atraso: ${data.title}`);
      else if (data.level === 'urgent') showInfo(`⚠️ Tarefa urgente vencida: ${data.title}`);
    };
    socket.on('task_overdue_alert', handler);
    return () => { socket.off('task_overdue_alert', handler); };
  }, [socket]);

  useEffect(() => {
    setPage(1);
    fetchTasks(1);
  }, [fetchTasks]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSearchInput = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(v), 350);
  };

  const handleCycleStatus = async (task: Task) => {
    const newStatus = STATUS_CYCLE[task.status] ?? 'A_FAZER';
    try {
      await api.patch(`/tasks/${task.id}/status`, { status: newStatus });
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      fetchStats();
      showSuccess(`Tarefa movida para "${STATUS_CONFIG[newStatus]?.label}"`);
    } catch {
      showError('Erro ao atualizar status');
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await api.post('/tasks', {
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        due_at: newDue ? new Date(newDue).toISOString() : undefined,
        assigned_user_id: newAssigned || undefined,
      });
      showSuccess('Tarefa criada');
      setNewTitle(''); setNewDesc(''); setNewDue(''); setNewAssigned('');
      setShowNew(false);
      fetchTasks(1);
      fetchStats();
    } catch {
      showError('Erro ao criar tarefa');
    } finally {
      setCreating(false);
    }
  };

  const resetFilters = () => {
    setStatusFilter(''); setDueFilter('');
    setAssignedFilter(''); setSearch(''); setSearchInput('');
  };

  // Sprint 6: Atalhos de teclado globais
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable;
      if (isEditable) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNew(v => !v); }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setViewMode(v => v === 'kanban' ? 'list' : 'kanban'); }
      if (e.key === 'Escape') {
        if (drawerTaskId) setDrawerTaskId(null);
        else if (showNew) setShowNew(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawerTaskId, showNew]);

  // Sprint 6: Impressão / PDF de produtividade
  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = tasks.map(t => {
      const due = t.due_at ? new Date(t.due_at).toLocaleDateString('pt-BR') : '—';
      const resp = t.assigned_user?.name ?? '—';
      const lead = t.lead?.name || t.lead?.phone || '—';
      const status = STATUS_CONFIG[t.status]?.label ?? t.status;
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${t.title}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${status}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${due}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${resp}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${lead}</td>
      </tr>`;
    }).join('');
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Relatório de Tarefas — ${new Date().toLocaleDateString('pt-BR')}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111;}h1{font-size:18px;margin-bottom:4px;}p{color:#666;font-size:13px;margin-bottom:20px;}table{width:100%;border-collapse:collapse;font-size:13px;}th{text-align:left;padding:8px 10px;background:#f5f5f5;border-bottom:2px solid #ddd;}</style>
    </head><body>
      <h1>Relatório de Tarefas</h1>
      <p>Gerado em ${new Date().toLocaleString('pt-BR')} · Total: ${stats.total} · A Fazer: ${stats.a_fazer} · Em Progresso: ${stats.em_progresso} · Concluídas: ${stats.concluida} · Vencidas: ${stats.vencidas}</p>
      <table><thead><tr><th>Título</th><th>Status</th><th>Prazo</th><th>Responsável</th><th>Lead</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    win.document.close();
    win.print();
  };

  // Sprint 4: Sugestão de próxima ação por IA
  const fetchNba = async () => {
    setNbaLoading(true);
    try {
      // Pega as primeiras tarefas vencidas/urgentes para contextualizar a IA
      const overdueTasks = tasks.filter(t =>
        t.due_at && new Date(t.due_at) < new Date() && t.status !== 'CONCLUIDA' && t.status !== 'CANCELADA'
      );
      const topTask = overdueTasks[0] ?? tasks[0];
      const res = await api.post('/tasks/next-action', {
        title: topTask?.title,
        description: topTask?.description,
        leadName: topTask?.lead?.name || topTask?.lead?.phone,
        recentTasks: tasks.slice(0, 5).map(t => `${t.title} [${STATUS_CONFIG[t.status]?.label}]`),
        assignedTo: topTask?.assigned_user?.name,
      });
      setNba(res.data);
    } catch {
      showError('Erro ao consultar IA');
    } finally {
      setNbaLoading(false);
    }
  };

  const hasFilters = statusFilter || dueFilter || assignedFilter || search;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border bg-card/40">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <CheckSquare size={18} className="text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Tarefas</h1>
              <p className="text-xs text-muted-foreground">{total} tarefa{total !== 1 ? 's' : ''} {hasFilters ? 'filtradas' : 'no total'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Vista toggle */}
            <div className="flex items-center bg-accent/60 rounded-xl p-1 gap-0.5">
              <button
                onClick={() => setViewMode('list')}
                title="Vista Lista (L)"
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <List size={15} />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                title="Vista Kanban (K)"
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'kanban' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <LayoutGrid size={15} />
              </button>
            </div>

            {/* Imprimir / PDF */}
            <button
              onClick={handlePrint}
              title="Imprimir / Exportar PDF"
              className="p-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Printer size={15} />
            </button>

            <button
              onClick={() => setShowNew(v => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus size={15} />
              Nova tarefa
            </button>
          </div>
        </div>

        {/* Produtividade cards */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Total',        value: stats.total,       color: 'text-foreground',  click: '' },
            { label: 'A Fazer',      value: stats.a_fazer,     color: 'text-blue-400',    click: 'A_FAZER' },
            { label: 'Em Progresso', value: stats.em_progresso,color: 'text-amber-400',   click: 'EM_PROGRESSO' },
            { label: 'Concluídas',   value: stats.concluida,   color: 'text-green-400',   click: 'CONCLUIDA' },
            { label: '⚠️ Vencidas',  value: stats.vencidas,    color: 'text-red-400',     click: 'overdue' },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => {
                if (s.click === 'overdue') { setDueFilter('overdue'); setStatusFilter(''); }
                else { setStatusFilter(prev => prev === s.click ? '' : s.click); setDueFilter(''); }
              }}
              className={`flex flex-col items-center p-2.5 rounded-xl border transition-all hover:shadow-sm ${
                (statusFilter === s.click && s.click) || (dueFilter === 'overdue' && s.click === 'overdue')
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card/60 hover:bg-accent/50'
              }`}
            >
              <span className={`text-lg font-bold ${s.color}`}>{s.value}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5 text-center leading-tight">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Sprint 4: Alertas de vencimento em tempo real ── */}
      {overdueAlerts.length > 0 && (
        <div className="shrink-0 px-6 py-2 flex items-center gap-2 bg-red-500/5 border-b border-red-500/20">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <span className="text-xs font-semibold text-red-400">
            {overdueAlerts.length} tarefa{overdueAlerts.length > 1 ? 's' : ''} em atraso requer{overdueAlerts.length > 1 ? 'em' : ''} atenção imediata
          </span>
          <div className="flex gap-1.5 flex-wrap flex-1">
            {overdueAlerts.map(a => (
              <span key={a.taskId} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.level === 'critical' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                {a.level === 'critical' ? '🚨' : '⚠️'} {a.title.slice(0, 30)}{a.title.length > 30 ? '…' : ''} (+{a.hoursOverdue}h)
              </span>
            ))}
          </div>
          <button onClick={() => setOverdueAlerts([])} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
        </div>
      )}

      {/* ── Sprint 4: Painel NBA (Next-Best-Action por IA) ── */}
      <div className="shrink-0 px-6 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles size={13} className="text-primary" />
            <span className="font-semibold text-foreground">Próxima Ação IA</span>
          </div>

          {!nba && !nbaLoading && (
            <button
              onClick={fetchNba}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
            >
              <Zap size={11} />
              Analisar tarefas
            </button>
          )}

          {nbaLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Consultando IA...
            </div>
          )}

          {nba && nba.acao && (
            <div className="flex-1 flex items-center gap-3 min-w-0">
              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                nba.urgencia === 'alta' ? 'bg-red-500/15 text-red-400' :
                nba.urgencia === 'media' ? 'bg-amber-500/15 text-amber-400' :
                'bg-green-500/15 text-green-400'
              }`}>
                {nba.urgencia === 'alta' ? '🔴' : nba.urgencia === 'media' ? '🟡' : '🟢'} {nba.urgencia.charAt(0).toUpperCase() + nba.urgencia.slice(1)}
              </span>
              <span className="text-xs font-semibold text-foreground truncate">{nba.acao}</span>
              <span className="text-[10px] text-muted-foreground truncate hidden sm:block">{nba.justificativa}</span>
              <button onClick={() => setNba(null)} className="shrink-0 text-muted-foreground hover:text-foreground ml-auto">
                <X size={12} />
              </button>
            </div>
          )}

          {nba && !nba.acao && (
            <span className="text-xs text-muted-foreground">{nba.justificativa}</span>
          )}
        </div>
      </div>

      {/* ── Formulário nova tarefa ── */}
      {showNew && (
        <div className="shrink-0 px-6 py-4 border-b border-border bg-accent/20">
          <div className="max-w-2xl space-y-2.5">
            <input
              autoFocus
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Título da tarefa *"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <textarea
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              placeholder="Descrição (opcional)"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                type="datetime-local"
                className="px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                value={newDue}
                onChange={e => setNewDue(e.target.value)}
              />
              <div className="flex-1 relative">
                <select
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  value={newAssigned}
                  onChange={e => setNewAssigned(e.target.value)}
                >
                  <option value="">Responsável (opcional)</option>
                  {users.map(u => {
                    const wl = workload.find(w => w.id === u.id);
                    const tag = wl ? ` · ${wl.total} tarefas${wl.overdue > 0 ? ` ⚠️${wl.overdue}` : ''}` : '';
                    return <option key={u.id} value={u.id}>{u.name}{tag}</option>;
                  })}
                </select>
                {newAssigned && workload.length > 0 && (() => {
                  const wl = workload.find(w => w.id === newAssigned);
                  if (!wl) return null;
                  return (
                    <div className="absolute -top-5 right-0 flex items-center gap-2 text-[10px]">
                      <span className="text-muted-foreground flex items-center gap-1"><TrendingDown size={9}/> {wl.total} pendentes</span>
                      {wl.overdue > 0 && <span className="text-red-400 font-bold">⚠️ {wl.overdue} vencidas</span>}
                      {wl.overdue === 0 && wl.total <= 3 && <span className="text-green-400 font-semibold">✓ Disponível</span>}
                    </div>
                  );
                })()}
              </div>
              <button onClick={() => setShowNew(false)} className="px-3 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors">
                <X size={14} />
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || creating}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="shrink-0 px-6 py-3 border-b border-border bg-card/20 flex flex-wrap items-center gap-2">
        {/* Status tabs */}
        <div className="flex gap-1">
          {(['', 'A_FAZER', 'EM_PROGRESSO', 'CONCLUIDA', 'CANCELADA'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setDueFilter(''); }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === s && !dueFilter
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {s === '' ? 'Todas' : STATUS_CONFIG[s]?.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Prazo chips */}
        {DUE_CHIPS.map(chip => (
          <button
            key={chip.id}
            onClick={() => { setDueFilter(prev => prev === chip.id ? '' : chip.id); setStatusFilter(''); }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              dueFilter === chip.id && chip.id !== ''
                ? 'bg-accent text-foreground border border-border'
                : chip.id === '' ? 'hidden' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            {chip.label}
          </button>
        ))}

        <div className="h-4 w-px bg-border" />

        {/* Responsável — Estagiário/Operador vê apenas suas tarefas */}
        {canViewAll ? (
          <div className="relative">
            <select
              value={assignedFilter}
              onChange={e => setAssignedFilter(e.target.value)}
              className="pl-3 pr-7 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
            >
              <option value="">Todos os responsáveis</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        ) : (
          <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold">
            Minhas Tarefas
          </span>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Buscar tarefa..."
            className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-primary/30 w-48"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Limpar filtros */}
        {hasFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RotateCcw size={11} />
            Limpar
          </button>
        )}

        {/* Atalhos de teclado hint */}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/50 select-none">
          <span><kbd className="px-1 py-0.5 rounded bg-accent/60 font-mono text-[9px]">N</kbd> nova</span>
          <span><kbd className="px-1 py-0.5 rounded bg-accent/60 font-mono text-[9px]">K</kbd> kanban</span>
          <span><kbd className="px-1 py-0.5 rounded bg-accent/60 font-mono text-[9px]">Esc</kbd> fechar</span>
        </div>
      </div>

      {/* ── Vista Kanban ── */}
      {viewMode === 'kanban' && (
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={28} className="animate-spin text-primary/40" />
            </div>
          ) : (
            <KanbanBoard
              tasks={tasks}
              onTaskClick={(id) => setDrawerTaskId(id)}
              onStatusChange={(id, status) => {
                setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
                fetchStats();
              }}
            />
          )}
        </div>
      )}

      {/* ── Vista Lista ── */}
      {viewMode === 'list' && <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && page === 1 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-primary/40" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-accent/50 flex items-center justify-center">
              <CheckSquare size={24} className="text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground">
              {hasFilters ? 'Nenhuma tarefa com esses filtros' : 'Nenhuma tarefa ainda'}
            </p>
            {hasFilters && (
              <button onClick={resetFilters} className="text-xs text-primary hover:underline">
                Limpar filtros
              </button>
            )}
            {!hasFilters && (
              <button onClick={() => setShowNew(true)} className="text-xs text-primary hover:underline">
                + Criar primeira tarefa
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {tasks.map(task => {
              const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.A_FAZER;
              const dueInfo = formatDue(task.due_at);
              const isDone = task.status === 'CONCLUIDA' || task.status === 'CANCELADA';

              return (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 px-6 py-3.5 hover:bg-accent/20 transition-colors group cursor-pointer ${isDone ? 'opacity-60' : ''}`}
                  onClick={() => setDrawerTaskId(task.id)}
                >
                  {/* Toggle status */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCycleStatus(task); }}
                    className="mt-0.5 shrink-0 transition-transform hover:scale-110"
                    title={`Status atual: ${cfg.label} — clicar para avançar`}
                  >
                    {isDone
                      ? <CheckCircle2 size={18} className="text-green-400" />
                      : <Circle size={18} className="text-muted-foreground/40 hover:text-primary transition-colors" />
                    }
                  </button>

                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {task.title}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>

                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>
                    )}

                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {dueInfo && (
                        <span className={`flex items-center gap-1 text-[11px] font-semibold ${dueInfo.overdue ? 'text-red-400' : 'text-muted-foreground'}`}>
                          {dueInfo.overdue && <AlertTriangle size={10} />}
                          <CalendarDays size={10} />
                          {dueInfo.text}
                        </span>
                      )}
                      {task.assigned_user && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <User size={10} />
                          {task.assigned_user.name}
                        </span>
                      )}
                      {task.lead && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Briefcase size={10} />
                          {task.lead.name || task.lead.phone}
                        </span>
                      )}
                      {(task._count?.comments ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MessageSquare size={10} />
                          {task._count!.comments}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ações rápidas (hover) */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0 mt-0.5">
                    {Object.entries(STATUS_CONFIG)
                      .filter(([k]) => k !== task.status)
                      .map(([k, v]) => (
                        <button
                          key={k}
                          onClick={() => api.patch(`/tasks/${task.id}/status`, { status: k }).then(() => {
                            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: k } : t));
                            fetchStats();
                          })}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full border border-border hover:bg-accent transition-colors ${v.color}`}
                          title={`Mover para ${v.label}`}
                        >
                          {v.label}
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}

            {/* Carregar mais */}
            {tasks.length < total && (
              <div className="px-6 py-4 text-center">
                <button
                  onClick={() => { const next = page + 1; setPage(next); fetchTasks(next); }}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <Filter size={13} />}
                  Carregar mais ({total - tasks.length} restantes)
                </button>
              </div>
            )}
          </div>
        )}
      </div>}

      {/* Sprint 5: Task Detail Drawer */}
      {drawerTaskId && (
        <TaskDrawer
          taskId={drawerTaskId}
          onClose={() => setDrawerTaskId(null)}
          onStatusChange={(id, status) => {
            setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
            fetchStats();
          }}
        />
      )}
    </div>
  );
}
