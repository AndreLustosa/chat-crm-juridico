'use client';

/**
 * Cockpit Extras — Fase 3 (P1) do redesign do dashboard.
 *
 * Componentes adicionais que aparecem após o usuário expandir "Análise
 * detalhada" no DashboardCockpit. Lazy-load: o fetch só dispara quando
 * o usuário expande a seção, mantendo o first-fold leve.
 *
 * Inclui:
 *  - GoalEditor: edita ou cadastra meta do mês inline (admin only)
 *  - DonutByArea: receita por área jurídica (donut SVG)
 *  - ForecastChart: 90 dias agrupado por semana com cenários
 *  - ExportButton: exporta dashboard em PDF (jspdf) ou CSV
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Pencil,
  PieChart,
  TrendingUp,
  Download,
  FileText,
  Sheet,
  Loader2,
  Check,
  X,
  Target,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */

interface AreaSlice {
  area: string;
  total: number;
}

interface ForecastBucket {
  from: string;
  to: string;
  expected: number;
  raw: number;
}

interface ForecastResult {
  scenario: string;
  days: number;
  buckets: ForecastBucket[];
  summary: { raw: number; expected: number; factor: number };
}

interface MonthlyGoal {
  id: string;
  tenant_id: string | null;
  year: number;
  month: number;
  value: string | number;
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v || 0);

const fmtDateShort = (s: string) => {
  const dt = new Date(s);
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Paleta para slices do donut
const AREA_COLORS = [
  '#10b981', '#3b82f6', '#a855f7', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#8b5cf6',
];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/* ──────────────────────────────────────────────────────────────
   GoalEditor — admin edita meta do mês
────────────────────────────────────────────────────────────── */

export function GoalEditor({
  isAdmin,
  onSaved,
}: {
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [month, setMonth] = useState(new Date().getUTCMonth() + 1);
  const [value, setValue] = useState('');
  const [propagate, setPropagate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<MonthlyGoal | null>(null);

  const loadCurrent = useCallback(async () => {
    try {
      const r = await api.get('/financeiro/dashboard/goals', { params: { year } });
      const found = (r.data as MonthlyGoal[]).find((g) => g.month === month) || null;
      setExisting(found);
      if (found) setValue(String(Number(found.value)));
    } catch {
      // silencioso — sem meta ainda
    }
  }, [year, month]);

  useEffect(() => {
    if (editing) loadCurrent();
  }, [editing, loadCurrent]);

  if (!isAdmin) return null;

  const handleSave = async () => {
    const num = parseFloat(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    if (isNaN(num) || num < 0) {
      showError('Valor inválido');
      return;
    }
    setSaving(true);
    try {
      await api.post('/financeiro/dashboard/goals', {
        year,
        month: propagate ? undefined : month,
        value: num,
        propagate,
      });
      showSuccess(propagate ? `Meta de ${fmt(num)} salva pros 12 meses de ${year}` : `Meta de ${MONTH_NAMES[month - 1]} salva: ${fmt(num)}`);
      setEditing(false);
      onSaved();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar meta');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-[10px] font-bold text-purple-400 hover:text-purple-300 hover:underline"
      >
        <Pencil size={10} /> Editar meta
      </button>
    );
  }

  return (
    <div className="bg-card border border-purple-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Target size={14} className="text-purple-400" />
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
          {existing ? 'Editar' : 'Cadastrar'} meta
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Ano</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value) || year)}
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Mês</label>
          <select
            value={month}
            disabled={propagate}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary disabled:opacity-50"
          >
            {MONTH_NAMES.map((n, i) => (
              <option key={i} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Valor (R$)</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="50000.00"
          className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary tabular-nums"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={propagate}
          onChange={(e) => setPropagate(e.target.checked)}
          className="rounded border-border"
        />
        <span>Aplicar pros 12 meses do ano</span>
      </label>

      <div className="flex items-center gap-2">
        <button
          disabled={saving}
          onClick={handleSave}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-xs font-bold disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Salvar
        </button>
        <button
          onClick={() => setEditing(false)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-muted-foreground text-xs"
        >
          <X size={12} /> Cancelar
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   DonutByArea
────────────────────────────────────────────────────────────── */

export function DonutByArea({
  from,
  to,
  type = 'realized',
}: {
  from: string;
  to: string;
  type?: 'realized' | 'contracted';
}) {
  const [data, setData] = useState<AreaSlice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'realized' | 'contracted'>(type);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/financeiro/dashboard/by-area', { params: { from, to, type: mode } })
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch(() => {
        if (!cancelled) showError('Erro ao carregar análise por área');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, mode]);

  const total = data?.reduce((acc, s) => acc + s.total, 0) || 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <PieChart size={14} className="text-violet-400" />
          <h3 className="text-sm font-bold text-foreground">Receita por área</h3>
        </div>
        <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5">
          <button
            onClick={() => setMode('realized')}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              mode === 'realized' ? 'bg-card text-foreground' : 'text-muted-foreground'
            }`}
          >
            Realizada
          </button>
          <button
            onClick={() => setMode('contracted')}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              mode === 'contracted' ? 'bg-card text-foreground' : 'text-muted-foreground'
            }`}
          >
            Contratada
          </button>
        </div>
      </div>

      {loading && (
        <div className="h-48 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && (!data || data.length === 0) && (
        <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
          Sem dados no período
        </div>
      )}

      {!loading && data && data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          <DonutSvg data={data} />
          <div className="space-y-1.5">
            {data.slice(0, 8).map((slice, i) => {
              const pct = total > 0 ? (slice.total / total) * 100 : 0;
              return (
                <div key={slice.area} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: AREA_COLORS[i % AREA_COLORS.length] }}
                    />
                    <span className="text-foreground truncate">{slice.area}</span>
                  </div>
                  <div className="text-right tabular-nums shrink-0 ml-2">
                    <div className="text-foreground font-bold">{fmt(slice.total)}</div>
                    <div className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DonutSvg({ data }: { data: AreaSlice[] }) {
  const size = 160;
  const radius = 60;
  const strokeWidth = 28;
  const cx = size / 2;
  const cy = size / 2;
  const total = data.reduce((acc, s) => acc + s.total, 0);

  if (total === 0) return null;

  let cumulative = 0;
  const segments = data.slice(0, AREA_COLORS.length).map((slice, i) => {
    const value = slice.total / total;
    const startAngle = cumulative * 360 - 90;
    const endAngle = (cumulative + value) * 360 - 90;
    cumulative += value;

    const start = polarToCartesian(cx, cy, radius, endAngle);
    const end = polarToCartesian(cx, cy, radius, startAngle);
    const largeArc = value > 0.5 ? 1 : 0;
    const path = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;

    return (
      <path
        key={slice.area}
        d={path}
        fill="none"
        stroke={AREA_COLORS[i % AREA_COLORS.length]}
        strokeWidth={strokeWidth}
        strokeLinecap="butt"
      />
    );
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-40 h-40 mx-auto">
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} opacity={0.2} />
      {segments}
      <text x={cx} y={cy - 6} textAnchor="middle" className="fill-foreground text-[11px] font-bold">
        Total
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" className="fill-foreground text-[10px] tabular-nums">
        {fmt(total)}
      </text>
    </svg>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/* ──────────────────────────────────────────────────────────────
   ForecastChart
────────────────────────────────────────────────────────────── */

export function ForecastChart({ lawyerId }: { lawyerId: string }) {
  const [scenario, setScenario] = useState<'optimistic' | 'realistic' | 'pessimistic'>('realistic');
  const [days, setDays] = useState(90);
  const [data, setData] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/financeiro/dashboard/forecast', {
        params: { days, scenario, lawyerId: lawyerId || undefined },
      })
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch(() => {
        if (!cancelled) showError('Erro ao carregar projeção');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, scenario, lawyerId]);

  const max = data ? Math.max(...data.buckets.map((b) => Math.max(b.expected, b.raw)), 1) : 1;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-cyan-400" />
          <h3 className="text-sm font-bold text-foreground">Projeção {days} dias</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as any)}
            className="px-2 py-1 text-[11px] bg-background border border-border rounded focus:outline-none"
          >
            <option value="optimistic">Otimista (100%)</option>
            <option value="realistic">Realista (85%)</option>
            <option value="pessimistic">Pessimista (60%)</option>
          </select>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="px-2 py-1 text-[11px] bg-background border border-border rounded focus:outline-none"
          >
            <option value={30}>30d</option>
            <option value={60}>60d</option>
            <option value={90}>90d</option>
            <option value={180}>180d</option>
          </select>
        </div>
      </div>

      {loading && (
        <div className="h-48 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-[10px] text-muted-foreground">Bruto</div>
              <div className="text-sm font-bold text-foreground tabular-nums">{fmt(data.summary.raw)}</div>
            </div>
            <div className="bg-cyan-500/10 rounded-lg p-2">
              <div className="text-[10px] text-cyan-400">Esperado</div>
              <div className="text-sm font-bold text-cyan-400 tabular-nums">{fmt(data.summary.expected)}</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-[10px] text-muted-foreground">Fator</div>
              <div className="text-sm font-bold text-foreground tabular-nums">{(data.summary.factor * 100).toFixed(0)}%</div>
            </div>
          </div>

          <div className="space-y-1.5">
            {data.buckets.map((b, i) => (
              <div key={`${b.from}-${i}`} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground tabular-nums">
                    {fmtDateShort(b.from)} → {fmtDateShort(b.to)}
                  </span>
                  <span className="text-cyan-400 font-bold tabular-nums">
                    {fmt(b.expected)}
                  </span>
                </div>
                <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-muted-foreground/30 rounded-full"
                    style={{ width: `${(b.raw / max) * 100}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-cyan-400/70 rounded-full"
                    style={{ width: `${(b.expected / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground mt-3 italic">
            Barra clara = valor bruto a vencer · barra colorida = esperado pelo cenário
          </p>
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   ExportButton — PDF (jspdf) ou CSV
────────────────────────────────────────────────────────────── */

export function ExportButton({
  from,
  to,
  lawyerId,
}: {
  from: string;
  to: string;
  lawyerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchAllData = useCallback(async () => {
    const [kpisRes, byLawyerRes, agingRes, byAreaRes] = await Promise.all([
      api.get('/financeiro/dashboard/kpis', { params: { from, to, lawyerId: lawyerId || undefined } }),
      api.get('/financeiro/dashboard/by-lawyer', { params: { from, to } }),
      api.get('/financeiro/dashboard/aging', { params: { lawyerId: lawyerId || undefined } }),
      api.get('/financeiro/dashboard/by-area', { params: { from, to, type: 'realized' } }),
    ]);
    return {
      kpis: kpisRes.data,
      byLawyer: byLawyerRes.data,
      aging: agingRes.data,
      byArea: byAreaRes.data,
    };
  }, [from, to, lawyerId]);

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const { kpis, byLawyer, aging, byArea } = await fetchAllData();
      // Import dinamico pra nao inflar o bundle
      const jsPDF = (await import('jspdf')).default;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });

      const fromDate = fmtDateShort(from);
      const toDate = fmtDateShort(to);

      let y = 50;
      doc.setFontSize(16);
      doc.text('Dashboard Financeiro', 40, y);
      y += 18;
      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text(`Período: ${fromDate} a ${toDate}`, 40, y);
      y += 24;

      // KPIs
      doc.setTextColor(0);
      doc.setFontSize(12);
      doc.text('Indicadores principais', 40, y);
      y += 16;
      doc.setFontSize(10);
      const kpiLines: Array<[string, string]> = [
        ['Receita realizada', fmt(kpis.revenue.value)],
        ['Despesas pagas', fmt(kpis.expenses.value)],
        ['Saldo', fmt(kpis.balance.value)],
        ['A receber', fmt(kpis.receivable.value)],
        ['Atrasado', fmt(kpis.overdue.value)],
      ];
      kpiLines.forEach(([label, val]) => {
        doc.text(`${label}: ${val}`, 50, y);
        y += 14;
      });
      y += 10;

      // Por advogado
      if (byLawyer.length > 0) {
        doc.setFontSize(12);
        doc.text('Receita por advogado', 40, y);
        y += 16;
        doc.setFontSize(10);
        byLawyer.slice(0, 10).forEach((l: any) => {
          doc.text(`${l.lawyerName}: ${fmt(l.revenue)}`, 50, y);
          y += 14;
          if (y > 760) {
            doc.addPage();
            y = 50;
          }
        });
        y += 10;
      }

      // Aging
      doc.setFontSize(12);
      doc.text('Aging — parcelas em aberto', 40, y);
      y += 16;
      doc.setFontSize(10);
      aging.forEach((b: any) => {
        doc.text(`${b.label}: ${fmt(b.total)} (${b.count} parcelas)`, 50, y);
        y += 14;
      });
      y += 10;

      // Por área
      if (byArea.length > 0) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        doc.setFontSize(12);
        doc.text('Receita por área jurídica', 40, y);
        y += 16;
        doc.setFontSize(10);
        byArea.forEach((a: any) => {
          doc.text(`${a.area}: ${fmt(a.total)}`, 50, y);
          y += 14;
          if (y > 760) {
            doc.addPage();
            y = 50;
          }
        });
      }

      doc.save(`dashboard-financeiro-${fromDate.replace('/', '-')}-${toDate.replace('/', '-')}.pdf`);
      showSuccess('PDF exportado com sucesso');
    } catch (e) {
      showError('Erro ao exportar PDF');
    } finally {
      setExporting(false);
      setOpen(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const { kpis, byLawyer, aging, byArea } = await fetchAllData();
      const lines: string[] = [];
      lines.push('Dashboard Financeiro');
      lines.push(`Periodo,${fmtDateShort(from)} a ${fmtDateShort(to)}`);
      lines.push('');
      lines.push('Indicador,Valor');
      lines.push(`Receita realizada,${kpis.revenue.value}`);
      lines.push(`Despesas pagas,${kpis.expenses.value}`);
      lines.push(`Saldo,${kpis.balance.value}`);
      lines.push(`A receber,${kpis.receivable.value}`);
      lines.push(`Atrasado,${kpis.overdue.value}`);
      lines.push('');
      lines.push('Receita por advogado');
      lines.push('Advogado,Receita');
      byLawyer.forEach((l: any) => lines.push(`${escapeCsv(l.lawyerName)},${l.revenue}`));
      lines.push('');
      lines.push('Aging');
      lines.push('Bucket,Total,Parcelas');
      aging.forEach((b: any) => lines.push(`${escapeCsv(b.label)},${b.total},${b.count}`));
      lines.push('');
      lines.push('Receita por area');
      lines.push('Area,Total');
      byArea.forEach((a: any) => lines.push(`${escapeCsv(a.area)},${a.total}`));

      const csv = lines.join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dashboard-financeiro-${fmtDateShort(from).replace('/', '-')}-${fmtDateShort(to).replace('/', '-')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      showSuccess('CSV exportado com sucesso');
    } catch (e) {
      showError('Erro ao exportar CSV');
    } finally {
      setExporting(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-accent/30 border border-border text-xs font-semibold text-foreground disabled:opacity-50"
      >
        {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        Exportar
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-10 min-w-[140px]">
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/30 text-foreground"
          >
            <FileText size={12} className="text-red-400" /> PDF
          </button>
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/30 text-foreground border-t border-border"
          >
            <Sheet size={12} className="text-emerald-400" /> CSV (Excel)
          </button>
        </div>
      )}
    </div>
  );
}

function escapeCsv(s: string): string {
  if (s == null) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
