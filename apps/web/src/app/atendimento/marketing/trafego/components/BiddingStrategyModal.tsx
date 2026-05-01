'use client';

import { useState } from 'react';
import { Loader2, X, TrendingUp } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type BiddingStrategy =
  | 'MAXIMIZE_CONVERSIONS'
  | 'MAXIMIZE_CLICKS'
  | 'MANUAL_CPC'
  | 'TARGET_CPA'
  | 'TARGET_ROAS'
  | 'MAXIMIZE_CONVERSION_VALUE';

const STRATEGIES: {
  v: BiddingStrategy;
  label: string;
  hint: string;
  needsCpa?: boolean;
  needsRoas?: boolean;
}[] = [
  {
    v: 'MAXIMIZE_CONVERSIONS',
    label: 'Maximizar conversões',
    hint: 'Sem CPA alvo — Google otimiza pra mais leads dentro do orçamento.',
  },
  {
    v: 'MAXIMIZE_CLICKS',
    label: 'Maximizar cliques',
    hint: 'Mais visitantes — fase inicial sem dados.',
  },
  {
    v: 'MANUAL_CPC',
    label: 'CPC manual',
    hint: 'Lances definidos por você no nível ad_group/keyword.',
  },
  {
    v: 'TARGET_CPA',
    label: 'CPA alvo',
    hint: 'Otimiza pra cada lead custar ~o valor alvo (precisa 30+ conv/mês).',
    needsCpa: true,
  },
  {
    v: 'TARGET_ROAS',
    label: 'ROAS alvo',
    hint: 'Otimiza pra retorno × gasto. Requer conversions_value.',
    needsRoas: true,
  },
  {
    v: 'MAXIMIZE_CONVERSION_VALUE',
    label: 'Maximizar valor de conversão',
    hint: 'Com conversions_value, sem alvo — Google maximiza receita.',
  },
];

interface Campaign {
  id: string;
  name: string;
  bidding_strategy: string | null;
}

export function BiddingStrategyModal({
  campaign,
  onClose,
  onUpdated,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const initial = (campaign?.bidding_strategy as BiddingStrategy | null) ??
    'MAXIMIZE_CONVERSIONS';
  const [strategy, setStrategy] = useState<BiddingStrategy>(initial);
  const [targetCpaBrl, setTargetCpaBrl] = useState('');
  const [targetRoas, setTargetRoas] = useState('');
  const [reason, setReason] = useState('');
  const [validateOnly, setValidateOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!campaign) return null;

  const opt = STRATEGIES.find((s) => s.v === strategy);

  async function submit() {
    if (!campaign) return;
    if (opt?.needsCpa) {
      const cpa = parseFloat(targetCpaBrl.replace(',', '.'));
      if (!Number.isFinite(cpa) || cpa <= 0) {
        showError('CPA alvo precisa ser > 0.');
        return;
      }
    }
    if (opt?.needsRoas) {
      const roas = parseFloat(targetRoas.replace(',', '.'));
      if (!Number.isFinite(roas) || roas <= 0) {
        showError('ROAS alvo precisa ser > 0.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const body: any = {
        bidding_strategy: strategy,
        validate_only: validateOnly,
      };
      if (reason.trim()) body.reason = reason.trim();
      if (opt?.needsCpa) body.target_cpa_brl = parseFloat(targetCpaBrl.replace(',', '.'));
      if (opt?.needsRoas) body.target_roas = parseFloat(targetRoas.replace(',', '.'));

      await api.patch(`/trafego/campaigns/${campaign.id}/bidding-strategy`, body);
      showSuccess(
        validateOnly
          ? 'Validação dry-run enfileirada.'
          : 'Mudança de estratégia enfileirada — período de aprendizado de 7-14 dias começa agora.',
      );
      onUpdated();
      onClose();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao atualizar estratégia.');
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
      <div className="bg-card border border-border rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={18} className="text-primary" />
              <h3 className="text-lg font-bold text-foreground">
                Estratégia de lance
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Campanha: <span className="font-mono">{campaign.name}</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Atual: <strong>{campaign.bidding_strategy ?? '—'}</strong>
            </p>
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

        <div className="p-5 space-y-3">
          <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded p-2 mb-2">
            <span>
              ⚠️ Mudar estratégia reseta o período de aprendizado (7-14d).
              Evite alternar mais de 1× por mês na mesma campanha.
            </span>
          </div>

          {STRATEGIES.map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => setStrategy(s.v)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                strategy === s.v
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <div className="text-sm font-bold text-foreground">{s.label}</div>
              <div className="text-[11px] text-muted-foreground">{s.hint}</div>
            </button>
          ))}

          {opt?.needsCpa && (
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                CPA alvo (R$) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={targetCpaBrl}
                onChange={(e) => setTargetCpaBrl(e.target.value)}
                placeholder="Ex: 80"
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </div>
          )}

          {opt?.needsRoas && (
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                ROAS alvo (multiplicador) *
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={targetRoas}
                onChange={(e) => setTargetRoas(e.target.value)}
                placeholder="Ex: 3.5 = 350% retorno"
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Motivo (audit log)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: alterando pra TARGET_CPA após 60 conv/mês"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={validateOnly}
              onChange={(e) => setValidateOnly(e.target.checked)}
            />
            Modo conselheiro (apenas validar)
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
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {validateOnly ? 'Validar' : 'Aplicar'}
          </button>
        </div>
      </div>
    </div>
  );
}
