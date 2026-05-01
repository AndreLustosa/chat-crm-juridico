'use client';

import { useState } from 'react';
import { Loader2, X, Sparkles, Plus, Trash2, ShieldAlert } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface AdGroup {
  id: string;
  name: string;
  campaign_id: string;
  campaign?: { name?: string | null } | null;
}

const HEADLINE_LIMIT = 30;
const DESCRIPTION_LIMIT = 90;
const PATH_LIMIT = 15;

/**
 * Modal de criação de RSA. Modos:
 *   1. Manual — admin digita 3..15 headlines + 2..4 descriptions
 *   2. IA — gera variações baseado em área + cidade
 *
 * Validação OAB roda no backend (GoogleAdsMutateService) — admin vê
 * violações na resposta antes do submit real (validate_only round).
 */
export function CreateRsaModal({
  adGroup,
  onClose,
  onCreated,
}: {
  adGroup: AdGroup | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [headlines, setHeadlines] = useState<string[]>(['', '', '']);
  const [descriptions, setDescriptions] = useState<string[]>(['', '']);
  const [path1, setPath1] = useState('');
  const [path2, setPath2] = useState('');
  const [finalUrl, setFinalUrl] = useState('');
  const [validateOnly, setValidateOnly] = useState(true); // default seguro
  const [submitting, setSubmitting] = useState(false);

  // IA generation state
  const [aiArea, setAiArea] = useState('');
  const [aiCity, setAiCity] = useState('');
  const [aiDifferentials, setAiDifferentials] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiModel, setAiModel] = useState<string | null>(null);

  if (!adGroup) return null;

  function setHeadlineAt(idx: number, value: string) {
    setHeadlines((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }
  function setDescriptionAt(idx: number, value: string) {
    setDescriptions((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }
  function addHeadline() {
    if (headlines.length < 15) setHeadlines([...headlines, '']);
  }
  function removeHeadline(idx: number) {
    if (headlines.length <= 3) return;
    setHeadlines(headlines.filter((_, i) => i !== idx));
  }
  function addDescription() {
    if (descriptions.length < 4) setDescriptions([...descriptions, '']);
  }
  function removeDescription(idx: number) {
    if (descriptions.length <= 2) return;
    setDescriptions(descriptions.filter((_, i) => i !== idx));
  }

  async function generateWithAi() {
    if (!aiArea.trim() || !aiCity.trim()) {
      showError('Informe a área do Direito e a cidade.');
      return;
    }
    setAiLoading(true);
    try {
      const { data } = await api.post<{
        headlines: string[];
        descriptions: string[];
        path1: string | null;
        path2: string | null;
        model: string;
      }>('/trafego/ai/generate-rsa', {
        practice_area: aiArea.trim(),
        city: aiCity.trim(),
        differentials: aiDifferentials.trim() || undefined,
        final_url: finalUrl.trim() || undefined,
      });
      setHeadlines(data.headlines);
      setDescriptions(data.descriptions);
      if (data.path1) setPath1(data.path1);
      if (data.path2) setPath2(data.path2);
      setAiModel(data.model);
      showSuccess(
        `${data.headlines.length} headlines + ${data.descriptions.length} descrições geradas com ${data.model}`,
      );
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.message ?? 'Falha ao gerar RSA';
      showError(`IA: ${msg}`);
    } finally {
      setAiLoading(false);
    }
  }

  async function submit() {
    if (!adGroup) return;
    const validHeadlines = headlines
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    const validDescriptions = descriptions
      .map((d) => d.trim())
      .filter((d) => d.length > 0);

    if (validHeadlines.length < 3) {
      showError('Mínimo 3 headlines preenchidos.');
      return;
    }
    if (validDescriptions.length < 2) {
      showError('Mínimo 2 descrições preenchidas.');
      return;
    }
    if (!finalUrl.trim()) {
      showError('Final URL é obrigatório.');
      return;
    }

    setSubmitting(true);
    try {
      const body: any = {
        final_url: finalUrl.trim(),
        headlines: validHeadlines,
        descriptions: validDescriptions,
        validate_only: validateOnly,
      };
      if (path1.trim()) body.path1 = path1.trim().slice(0, PATH_LIMIT);
      if (path2.trim()) body.path2 = path2.trim().slice(0, PATH_LIMIT);

      await api.post(`/trafego/ad-groups/${adGroup.id}/ads/rsa`, body);
      showSuccess(
        validateOnly
          ? 'RSA validado em dry-run — confira em mutate-logs.'
          : 'RSA enfileirado pra criação no Google Ads.',
      );
      onCreated();
      onClose();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao criar RSA.');
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
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-bold text-foreground">
              Novo anúncio (RSA)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ad Group: <span className="font-mono">{adGroup.name}</span>
              {adGroup.campaign?.name ? ` · ${adGroup.campaign.name}` : ''}
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

        <div className="p-5 space-y-5">
          {/* IA Generator */}
          <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={16} className="text-violet-600" />
              <h4 className="text-sm font-bold text-foreground">
                Gerar variações com IA
              </h4>
              {aiModel && (
                <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 ml-auto">
                  {aiModel}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Claude gera 15 headlines + 4 descriptions baseado em área e
              cidade — todos OAB-compliant. Você pode editar antes de submeter.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                value={aiArea}
                onChange={(e) => setAiArea(e.target.value)}
                placeholder="Área (ex: trabalhista)"
                className="px-3 py-2 bg-background border border-border rounded-md text-xs"
              />
              <input
                value={aiCity}
                onChange={(e) => setAiCity(e.target.value)}
                placeholder="Cidade (ex: Maceió)"
                className="px-3 py-2 bg-background border border-border rounded-md text-xs"
              />
              <input
                value={aiDifferentials}
                onChange={(e) => setAiDifferentials(e.target.value)}
                placeholder="Diferenciais (opcional)"
                className="px-3 py-2 bg-background border border-border rounded-md text-xs"
              />
            </div>
            <button
              type="button"
              onClick={generateWithAi}
              disabled={aiLoading || !aiArea.trim() || !aiCity.trim()}
              className="mt-2 flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
            >
              {aiLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              Gerar variações
            </button>
          </div>

          {/* Final URL */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Landing page (final URL) *
            </label>
            <input
              type="url"
              value={finalUrl}
              onChange={(e) => setFinalUrl(e.target.value)}
              placeholder="https://andrelustosa.adv.br/trabalhista"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </div>

          {/* Headlines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-foreground">
                Headlines * ({headlines.length}/15, mín 3)
              </label>
              <button
                type="button"
                onClick={addHeadline}
                disabled={headlines.length >= 15}
                className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 disabled:opacity-40 flex items-center gap-1"
              >
                <Plus size={11} />
                Adicionar
              </button>
            </div>
            <div className="space-y-1.5">
              {headlines.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-5 text-right tabular-nums">
                    {i + 1}.
                  </span>
                  <input
                    value={h}
                    onChange={(e) => setHeadlineAt(i, e.target.value)}
                    maxLength={HEADLINE_LIMIT + 5}
                    placeholder={`Headline ${i + 1} (max ${HEADLINE_LIMIT} chars)`}
                    className="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded-md font-mono"
                  />
                  <span
                    className={`text-[10px] tabular-nums w-10 text-right ${
                      h.length > HEADLINE_LIMIT
                        ? 'text-red-500 font-bold'
                        : h.length > HEADLINE_LIMIT - 5
                          ? 'text-amber-500'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {h.length}/{HEADLINE_LIMIT}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeHeadline(i)}
                    disabled={headlines.length <= 3}
                    className="p-1 text-muted-foreground hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Remover"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Descriptions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-foreground">
                Descriptions * ({descriptions.length}/4, mín 2)
              </label>
              <button
                type="button"
                onClick={addDescription}
                disabled={descriptions.length >= 4}
                className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 disabled:opacity-40 flex items-center gap-1"
              >
                <Plus size={11} />
                Adicionar
              </button>
            </div>
            <div className="space-y-1.5">
              {descriptions.map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground w-5 text-right tabular-nums mt-2">
                    {i + 1}.
                  </span>
                  <textarea
                    value={d}
                    onChange={(e) => setDescriptionAt(i, e.target.value)}
                    rows={2}
                    placeholder={`Descrição ${i + 1} (max ${DESCRIPTION_LIMIT} chars)`}
                    className="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded-md font-mono resize-none"
                  />
                  <span
                    className={`text-[10px] tabular-nums w-10 text-right mt-2 ${
                      d.length > DESCRIPTION_LIMIT
                        ? 'text-red-500 font-bold'
                        : d.length > DESCRIPTION_LIMIT - 10
                          ? 'text-amber-500'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {d.length}/{DESCRIPTION_LIMIT}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDescription(i)}
                    disabled={descriptions.length <= 2}
                    className="p-1 mt-2 text-muted-foreground hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Remover"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Paths (display URL) */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Paths display URL (opcional, max {PATH_LIMIT} chars)
            </label>
            <div className="flex gap-2">
              <input
                value={path1}
                onChange={(e) => setPath1(e.target.value.slice(0, PATH_LIMIT + 5))}
                maxLength={PATH_LIMIT + 5}
                placeholder="path1"
                className="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded-md font-mono"
              />
              <input
                value={path2}
                onChange={(e) => setPath2(e.target.value.slice(0, PATH_LIMIT + 5))}
                maxLength={PATH_LIMIT + 5}
                placeholder="path2"
                className="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded-md font-mono"
              />
            </div>
          </div>

          {/* OAB warning */}
          <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded p-3">
            <ShieldAlert size={13} className="shrink-0 mt-0.5" />
            <div>
              <strong>Validação OAB ativa.</strong> Termos como "garantimos
              vitória", "100% êxito", "primeiro lugar" são bloqueados pelo
              GoogleAdsMutateService. Recomendamos manter <strong>"Apenas
              validar"</strong> ligado no primeiro envio pra ver violações
              antes de criar de verdade.
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={validateOnly}
              onChange={(e) => setValidateOnly(e.target.checked)}
            />
            <strong>Apenas validar</strong> (recomendado no primeiro envio —
            Google checa OAB e formato sem criar)
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
            {validateOnly ? 'Validar RSA' : 'Criar RSA'}
          </button>
        </div>
      </div>
    </div>
  );
}
