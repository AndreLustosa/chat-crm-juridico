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
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { useRole } from '@/lib/useRole';
import GoalsManagerModal from './GoalsManagerModal';

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

  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

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
            rows={group.rows}
            year={year}
            kindFilter={kindFilter}
            canEdit={canEdit}
            onChanged={fetchGoals}
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
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Seção por escopo (Escritório, ou um advogado específico)
────────────────────────────────────────────────────────────── */

function ScopeSection({
  label, rows, year, kindFilter, canEdit, onChanged,
}: {
  label: string;
  rows: GoalRow[];
  year: number;
  kindFilter: 'ALL' | GoalKind;
  canEdit: boolean;
  onChanged: () => void;
}) {
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
                />
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Linha da tabela (com edição inline + apagar)
────────────────────────────────────────────────────────────── */

function GoalTableRow({
  row, showMonth, showKindCol, canEdit, onChanged,
}: {
  row: GoalRow;
  showMonth: boolean;
  showKindCol: boolean;
  canEdit: boolean;
  onChanged: () => void;
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
      <td className="px-3 py-2.5 text-right text-foreground tabular-nums">{fmt(row.realized)}</td>
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
