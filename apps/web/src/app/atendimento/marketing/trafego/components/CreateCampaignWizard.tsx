'use client';

import { useState } from 'react';
import { Loader2, X, Plus, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type BiddingStrategy =
  | 'MAXIMIZE_CONVERSIONS'
  | 'MAXIMIZE_CLICKS'
  | 'MANUAL_CPC'
  | 'TARGET_CPA';

const BIDDING_OPTIONS: { v: BiddingStrategy; label: string; hint: string }[] = [
  {
    v: 'MAXIMIZE_CONVERSIONS',
    label: 'Maximizar conversões',
    hint: 'Recomendado quando ainda não há volume — Google escolhe os lances pra ti.',
  },
  {
    v: 'MAXIMIZE_CLICKS',
    label: 'Maximizar cliques',
    hint: 'Mais visitantes — útil pra conta nova sem dados de conversão.',
  },
  {
    v: 'MANUAL_CPC',
    label: 'CPC manual',
    hint: 'Você define cada lance — só pra quem já tem experiência.',
  },
  {
    v: 'TARGET_CPA',
    label: 'CPA alvo',
    hint: 'Tem 30+ conversões/mês? Defina um custo-alvo por lead.',
  },
];

// Geo target IDs comuns no Brasil (subset — Google AdWords criteria IDs)
const GEO_PRESETS: { id: string; label: string }[] = [
  { id: '1001775', label: 'Brasil (todo o país)' },
  { id: '1031620', label: 'Maceió/AL' },
  { id: '1001789', label: 'São Paulo/SP' },
  { id: '1001824', label: 'Rio de Janeiro/RJ' },
  { id: '1001770', label: 'Belo Horizonte/MG' },
  { id: '1001839', label: 'Recife/PE' },
  { id: '1001782', label: 'Brasília/DF' },
  { id: '1001793', label: 'Salvador/BA' },
];

export function CreateCampaignWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [budgetBrl, setBudgetBrl] = useState('30');
  const [bidding, setBidding] = useState<BiddingStrategy>('MAXIMIZE_CONVERSIONS');
  const [targetCpaBrl, setTargetCpaBrl] = useState('');
  const [geoIds, setGeoIds] = useState<string[]>(['1001775']);
  const [finalUrl, setFinalUrl] = useState('');
  const [initialStatus, setInitialStatus] = useState<'PAUSED' | 'ENABLED'>(
    'PAUSED',
  );
  const [validateOnly, setValidateOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName('');
    setBudgetBrl('30');
    setBidding('MAXIMIZE_CONVERSIONS');
    setTargetCpaBrl('');
    setGeoIds(['1001775']);
    setFinalUrl('');
    setInitialStatus('PAUSED');
    setValidateOnly(false);
  }

  async function submit() {
    if (!name.trim() || name.length < 3) {
      showError('Nome da campanha precisa ter pelo menos 3 caracteres.');
      return;
    }
    const budget = parseFloat(budgetBrl.replace(',', '.'));
    if (!Number.isFinite(budget) || budget < 1) {
      showError('Orçamento diário precisa ser >= R$ 1.');
      return;
    }
    if (bidding === 'TARGET_CPA') {
      const cpa = parseFloat(targetCpaBrl.replace(',', '.'));
      if (!Number.isFinite(cpa) || cpa <= 0) {
        showError('CPA alvo precisa ser > 0.');
        return;
      }
    }
    if (geoIds.length === 0) {
      showError('Selecione pelo menos uma localização.');
      return;
    }

    setSubmitting(true);
    try {
      const body: any = {
        name: name.trim(),
        daily_budget_brl: budget,
        bidding_strategy: bidding,
        geo_target_ids: geoIds,
        language_ids: ['1014'], // pt-BR fixo por enquanto
        initial_status: initialStatus,
        validate_only: validateOnly,
      };
      if (bidding === 'TARGET_CPA') {
        body.target_cpa_brl = parseFloat(targetCpaBrl.replace(',', '.'));
      }
      if (finalUrl.trim()) body.final_url = finalUrl.trim();

      await api.post('/trafego/campaigns', body);
      showSuccess(
        validateOnly
          ? 'Validação dry-run enfileirada — confira em Configurações > Sync logs.'
          : `Campanha "${name}" enfileirada. Vai aparecer em ~30s na lista.`,
      );
      onCreated();
      reset();
      onClose();
    } catch (err: any) {
      showError(
        err?.response?.data?.message ?? 'Falha ao criar campanha.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-bold text-foreground">
              Nova campanha Search
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cria diretamente na conta Google Ads. Default: pausada — admin
              ativa depois de revisar grupos/anúncios.
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

        <div className="p-5 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Nome da campanha *
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Trabalhista — Maceió — Search Q2"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </div>

          {/* Orçamento diário */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Orçamento diário (R$) *
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={budgetBrl}
              onChange={(e) => setBudgetBrl(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              ≈ R${' '}
              {(parseFloat(budgetBrl.replace(',', '.')) * 30 || 0).toFixed(2)}/mês
            </p>
          </div>

          {/* Bidding strategy */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-2">
              Estratégia de lance *
            </label>
            <div className="space-y-2">
              {BIDDING_OPTIONS.map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setBidding(opt.v)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    bidding === opt.v
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  <div className="text-sm font-bold text-foreground">
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {opt.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Target CPA condicional */}
          {bidding === 'TARGET_CPA' && (
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
              <p className="text-[11px] text-muted-foreground mt-1">
                Custo médio que você aceita pagar por lead. Comece 10-20% acima
                do CPA atual da conta.
              </p>
            </div>
          )}

          {/* Localização */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-2">
              Localização *
            </label>
            <div className="grid grid-cols-2 gap-1">
              {GEO_PRESETS.map((g) => {
                const checked = geoIds.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer ${
                      checked
                        ? 'bg-violet-500/10 border border-violet-500/30'
                        : 'border border-border hover:bg-accent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setGeoIds([...geoIds, g.id]);
                        } else {
                          setGeoIds(geoIds.filter((x) => x !== g.id));
                        }
                      }}
                    />
                    <span>{g.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Final URL */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Landing page (opcional)
            </label>
            <input
              type="url"
              value={finalUrl}
              onChange={(e) => setFinalUrl(e.target.value)}
              placeholder="https://andrelustosa.adv.br/trabalhista"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </div>

          {/* Status inicial */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-2">
              Status inicial
            </label>
            <div className="flex gap-2">
              {(['PAUSED', 'ENABLED'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInitialStatus(s)}
                  className={`flex-1 px-3 py-2 text-xs font-bold rounded-md border ${
                    initialStatus === s
                      ? 'border-violet-500/50 bg-violet-500/10 text-violet-700'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {s === 'PAUSED' ? 'Pausada (recomendado)' : 'Ativa'}
                </button>
              ))}
            </div>
            {initialStatus === 'ENABLED' && (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>
                  Campanha ATIVA já gasta dinheiro logo após criar. Adicione
                  ad_groups + RSAs antes — campanha sem anúncios ainda fica
                  "elegível" mas não roda.
                </span>
              </div>
            )}
          </div>

          {/* Dry-run toggle */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={validateOnly}
              onChange={(e) => setValidateOnly(e.target.checked)}
            />
            Modo conselheiro (apenas validar — não cria no Google)
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
            {validateOnly ? 'Validar' : 'Criar campanha'}
          </button>
        </div>
      </div>
    </div>
  );
}
