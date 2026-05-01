'use client';

import { useMemo, useState } from 'react';
import { Loader2, X, ShieldX } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type MatchType = 'BROAD' | 'PHRASE' | 'EXACT';
type Scope = 'CAMPAIGN' | 'AD_GROUP';

/**
 * Modal pra adicionar negativas em batch.
 * - textarea aceita múltiplas keywords (1 por linha)
 * - seletor de match type (Ampla/Frase/Exata)
 * - seletor de escopo: Esta campanha (criterion na campaign) ou
 *   Todas as campanhas (cross-campaign loop pelo front)
 *
 * Recebe `defaultTerms` opcional pra pré-preencher (vindo de "sugestões"
 * de termos a negativar).
 *
 * Quando `scope=AD_GROUP`, requer `defaultAdGroupId` (campanha tem 1
 * ad_group selecionado). Quando `scope=CAMPAIGN`, opera direto na campanha.
 */
export function AddNegativesModal({
  open,
  campaignId,
  campaignName,
  defaultAdGroupId,
  defaultTerms = [],
  allowAllCampaigns = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  campaignId: string | null;
  campaignName: string;
  defaultAdGroupId?: string | null;
  defaultTerms?: string[];
  /** Permite escopo "todas as campanhas" — usado em /termos-busca cross-campaign */
  allowAllCampaigns?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [terms, setTerms] = useState(defaultTerms.join('\n'));
  const [matchType, setMatchType] = useState<MatchType>('PHRASE');
  const [scope, setScope] = useState<Scope>(
    defaultAdGroupId ? 'AD_GROUP' : 'CAMPAIGN',
  );
  const [includeAllCampaigns, setIncludeAllCampaigns] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const parsedTerms = useMemo(
    () =>
      terms
        .split('\n')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .filter((t, i, arr) => arr.indexOf(t) === i),
    [terms],
  );

  if (!open) return null;

  async function handleSave() {
    if (parsedTerms.length === 0) {
      showError('Digite pelo menos 1 palavra negativa.');
      return;
    }
    setSubmitting(true);
    let okCount = 0;
    let failCount = 0;
    try {
      if (includeAllCampaigns && allowAllCampaigns) {
        // Cross-campaign: lista todas + chama campaign-level negatives
        const { data } = await api.get<{ id: string }[]>('/trafego/campaigns');
        const camps = data.filter((c: any) => c.status !== 'REMOVED');
        for (const c of camps) {
          try {
            await api.post(`/trafego/campaigns/${c.id}/negatives`, {
              scope: 'CAMPAIGN',
              negatives: parsedTerms.map((t) => ({
                text: t,
                match_type: matchType,
              })),
              reason: 'Adicionada via cross-campaign negatives modal',
            });
            okCount++;
          } catch {
            failCount++;
          }
        }
      } else if (scope === 'CAMPAIGN' && campaignId) {
        await api.post(`/trafego/campaigns/${campaignId}/negatives`, {
          scope: 'CAMPAIGN',
          negatives: parsedTerms.map((t) => ({
            text: t,
            match_type: matchType,
          })),
          reason: `Adicionadas via modal (${parsedTerms.length} termos)`,
        });
        okCount = 1;
      } else if (scope === 'AD_GROUP' && defaultAdGroupId) {
        await api.post(`/trafego/ad-groups/${defaultAdGroupId}/negatives`, {
          scope: 'AD_GROUP',
          negatives: parsedTerms.map((t) => ({
            text: t,
            match_type: matchType,
          })),
          reason: `Adicionadas via modal (${parsedTerms.length} termos)`,
        });
        okCount = 1;
      }
      if (failCount === 0) {
        showSuccess(
          includeAllCampaigns
            ? `${parsedTerms.length} negativas em ${okCount} campanhas.`
            : `${parsedTerms.length} negativa(s) enfileirada(s).`,
        );
      } else {
        showError(
          `${okCount} aplicado(s), ${failCount} falhou(aram). Verifique mutate-logs.`,
        );
      }
      onSaved();
      onClose();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao adicionar.');
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
      <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldX size={18} className="text-red-500" />
              <h3 className="text-base font-bold text-foreground">
                Adicionar palavras negativas
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {campaignName ? `Campanha: ${campaignName}` : ''}
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
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Palavras a negativar (uma por linha)
            </label>
            <textarea
              autoFocus
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={6}
              placeholder={'defensoria publica\ntj alagoas\nadvogado online'}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm font-mono resize-none"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {parsedTerms.length} palavra
              {parsedTerms.length === 1 ? '' : 's'} pronta
              {parsedTerms.length === 1 ? '' : 's'} pra adicionar
              {parsedTerms.length > 0 ? '.' : '.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-2">
              Tipo de match
            </label>
            <div className="flex gap-2">
              {(
                [
                  {
                    v: 'BROAD',
                    label: 'Ampla',
                    hint: 'Bloqueia variações',
                  },
                  {
                    v: 'PHRASE',
                    label: 'Frase',
                    hint: 'Bloqueia se contém o termo',
                  },
                  {
                    v: 'EXACT',
                    label: 'Exata',
                    hint: 'Bloqueia só o termo idêntico',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setMatchType(opt.v)}
                  className={`flex-1 px-3 py-2 text-xs rounded-md border ${
                    matchType === opt.v
                      ? 'border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <div className="font-bold">{opt.label}</div>
                  <div className="text-[10px] mt-0.5">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {!allowAllCampaigns && defaultAdGroupId && (
            <div>
              <label className="block text-xs font-semibold text-foreground mb-2">
                Escopo
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScope('AD_GROUP')}
                  className={`flex-1 px-3 py-2 text-xs rounded-md border ${
                    scope === 'AD_GROUP'
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-border'
                  }`}
                >
                  <div className="font-bold">Grupo de anúncio</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Só este ad_group
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setScope('CAMPAIGN')}
                  className={`flex-1 px-3 py-2 text-xs rounded-md border ${
                    scope === 'CAMPAIGN'
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-border'
                  }`}
                >
                  <div className="font-bold">Campanha inteira</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Todos os ad_groups da campanha
                  </div>
                </button>
              </div>
            </div>
          )}

          {allowAllCampaigns && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={includeAllCampaigns}
                onChange={(e) => setIncludeAllCampaigns(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Aplicar em TODAS as campanhas</strong> (não só nesta).
                Itera pelas campanhas ativas e adiciona em cada uma.
              </span>
            </label>
          )}
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
            onClick={handleSave}
            disabled={submitting || parsedTerms.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Adicionar {parsedTerms.length > 0 && `(${parsedTerms.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
