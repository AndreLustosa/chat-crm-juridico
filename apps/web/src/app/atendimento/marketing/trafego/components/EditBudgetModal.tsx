'use client';

import { useEffect, useState } from 'react';
import { Loader2, X, DollarSign, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(v || 0);

/**
 * Modal de edição do orçamento diário de uma campanha. Reusável entre
 * CampanhasTab (modal central) e a página de detalhe.
 *
 * Validação:
 *   - mínimo R$1 (Google rejeita abaixo)
 *   - máximo R$10.000/dia (sanity check — não há limite hard do Google
 *     mas evita digitação errada como R$3000 quando queria R$30)
 *   - delta vs atual em destaque quando >50% (pra evitar shock change)
 *
 * UX: preview do gasto mensal estimado embaixo do input + alerta visual
 * quando mudança é grande.
 */
export function EditBudgetModal({
  open,
  campaignId,
  campaignName,
  currentBudgetBrl,
  onClose,
  onSaved,
}: {
  open: boolean;
  campaignId: string | null;
  campaignName: string;
  currentBudgetBrl: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [budgetInput, setBudgetInput] = useState('');
  const [reason, setReason] = useState('');
  const [validateOnly, setValidateOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Hidrata input quando modal abre
  useEffect(() => {
    if (open) {
      setBudgetInput(currentBudgetBrl?.toString() ?? '');
      setReason('');
      setValidateOnly(false);
    }
  }, [open, currentBudgetBrl]);

  if (!open || !campaignId) return null;

  const newAmount = parseFloat(budgetInput.replace(',', '.'));
  const isValid = Number.isFinite(newAmount) && newAmount >= 1 && newAmount <= 10000;
  const monthlyEstimate = isValid ? newAmount * 30 : 0;

  const deltaPct =
    isValid && currentBudgetBrl && currentBudgetBrl > 0
      ? (newAmount - currentBudgetBrl) / currentBudgetBrl
      : null;
  const isLargeChange = deltaPct !== null && Math.abs(deltaPct) > 0.5;
  const hasChanged =
    isValid &&
    currentBudgetBrl !== null &&
    Math.abs(newAmount - currentBudgetBrl) > 0.005;

  async function submit() {
    if (!isValid) {
      showError('Valor diário precisa estar entre R$ 1 e R$ 10.000.');
      return;
    }
    if (!campaignId) return;
    setSubmitting(true);
    try {
      await api.patch(`/trafego/campaigns/${campaignId}/budget`, {
        new_amount_brl: newAmount,
        reason: reason.trim() || undefined,
        validate_only: validateOnly,
      });
      showSuccess(
        validateOnly
          ? 'Validação dry-run enfileirada — confira em mutate-logs.'
          : 'Atualização de orçamento enfileirada.',
      );
      onSaved();
      onClose();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao atualizar orçamento.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl w-full max-w-md">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={18} className="text-primary" />
              <h3 className="text-base font-bold text-foreground">
                Atualizar orçamento diário
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Campanha:{' '}
              <span className="font-mono">{campaignName}</span>
            </p>
            {currentBudgetBrl !== null && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Atual: <strong>{fmtBRL(currentBudgetBrl)}/dia</strong>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Novo valor diário (R$)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <input
                type="number"
                step="0.01"
                min="1"
                max="10000"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-full pl-9 pr-12 py-2 bg-background border border-border rounded-md text-sm"
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                /dia
              </span>
            </div>
            {isValid && (
              <p className="text-[11px] text-muted-foreground mt-1">
                ≈{' '}
                <strong className="text-foreground">
                  {fmtBRL(monthlyEstimate)}/mês
                </strong>{' '}
                (× 30 dias)
                {deltaPct !== null && hasChanged && (
                  <span
                    className={`ml-2 font-bold ${deltaPct > 0 ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {deltaPct > 0 ? '+' : ''}
                    {(deltaPct * 100).toFixed(0)}% vs atual
                  </span>
                )}
              </p>
            )}
            {!isValid && budgetInput.length > 0 && (
              <p className="text-[11px] text-red-500 mt-1">
                Valor precisa estar entre R$ 1 e R$ 10.000
              </p>
            )}
          </div>

          {isLargeChange && (
            <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded p-2">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>
                Mudança grande ({deltaPct! > 0 ? '+' : ''}
                {(deltaPct! * 100).toFixed(0)}%). Para Smart Bidding, evite
                ajustes &gt; 20% — reseta o período de aprendizado.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Motivo (opcional, fica no audit log)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              placeholder="Ex: aumentar pra capturar mais leads em fim de mês"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={validateOnly}
              onChange={(e) => setValidateOnly(e.target.checked)}
            />
            Modo conselheiro (validar sem aplicar)
          </label>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !isValid || !hasChanged}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {validateOnly ? 'Validar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
