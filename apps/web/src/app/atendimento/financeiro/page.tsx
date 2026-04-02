'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Clock,
  Plus, X, Search, Loader2, Phone, MessageSquare,
  ArrowUpDown, ChevronDown, Trash2, Pencil, Check,
  BarChart3, Receipt, CreditCard, Ban, Users, Link2, Unlink,
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
const TABS = ['Resumo', 'Receitas', 'Despesas', 'Cobrancas', 'Clientes', 'Inadimplencia'] as const;
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
    Clientes: Users,
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

        {/* ─── TAB: Clientes (CRM ↔ Asaas) ─── */}
        {tab === 'Clientes' && <ClientesSyncTab />}

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
   Componente: Cobranças — Layout estilo Asaas
══════════════════════════════════════════════════════════════ */

const CHARGE_STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  PENDING: { label: 'Aguardando pagamento', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20', dot: 'bg-amber-400' },
  RECEIVED: { label: 'Recebida', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', dot: 'bg-emerald-400' },
  CONFIRMED: { label: 'Confirmada', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', dot: 'bg-emerald-400' },
  RECEIVED_IN_CASH: { label: 'Recebida em dinheiro', color: 'text-teal-400 bg-teal-400/10 border-teal-400/20', dot: 'bg-teal-400' },
  OVERDUE: { label: 'Vencida', color: 'text-red-400 bg-red-400/10 border-red-400/20', dot: 'bg-red-400' },
  REFUNDED: { label: 'Estornada', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20', dot: 'bg-purple-400' },
  DELETED: { label: 'Removida', color: 'text-gray-400 bg-gray-400/10 border-gray-400/20', dot: 'bg-gray-500' },
  CANCELLED: { label: 'Cancelada', color: 'text-gray-400 bg-gray-400/10 border-gray-400/20', dot: 'bg-gray-500' },
};

const BILLING_ICONS: Record<string, { icon: string; label: string }> = {
  PIX: { icon: '⚡', label: 'Pix' },
  BOLETO: { icon: '📄', label: 'Boleto Bancario' },
  CREDIT_CARD: { icon: '💳', label: 'Cartao de Credito' },
  UNDEFINED: { icon: '❓', label: 'Indefinido' },
};

const STATUS_FILTERS = [
  { id: 'PENDING', label: 'Aguardando pagamento' },
  { id: 'OVERDUE', label: 'Vencida' },
  { id: 'RECEIVED', label: 'Recebida' },
  { id: 'CONFIRMED', label: 'Confirmada' },
  { id: 'RECEIVED_IN_CASH', label: 'Recebida em dinheiro' },
  { id: 'REFUNDED', label: 'Estornada' },
];

function CobrancasAsaasTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailCharge, setDetailCharge] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingCharge, setEditingCharge] = useState<any>(null);
  const [editForm, setEditForm] = useState({ value: '', dueDate: '', description: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  // Filtros
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [billingTypeFilter, setBillingTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fmt = (v: number | string) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      typeof v === 'string' ? parseFloat(v) : v,
    );

  const fmtDate = (d: string) => {
    if (!d) return '--';
    const dt = new Date(d);
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  };

  const fetchCharges = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: '100' };
      if (statusFilters.size === 1) params.status = Array.from(statusFilters)[0];
      if (billingTypeFilter) params.billingType = billingTypeFilter;
      if (dateFrom) params.dateGe = dateFrom;
      if (dateTo) params.dateLe = dateTo;
      const res = await api.get('/payment-gateway/charges/asaas', { params });
      setData(res.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [statusFilters, billingTypeFilter, dateFrom, dateTo]);

  useEffect(() => { fetchCharges(); }, [fetchCharges]);

  const openDetail = async (chargeId: string) => {
    setDetailLoading(true);
    setDetailCharge(null);
    try {
      const res = await api.get(`/payment-gateway/charges/asaas/detail/${chargeId}`);
      setDetailCharge(res.data);
    } catch { showError('Erro ao carregar detalhes'); }
    finally { setDetailLoading(false); }
  };

  const openEdit = (charge: any) => {
    setEditingCharge(charge);
    setEditForm({
      value: String(charge.value || ''),
      dueDate: charge.dueDate || '',
      description: charge.description || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingCharge) return;
    setSavingEdit(true);
    try {
      const updates: any = {};
      if (editForm.value) updates.value = parseFloat(editForm.value);
      if (editForm.dueDate) updates.dueDate = editForm.dueDate;
      if (editForm.description !== undefined) updates.description = editForm.description;
      await api.put(`/payment-gateway/charges/asaas/${editingCharge.id}`, updates);
      showSuccess('Cobranca atualizada!');
      setEditingCharge(null);
      await fetchCharges();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao atualizar');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteCharge = async (chargeId: string) => {
    if (!confirm('Excluir esta cobranca no Asaas? Esta acao nao pode ser desfeita.')) return;
    setDeletingId(chargeId);
    try {
      await api.delete(`/payment-gateway/charges/asaas/${chargeId}`);
      showSuccess('Cobranca excluida!');
      await fetchCharges();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao excluir');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/payment-gateway/charges/sync');
      await fetchCharges();
      showSuccess('Cobrancas sincronizadas!');
    } catch (e: any) { showError(e?.response?.data?.message || 'Erro'); }
    finally { setSyncing(false); }
  };

  const toggleStatus = (s: string) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const clearFilters = () => {
    setStatusFilters(new Set());
    setBillingTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
  };

  const hasActiveFilters = statusFilters.size > 0 || billingTypeFilter || dateFrom || dateTo;

  // Dados + filtro client-side por nome
  const rawList: any[] = data?.data || [];
  const filteredList = searchQuery
    ? rawList.filter(c => (c.customerName || c.customer || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : rawList;

  // Multi-status filter client-side (API so aceita 1 status)
  const displayList = statusFilters.size > 1
    ? filteredList.filter(c => statusFilters.has(c.status))
    : filteredList;

  const totalValue = displayList.reduce((s, c) => s + Number(c.value || 0), 0);

  return (
    <div className="space-y-3">
      {/* ── Header: Busca + Filtros + Acoes ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Busca */}
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Procurar por nome do cliente..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Botao Filtros */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-4 py-2 text-sm font-medium border rounded-lg flex items-center gap-2 transition-colors ${
            hasActiveFilters
              ? 'border-primary text-primary bg-primary/10'
              : 'border-border text-muted-foreground hover:bg-accent/30'
          }`}
        >
          <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          Filtros
          {hasActiveFilters && (
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {statusFilters.size + (billingTypeFilter ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)}
            </span>
          )}
        </button>

        {/* Sincronizar */}
        <button onClick={handleSync} disabled={syncing} className="px-4 py-2 text-sm font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/25 disabled:opacity-50 flex items-center gap-2 transition-colors">
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpDown size={14} />}
          Sincronizar
        </button>
      </div>

      {/* ── Painel de Filtros (colapsavel) ── */}
      {showFilters && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Periodo */}
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Periodo de vencimento</p>
              <div className="flex items-center gap-2">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none" />
                <span className="text-xs text-muted-foreground">ate</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none" />
              </div>
            </div>

            {/* Tipo */}
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Forma de pagamento</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(BILLING_ICONS).filter(([k]) => k !== 'UNDEFINED').map(([key, { icon, label }]) => (
                  <button
                    key={key}
                    onClick={() => setBillingTypeFilter(billingTypeFilter === key ? '' : key)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      billingTypeFilter === key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent/30'
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Status</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map(sf => (
                  <button
                    key={sf.id}
                    onClick={() => toggleStatus(sf.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      statusFilters.has(sf.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent/30'
                    }`}
                  >
                    {sf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={clearFilters} className="px-4 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-lg hover:bg-accent/30 transition-colors">
              Limpar
            </button>
            <button onClick={() => { fetchCharges(); setShowFilters(false); }} className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-colors">
              Aplicar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Editar Cobranca ── */}
      {editingCharge && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditingCharge(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Pencil size={16} className="text-primary" /> Editar Cobranca
            </h3>
            <p className="text-xs text-muted-foreground">
              Cliente: {editingCharge.customerName || editingCharge.customer} | ID: {editingCharge.id?.slice(-8)}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Valor (R$)</label>
                <input type="number" step="0.01" min="0" value={editForm.value}
                  onChange={e => setEditForm(f => ({ ...f, value: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Data de Vencimento</label>
                <input type="date" value={editForm.dueDate}
                  onChange={e => setEditForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Descricao</label>
                <input type="text" value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descricao da cobranca"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleSaveEdit} disabled={savingEdit}
                className="flex-1 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Salvar
              </button>
              <button onClick={() => setEditingCharge(null)}
                className="px-4 py-2.5 text-sm font-medium text-muted-foreground border border-border rounded-lg hover:bg-accent/30">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Detalhes da Cobranca ── */}
      {(detailCharge || detailLoading) && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { setDetailCharge(null); setDetailLoading(false); }}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {detailLoading ? (
              <div className="p-12 text-center"><Loader2 size={24} className="animate-spin text-muted-foreground mx-auto" /></div>
            ) : detailCharge && (
              <div className="p-6 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-foreground">Detalhes da Cobranca</h3>
                  <button onClick={() => setDetailCharge(null)} className="p-1 text-muted-foreground hover:text-foreground"><X size={16} /></button>
                </div>

                {/* Cliente */}
                <div className="bg-background rounded-xl p-4 space-y-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cliente</p>
                  <p className="text-sm font-semibold text-foreground">{detailCharge.customerName || detailCharge.customer}</p>
                  {detailCharge.customerCpfCnpj && <p className="text-xs text-muted-foreground font-mono">{detailCharge.customerCpfCnpj}</p>}
                  {detailCharge.customerEmail && <p className="text-xs text-muted-foreground">{detailCharge.customerEmail}</p>}
                  {detailCharge.customerPhone && <p className="text-xs text-muted-foreground">{detailCharge.customerPhone}</p>}
                </div>

                {/* Dados da cobranca */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Valor</p>
                    <p className="text-lg font-bold text-foreground">{fmt(detailCharge.value || 0)}</p>
                  </div>
                  <div className="bg-background rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Valor Liquido</p>
                    <p className="text-lg font-bold text-emerald-400">{fmt(detailCharge.netValue || 0)}</p>
                  </div>
                  <div className="bg-background rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Status</p>
                    <p className="text-sm font-semibold">{(CHARGE_STATUS_MAP[detailCharge.status] || { label: detailCharge.status }).label}</p>
                  </div>
                  <div className="bg-background rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Forma de Pagamento</p>
                    <p className="text-sm">{(BILLING_ICONS[detailCharge.billingType] || {}).label || detailCharge.billingType}</p>
                  </div>
                  <div className="bg-background rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Vencimento</p>
                    <p className="text-sm">{fmtDate(detailCharge.dueDate)}</p>
                  </div>
                  <div className="bg-background rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Criada em</p>
                    <p className="text-sm">{fmtDate(detailCharge.dateCreated)}</p>
                  </div>
                </div>

                {/* Descricao */}
                {detailCharge.description && (
                  <div className="bg-background rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Descricao</p>
                    <p className="text-sm text-foreground">{detailCharge.description}</p>
                  </div>
                )}

                {/* Juros e Multa */}
                {(detailCharge.interest?.value > 0 || detailCharge.fine?.value > 0) && (
                  <div className="bg-background rounded-xl p-3 grid grid-cols-2 gap-2">
                    {detailCharge.interest?.value > 0 && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Juros ao mes</p>
                        <p className="text-sm">{detailCharge.interest.value}%</p>
                      </div>
                    )}
                    {detailCharge.fine?.value > 0 && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Multa por atraso</p>
                        <p className="text-sm">{detailCharge.fine.value}%</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Numero da fatura / Nosso Numero */}
                <div className="bg-background rounded-xl p-3 grid grid-cols-2 gap-2">
                  {detailCharge.invoiceNumber && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">N. Fatura</p>
                      <p className="text-sm font-mono">{detailCharge.invoiceNumber}</p>
                    </div>
                  )}
                  {detailCharge.nossoNumero && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Nosso Numero</p>
                      <p className="text-sm font-mono">{detailCharge.nossoNumero}</p>
                    </div>
                  )}
                </div>

                {/* PIX QR Code */}
                {detailCharge.pixCopyPaste && (
                  <div className="bg-background rounded-xl p-3 space-y-2">
                    <p className="text-[10px] text-muted-foreground uppercase">PIX Copia e Cola</p>
                    <div className="flex gap-2">
                      <input readOnly value={detailCharge.pixCopyPaste} className="flex-1 px-3 py-1.5 text-xs bg-card border border-border rounded-lg font-mono truncate" />
                      <button onClick={() => { navigator.clipboard.writeText(detailCharge.pixCopyPaste); showSuccess('Copiado!'); }}
                        className="px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg">Copiar</button>
                    </div>
                  </div>
                )}

                {/* Botoes de acao */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {detailCharge.bankSlipUrl && (
                    <a href={detailCharge.bankSlipUrl} target="_blank" rel="noopener noreferrer"
                      className="flex-1 py-2.5 text-sm font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/25 flex items-center justify-center gap-2 transition-colors">
                      <Receipt size={14} /> Boleto (PDF)
                    </a>
                  )}
                  {detailCharge.invoiceUrl && (
                    <a href={detailCharge.invoiceUrl} target="_blank" rel="noopener noreferrer"
                      className="flex-1 py-2.5 text-sm font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/25 flex items-center justify-center gap-2 transition-colors">
                      <CreditCard size={14} /> Fatura Online
                    </a>
                  )}
                  {detailCharge.transactionReceiptUrl && (
                    <a href={detailCharge.transactionReceiptUrl} target="_blank" rel="noopener noreferrer"
                      className="flex-1 py-2.5 text-sm font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-lg hover:bg-purple-500/25 flex items-center justify-center gap-2 transition-colors">
                      <Receipt size={14} /> Comprovante
                    </a>
                  )}
                </div>

                {/* ID da cobranca */}
                <p className="text-[10px] text-muted-foreground text-center font-mono">ID: {detailCharge.id}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tabela ── */}
      {loading ? (
        <div className="text-center py-16"><Loader2 size={24} className="animate-spin text-muted-foreground mx-auto" /></div>
      ) : displayList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhuma cobranca encontrada</p>
          <p className="text-xs mt-1">Ajuste os filtros ou crie uma nova cobranca</p>
        </div>
      ) : (
        <>
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-card/80 border-b border-border">
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Nome</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Valor</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Descricao</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Forma de pagamento</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Vencimento</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {displayList.map((c: any, i: number) => {
                  const st = CHARGE_STATUS_MAP[c.status] || { label: c.status, color: 'text-gray-400 bg-gray-400/10 border-gray-400/20', dot: 'bg-gray-500' };
                  const bt = BILLING_ICONS[c.billingType] || BILLING_ICONS.UNDEFINED;
                  return (
                    <tr key={c.id || i} className="border-b border-border/40 hover:bg-accent/10 transition-colors cursor-pointer" onClick={() => openDetail(c.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                            {(c.customerName || c.customer || '?')[0]?.toUpperCase()}
                          </div>
                          <span className="font-medium text-foreground truncate max-w-[180px] hover:text-primary transition-colors">
                            {c.customerName || c.customer || '--'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">{fmt(c.value || 0)}</td>
                      <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]" title={c.description}>
                        {c.description || '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <span>{bt.icon}</span>
                          <span className="text-muted-foreground">{bt.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(c.dueDate)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${st.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {c.status !== 'RECEIVED' && c.status !== 'CONFIRMED' && c.status !== 'RECEIVED_IN_CASH' && (
                            <>
                              <button
                                onClick={() => openEdit(c)}
                                className="px-2 py-1 text-[10px] font-semibold text-primary border border-primary/20 rounded-md hover:bg-primary/10 transition-colors inline-flex items-center gap-1"
                                title="Editar cobranca"
                              >
                                <Pencil size={10} /> Editar
                              </button>
                              <button
                                onClick={() => handleDeleteCharge(c.id)}
                                disabled={deletingId === c.id}
                                className="px-2 py-1 text-[10px] font-semibold text-red-400 border border-red-400/20 rounded-md hover:bg-red-400/10 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                                title="Excluir cobranca"
                              >
                                {deletingId === c.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Rodape */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>{displayList.length} cobranca(s) {data?.totalCount > displayList.length ? `de ${data.totalCount}` : ''}</span>
            <span className="font-semibold text-foreground">Total: {fmt(totalValue)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Componente: Clientes CRM ↔ Asaas
══════════════════════════════════════════════════════════════ */

function ClientesSyncTab() {
  const [linked, setLinked] = useState<any[]>([]);
  const [asaasCustomers, setAsaasCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [view, setView] = useState<'linked' | 'asaas' | 'unlinked'>('linked');
  const [searchQuery, setSearchQuery] = useState('');
  const [linking, setLinking] = useState<string | null>(null); // asaas customer ID being linked
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<any[]>([]);

  const fetchLinked = useCallback(async () => {
    try {
      const res = await api.get('/payment-gateway/customers/linked');
      setLinked(res.data || []);
    } catch { setLinked([]); }
  }, []);

  const fetchAsaas = useCallback(async () => {
    try {
      const res = await api.get('/payment-gateway/customers/asaas', { params: { limit: '100' } });
      setAsaasCustomers(res.data?.data || []);
    } catch { setAsaasCustomers([]); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchLinked(), fetchAsaas()]).finally(() => setLoading(false));
  }, [fetchLinked, fetchAsaas]);

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await api.post('/payment-gateway/customers/import');
      setImportResult(res.data);
      await Promise.all([fetchLinked(), fetchAsaas()]);
      showSuccess(`${res.data.linked} cliente(s) vinculado(s) automaticamente!`);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao importar');
    } finally {
      setImporting(false);
    }
  };

  const handleLink = async (asaasId: string, leadId: string) => {
    try {
      await api.post('/payment-gateway/customers/link', { asaasCustomerId: asaasId, leadId });
      showSuccess('Cliente vinculado!');
      setLinking(null);
      setLeadSearch('');
      setLeadResults([]);
      await fetchLinked();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao vincular');
    }
  };

  const handleUnlink = async (id: string) => {
    if (!confirm('Desvincular este cliente?')) return;
    try {
      await api.delete(`/payment-gateway/customers/${id}`);
      showSuccess('Desvinculado');
      await fetchLinked();
    } catch { showError('Erro ao desvincular'); }
  };

  const searchLeads = async (q: string) => {
    setLeadSearch(q);
    if (q.length < 2) { setLeadResults([]); return; }
    try {
      const res = await api.get('/leads', { params: { search: q, limit: 5 } });
      setLeadResults(res.data?.data || res.data || []);
    } catch { setLeadResults([]); }
  };

  const linkedIds = new Set(linked.map(l => l.external_id));
  const unlinkedAsaas = asaasCustomers.filter(c => !linkedIds.has(c.id) && !c.deleted);

  const q = searchQuery.toLowerCase();
  const filteredLinked = q ? linked.filter(l => (l.lead?.name || '').toLowerCase().includes(q) || (l.cpf_cnpj || '').includes(q)) : linked;
  const filteredAsaas = q ? asaasCustomers.filter(c => (c.name || '').toLowerCase().includes(q) || (c.cpfCnpj || '').includes(q)) : asaasCustomers;

  const displayList = view === 'linked' ? filteredLinked : view === 'asaas' ? filteredAsaas : unlinkedAsaas;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Users size={15} className="text-primary" />
          Clientes CRM x Asaas
          <span className="text-xs text-muted-foreground font-normal">({linked.length} vinculados)</span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome ou CPF..."
              className="pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none w-48" />
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['linked', 'asaas', 'unlinked'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/30'}`}>
                {v === 'linked' ? `Vinculados (${linked.length})` : v === 'asaas' ? `Asaas (${asaasCustomers.length})` : `Sem vinculo (${unlinkedAsaas.length})`}
              </button>
            ))}
          </div>
          <button onClick={handleImport} disabled={importing}
            className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            Importar e Vincular
          </button>
        </div>
      </div>

      {/* Import result */}
      {importResult && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs">
          <p className="font-semibold text-emerald-400">Importacao concluida: {importResult.total} clientes no Asaas</p>
          <p className="text-muted-foreground mt-1">{importResult.linked} vinculados automaticamente | {importResult.alreadyLinked} ja vinculados | {importResult.unlinked?.length || 0} sem match</p>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-16"><Loader2 size={24} className="animate-spin text-muted-foreground mx-auto" /></div>
      ) : displayList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum cliente {view === 'linked' ? 'vinculado' : view === 'asaas' ? 'no Asaas' : 'sem vinculo'}</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-card/80 border-b border-border">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">CPF/CNPJ</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Telefone</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">ID Asaas</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Acao</th>
              </tr>
            </thead>
            <tbody>
              {displayList.map((item: any, i: number) => {
                const isLinkedView = view === 'linked';
                const name = isLinkedView ? item.lead?.name : item.name;
                const cpf = isLinkedView ? item.cpf_cnpj : item.cpfCnpj?.replace(/\D/g, '');
                const email = isLinkedView ? item.lead?.email : item.email;
                const phone = isLinkedView ? item.lead?.phone : (item.phone || item.mobilePhone);
                const asaasId = isLinkedView ? item.external_id : item.id;
                const isAlreadyLinked = linkedIds.has(item.id);

                return (
                  <tr key={asaasId || i} className="border-b border-border/40 hover:bg-accent/10 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                          {(name || '?')[0]?.toUpperCase()}
                        </div>
                        <span className="font-medium text-foreground truncate max-w-[160px]">{name || '--'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{cpf || '--'}</td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[150px]">{email || '--'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{phone || '--'}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">{asaasId?.slice(-10)}</td>
                    <td className="px-4 py-3">
                      {isLinkedView ? (
                        <button onClick={() => handleUnlink(item.id)}
                          className="px-2 py-1 text-[10px] font-semibold text-red-400 border border-red-400/20 rounded-md hover:bg-red-400/10 flex items-center gap-1">
                          <Unlink size={10} /> Desvincular
                        </button>
                      ) : isAlreadyLinked ? (
                        <span className="px-2 py-1 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-md">Vinculado</span>
                      ) : linking === item.id ? (
                        <div className="space-y-1">
                          <input type="text" value={leadSearch} onChange={e => searchLeads(e.target.value)}
                            placeholder="Buscar lead por nome..."
                            className="w-full px-2 py-1 text-[10px] bg-background border border-border rounded-md focus:outline-none" autoFocus />
                          {leadResults.map(l => (
                            <button key={l.id} onClick={() => handleLink(item.id, l.id)}
                              className="w-full text-left px-2 py-1 text-[10px] hover:bg-accent/30 rounded-md flex items-center gap-1">
                              <Check size={10} className="text-emerald-400" /> {l.name || l.phone}
                            </button>
                          ))}
                          <button onClick={() => { setLinking(null); setLeadSearch(''); setLeadResults([]); }}
                            className="text-[10px] text-muted-foreground hover:text-foreground">Cancelar</button>
                        </div>
                      ) : (
                        <button onClick={() => setLinking(item.id)}
                          className="px-2 py-1 text-[10px] font-semibold text-primary border border-primary/20 rounded-md hover:bg-primary/10 flex items-center gap-1">
                          <Link2 size={10} /> Vincular
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
