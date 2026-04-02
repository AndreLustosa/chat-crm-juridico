'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Clock,
  Plus, X, Search, Loader2, Phone, MessageSquare,
  ArrowUpDown, ChevronDown, Trash2, Pencil, Check,
  BarChart3, Receipt, CreditCard, Ban,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */
interface FinancialSummary {
  totalRevenue: number;
  totalExpenses: number;
  totalReceivable: number;
  totalOverdue: number;
  balance: number;
}

interface Transaction {
  id: string;
  type: 'RECEITA' | 'DESPESA';
  category: string;
  description: string;
  amount: string;
  date: string;
  due_date: string | null;
  paid_at: string | null;
  payment_method: string | null;
  status: 'PAGO' | 'PENDENTE' | 'CANCELADO';
  legal_case: { id: string; case_number: string; legal_area: string } | null;
  lead: { id: string; name: string; phone: string } | null;
  lawyer: { id: string; name: string } | null;
}

/* ──────────────────────────────────────────────────────────────
   Constants
────────────────────────────────────────────────────────────── */
const TABS = ['Resumo', 'Receitas', 'Despesas', 'Cobrancas', 'Inadimplencia'] as const;
type Tab = typeof TABS[number];

const PERIODS = [
  { label: 'Hoje', value: 'hoje' },
  { label: 'Semana', value: 'semana' },
  { label: 'Mes', value: 'mes' },
  { label: 'Trimestre', value: 'trimestre' },
  { label: 'Ano', value: 'ano' },
] as const;

const RECEITA_CATEGORIES = ['Honorarios', 'Consultas', 'Acordos Extrajudiciais', 'Outros'];
const DESPESA_CATEGORIES = ['Custas Judiciais', 'Pericias', 'Deslocamento', 'Material de Escritorio', 'Cartorio', 'Correios', 'Outros'];

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const fmt = (v: number | string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    typeof v === 'string' ? parseFloat(v) : v,
  );

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
};

function getPeriodRange(period: string): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  let start: Date;
  let end: Date = new Date(Date.UTC(y, m, d, 23, 59, 59));

  switch (period) {
    case 'hoje':
      start = new Date(Date.UTC(y, m, d));
      break;
    case 'semana': {
      const day = now.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      start = new Date(Date.UTC(y, m, d - diff));
      break;
    }
    case 'trimestre':
      start = new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
      break;
    case 'ano':
      start = new Date(Date.UTC(y, 0, 1));
      break;
    default: // mes
      start = new Date(Date.UTC(y, m, 1));
      break;
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

function daysOverdue(dueDate: string): number {
  const due = new Date(dueDate);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
}

function whatsappLink(phone: string, message: string): string {
  const clean = phone.replace(/\D/g, '');
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

/* ──────────────────────────────────────────────────────────────
   KPI Card
────────────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, color, bgColor }: {
  icon: any; label: string; value: string; color: string; bgColor: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center mb-2`}>
        <Icon size={16} className={color} />
      </div>
      <p className={`text-xl font-bold ${color} tabular-nums`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5 font-semibold uppercase tracking-wide">{label}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Status Badge
────────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    PAGO: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Pago' },
    PENDENTE: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Pendente' },
    CANCELADO: { bg: 'bg-gray-500/15', text: 'text-gray-400', label: 'Cancelado' },
  };
  const s = map[status] || map.PENDENTE;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
   Quick-Add Form
────────────────────────────────────────────────────────────── */
function QuickAddForm({ type, categories, onCreated }: {
  type: 'RECEITA' | 'DESPESA';
  categories: string[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const reset = () => { setDesc(''); setAmount(''); setCategory(categories[0]); setDate(new Date().toISOString().slice(0, 10)); };

  const handleSubmit = async () => {
    if (!desc.trim() || !amount) { showError('Preencha descricao e valor'); return; }
    const numVal = parseFloat(amount.replace(',', '.'));
    if (isNaN(numVal) || numVal <= 0) { showError('Valor invalido'); return; }
    setSaving(true);
    try {
      await api.post('/financeiro/transactions', {
        type,
        category,
        description: desc.trim(),
        amount: numVal,
        date: new Date(date + 'T12:00:00Z').toISOString(),
        due_date: new Date(date + 'T12:00:00Z').toISOString(),
        status: 'PENDENTE',
      });
      showSuccess(`${type === 'RECEITA' ? 'Receita' : 'Despesa'} criada`);
      reset();
      setOpen(false);
      onCreated();
    } catch {
      showError('Erro ao criar transacao');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
      >
        <Plus size={14} /> Nova {type === 'RECEITA' ? 'Receita' : 'Despesa'}
      </button>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">
          Nova {type === 'RECEITA' ? 'Receita' : 'Despesa'}
        </h3>
        <button onClick={() => { setOpen(false); reset(); }} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          placeholder="Descricao"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          placeholder="Valor (R$)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Salvar
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Transaction Table
────────────────────────────────────────────────────────────── */
function TransactionTable({ rows, onRefresh }: { rows: Transaction[]; onRefresh: () => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta transacao?')) return;
    setDeleting(id);
    try {
      await api.delete(`/financeiro/transactions/${id}`);
      showSuccess('Transacao removida');
      onRefresh();
    } catch {
      showError('Erro ao remover');
    } finally {
      setDeleting(null);
    }
  };

  const handleTogglePago = async (t: Transaction) => {
    const newStatus = t.status === 'PAGO' ? 'PENDENTE' : 'PAGO';
    try {
      await api.patch(`/financeiro/transactions/${t.id}`, {
        status: newStatus,
        paid_at: newStatus === 'PAGO' ? new Date().toISOString() : null,
      });
      showSuccess(newStatus === 'PAGO' ? 'Marcado como pago' : 'Revertido para pendente');
      onRefresh();
    } catch {
      showError('Erro ao atualizar status');
    }
  };

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Receipt size={32} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Nenhuma transacao encontrada</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Descricao</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Categoria</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Caso</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Valor</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Status</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border/50 hover:bg-accent/10 transition-colors">
                <td className="px-4 py-3 text-foreground tabular-nums whitespace-nowrap">{fmtDate(t.date)}</td>
                <td className="px-4 py-3 text-foreground max-w-[200px] truncate">{t.description}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{t.category}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {t.legal_case ? t.legal_case.case_number || '-' : '-'}
                </td>
                <td className={`px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap ${t.type === 'RECEITA' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmt(t.amount)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => handleTogglePago(t)}
                      className="p-1.5 rounded-lg hover:bg-accent/30 transition-colors text-muted-foreground hover:text-emerald-400"
                      title={t.status === 'PAGO' ? 'Reverter para pendente' : 'Marcar como pago'}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                      className="p-1.5 rounded-lg hover:bg-accent/30 transition-colors text-muted-foreground hover:text-red-400"
                      title="Excluir"
                    >
                      {deleting === t.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Monthly Chart (CSS only)
────────────────────────────────────────────────────────────── */
function MonthlyChart({ receitas, despesas }: { receitas: Transaction[]; despesas: Transaction[] }) {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const currentMonth = new Date().getUTCMonth();

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const mIdx = (currentMonth - 5 + i + 12) % 12;
    const recTotal = receitas
      .filter((t) => new Date(t.date).getUTCMonth() === mIdx && t.status === 'PAGO')
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const despTotal = despesas
      .filter((t) => new Date(t.date).getUTCMonth() === mIdx)
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    return { label: months[mIdx], receita: recTotal, despesa: despTotal };
  });

  const maxVal = Math.max(...monthlyData.map((d) => Math.max(d.receita, d.despesa)), 1);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
        <BarChart3 size={15} className="text-primary" />
        Receitas vs Despesas (6 meses)
      </h3>
      <div className="flex items-end gap-3 h-36">
        {monthlyData.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end justify-center gap-1 h-28">
              <div
                className="w-3 bg-emerald-500/70 rounded-t-sm transition-all duration-300"
                style={{ height: `${Math.max(2, (d.receita / maxVal) * 100)}%` }}
                title={`Receita: ${fmt(d.receita)}`}
              />
              <div
                className="w-3 bg-red-500/70 rounded-t-sm transition-all duration-300"
                style={{ height: `${Math.max(2, (d.despesa / maxVal) * 100)}%` }}
                title={`Despesa: ${fmt(d.despesa)}`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground font-semibold">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4 mt-3">
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-emerald-500" /> Receitas
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-red-500" /> Despesas
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function FinanceiroPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Resumo');
  const [period, setPeriod] = useState('mes');

  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [receitas, setReceitas] = useState<Transaction[]>([]);
  const [despesas, setDespesas] = useState<Transaction[]>([]);
  const [overdue, setOverdue] = useState<Transaction[]>([]);

  /* ─── Auth guard ─── */
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
  }, [router]);

  /* ─── Fetch data ─── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    const { startDate, endDate } = getPeriodRange(period);
    try {
      const [sumRes, recRes, despRes] = await Promise.all([
        api.get('/financeiro/summary', { params: { startDate, endDate } }),
        api.get('/financeiro/transactions', { params: { type: 'RECEITA', startDate, endDate, limit: 100 } }),
        api.get('/financeiro/transactions', { params: { type: 'DESPESA', startDate, endDate, limit: 100 } }),
      ]);
      setSummary(sumRes.data);

      const recRows = Array.isArray(recRes.data) ? recRes.data : recRes.data.data || [];
      const despRows = Array.isArray(despRes.data) ? despRes.data : despRes.data.data || [];
      setReceitas(recRows);
      setDespesas(despRows);

      // Overdue: receitas pendentes com due_date no passado
      const now = new Date();
      const overdueItems = recRows.filter(
        (t: Transaction) => t.status === 'PENDENTE' && t.due_date && new Date(t.due_date) < now,
      );
      setOverdue(overdueItems);
    } catch {
      showError('Erro ao carregar dados financeiros');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) fetchData();
  }, [fetchData]);

  /* ─── Tab icons ─── */
  const tabIcons: Record<Tab, any> = {
    Resumo: BarChart3,
    Receitas: TrendingUp,
    Despesas: TrendingDown,
    Cobrancas: CreditCard,
    Inadimplencia: AlertTriangle,
  };

  /* ─── Loading skeleton ─── */
  if (loading && !summary) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 md:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="animate-pulse space-y-2">
            <div className="h-8 w-48 bg-muted rounded-lg" />
            <div className="h-4 w-32 bg-muted rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                <div className="w-8 h-8 rounded-lg bg-muted mb-2" />
                <div className="h-6 w-24 bg-muted rounded mb-1" />
                <div className="h-3 w-16 bg-muted rounded" />
              </div>
            ))}
          </div>
          <div className="bg-card border border-border rounded-xl p-4 animate-pulse h-48" />
        </div>
      </div>
    );
  }

  /* ─── Quick stats ─── */
  const totalTransacoes = receitas.length + despesas.length;
  const categoryCounts: Record<string, number> = {};
  [...receitas, ...despesas].forEach((t) => {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  });
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5 pb-28 md:pb-6">

        {/* ─── Header ─── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <DollarSign size={20} className="text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Financeiro</h1>
              <p className="text-xs text-muted-foreground">Gestao de receitas, despesas e inadimplencia</p>
            </div>
          </div>

          {/* Period Selector */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  period === p.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent/30'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Tab Navigation ─── */}
        <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
          {TABS.map((t) => {
            const Icon = tabIcons[t];
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  tab === t
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent/30'
                }`}
              >
                <Icon size={14} />
                {t === 'Inadimplencia' ? 'Inadimplencia' : t === 'Cobrancas' ? 'Cobrancas' : t}
              </button>
            );
          })}
        </div>

        {/* ─── TAB: Resumo ─── */}
        {tab === 'Resumo' && summary && (
          <div className="space-y-5">
            {/* KPI Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard
                icon={DollarSign}
                label="Total Contratado"
                value={fmt(summary.totalRevenue)}
                color="text-blue-400"
                bgColor="bg-blue-500/15"
              />
              <KpiCard
                icon={TrendingUp}
                label="Recebido"
                value={fmt(summary.totalRevenue - summary.totalReceivable)}
                color="text-emerald-400"
                bgColor="bg-emerald-500/15"
              />
              <KpiCard
                icon={Clock}
                label="A Receber"
                value={fmt(summary.totalReceivable)}
                color="text-amber-400"
                bgColor="bg-amber-500/15"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Atrasado"
                value={fmt(summary.totalOverdue)}
                color="text-red-400"
                bgColor="bg-red-500/15"
              />
            </div>

            {/* Chart */}
            <MonthlyChart receitas={receitas} despesas={despesas} />

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-bold text-foreground mb-3">Resumo do Periodo</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total de Transacoes</span>
                    <span className="text-foreground font-bold tabular-nums">{totalTransacoes}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Receitas</span>
                    <span className="text-emerald-400 font-bold tabular-nums">{receitas.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Despesas</span>
                    <span className="text-red-400 font-bold tabular-nums">{despesas.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Em Atraso</span>
                    <span className="text-red-400 font-bold tabular-nums">{overdue.length}</span>
                  </div>
                  <div className="h-px bg-border my-1" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Saldo</span>
                    <span className={`font-bold tabular-nums ${summary.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmt(summary.balance)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-bold text-foreground mb-3">Categorias Mais Comuns</h3>
                {topCategories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem dados no periodo</p>
                ) : (
                  <div className="space-y-2">
                    {topCategories.map(([cat, count], i) => {
                      const pct = Math.max(5, (count / totalTransacoes) * 100);
                      return (
                        <div key={cat} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-foreground font-semibold">{cat}</span>
                            <span className="text-muted-foreground tabular-nums">{count}</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary/60 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB: Receitas ─── */}
        {tab === 'Receitas' && (
          <div className="space-y-4">
            <QuickAddForm type="RECEITA" categories={RECEITA_CATEGORIES} onCreated={fetchData} />
            <TransactionTable rows={receitas} onRefresh={fetchData} />
          </div>
        )}

        {/* ─── TAB: Despesas ─── */}
        {tab === 'Despesas' && (
          <div className="space-y-4">
            <QuickAddForm type="DESPESA" categories={DESPESA_CATEGORIES} onCreated={fetchData} />
            <TransactionTable rows={despesas} onRefresh={fetchData} />
          </div>
        )}

        {/* ─── TAB: Cobrancas (Asaas) ─── */}
        {tab === 'Cobrancas' && <CobrancasAsaasTab />}

        {/* ─── TAB: Inadimplencia ─── */}
        {tab === 'Inadimplencia' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <AlertTriangle size={15} className="text-red-400" />
                Pagamentos em Atraso ({overdue.length})
              </h2>
            </div>

            {overdue.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <Check size={32} className="mx-auto text-emerald-400 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum pagamento em atraso</p>
              </div>
            ) : (
              <div className="space-y-2">
                {overdue.map((t) => {
                  const days = t.due_date ? daysOverdue(t.due_date) : 0;
                  const clientName = t.lead?.name || 'Cliente desconhecido';
                  const clientPhone = t.lead?.phone || '';
                  const caseNumber = t.legal_case?.case_number || '-';
                  const reminderMsg = `Ola ${clientName}, verificamos que existe um pagamento pendente no valor de ${fmt(t.amount)} referente ao processo ${caseNumber}. Por gentileza, entre em contato para regularizacao.`;

                  return (
                    <div key={t.id} className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-foreground truncate">{clientName}</span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            days > 30 ? 'bg-red-500/15 text-red-400' : days > 7 ? 'bg-amber-500/15 text-amber-400' : 'bg-yellow-500/15 text-yellow-400'
                          }`}>
                            {days} dias
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>Processo: {caseNumber}</span>
                          <span className="text-red-400 font-bold">{fmt(t.amount)}</span>
                          {t.due_date && <span>Venc.: {fmtDate(t.due_date)}</span>}
                        </div>
                        {clientPhone && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Phone size={10} /> {clientPhone}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {clientPhone && (
                          <a
                            href={whatsappLink(clientPhone, reminderMsg)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"
                          >
                            <MessageSquare size={13} />
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Componente: Cobranças Asaas
══════════════════════════════════════════════════════════════ */

const CHARGE_STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pendente', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  RECEIVED: { label: 'Recebido', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  CONFIRMED: { label: 'Confirmado', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  OVERDUE: { label: 'Vencido', color: 'text-red-400 bg-red-400/10 border-red-400/20' },
  REFUNDED: { label: 'Devolvido', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  DELETED: { label: 'Excluído', color: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
  CANCELLED: { label: 'Cancelado', color: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
};

const BILLING_TYPE_LABEL: Record<string, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartao',
  UNDEFINED: 'Indefinido',
};

function CobrancasAsaasTab() {
  const [charges, setCharges] = useState<any[]>([]);
  const [asaasCharges, setAsaasCharges] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<'local' | 'asaas'>('asaas');
  const [statusFilter, setStatusFilter] = useState('');

  const fmt = (v: number | string) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      typeof v === 'string' ? parseFloat(v) : v,
    );

  const fmtDate = (d: string) => {
    if (!d) return '--';
    const dt = new Date(d);
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  };

  const fetchLocal = useCallback(async () => {
    try {
      const params: any = { limit: '100' };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/payment-gateway/charges', { params });
      setCharges(res.data || []);
    } catch { setCharges([]); }
  }, [statusFilter]);

  const fetchAsaas = useCallback(async () => {
    try {
      const params: any = { limit: '50' };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/payment-gateway/charges/asaas', { params });
      setAsaasCharges(res.data);
    } catch { setAsaasCharges(null); }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchLocal(), fetchAsaas()]).finally(() => setLoading(false));
  }, [fetchLocal, fetchAsaas]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/payment-gateway/charges/sync');
      await Promise.all([fetchLocal(), fetchAsaas()]);
      showSuccess('Cobrancas sincronizadas!');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao sincronizar');
    } finally {
      setSyncing(false);
    }
  };

  const asaasList = asaasCharges?.data || asaasCharges || [];
  const displayList = view === 'asaas' ? (Array.isArray(asaasList) ? asaasList : []) : charges;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <CreditCard size={15} className="text-primary" />
          Cobrancas Asaas
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none"
          >
            <option value="">Todos os status</option>
            <option value="PENDING">Pendente</option>
            <option value="RECEIVED">Recebido</option>
            <option value="CONFIRMED">Confirmado</option>
            <option value="OVERDUE">Vencido</option>
          </select>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setView('asaas')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'asaas' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/30'}`}>
              Asaas
            </button>
            <button onClick={() => setView('local')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'local' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/30'}`}>
              Local
            </button>
          </div>
          <button onClick={handleSync} disabled={syncing} className="px-3 py-1.5 text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/25 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpDown size={12} />}
            Sincronizar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 size={20} className="animate-spin text-muted-foreground mx-auto" /></div>
      ) : displayList.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhuma cobranca {view === 'asaas' ? 'encontrada no Asaas' : 'registrada localmente'}
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-card border-b border-border text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                <th className="px-3 py-2.5 text-left font-semibold">Tipo</th>
                <th className="px-3 py-2.5 text-left font-semibold">Valor</th>
                <th className="px-3 py-2.5 text-left font-semibold">Vencimento</th>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold">ID</th>
              </tr>
            </thead>
            <tbody>
              {displayList.map((c: any, i: number) => {
                const isAsaas = view === 'asaas';
                const status = c.status;
                const statusInfo = CHARGE_STATUS_MAP[status] || { label: status, color: 'text-gray-400 bg-gray-400/10 border-gray-400/20' };
                const billingType = isAsaas ? c.billingType : c.billing_type;
                const value = isAsaas ? c.value : c.amount;
                const dueDate = isAsaas ? c.dueDate : c.due_date;
                const clientName = isAsaas
                  ? (c.customer || c.externalReference || '--')
                  : ((c as any).honorario_payment?.honorario?.legal_case?.lead?.name || '--');
                const chargeId = isAsaas ? c.id : c.external_id;

                return (
                  <tr key={chargeId || i} className="border-b border-border/50 hover:bg-accent/20 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-foreground truncate max-w-[180px]">{clientName}</td>
                    <td className="px-3 py-2.5">{BILLING_TYPE_LABEL[billingType] || billingType}</td>
                    <td className="px-3 py-2.5 font-semibold text-foreground">{fmt(value || 0)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(dueDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground truncate max-w-[120px]" title={chargeId}>
                      {chargeId?.slice(-8) || '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && displayList.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {displayList.length} cobranca(s) — Total: {fmt(displayList.reduce((s: number, c: any) => s + Number(view === 'asaas' ? c.value : c.amount || 0), 0))}
        </p>
      )}
    </div>
  );
}
