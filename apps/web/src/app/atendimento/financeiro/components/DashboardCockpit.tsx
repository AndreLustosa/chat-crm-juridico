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

import { useCallback, useEffect, useState } from 'react';
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
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { useRole } from '@/lib/useRole';
import { DonutByArea, ForecastChart, ExportButton, GoalEditor } from './DashboardCockpitExtras';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */

interface UrgentActions {
  overdue: { count: number; total: number };
  /** @deprecated mantido por compat — agora == overdue */
  overdue7d?: { count: number; total: number };
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
  receivable: {
    value: number;
    previous: number;
    deltaPct: number | null;
    /** A1 — breakdown: a vencer (due_date >= today) */
    dueValue?: number;
    /** A1 — breakdown: vencido (due_date < today) */
    overdueValue?: number;
  };
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
    /** A6 — usado pra derivar status "Enviada" (reminder enviado) */
    reminder_count?: number;
    last_reminder_sent_at?: string | null;
  } | null;
}

/* ──────────────────────────────────────────────────────────────
   A6 — Mapeamento de status Asaas (8 estados)
────────────────────────────────────────────────────────────── */

type AsaasState =
  | 'NAO_GERADA'
  | 'GERADA'
  | 'ENVIADA'
  | 'VISUALIZADA'
  | 'PAGA'
  | 'VENCIDA'
  | 'CANCELADA'
  | 'ESTORNADA';

interface AsaasStatusInfo {
  state: AsaasState;
  label: string;
  color: string;
}

/**
 * Deriva o status Asaas a partir do gatewayCharge.
 *
 * Mapeamento:
 *  - sem charge        -> Não gerada
 *  - PENDING + sem reminder -> Gerada
 *  - PENDING + reminder enviado -> Enviada
 *  - RECEIVED/CONFIRMED -> Paga
 *  - OVERDUE -> Vencida
 *  - CANCELLED/DELETED -> Cancelada
 *  - REFUNDED -> Estornada
 *
 * "Visualizada" — Asaas nao expoe webhook de visualizacao por default;
 * tratamos como "Enviada" enquanto nao houver evento.
 */
function getAsaasStatus(charge: ChargeRow['gatewayCharge']): AsaasStatusInfo {
  if (!charge) {
    return { state: 'NAO_GERADA', label: 'Não gerada', color: 'text-muted-foreground bg-muted/30' };
  }
  const s = (charge.status || '').toUpperCase();
  if (s === 'RECEIVED' || s === 'CONFIRMED' || s === 'RECEIVED_IN_CASH') {
    return { state: 'PAGA', label: 'Paga', color: 'text-emerald-400 bg-emerald-500/10' };
  }
  if (s === 'OVERDUE') {
    return { state: 'VENCIDA', label: 'Vencida', color: 'text-red-400 bg-red-500/10' };
  }
  if (s === 'CANCELLED' || s === 'DELETED') {
    return { state: 'CANCELADA', label: 'Cancelada', color: 'text-muted-foreground bg-muted/30' };
  }
  if (s === 'REFUNDED' || s === 'REFUND_REQUESTED' || s === 'REFUND_IN_PROGRESS') {
    return { state: 'ESTORNADA', label: 'Estornada', color: 'text-amber-400 bg-amber-500/10' };
  }
  // PENDING — diferencia "Gerada" de "Enviada" via tracking de reminder
  const reminderCount = charge.reminder_count || 0;
  if (reminderCount > 0) {
    return { state: 'ENVIADA', label: 'Enviada', color: 'text-blue-400 bg-blue-500/10' };
  }
  return { state: 'GERADA', label: 'Gerada', color: 'text-cyan-400 bg-cyan-500/10' };
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
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-5" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.25" points={points} />
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
  // A1 — banner agora usa "atrasados" (TODAS as faixas vencidas) pra
  // bater com aging e KPI breakdown. Subdivisao 1-7d/8-30d/etc fica so
  // no aging.
  const overdueData = data.overdue || data.overdue7d;
  if (overdueData && overdueData.count > 0)
    items.push({ key: 'overdue', icon: AlertTriangle, label: 'atrasados', count: overdueData.count, total: overdueData.total, color: 'text-red-400' });
  if (data.overdueToday.count > 0)
    items.push({ key: 'overdue', icon: Clock, label: 'vencendo hoje', count: data.overdueToday.count, total: data.overdueToday.total, color: 'text-amber-400' });
  if (data.awaitingAlvara.count > 0)
    items.push({ key: 'awaiting_alvara', icon: Calendar, label: 'aguardando alvará', count: data.awaitingAlvara.count, total: data.awaitingAlvara.total, color: 'text-blue-400' });
  if (data.withoutCpf.count > 0)
    items.push({ key: 'no_cpf', icon: UserPlus, label: 'sem CPF cadastrado', count: data.withoutCpf.count, color: 'text-purple-400' });

  // B2 — banner mais compacto: sem titulo redundante, sem icone isolado.
  // Cada bloco em UMA linha (rotulo em uppercase + count + valor + acao).
  // O fundo gradiente claro ja comunica urgencia visual.
  return (
    <div className="bg-gradient-to-r from-red-500/10 via-amber-500/5 to-blue-500/5 border border-red-500/15 rounded-xl px-3 py-2 md:px-4 md:py-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1.5">
        {items.map((it, idx) => {
          const Icon = it.icon;
          return (
            <button
              key={`${it.key}-${idx}`}
              onClick={() => onJumpTo(it.key)}
              className="flex items-center gap-2 group min-w-0 hover:bg-card/30 -mx-1 px-1 rounded transition-colors"
            >
              <Icon size={12} className={`${it.color} shrink-0`} />
              <span className={`text-[10.5px] font-semibold uppercase tracking-wide ${it.color}`}>
                {it.label}
              </span>
              <span className="text-xs font-bold text-foreground tabular-nums">
                {it.count}
              </span>
              {it.total !== undefined && (
                <span className="text-[10.5px] text-muted-foreground tabular-nums">
                  · {fmt(it.total)}
                </span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/60 group-hover:text-foreground transition-colors">
                ver →
              </span>
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
  breakdown,
  comparedValue,
  comparedLabel,
  semantic = 'positive-good',
}: {
  icon: any;
  label: string;
  value: string;
  delta?: number | null;
  color: string;
  bgColor: string;
  sparkline?: Array<{ date: string; value: number }>;
  hint?: string;
  /** A1 — sub-linhas abaixo do valor (ex: "X a vencer · Y vencido") */
  breakdown?: Array<{ label: string; value: number; tone?: 'normal' | 'danger' }>;
  /** A2 — valor numerico do periodo comparado (mostrado entre parenteses) */
  comparedValue?: number;
  /** A2 — rotulo curto do periodo comparado (ex: "Mar/2026") */
  comparedLabel?: string;
  /** A2 — semantica de cor: subir e bom (Receita/Saldo) ou ruim (Despesas) */
  semantic?: 'positive-good' | 'positive-bad';
}) {
  // A2 — variacao entre -2% e +2% e neutra pra evitar flutter visual
  const isNeutral = delta !== null && delta !== undefined && Math.abs(delta) < 2;
  const deltaPositive = delta !== null && delta !== undefined && delta > 0 && !isNeutral;
  const deltaNegative = delta !== null && delta !== undefined && delta < 0 && !isNeutral;

  // Cor semantica: pra Despesas/A receber subir e ruim
  const isGoodChange =
    semantic === 'positive-good' ? deltaPositive : deltaNegative;
  const isBadChange =
    semantic === 'positive-good' ? deltaNegative : deltaPositive;

  const deltaColorClass = isNeutral
    ? 'text-muted-foreground'
    : isGoodChange
    ? 'text-emerald-400'
    : isBadChange
    ? 'text-red-400'
    : 'text-muted-foreground';

  // B1 — densidade: padding menor (p-3 em vez de p-4), gaps reduzidos.
  // Icone superior removido — nao agregava informacao funcional.
  // Rotulo em peso medium (era bold). Sparkline mais discreto (h-6).
  return (
    <div className="bg-card border border-border rounded-xl p-3 hover:border-foreground/20 transition-colors">
      <div className="text-[10.5px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="text-base md:text-lg font-semibold text-foreground tabular-nums mt-0.5">
        {value}
      </div>

      {/* A2 — linha de comparacao com seta + delta % + valor periodo anterior */}
      {delta !== undefined && delta !== null && (
        <div className={`flex items-center gap-1 mt-0.5 text-[10.5px] font-medium ${deltaColorClass}`}>
          {deltaPositive && <ArrowUp size={10} />}
          {deltaNegative && <ArrowDown size={10} />}
          {isNeutral && <span className="text-[9px]">—</span>}
          <span>{fmtPct(delta)}</span>
          {comparedLabel && comparedValue !== undefined && (
            <span className="text-muted-foreground/80 truncate">
              vs {comparedLabel} ({fmt(comparedValue)})
            </span>
          )}
          {comparedLabel && comparedValue === undefined && (
            <span className="text-muted-foreground/80">vs {comparedLabel}</span>
          )}
        </div>
      )}
      {/* Quando nao ha base de comparacao, mostrar "—" */}
      {(delta === null || delta === undefined) && comparedLabel && (
        <div className="flex items-center gap-1 mt-0.5 text-[10.5px] text-muted-foreground">
          <span>—</span>
          <span>vs {comparedLabel}</span>
        </div>
      )}

      {hint && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</div>}

      {/* A1 — breakdown abaixo (ex: "X a vencer · Y vencido") */}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-1.5 space-y-0.5 text-[10.5px]">
          {breakdown.map((b, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-muted-foreground">{b.label}</span>
              <span className={b.tone === 'danger' ? 'text-red-400 font-semibold tabular-nums' : 'text-foreground/80 tabular-nums'}>
                {fmt(b.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* B1 — sparkline mais discreto (sem caixa em volta, altura menor) */}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-1.5 opacity-70">
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

  // A2 — rotulo curto do periodo comparado (ex: "Mar/2026")
  const comparedLabel = formatComparedLabel(data.period.comparedTo.from, data.period.comparedTo.kind);

  // A2 — Saldo: deltaPct manual (kpis nao retorna por default)
  const balanceDelta =
    data.balance.previous !== 0
      ? ((data.balance.value - data.balance.previous) / Math.abs(data.balance.previous)) * 100
      : data.balance.value === 0
      ? 0
      : null;

  // A1 — breakdown do "A receber"
  const receivableBreakdown: Array<{ label: string; value: number; tone?: 'normal' | 'danger' }> = [];
  if (data.receivable.dueValue !== undefined) {
    receivableBreakdown.push({ label: 'A vencer', value: data.receivable.dueValue });
  }
  if (data.receivable.overdueValue !== undefined && data.receivable.overdueValue > 0) {
    receivableBreakdown.push({ label: 'Vencido', value: data.receivable.overdueValue, tone: 'danger' });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={TrendingUp}
          label="Receita realizada"
          value={fmt(data.revenue.value)}
          delta={data.revenue.deltaPct}
          comparedValue={data.revenue.previous}
          comparedLabel={comparedLabel}
          semantic="positive-good"
          color="text-emerald-400"
          bgColor="bg-emerald-500/15"
          sparkline={data.sparkline}
        />
        <KpiCard
          icon={TrendingDown}
          label="Despesas"
          value={fmt(data.expenses.value)}
          delta={data.expenses.deltaPct}
          comparedValue={data.expenses.previous}
          comparedLabel={comparedLabel}
          semantic="positive-bad"
          color="text-red-400"
          bgColor="bg-red-500/15"
        />
        <KpiCard
          icon={DollarSign}
          label="Saldo"
          value={fmt(data.balance.value)}
          delta={balanceDelta}
          comparedValue={data.balance.previous}
          comparedLabel={comparedLabel}
          semantic="positive-good"
          color={data.balance.value >= 0 ? 'text-emerald-400' : 'text-red-400'}
          bgColor={data.balance.value >= 0 ? 'bg-emerald-500/15' : 'bg-red-500/15'}
        />
        <KpiCard
          icon={Clock}
          label="A receber"
          value={fmt(data.receivable.value)}
          delta={data.receivable.deltaPct}
          comparedValue={data.receivable.previous}
          comparedLabel="snapshot anterior"
          semantic="positive-bad"
          color="text-blue-400"
          bgColor="bg-blue-500/15"
          breakdown={receivableBreakdown}
        />
      </div>

      <MonthlyGoalCard goal={data.monthlyGoal} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   A7 — MonthOverMonthStrip (faixa entre Camada 2 e 3)
────────────────────────────────────────────────────────────── */

function MonthOverMonthStrip({ data }: { data: Kpis | null }) {
  if (!data) return null;

  const comparedLabel = formatComparedLabel(data.period.comparedTo.from, data.period.comparedTo.kind);
  const currentLabel = formatComparedLabel(data.period.from, 'previous-month'); // mes atual no mesmo formato

  // 3 comparativos: Receita, Despesa, Saldo
  const blocks = [
    {
      key: 'revenue',
      label: 'Receita',
      current: data.revenue.value,
      previous: data.revenue.previous,
      semantic: 'positive-good' as const,
      color: 'text-emerald-400',
      barColor: 'bg-emerald-400/70',
    },
    {
      key: 'expenses',
      label: 'Despesa',
      current: data.expenses.value,
      previous: data.expenses.previous,
      semantic: 'positive-bad' as const,
      color: 'text-red-400',
      barColor: 'bg-red-400/70',
    },
    {
      key: 'balance',
      label: 'Saldo',
      current: data.balance.value,
      previous: data.balance.previous,
      semantic: 'positive-good' as const,
      color: data.balance.value >= 0 ? 'text-emerald-400' : 'text-red-400',
      barColor: data.balance.value >= 0 ? 'bg-emerald-400/70' : 'bg-red-400/70',
    },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-foreground">Mês a mês</h3>
        <span className="text-[10px] text-muted-foreground">
          {currentLabel} <span className="opacity-60">vs</span> {comparedLabel}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {blocks.map((b) => {
          // Delta % com tratamento de base zero
          let delta: number | null;
          if (b.previous === 0) delta = b.current === 0 ? 0 : null;
          else delta = ((b.current - b.previous) / Math.abs(b.previous)) * 100;

          const isNeutral = delta !== null && Math.abs(delta) < 2;
          const positive = delta !== null && delta > 0 && !isNeutral;
          const negative = delta !== null && delta < 0 && !isNeutral;

          // Cor semantica
          const isGood = b.semantic === 'positive-good' ? positive : negative;
          const isBad = b.semantic === 'positive-good' ? negative : positive;
          const deltaColor = isNeutral
            ? 'text-muted-foreground'
            : isGood
            ? 'text-emerald-400'
            : isBad
            ? 'text-red-400'
            : 'text-muted-foreground';

          // Mini-barrinha comparativa: escala em relacao ao maior dos 2
          const maxVal = Math.max(Math.abs(b.current), Math.abs(b.previous), 1);
          const currentPct = (Math.abs(b.current) / maxVal) * 100;
          const previousPct = (Math.abs(b.previous) / maxVal) * 100;

          return (
            <div key={b.key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {b.label}
                </span>
                <span className={`flex items-center gap-1 text-[11px] font-bold ${deltaColor}`}>
                  {positive && <ArrowUp size={11} />}
                  {negative && <ArrowDown size={11} />}
                  {isNeutral && <span className="text-[10px]">—</span>}
                  {fmtPct(delta)}
                </span>
              </div>
              <div className={`text-base font-bold tabular-nums ${b.color}`}>
                {fmt(b.current)}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {fmt(b.previous)} <span className="opacity-60">em {comparedLabel}</span>
              </div>
              {/* Mini-barrinha comparativa: 2 barras horizontais */}
              <div className="space-y-1 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground w-10 shrink-0">
                    {currentLabel}
                  </span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${b.barColor}`} style={{ width: `${currentPct}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground/60 w-10 shrink-0">
                    {comparedLabel}
                  </span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-muted-foreground/30" style={{ width: `${previousPct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A2 — Formata "Mar/2026" a partir da data inicial do periodo comparado. */
function formatComparedLabel(fromIso: string, kind: string): string {
  const dt = new Date(fromIso);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  if (kind === 'previous-year') {
    return `${dt.getUTCFullYear()}`;
  }
  return `${months[dt.getUTCMonth()]}/${dt.getUTCFullYear()}`;
}

function MonthlyGoalCard({ goal }: { goal: Kpis['monthlyGoal'] }) {
  const { isAdmin } = useRole();
  const [refreshKey, setRefreshKey] = useState(0);

  // Sem meta cadastrada — mostra CTA pra criar (admin only)
  if (!goal) {
    if (!isAdmin) return null;
    return (
      <div className="bg-card border border-dashed border-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Sem meta cadastrada para o mês</span>
          </div>
          <GoalEditor isAdmin={isAdmin} onSaved={() => setRefreshKey((k) => k + 1)} />
        </div>
      </div>
    );
  }

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
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">
            {fmt(goal.realized)} / {fmt(goal.target)}
          </div>
          <GoalEditor isAdmin={isAdmin} onSaved={() => setRefreshKey((k) => k + 1)} />
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

function ByLawyerChart({ data, loading, periodLabel }: { data: RevenueByLawyer[] | null; loading: boolean; periodLabel?: string }) {
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-3 animate-pulse h-56" />
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-foreground">Receita por advogado</h3>
          {periodLabel && <span className="text-[10px] text-muted-foreground">{periodLabel}</span>}
        </div>
        <div className="text-xs text-muted-foreground">Sem receitas no período</div>
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.revenue), 1);
  // B4 — padding menor (p-3), titulo em peso medio, metainfo na mesma
  // linha do titulo. Barras mais finas (h-1) com label/valor sob a barra.
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-foreground">Receita por advogado</h3>
        {periodLabel && <span className="text-[10px] text-muted-foreground">{periodLabel}</span>}
      </div>
      <div className="space-y-1.5">
        {data.slice(0, 8).map((d) => (
          <div key={d.lawyerId} className="group">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-foreground truncate">{d.lawyerName}</span>
              <span className="text-emerald-400 font-semibold tabular-nums">{fmt(d.revenue)}</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden mt-0.5">
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
    return <div className="bg-card border border-border rounded-xl p-3 animate-pulse h-56" />;
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

  // Total geral pra subtitulo
  const totalGeral = data.reduce((acc, b) => acc + b.total, 0);
  const totalCount = data.reduce((acc, b) => acc + b.count, 0);

  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-foreground">Aging — parcelas em aberto</h3>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {fmt(totalGeral)} <span className="opacity-60">· {totalCount}</span>
        </span>
      </div>
      <div className="space-y-1.5">
        {data.map((b) => (
          <button
            key={b.key}
            onClick={() => onSelectBucket(b.key)}
            className="w-full text-left group"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-foreground group-hover:underline">{b.label}</span>
              <span className="tabular-nums">
                <span className="text-foreground font-semibold">{fmt(b.total)}</span>
                <span className="text-muted-foreground ml-1">({b.count})</span>
              </span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden mt-0.5">
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

// B3 — filtros expandidos da tabela
type ChargeFilter = 'all' | 'overdue' | 'pending' | 'paid' | 'awaiting_alvara' | 'no_cpf' | 'to_send' | 'due_today';
type ChargeCounts = Record<ChargeFilter, number>;

function OperationalTable({
  filter,
  setFilter,
  searchInit,
  lawyerId,
}: {
  filter: ChargeFilter;
  setFilter: (f: ChargeFilter) => void;
  searchInit?: string;
  lawyerId?: string;
}) {
  const [data, setData] = useState<ChargesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<ChargeCounts | null>(null);
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

  // B3 — fetch dos contadores (refresh quando search muda ou apos inline-cpf)
  const fetchCounts = useCallback(async () => {
    try {
      const r = await api.get('/financeiro/dashboard/charges/counts', {
        params: {
          search: search || undefined,
          lawyerId: lawyerId || undefined,
        },
      });
      setCounts(r.data);
    } catch {
      // sem contadores nao quebra a tabela
    }
  }, [search, lawyerId]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Debounce do search
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // B3 — abas com contadores. Ordem mais acionavel primeiro.
  const tabs: Array<{ key: ChargeFilter; label: string }> = [
    { key: 'no_cpf', label: 'Sem CPF' },
    { key: 'to_send', label: 'A enviar' },
    { key: 'overdue', label: 'Vencidas' },
    { key: 'due_today', label: 'Vence hoje' },
    { key: 'pending', label: 'A vencer' },
    { key: 'awaiting_alvara', label: 'Aguard. alvará' },
    { key: 'paid', label: 'Pagas' },
    { key: 'all', label: 'Todas' },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* B3 — header com titulo + busca unica + abas com contadores */}
      <div className="p-3 border-b border-border/60 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">Cobranças</h3>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nome do cliente ou CPF..."
              className="pl-7 pr-3 py-1.5 text-[11px] bg-background border border-border rounded-lg w-full sm:w-60 focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        {/* B3 — abas com contador embutido. Ativa em primary. Demais cinza. */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {tabs.map((t) => {
            const active = filter === t.key;
            const c = counts?.[t.key];
            return (
              <button
                key={t.key}
                onClick={() => {
                  setFilter(t.key);
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span>{t.label}</span>
                {c !== undefined && (
                  <span
                    className={`text-[10px] tabular-nums ${
                      active ? 'opacity-80' : 'text-muted-foreground/70'
                    }`}
                  >
                    ({c})
                  </span>
                )}
              </button>
            );
          })}
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
              {/* A6 — split Status em 2 colunas: pagamento + Asaas */}
              <th className="px-3 py-2 font-medium">Pagamento</th>
              <th className="px-3 py-2 font-medium">Asaas</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center">
                  <Loader2 size={16} className="inline animate-spin text-muted-foreground" />
                </td>
              </tr>
            )}
            {!loading && data && data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
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

  // A6 — Status do pagamento (4 estados): A vencer, Vence hoje, Atrasado, Pago
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDt = row.dueDate ? new Date(row.dueDate) : null;
  const isToday = dueDt && dueDt.toDateString() === today.toDateString();
  const isOverdue = dueDt && dueDt < today && row.status !== 'PAGO' && !isToday;

  let st: { label: string; color: string };
  if (row.status === 'PAGO') {
    st = { label: 'Pago', color: 'text-emerald-400 bg-emerald-500/10' };
  } else if (isOverdue) {
    st = { label: 'Atrasado', color: 'text-red-400 bg-red-500/10' };
  } else if (isToday) {
    st = { label: 'Vence hoje', color: 'text-amber-400 bg-amber-500/10' };
  } else {
    st = { label: 'A vencer', color: 'text-blue-400 bg-blue-500/10' };
  }

  // A6 — Status Asaas (8 estados) derivado do gatewayCharge.status
  const asaasStatus = getAsaasStatus(row.gatewayCharge);

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

  // A5 — "Cadastrar CPF" so aparece quando o lead nao tem CPF cadastrado
  // E o pagamento nao esta PAGO (nao adianta cadastrar CPF pra cobranca
  // que ja foi paga). Bate com o contador `withoutCpf.count` do banner
  // (que filtra apenas charges em PENDING/OVERDUE).
  const needsCpf = !row.leadCpf && row.status !== 'PAGO';

  return (
    <tr className="border-b border-border/50 hover:bg-accent/20 transition-colors">
      <td className="px-3 py-2.5">
        <div className="font-medium text-foreground">{row.leadName || '—'}</div>
        {row.leadCpf ? (
          <div className="text-[10px] text-muted-foreground tabular-nums">{row.leadCpf}</div>
        ) : needsCpf ? (
          <button
            onClick={() => setShowCpfInput((v) => !v)}
            className="text-[10px] text-amber-400 hover:underline flex items-center gap-1"
          >
            <UserPlus size={10} /> Cadastrar CPF
          </button>
        ) : null}
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
      {/* A6 — Status do pagamento */}
      <td className="px-3 py-2.5">
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${st.color}`}>
          {st.label}
        </span>
      </td>
      {/* A6 — Status Asaas (8 estados) */}
      <td className="px-3 py-2.5">
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-medium ${asaasStatus.color}`}
          title={`Status no Asaas: ${asaasStatus.label}`}
        >
          {asaasStatus.label}
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

  const [tableFilter, setTableFilter] = useState<ChargeFilter>('all');
  const [showExtras, setShowExtras] = useState(false);

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
    else if (target === 'no_cpf') setTableFilter('no_cpf');
    else setTableFilter('all');
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

      {/* A7 — Faixa "Mês a mês" entre KPIs e Análises */}
      <MonthOverMonthStrip data={kpis} />

      {/* Layer 3: Análises (lado a lado em desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ByLawyerChart
          data={byLawyer}
          loading={loadingAnalyses}
          periodLabel={kpis ? formatComparedLabel(kpis.period.from, 'previous-month').toLowerCase() : undefined}
        />
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

      {/* Análise detalhada (lazy-load — Fase 3) */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowExtras((v) => !v)}
          className="w-full flex items-center justify-between p-3 hover:bg-accent/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">Análise detalhada</span>
            <span className="text-[10px] text-muted-foreground">
              Receita por área · Projeção · Exportação
            </span>
          </div>
          <div className="flex items-center gap-2">
            {showExtras && (
              <div onClick={(e) => e.stopPropagation()}>
                <ExportButton from={from} to={to} lawyerId={lawyerId} />
              </div>
            )}
            {showExtras ? (
              <ChevronUp size={16} className="text-muted-foreground" />
            ) : (
              <ChevronDown size={16} className="text-muted-foreground" />
            )}
          </div>
        </button>
        {showExtras && (
          <div className="p-3 border-t border-border space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <DonutByArea from={from} to={to} type="realized" />
              <ForecastChart lawyerId={lawyerId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
