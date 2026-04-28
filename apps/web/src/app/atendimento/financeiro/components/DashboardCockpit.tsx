'use client';

/**
 * Cockpit Financeiro — dashboard novo (Fase 2 do redesign).
 *
 * 4 layers hierárquicos:
 *  1. UrgentBanner — só aparece se há ações pendentes
 *  2. KpiGrid — KPIs com sparkline + comparação MoM
 *  3. Analyses — receita por advogado + aging buckets
 *  4. OperationalTable — cobranças paginadas com inline-CPF
 *
 * Fetches paralelos: urgent + kpis + by-lawyer + aging na primeira render
 * (<1s first fold), charges fetcha sob demanda quando aba scroll/interaction.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  DollarSign,
  TrendingDown,
  TrendingUp,
  ArrowUp,
  ArrowDown,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  CreditCard,
  Calendar,
  UserPlus,
  Target,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */

interface UrgentActions {
  overdue7d: { count: number; total: number };
  overdueToday: { count: number; total: number };
  awaitingAlvara: { count: number; total: number };
  withoutCpf: { count: number };
  totalActionable: number;
}

interface Kpis {
  period: { from: string; to: string; comparedTo: { from: string; to: string; kind: string } };
  revenue: { value: number; previous: number; deltaPct: number | null };
  expenses: { value: number; previous: number; deltaPct: number | null };
  balance: { value: number; previous: number };
  receivable: { value: number; previous: number; deltaPct: number | null };
  overdue: { value: number };
  sparkline: Array<{ date: string; value: number }>;
  monthlyGoal: { year: number; month: number; target: number; realized: number; progressPct: number } | null;
}

interface RevenueByLawyer {
  lawyerId: string;
  lawyerName: string;
  revenue: number;
}

interface AgingBucket {
  key: string;
  label: string;
  total: number;
  count: number;
}

interface ChargeRow {
  id: string;
  kind: 'case';
  amount: number;
  dueDate: string | null;
  status: string;
  paidAt: string | null;
  leadId: string | null;
  leadName: string | null;
  leadCpf: string | null;
  leadPhone: string | null;
  legalCaseId: string | null;
  caseNumber: string | null;
  legalArea: string | null;
  lawyerId: string | null;
  lawyerName: string | null;
  gatewayCharge: {
    id: string;
    external_id: string;
    status: string;
    billing_type: string;
    invoice_url: string | null;
    boleto_url: string | null;
    pix_qr_code: string | null;
    pix_copy_paste: string | null;
  } | null;
}

interface ChargesPage {
  items: ChargeRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v || 0);

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
};

const fmtPct = (v: number | null) => {
  if (v === null || isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
};

const cleanCpf = (raw: string) => raw.replace(/\D/g, '');
const isValidCpfCnpj = (s: string) => {
  const c = cleanCpf(s);
  return c.length === 11 || c.length === 14;
};

/* ──────────────────────────────────────────────────────────────
   Sparkline (SVG simples, sem dependência externa)
────────────────────────────────────────────────────────────── */

function Sparkline({ data, color = '#10b981' }: { data: Array<{ date: string; value: number }>; color?: string }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const width = 100;
  const height = 32;
  const stepX = width / Math.max(data.length - 1, 1);
  const points = data
    .map((d, i) => {
      const x = i * stepX;
      const y = height - ((d.value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────
   Layer 1: UrgentBanner
────────────────────────────────────────────────────────────── */

function UrgentBanner({
  data,
  onJumpTo,
}: {
  data: UrgentActions | null;
  onJumpTo: (filter: 'overdue' | 'awaiting_alvara' | 'no_cpf') => void;
}) {
  if (!data || data.totalActionable === 0) return null;

  const items: Array<{
    key: 'overdue' | 'awaiting_alvara' | 'no_cpf';
    icon: any;
    label: string;
    count: number;
    total?: number;
    color: string;
  }> = [];
  if (data.overdue7d.count > 0)
    items.push({ key: 'overdue', icon: AlertTriangle, label: 'atrasados 7+ dias', count: data.overdue7d.count, total: data.overdue7d.total, color: 'text-red-400' });
  if (data.overdueToday.count > 0)
    items.push({ key: 'overdue', icon: Clock, label: 'vencendo hoje', count: data.overdueToday.count, total: data.overdueToday.total, color: 'text-amber-400' });
  if (data.awaitingAlvara.count > 0)
    items.push({ key: 'awaiting_alvara', icon: Calendar, label: 'aguardando alvará', count: data.awaitingAlvara.count, total: data.awaitingAlvara.total, color: 'text-blue-400' });
  if (data.withoutCpf.count > 0)
    items.push({ key: 'no_cpf', icon: UserPlus, label: 'sem CPF cadastrado', count: data.withoutCpf.count, color: 'text-purple-400' });

  return (
    <div className="bg-gradient-to-r from-red-500/10 via-amber-500/5 to-blue-500/5 border border-red-500/20 rounded-xl p-3 md:p-4 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-red-400" />
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Ações urgentes</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {items.map((it, idx) => {
          const Icon = it.icon;
          return (
            <button
              key={`${it.key}-${idx}`}
              onClick={() => onJumpTo(it.key)}
              className="flex items-center gap-2 px-3 py-2 bg-card hover:bg-accent/30 border border-border rounded-lg transition-colors text-left"
            >
              <Icon size={14} className={`${it.color} shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-foreground">
                  {it.count} {it.label}
                </div>
                {it.total !== undefined && (
                  <div className="text-[10px] text-muted-foreground">{fmt(it.total)}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Layer 2: KpiGrid (com sparkline + MoM)
────────────────────────────────────────────────────────────── */

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  color,
  bgColor,
  sparkline,
  hint,
}: {
  icon: any;
  label: string;
  value: string;
  delta?: number | null;
  color: string;
  bgColor: string;
  sparkline?: Array<{ date: string; value: number }>;
  hint?: string;
}) {
  const deltaPositive = delta !== null && delta !== undefined && delta > 0;
  const deltaNegative = delta !== null && delta !== undefined && delta < 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-foreground/20 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center`}>
          <Icon size={16} className={color} />
        </div>
        {delta !== undefined && delta !== null && (
          <div
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
              deltaPositive ? 'text-emerald-400 bg-emerald-500/10' : deltaNegative ? 'text-red-400 bg-red-500/10' : 'text-muted-foreground bg-muted/20'
            }`}
          >
            {deltaPositive && <ArrowUp size={10} />}
            {deltaNegative && <ArrowDown size={10} />}
            {fmtPct(delta)}
          </div>
        )}
      </div>
      <div className="text-lg md:text-xl font-bold text-foreground mb-0.5">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</div>}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-2 -mx-1">
          <Sparkline data={sparkline} color={color.includes('emerald') ? '#10b981' : color.includes('red') ? '#ef4444' : '#3b82f6'} />
        </div>
      )}
    </div>
  );
}

function KpiGrid({ data, loading }: { data: Kpis | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
            <div className="w-8 h-8 rounded-lg bg-muted mb-2" />
            <div className="h-6 w-24 bg-muted rounded mb-1" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={TrendingUp}
          label="Receita realizada"
          value={fmt(data.revenue.value)}
          delta={data.revenue.deltaPct}
          color="text-emerald-400"
          bgColor="bg-emerald-500/15"
          sparkline={data.sparkline}
          hint="vs período anterior"
        />
        <KpiCard
          icon={TrendingDown}
          label="Despesas"
          value={fmt(data.expenses.value)}
          delta={data.expenses.deltaPct}
          color="text-red-400"
          bgColor="bg-red-500/15"
        />
        <KpiCard
          icon={DollarSign}
          label="Saldo"
          value={fmt(data.balance.value)}
          color={data.balance.value >= 0 ? 'text-emerald-400' : 'text-red-400'}
          bgColor={data.balance.value >= 0 ? 'bg-emerald-500/15' : 'bg-red-500/15'}
        />
        <KpiCard
          icon={Clock}
          label="A receber"
          value={fmt(data.receivable.value)}
          delta={data.receivable.deltaPct}
          color="text-blue-400"
          bgColor="bg-blue-500/15"
          hint="só com data de vencimento"
        />
      </div>

      {data.monthlyGoal && (
        <MonthlyGoalCard goal={data.monthlyGoal} />
      )}
    </div>
  );
}

function MonthlyGoalCard({ goal }: { goal: NonNullable<Kpis['monthlyGoal']> }) {
  const pct = Math.min(100, goal.progressPct);
  const onTrack = pct >= 90;
  const close = pct >= 60 && pct < 90;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-purple-400" />
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Meta do mês</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          {fmt(goal.realized)} / {fmt(goal.target)}
        </div>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${onTrack ? 'bg-emerald-400' : close ? 'bg-amber-400' : 'bg-red-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
        <span>{goal.progressPct.toFixed(1)}% atingido</span>
        <span>
          {onTrack ? '🎯 No alvo' : close ? '⚠️ Atenção' : '🔴 Distante'}
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Layer 3: Analyses (by-lawyer + aging)
────────────────────────────────────────────────────────────── */

function ByLawyerChart({ data, loading }: { data: RevenueByLawyer[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-pulse h-64" />
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-bold text-foreground mb-2">Receita por advogado</h3>
        <div className="text-xs text-muted-foreground">Sem receitas no período</div>
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-foreground mb-3">Receita por advogado</h3>
      <div className="space-y-2">
        {data.slice(0, 8).map((d) => (
          <div key={d.lawyerId} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground truncate">{d.lawyerName}</span>
              <span className="text-emerald-400 font-bold tabular-nums">{fmt(d.revenue)}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400/70 rounded-full" style={{ width: `${(d.revenue / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgingChart({ data, loading, onSelectBucket }: { data: AgingBucket[] | null; loading: boolean; onSelectBucket: (key: string) => void }) {
  if (loading) {
    return <div className="bg-card border border-border rounded-xl p-4 animate-pulse h-64" />;
  }
  if (!data) return null;
  const max = Math.max(...data.map((d) => d.total), 1);

  const colors: Record<string, string> = {
    current: 'bg-blue-400/70',
    overdue1to7: 'bg-amber-400/70',
    overdue8to30: 'bg-orange-400/70',
    overdue31to60: 'bg-red-400/70',
    overdue60plus: 'bg-red-500/80',
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-foreground mb-3">Aging — parcelas em aberto</h3>
      <div className="space-y-2">
        {data.map((b) => (
          <button
            key={b.key}
            onClick={() => onSelectBucket(b.key)}
            className="w-full text-left space-y-1 group"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground group-hover:underline">{b.label}</span>
              <span className="tabular-nums">
                <span className="text-foreground font-bold">{fmt(b.total)}</span>
                <span className="text-muted-foreground ml-1">({b.count})</span>
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${colors[b.key] || 'bg-muted-foreground/40'}`} style={{ width: `${(b.total / max) * 100}%` }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Layer 4: OperationalTable (com inline-CPF)
────────────────────────────────────────────────────────────── */

function OperationalTable({
  filter,
  setFilter,
  searchInit,
  lawyerId,
}: {
  filter: 'overdue' | 'pending' | 'paid' | 'awaiting_alvara' | 'all';
  setFilter: (f: 'overdue' | 'pending' | 'paid' | 'awaiting_alvara' | 'all') => void;
  searchInit?: string;
  lawyerId?: string;
}) {
  const [data, setData] = useState<ChargesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchInit || '');
  const [searchInput, setSearchInput] = useState(searchInit || '');
  const [page, setPage] = useState(1);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/financeiro/dashboard/charges', {
        params: {
          filter,
          search: search || undefined,
          page,
          pageSize: 20,
          lawyerId: lawyerId || undefined,
        },
      });
      setData(r.data);
    } catch {
      showError('Erro ao carregar cobranças');
    } finally {
      setLoading(false);
    }
  }, [filter, search, page, lawyerId]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Debounce do search
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  const filterOptions: Array<{ key: typeof filter; label: string; count?: number }> = [
    { key: 'all', label: 'Todas' },
    { key: 'overdue', label: 'Atrasadas' },
    { key: 'pending', label: 'A vencer' },
    { key: 'awaiting_alvara', label: 'Aguardando alvará' },
    { key: 'paid', label: 'Pagas' },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header com filtros + search */}
      <div className="p-3 border-b border-border space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h3 className="text-sm font-bold text-foreground">Cobranças</h3>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nome do cliente ou CPF..."
              className="pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg w-full sm:w-64 focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                setFilter(opt.key);
                setPage(1);
              }}
              className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                filter === opt.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/30'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 border-b border-border">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Cliente / CPF</th>
              <th className="px-3 py-2 font-medium">Processo</th>
              <th className="px-3 py-2 font-medium">Vencimento</th>
              <th className="px-3 py-2 font-medium text-right">Valor</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <Loader2 size={16} className="inline animate-spin text-muted-foreground" />
                </td>
              </tr>
            )}
            {!loading && data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma cobrança encontrada
                </td>
              </tr>
            )}
            {!loading &&
              data &&
              data.items.map((row) => (
                <ChargeRowCell key={row.id} row={row} onUpdate={fetchPage} />
              ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between p-3 border-t border-border text-xs">
          <span className="text-muted-foreground">
            Página {data.page} de {data.totalPages} ({data.total} itens)
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={data.page <= 1}
              onClick={() => setPage(data.page - 1)}
              className="px-3 py-1 rounded-md bg-muted hover:bg-muted/70 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <button
              disabled={data.page >= data.totalPages}
              onClick={() => setPage(data.page + 1)}
              className="px-3 py-1 rounded-md bg-muted hover:bg-muted/70 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChargeRowCell({ row, onUpdate }: { row: ChargeRow; onUpdate: () => void }) {
  const [showCpfInput, setShowCpfInput] = useState(false);
  const [cpfInput, setCpfInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isOverdue = row.dueDate && new Date(row.dueDate) < new Date() && row.status !== 'PAGO';
  const statusLabel: Record<string, { label: string; color: string }> = {
    PAGO: { label: 'Pago', color: 'text-emerald-400 bg-emerald-500/10' },
    PENDENTE: isOverdue
      ? { label: 'Atrasado', color: 'text-red-400 bg-red-500/10' }
      : { label: 'A vencer', color: 'text-blue-400 bg-blue-500/10' },
    ATRASADO: { label: 'Atrasado', color: 'text-red-400 bg-red-500/10' },
  };
  const st = statusLabel[row.status] || { label: row.status, color: 'text-muted-foreground bg-muted/20' };

  const handleInlineCpf = async () => {
    if (!row.leadId) return;
    if (!isValidCpfCnpj(cpfInput)) {
      showError('CPF/CNPJ inválido');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/financeiro/dashboard/inline-cpf', {
        leadId: row.leadId,
        cpfCnpj: cpfInput,
      });
      showSuccess('CPF cadastrado. Agora você pode gerar a cobrança.');
      setShowCpfInput(false);
      setCpfInput('');
      onUpdate();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar CPF');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <tr className="border-b border-border/50 hover:bg-accent/20 transition-colors">
      <td className="px-3 py-2.5">
        <div className="font-medium text-foreground">{row.leadName || '—'}</div>
        {row.leadCpf ? (
          <div className="text-[10px] text-muted-foreground tabular-nums">{row.leadCpf}</div>
        ) : (
          <button
            onClick={() => setShowCpfInput((v) => !v)}
            className="text-[10px] text-amber-400 hover:underline flex items-center gap-1"
          >
            <UserPlus size={10} /> Cadastrar CPF
          </button>
        )}
        {showCpfInput && (
          <div className="mt-1 flex items-center gap-1">
            <input
              autoFocus
              value={cpfInput}
              onChange={(e) => setCpfInput(e.target.value)}
              placeholder="000.000.000-00"
              className="px-2 py-1 text-[10px] bg-background border border-border rounded w-32 focus:outline-none focus:border-primary"
            />
            <button
              disabled={submitting}
              onClick={handleInlineCpf}
              className="p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
            >
              {submitting ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
            </button>
            <button
              onClick={() => {
                setShowCpfInput(false);
                setCpfInput('');
              }}
              className="p-1 rounded bg-muted hover:bg-muted/70 text-muted-foreground"
            >
              <XCircle size={10} />
            </button>
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="text-foreground/80 truncate max-w-[180px]">
          {row.caseNumber || '—'}
        </div>
        {row.legalArea && <div className="text-[10px] text-muted-foreground">{row.legalArea}</div>}
      </td>
      <td className="px-3 py-2.5 tabular-nums">{fmtDate(row.dueDate)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-bold">{fmt(row.amount)}</td>
      <td className="px-3 py-2.5">
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${st.color}`}>
          {st.label}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          {row.gatewayCharge?.invoice_url && (
            <a
              href={row.gatewayCharge.invoice_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground"
              title="Abrir cobrança no gateway"
            >
              <ExternalLink size={12} />
            </a>
          )}
          {!row.gatewayCharge && row.leadCpf && row.status !== 'PAGO' && (
            <span
              className="p-1.5 rounded bg-muted text-muted-foreground"
              title="Sem cobrança gerada"
            >
              <CreditCard size={12} />
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ──────────────────────────────────────────────────────────────
   Orchestrator
────────────────────────────────────────────────────────────── */

interface DashboardCockpitProps {
  /** Período selecionado externamente (passado via props pra centralizar). */
  from: string;
  to: string;
  /** lawyerId efetivo (ADMIN livre, demais = req.user.id). */
  lawyerId: string;
  /** Compare mode: previous-month (default) ou previous-year. */
  compare?: 'previous-month' | 'previous-year';
}

export default function DashboardCockpit({ from, to, lawyerId, compare = 'previous-month' }: DashboardCockpitProps) {
  const [urgent, setUrgent] = useState<UrgentActions | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [byLawyer, setByLawyer] = useState<RevenueByLawyer[] | null>(null);
  const [aging, setAging] = useState<AgingBucket[] | null>(null);

  const [loadingFirstFold, setLoadingFirstFold] = useState(true);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);

  const [tableFilter, setTableFilter] = useState<'overdue' | 'pending' | 'paid' | 'awaiting_alvara' | 'all'>('all');

  // First fold: urgent + kpis (banner + cards top-of-page)
  useEffect(() => {
    let cancelled = false;
    setLoadingFirstFold(true);
    Promise.all([
      api.get('/financeiro/dashboard/urgent', { params: { lawyerId: lawyerId || undefined } }),
      api.get('/financeiro/dashboard/kpis', { params: { from, to, compare, lawyerId: lawyerId || undefined } }),
    ])
      .then(([uRes, kRes]) => {
        if (cancelled) return;
        setUrgent(uRes.data);
        setKpis(kRes.data);
      })
      .catch(() => {
        if (cancelled) return;
        showError('Erro ao carregar dashboard financeiro');
      })
      .finally(() => {
        if (!cancelled) setLoadingFirstFold(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, compare, lawyerId]);

  // Below the fold: by-lawyer + aging
  useEffect(() => {
    let cancelled = false;
    setLoadingAnalyses(true);
    Promise.all([
      api.get('/financeiro/dashboard/by-lawyer', { params: { from, to } }),
      api.get('/financeiro/dashboard/aging', { params: { lawyerId: lawyerId || undefined } }),
    ])
      .then(([blRes, aRes]) => {
        if (cancelled) return;
        setByLawyer(blRes.data);
        setAging(aRes.data);
      })
      .catch(() => {
        // não bloqueia, apenas log
      })
      .finally(() => {
        if (!cancelled) setLoadingAnalyses(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, lawyerId]);

  const handleJumpTo = useCallback((target: 'overdue' | 'awaiting_alvara' | 'no_cpf') => {
    if (target === 'overdue') setTableFilter('overdue');
    else if (target === 'awaiting_alvara') setTableFilter('awaiting_alvara');
    else setTableFilter('all'); // no_cpf: filtra na busca depois
    // scroll suave pra tabela
    document.getElementById('operational-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleAgingBucket = useCallback((key: string) => {
    if (key === 'current') setTableFilter('pending');
    else setTableFilter('overdue');
    document.getElementById('operational-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="space-y-5">
      {/* Layer 1: Banner urgente */}
      <UrgentBanner data={urgent} onJumpTo={handleJumpTo} />

      {/* Layer 2: KPIs */}
      <KpiGrid data={kpis} loading={loadingFirstFold} />

      {/* Layer 3: Análises (lado a lado em desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ByLawyerChart data={byLawyer} loading={loadingAnalyses} />
        <AgingChart data={aging} loading={loadingAnalyses} onSelectBucket={handleAgingBucket} />
      </div>

      {/* Layer 4: Tabela operacional */}
      <div id="operational-table">
        <OperationalTable
          filter={tableFilter}
          setFilter={setTableFilter}
          lawyerId={lawyerId}
        />
      </div>
    </div>
  );
}
