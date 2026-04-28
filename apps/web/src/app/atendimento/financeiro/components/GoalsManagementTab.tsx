'use client';

/**
 * Tela "Gestão de Metas" — aba dedicada do menu Financeiro.
 *
 * Layout:
 *  - Filtros no topo: ano, escopo (escritório/advogado/todos), tipo
 *    (realizada/contratada/todos)
 *  - Tabela: 12 linhas (uma por mês) × N colunas (meta, realizado, %, projeção)
 *  - Quando filtro=todos os escopos, mostra uma seção por escopo (Escritório,
 *    depois cada advogado), cada um com sua tabela de 12 meses
 *  - Botão "Definir meta" no canto superior direito (abre GoalsManagerModal)
 *  - Edição inline do valor da meta + apagar (soft delete)
 *
 * Permissões:
 *  - ASSOCIADO: vê apenas Escritório + a sua meta. Sem botão de editar/apagar.
 *  - ADMIN/FINANCEIRO: tudo. Pode editar/apagar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Target, Pencil, Trash2, Plus, Check, X, Loader2, ArrowUpRight,
  History, GitCompare, Sigma,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { useRole } from '@/lib/useRole';
import GoalsManagerModal from './GoalsManagerModal';
import GoalHistoryDrawer from './GoalHistoryDrawer';

type GoalKind = 'REALIZED' | 'CONTRACTED';
type GoalStatus = 'on_track' | 'warning' | 'behind' | 'achieved' | null;

interface GoalRow {
  id: string;
  year: number;
  month: number;
  kind: GoalKind;
  scope: 'OFFICE' | 'LAWYER';
  lawyerId: string | null;
  lawyerName: string | null;
  target: number;
  realized: number;
  progressPct: number;
  projection: number | null;
  status: GoalStatus;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface LawyerLite { id: string; name: string }

interface GoalsManagementTabProps {
  /** Lista de advogados — passada do page.tsx */
  lawyers: LawyerLite[];
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v || 0);

/* ──────────────────────────────────────────────────────────────
   Tab principal
────────────────────────────────────────────────────────────── */

export default function GoalsManagementTab({ lawyers }: GoalsManagementTabProps) {
  const { isAdmin, isFinanceiro } = useRole();
  const canEdit = isAdmin || isFinanceiro;

  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'OFFICE' | string>('ALL');
  const [kindFilter, setKindFilter] = useState<'ALL' | GoalKind>('ALL');

  // Toggles novos
  const [showYoy, setShowYoy] = useState(false);            // compara com ano anterior
  const [showCumulative, setShowCumulative] = useState(false); // mostra acumulado Q1-Q4 + ano

  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Drawer de historico
  const [historyContext, setHistoryContext] = useState<{
    scope: string; kind: GoalKind; year: number; month: number; label: string;
  } | null>(null);

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { year };
      if (scopeFilter !== 'ALL') params.scope = scopeFilter;
      if (kindFilter !== 'ALL') params.kind = kindFilter;
      const r = await api.get('/financeiro/goals', { params });
      setGoals(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      if (e?.response?.status !== 403) {
        showError('Erro ao carregar metas');
      }
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, [year, scopeFilter, kindFilter]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  // Agrupa por escopo (OFFICE primeiro, depois cada advogado)
  // Quando scopeFilter !== 'ALL', so 1 grupo aparece.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: GoalRow[] }>();
    for (const g of goals) {
      const key = g.scope === 'OFFICE' ? '__OFFICE__' : `lawyer:${g.lawyerId}`;
      const label = g.scope === 'OFFICE' ? 'Escritório' : g.lawyerName || 'Advogado';
      if (!map.has(key)) map.set(key, { label, rows: [] });
      map.get(key)!.rows.push(g);
    }
    // Ordena: escritorio primeiro, depois alfabetico
    return Array.from(map.entries())
      .sort(([ka], [kb]) => {
        if (ka === '__OFFICE__') return -1;
        if (kb === '__OFFICE__') return 1;
        return 0;
      })
      .map(([_, v]) => v);
  }, [goals]);

  return (
    <div className="space-y-4">
      {/* Header com filtros + botao */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-purple-400" />
          <h2 className="text-lg font-bold text-foreground">Gestão de Metas</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro Ano */}
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="px-2.5 py-1.5 text-[11px] bg-card border border-border rounded-lg focus:outline-none"
          >
            {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {/* Filtro Escopo */}
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[11px] bg-card border border-border rounded-lg focus:outline-none"
          >
            <option value="ALL">Todos os escopos</option>
            <option value="OFFICE">Escritório</option>
            <optgroup label="Por advogado">
              {lawyers.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </optgroup>
          </select>
          {/* Filtro Tipo */}
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as any)}
            className="px-2.5 py-1.5 text-[11px] bg-card border border-border rounded-lg focus:outline-none"
          >
            <option value="ALL">Todos os tipos</option>
            <option value="REALIZED">Realizada</option>
            <option value="CONTRACTED">Contratada</option>
          </select>
          {/* Toggle YoY (compara com ano anterior) */}
          <button
            onClick={() => setShowYoy((v) => !v)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border ${
              showYoy
                ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
            title="Compara com o ano anterior mes a mes"
          >
            <GitCompare size={11} /> YoY
          </button>
          {/* Toggle acumulado (Q1-Q4 + ano) */}
          <button
            onClick={() => setShowCumulative((v) => !v)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border ${
              showCumulative
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'bg-card border-border text-muted-foreground hover:text-foreground'
            }`}
            title="Mostra totais por trimestre e ano"
          >
            <Sigma size={11} /> Acumulado
          </button>
          {/* CTA Definir meta (admin only) */}
          {canEdit && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90"
            >
              <Plus size={11} /> Definir meta
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Loader2 size={20} className="inline animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty */}
      {!loading && goals.length === 0 && (
        <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
          <Target size={20} className="inline text-muted-foreground mb-2" />
          <div className="text-sm font-bold text-foreground">Nenhuma meta cadastrada</div>
          <div className="text-xs text-muted-foreground mt-1">
            {canEdit
              ? 'Use o botão "Definir meta" no topo direito para começar.'
              : 'Peça pro administrador cadastrar uma meta.'}
          </div>
        </div>
      )}

      {/* Sections por escopo */}
      {!loading &&
        groups.map((group) => (
          <ScopeSection
            key={group.label}
            label={group.label}
            scopeKey={group.rows[0]?.scope === 'OFFICE' ? 'OFFICE' : (group.rows[0]?.lawyerId || 'OFFICE')}
            rows={group.rows}
            year={year}
            kindFilter={kindFilter}
            canEdit={canEdit}
            showYoy={showYoy}
            showCumulative={showCumulative}
            onChanged={fetchGoals}
            onOpenHistory={(scope, kind, m, label) => setHistoryContext({ scope, kind, year, month: m, label })}
          />
        ))}

      {/* Modal pra cadastrar meta */}
      {showModal && (
        <GoalsManagerModal
          lawyers={lawyers}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            fetchGoals();
          }}
        />
      )}

      {/* Drawer historico de versoes */}
      {historyContext && (
        <GoalHistoryDrawer
          scope={historyContext.scope}
          kind={historyContext.kind}
          year={historyContext.year}
          month={historyContext.month}
          contextLabel={historyContext.label}
          onClose={() => setHistoryContext(null)}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Seção por escopo (Escritório, ou um advogado específico)
────────────────────────────────────────────────────────────── */

function ScopeSection({
  label, scopeKey, rows, year, kindFilter, canEdit, showYoy, showCumulative, onChanged, onOpenHistory,
}: {
  label: string;
  /** 'OFFICE' ou lawyerId */
  scopeKey: string;
  rows: GoalRow[];
  year: number;
  kindFilter: 'ALL' | GoalKind;
  canEdit: boolean;
  showYoy: boolean;
  showCumulative: boolean;
  onChanged: () => void;
  onOpenHistory: (scope: string, kind: GoalKind, month: number, label: string) => void;
}) {
  // YoY data — fetched on demand quando toggle habilitado
  const [yoyData, setYoyData] = useState<Array<{
    month: number;
    targetThis: number | null;
    targetPrev: number | null;
    realizedThis: number;
    realizedPrev: number;
    realizedDeltaPct: number | null;
  }> | null>(null);

  useEffect(() => {
    if (!showYoy) {
      setYoyData(null);
      return;
    }
    // Fetch pra cada kind ativo. Quando kindFilter='ALL', pegamos REALIZED como
    // padrao (mais relevante). Pra ver YoY de CONTRACTED, usuario filtra.
    const kindForYoy = kindFilter === 'ALL' ? 'REALIZED' : kindFilter;
    api
      .get('/financeiro/goals/yoy', { params: { year, scope: scopeKey, kind: kindForYoy } })
      .then((r) => setYoyData(r.data))
      .catch(() => { /* silencioso */ });
  }, [showYoy, year, scopeKey, kindFilter]);

  // Cumulative data
  const [cumulative, setCumulative] = useState<{
    quarters: Array<{ key: string; target: number; realized: number; progressPct: number | null }>;
    annual: { target: number; realized: number; progressPct: number | null };
  } | null>(null);

  useEffect(() => {
    if (!showCumulative) {
      setCumulative(null);
      return;
    }
    const kindForCum = kindFilter === 'ALL' ? 'REALIZED' : kindFilter;
    api
      .get('/financeiro/goals/cumulative', { params: { year, scope: scopeKey, kind: kindForCum } })
      .then((r) => setCumulative(r.data))
      .catch(() => { /* silencioso */ });
  }, [showCumulative, year, scopeKey, kindFilter]);

  // Agrupa rows por mês — pode ter 2 entries por mês quando kindFilter='ALL'
  // (uma de REALIZED + uma de CONTRACTED).
  const byMonth = useMemo(() => {
    const map = new Map<number, GoalRow[]>();
    for (const r of rows) {
      if (!map.has(r.month)) map.set(r.month, []);
      map.get(r.month)!.push(r);
    }
    return map;
  }, [rows]);

  // Total cadastrado + total realizado da seção
  const totals = useMemo(() => {
    let target = 0;
    let realized = 0;
    for (const r of rows) {
      if (kindFilter !== 'ALL' && r.kind !== kindFilter) continue;
      target += r.target;
      realized += r.realized;
    }
    return { target, realized };
  }, [rows, kindFilter]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">{label}</h3>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          Total {year}: <span className="text-foreground font-semibold">{fmt(totals.realized)}</span>
          <span className="opacity-60"> / </span>
          <span className="text-foreground font-semibold">{fmt(totals.target)}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 border-b border-border">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Mês</th>
              {kindFilter === 'ALL' && <th className="px-3 py-2 font-medium">Tipo</th>}
              <th className="px-3 py-2 font-medium text-right">Meta</th>
              <th className="px-3 py-2 font-medium text-right">Realizado</th>
              <th className="px-3 py-2 font-medium text-right">% atingido</th>
              <th className="px-3 py-2 font-medium text-right">Projeção</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {canEdit && <th className="px-3 py-2 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const monthRows = byMonth.get(m) || [];
              if (monthRows.length === 0) {
                return (
                  <tr key={m} className="border-b border-border/50">
                    <td className="px-3 py-2.5 text-foreground/60">{MONTH_NAMES[m - 1]}</td>
                    <td colSpan={(kindFilter === 'ALL' ? 1 : 0) + 5 + (canEdit ? 1 : 0)} className="px-3 py-2.5 text-[11px] text-muted-foreground italic">
                      Sem meta cadastrada
                    </td>
                  </tr>
                );
              }
              return monthRows.map((row, idx) => (
                <GoalTableRow
                  key={row.id}
                  row={row}
                  showMonth={idx === 0}
                  showKindCol={kindFilter === 'ALL'}
                  canEdit={canEdit}
                  onChanged={onChanged}
                  yoy={showYoy && yoyData ? yoyData.find((y) => y.month === m) : undefined}
                  scopeKey={scopeKey}
                  scopeLabel={label}
                  onOpenHistory={onOpenHistory}
                />
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* Acumulado: rodape com Q1-Q4 + ano (commit H) */}
      {showCumulative && cumulative && (
        <div className="border-t border-border bg-muted/10 p-3">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Acumulado {year}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {cumulative.quarters.map((q) => (
              <div key={q.key} className="bg-card rounded-lg p-2 text-center">
                <div className="text-[10px] text-muted-foreground">{q.key}</div>
                <div className="text-xs font-bold text-foreground tabular-nums">{fmt(q.realized)}</div>
                <div className="text-[10px] text-muted-foreground tabular-nums">/ {fmt(q.target)}</div>
                {q.progressPct !== null && (
                  <div className={`text-[10px] tabular-nums ${q.progressPct >= 100 ? 'text-emerald-400' : q.progressPct >= 80 ? 'text-emerald-400' : q.progressPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {q.progressPct.toFixed(0)}%
                  </div>
                )}
              </div>
            ))}
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2 text-center">
              <div className="text-[10px] text-emerald-400 font-bold">Ano</div>
              <div className="text-xs font-bold text-foreground tabular-nums">{fmt(cumulative.annual.realized)}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">/ {fmt(cumulative.annual.target)}</div>
              {cumulative.annual.progressPct !== null && (
                <div className={`text-[10px] tabular-nums ${cumulative.annual.progressPct >= 80 ? 'text-emerald-400' : cumulative.annual.progressPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {cumulative.annual.progressPct.toFixed(0)}%
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Linha da tabela (com edição inline + apagar)
────────────────────────────────────────────────────────────── */

function GoalTableRow({
  row, showMonth, showKindCol, canEdit, onChanged, yoy, scopeKey, scopeLabel, onOpenHistory,
}: {
  row: GoalRow;
  showMonth: boolean;
  showKindCol: boolean;
  canEdit: boolean;
  onChanged: () => void;
  yoy?: {
    month: number;
    targetThis: number | null;
    targetPrev: number | null;
    realizedThis: number;
    realizedPrev: number;
    realizedDeltaPct: number | null;
  };
  scopeKey: string;
  scopeLabel: string;
  onOpenHistory: (scope: string, kind: GoalKind, month: number, label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [valueStr, setValueStr] = useState(String(row.target));
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    const num = parseFloat(valueStr.replace(/[^\d,.-]/g, '').replace(',', '.'));
    if (isNaN(num) || num < 0) {
      showError('Valor inválido');
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/financeiro/goals/${row.id}`, { value: num });
      showSuccess('Meta atualizada');
      setEditing(false);
      onChanged();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao atualizar meta');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Apagar meta de ${MONTH_NAMES[row.month - 1]} (${kindLabel(row.kind)})?`)) return;
    setSubmitting(true);
    try {
      await api.delete(`/financeiro/goals/${row.id}`);
      showSuccess('Meta apagada');
      onChanged();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao apagar meta');
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = badgeForStatus(row.status);

  return (
    <tr className="border-b border-border/50 hover:bg-accent/10 transition-colors">
      <td className="px-3 py-2.5 text-foreground">
        {showMonth ? MONTH_NAMES[row.month - 1] : ''}
      </td>
      {showKindCol && (
        <td className="px-3 py-2.5 text-muted-foreground">{kindLabel(row.kind)}</td>
      )}

      {/* Meta — editavel inline */}
      <td className="px-3 py-2.5 text-right">
        {editing ? (
          <input
            type="text"
            value={valueStr}
            onChange={(e) => setValueStr(e.target.value)}
            autoFocus
            className="w-28 px-2 py-1 text-xs bg-background border border-primary rounded tabular-nums text-right focus:outline-none"
          />
        ) : (
          <span className="text-foreground font-semibold tabular-nums">{fmt(row.target)}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right text-foreground tabular-nums">
        {fmt(row.realized)}
        {/* YoY: mostra delta abaixo do realizado quando habilitado */}
        {yoy && yoy.realizedDeltaPct !== null && (
          <div
            className={`text-[10px] ${
              yoy.realizedDeltaPct > 2 ? 'text-emerald-400' : yoy.realizedDeltaPct < -2 ? 'text-red-400' : 'text-muted-foreground'
            }`}
            title={`Ano anterior: ${fmt(yoy.realizedPrev)}`}
          >
            {yoy.realizedDeltaPct > 0 ? '▲' : yoy.realizedDeltaPct < 0 ? '▼' : '—'}{' '}
            {yoy.realizedDeltaPct > 0 ? '+' : ''}
            {yoy.realizedDeltaPct.toFixed(1)}% YoY
          </div>
        )}
        {yoy && yoy.realizedDeltaPct === null && yoy.realizedPrev === 0 && (
          <div className="text-[10px] text-muted-foreground">— sem base anterior</div>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        <span className={statusBadge.textColor}>{row.progressPct.toFixed(1)}%</span>
      </td>
      <td className="px-3 py-2.5 text-right text-cyan-400 tabular-nums">
        {row.projection !== null ? (
          <span title="Projeção de fechamento baseada no ritmo atual">
            {fmt(row.projection)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusBadge.bg} ${statusBadge.textColor}`}>
          {statusBadge.label}
        </span>
      </td>

      {canEdit && (
        <td className="px-3 py-2.5">
          {editing ? (
            <div className="flex items-center gap-1">
              <button
                disabled={submitting}
                onClick={handleSave}
                className="p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                title="Salvar"
              >
                {submitting ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setValueStr(String(row.target));
                }}
                className="p-1 rounded bg-muted hover:bg-muted/70 text-muted-foreground"
                title="Cancelar"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground"
                title="Editar valor"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={() =>
                  onOpenHistory(
                    scopeKey,
                    row.kind,
                    row.month,
                    `${MONTH_NAMES[row.month - 1]}/${row.year} — ${scopeLabel}, ${kindLabel(row.kind)}`,
                  )
                }
                className="p-1 rounded hover:bg-accent/30 text-muted-foreground hover:text-purple-400"
                title="Ver histórico de versões desta meta"
              >
                <History size={11} />
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 disabled:opacity-50"
                title="Apagar meta"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */

function kindLabel(k: GoalKind): string {
  return k === 'REALIZED' ? 'Realizada' : 'Contratada';
}

function badgeForStatus(status: GoalStatus): { label: string; bg: string; textColor: string } {
  switch (status) {
    case 'achieved':
      return { label: '🎯 Atingida', bg: 'bg-emerald-500/15', textColor: 'text-emerald-400' };
    case 'on_track':
      return { label: 'No alvo', bg: 'bg-emerald-500/10', textColor: 'text-emerald-400' };
    case 'warning':
      return { label: 'Atenção', bg: 'bg-amber-500/10', textColor: 'text-amber-400' };
    case 'behind':
      return { label: 'Distante', bg: 'bg-red-500/10', textColor: 'text-red-400' };
    default:
      return { label: '—', bg: 'bg-muted/30', textColor: 'text-muted-foreground' };
  }
}
