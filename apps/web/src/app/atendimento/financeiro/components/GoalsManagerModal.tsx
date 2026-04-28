'use client';

/**
 * Modal "Definir meta" — 3 abas:
 *  1. Mês único: cadastra meta de um mes especifico
 *  2. Ano inteiro: divide um valor anual em 12 meses iguais
 *  3. Replicar N meses: repete o mesmo valor pra N meses sequenciais
 *
 * Campos comuns: escopo (escritorio | advogado), tipo (REALIZED | CONTRACTED |
 * BOTH), valor.
 *
 * Antes de salvar, chama POST /financeiro/goals/check-conflicts pra detectar
 * metas existentes que serao sobrescritas. Se houver conflito, mostra dialog
 * de confirmacao antes de submeter com overwriteConfirmed=true.
 */

import { useEffect, useState } from 'react';
import { X, Check, ChevronRight, Loader2, Info, AlertTriangle, Calendar, Copy } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */

export type GoalKind = 'REALIZED' | 'CONTRACTED';
export type GoalKindOption = 'REALIZED' | 'CONTRACTED' | 'BOTH';
export type GoalScope = 'OFFICE' | string; // 'OFFICE' ou lawyer UUID
type Mode = 'single' | 'yearly' | 'replicate';

interface LawyerOption {
  id: string;
  name: string;
}

interface ConflictPreview {
  id: string;
  year: number;
  month: number;
  kind: GoalKind;
  currentValue: number;
}

interface GoalsManagerModalProps {
  /** Lista de advogados — apenas ADMIN/FINANCEIRO pode escolher escopo individual */
  lawyers?: LawyerOption[];
  /** Pre-seleciona escopo (ex: vem do filtro de advogado do dashboard) */
  defaultScope?: GoalScope;
  /** Pre-seleciona tipo */
  defaultKind?: GoalKindOption;
  onClose: () => void;
  onSaved: () => void;
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v || 0);

/* ──────────────────────────────────────────────────────────────
   Modal
────────────────────────────────────────────────────────────── */

export default function GoalsManagerModal({
  lawyers = [],
  defaultScope = 'OFFICE',
  defaultKind = 'REALIZED',
  onClose,
  onSaved,
}: GoalsManagerModalProps) {
  const [mode, setMode] = useState<Mode>('single');

  // Campos comuns
  const [scope, setScope] = useState<GoalScope>(defaultScope);
  const [kind, setKind] = useState<GoalKindOption>(defaultKind);
  const [valueStr, setValueStr] = useState('');

  // Campos específicos
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [monthsToReplicate, setMonthsToReplicate] = useState(6);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictPreview[] | null>(null);

  const valueNum = parseFloat(valueStr.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;

  // ESC fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // ─── Validacao ───────────────────────────────────────

  const errors: string[] = [];
  if (valueNum <= 0) errors.push('Informe um valor maior que zero');
  if (year < 2024 || year > 2099) errors.push('Ano inválido');
  if (mode === 'single' && (month < 1 || month > 12)) errors.push('Mês inválido');
  if (mode === 'replicate') {
    if (month < 1 || month > 12) errors.push('Mês inicial inválido');
    if (monthsToReplicate < 1 || monthsToReplicate > 24) errors.push('Quantidade de meses entre 1 e 24');
  }

  // ─── Submit ──────────────────────────────────────────

  const buildPayload = (overwriteConfirmed = false) => ({
    scope,
    kind,
    value: valueNum,
    mode,
    year,
    ...(mode !== 'yearly' ? { month } : {}),
    ...(mode === 'replicate' ? { monthsToReplicate } : {}),
    overwriteConfirmed,
  });

  const handleSave = async () => {
    if (errors.length > 0) {
      showError(errors[0]);
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post('/financeiro/goals', buildPayload(false));
      if (r.data?.requiresConfirmation) {
        // Mostra dialog de conflito
        setConflicts(r.data.conflicts);
      } else {
        showSuccess(buildSuccessMessage(r.data));
        onSaved();
      }
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar meta');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmOverwrite = async () => {
    setSubmitting(true);
    try {
      const r = await api.post('/financeiro/goals', buildPayload(true));
      showSuccess(buildSuccessMessage(r.data));
      onSaved();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar meta');
    } finally {
      setSubmitting(false);
    }
  };

  const buildSuccessMessage = (data: any) => {
    const created = data?.created || 0;
    const replaced = data?.replaced || 0;
    const partes: string[] = [];
    if (created > 0) partes.push(`${created} meta(s) criada(s)`);
    if (replaced > 0) partes.push(`${replaced} sobrescrita(s)`);
    return partes.join(' · ') || 'Meta salva';
  };

  // ─── Render principal ────────────────────────────────

  if (conflicts) {
    return (
      <ConflictsDialog
        conflicts={conflicts}
        kind={kind}
        scope={scope}
        lawyers={lawyers}
        onConfirm={handleConfirmOverwrite}
        onCancel={() => setConflicts(null)}
        submitting={submitting}
      />
    );
  }

  const scopeLabel = scope === 'OFFICE'
    ? 'Escritório (todos)'
    : lawyers.find((l) => l.id === scope)?.name || 'Advogado';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 z-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-foreground">Definir meta</h2>
            <button
              onClick={onClose}
              disabled={submitting}
              className="p-1 rounded hover:bg-accent/30 text-muted-foreground hover:text-foreground"
              title="Fechar (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tabs de modo */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
            {(['single', 'yearly', 'replicate'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                  mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'single' && '1. Mês único'}
                {m === 'yearly' && '2. Ano inteiro'}
                {m === 'replicate' && '3. Replicar N meses'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Escopo */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Escopo</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
            >
              <option value="OFFICE">Escritório (todos os advogados)</option>
              {lawyers.length > 0 && <optgroup label="Por advogado">
                {lawyers.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </optgroup>}
            </select>
          </div>

          {/* Tipo de meta */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
              Tipo de meta
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'REALIZED', label: 'Realizada', hint: 'Caixa entrou' },
                { key: 'CONTRACTED', label: 'Contratada', hint: 'Vendido no mês' },
                { key: 'BOTH', label: 'Ambas', hint: 'Mesmo valor para as 2' },
              ] as Array<{ key: GoalKindOption; label: string; hint: string }>).map((opt) => (
                <label
                  key={opt.key}
                  className={`block p-2.5 border rounded-lg cursor-pointer transition-colors text-center ${
                    kind === opt.key
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/20'
                  }`}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={opt.key}
                    checked={kind === opt.key}
                    onChange={() => setKind(opt.key)}
                    className="sr-only"
                  />
                  <div className="text-xs font-bold text-foreground">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground">{opt.hint}</div>
                </label>
              ))}
            </div>
          </div>

          {/* Valor */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
              Valor (R$)
            </label>
            <input
              type="text"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              placeholder={mode === 'yearly' ? '720000.00 (será dividido em 12)' : '60000.00'}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg tabular-nums focus:outline-none focus:border-primary"
            />
            {valueNum > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1">
                {fmt(valueNum)}
                {mode === 'yearly' && (
                  <span className="ml-2">→ {fmt(valueNum / 12)} por mês</span>
                )}
              </div>
            )}
          </div>

          {/* Campos por modo */}
          {mode === 'single' && (
            <SingleMonthFields year={year} setYear={setYear} month={month} setMonth={setMonth} />
          )}
          {mode === 'yearly' && (
            <YearlyFields year={year} setYear={setYear} valueNum={valueNum} />
          )}
          {mode === 'replicate' && (
            <ReplicateFields
              year={year}
              setYear={setYear}
              month={month}
              setMonth={setMonth}
              monthsToReplicate={monthsToReplicate}
              setMonthsToReplicate={setMonthsToReplicate}
            />
          )}

          {/* Resumo do que vai acontecer */}
          <div className="bg-muted/30 rounded-lg p-3 text-[11px] text-muted-foreground">
            <div className="flex items-start gap-2">
              <Info size={11} className="mt-0.5 shrink-0" />
              <div>
                {buildSummary({ mode, year, month, monthsToReplicate, valueNum, kind, scopeLabel })}
              </div>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 space-y-1">
              {errors.map((e, i) => (
                <div key={i} className="text-[11px] text-red-400">• {e}</div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-accent/30 text-xs font-semibold disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={submitting || errors.length > 0}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold disabled:opacity-50"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Sub-fields por modo
────────────────────────────────────────────────────────────── */

function SingleMonthFields({ year, setYear, month, setMonth }: any) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Mês</label>
        <select
          value={month}
          onChange={(e) => setMonth(parseInt(e.target.value))}
          className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
        >
          {MONTH_NAMES.map((n, i) => (
            <option key={i} value={i + 1}>{n}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Ano</label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value) || year)}
          className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary tabular-nums"
        />
      </div>
    </div>
  );
}

function YearlyFields({ year, setYear, valueNum }: any) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Ano</label>
      <input
        type="number"
        value={year}
        onChange={(e) => setYear(parseInt(e.target.value) || year)}
        className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary tabular-nums"
      />
      <div className="text-[11px] text-muted-foreground mt-2 flex items-start gap-2">
        <Calendar size={11} className="mt-0.5 shrink-0" />
        <span>
          Vamos dividir esse valor igualmente nos 12 meses
          {valueNum > 0 && ` (${fmt(valueNum / 12)}/mês)`}.
        </span>
      </div>
    </div>
  );
}

function ReplicateFields({ year, setYear, month, setMonth, monthsToReplicate, setMonthsToReplicate }: any) {
  // Calcula mes final pra texto explicativo
  let endY = year;
  let endM = month + monthsToReplicate - 1;
  if (endM > 12) {
    endY += Math.floor((endM - 1) / 12);
    endM = ((endM - 1) % 12) + 1;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Mês inicial</label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
          >
            {MONTH_NAMES.map((n, i) => (
              <option key={i} value={i + 1}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Ano</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value) || year)}
            className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary tabular-nums"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Repetir por</label>
          <input
            type="number"
            min="1"
            max="24"
            value={monthsToReplicate}
            onChange={(e) => setMonthsToReplicate(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary tabular-nums"
          />
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground flex items-start gap-2">
        <Copy size={11} className="mt-0.5 shrink-0" />
        <span>
          Vamos criar metas iguais de <strong>{MONTH_NAMES[month - 1]}/{year}</strong> até{' '}
          <strong>{MONTH_NAMES[endM - 1]}/{endY}</strong> ({monthsToReplicate} meses).
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Resumo textual
────────────────────────────────────────────────────────────── */

function buildSummary({ mode, year, month, monthsToReplicate, valueNum, kind, scopeLabel }: any): string {
  if (valueNum <= 0) return 'Informe um valor para ver o resumo.';
  const valueLabel = fmt(valueNum);

  const kindLabel = kind === 'BOTH' ? 'Realizada + Contratada' : kind === 'REALIZED' ? 'Realizada' : 'Contratada';
  const recordsCreated = kind === 'BOTH' ? 2 : 1;

  if (mode === 'single') {
    return `Vai cadastrar ${recordsCreated} meta(s) [${kindLabel}] de ${valueLabel} em ${MONTH_NAMES[month - 1]}/${year} para ${scopeLabel}.`;
  }
  if (mode === 'yearly') {
    const perMonth = valueNum / 12;
    return `Vai cadastrar ${12 * recordsCreated} meta(s) [${kindLabel}] no ano de ${year} (${fmt(perMonth)} por mês) para ${scopeLabel}.`;
  }
  return `Vai cadastrar ${monthsToReplicate * recordsCreated} meta(s) [${kindLabel}] de ${valueLabel} cada, a partir de ${MONTH_NAMES[month - 1]}/${year}, para ${scopeLabel}.`;
}

/* ──────────────────────────────────────────────────────────────
   Dialog de conflito (sobrescrita)
────────────────────────────────────────────────────────────── */

function ConflictsDialog({
  conflicts, kind, scope, lawyers, onConfirm, onCancel, submitting,
}: {
  conflicts: ConflictPreview[];
  kind: GoalKindOption;
  scope: GoalScope;
  lawyers: LawyerOption[];
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const scopeLabel = scope === 'OFFICE' ? 'Escritório' : lawyers.find((l) => l.id === scope)?.name || 'Advogado';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-amber-500/30 rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <h2 className="text-base font-bold text-foreground">Sobrescrever metas existentes?</h2>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Já existem <strong>{conflicts.length}</strong> meta(s) cadastrada(s) para{' '}
            <strong>{scopeLabel}</strong> nos meses abaixo. Confirmar vai marcar essas metas
            como apagadas (soft delete) e criar as novas com o valor que você informou.
          </p>

          <div className="bg-muted/30 rounded-lg p-3 max-h-64 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left pb-1">Mês</th>
                  <th className="text-left pb-1">Tipo</th>
                  <th className="text-right pb-1">Valor atual</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={c.id} className="border-t border-border/50">
                    <td className="py-1 text-foreground">{MONTH_NAMES[c.month - 1]}/{c.year}</td>
                    <td className="py-1 text-muted-foreground">{c.kind === 'REALIZED' ? 'Realizada' : 'Contratada'}</td>
                    <td className="py-1 text-right text-foreground tabular-nums">{fmt(c.currentValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-accent/30 text-xs font-semibold disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 text-xs font-semibold disabled:opacity-50"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Sobrescrever
          </button>
        </div>
      </div>
    </div>
  );
}
