'use client';

import { useState } from 'react';
import {
  Sparkles,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldX,
  Calendar,
  DollarSign,
  AlertCircle,
  Info,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(v || 0);

const fmtPct = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(v || 0);

interface WeeklyDiagnosis {
  period: {
    from: string;
    to: string;
    previous_from: string;
    previous_to: string;
  };
  metrics: {
    this_week: {
      spend_brl: number;
      leads: number;
      cpl_brl: number;
      ctr: number;
      clicks: number;
    };
    previous_week: {
      spend_brl: number;
      leads: number;
      cpl_brl: number;
      ctr: number;
      clicks: number;
    };
    deltas: {
      spend_pct: number | null;
      leads_pct: number | null;
      cpl_pct: number | null;
    };
  };
  diagnosis: string;
  model: string;
}

interface KeywordToPause {
  id: string;
  kind: 'search_term' | 'keyword';
  text: string;
  match_type: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  cost_brl: number;
  clicks: number;
  conversions: number;
}

interface BudgetSuggestion {
  campaign_id: string;
  campaign_name: string;
  current_daily_brl: number;
  cpl_brl: number;
  conv_30d: number;
  recommendation: 'INCREASE' | 'DECREASE' | 'KEEP' | 'INSUFFICIENT_DATA';
  suggested_daily_brl: number | null;
  change_pct: number | null;
  reasoning: string;
}

/**
 * Painel "IA Otimiza" — 3 seções colapsáveis com chamadas on-demand:
 *   1. Diagnóstico semanal (Claude)
 *   2. Keywords pra negativar
 *   3. Sugestão de budget
 *
 * Usado dentro do IaOtimizadoraTab existente, abaixo das decisões
 * automáticas geradas pelos loops.
 */
export function IaOtimizaPanel({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-foreground">
          Insights manuais (gerados sob demanda)
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Diferente das decisões automáticas acima, essas seções rodam quando
          você clica — útil pra revisões pontuais.
        </p>
      </div>

      <WeeklyDiagnosisCard canManage={canManage} />
      <KeywordsToPauseCard canManage={canManage} />
      <BudgetSuggestionsCard canManage={canManage} />
    </div>
  );
}

// ─── 1. Diagnóstico Semanal ──────────────────────────────────────────────

function WeeklyDiagnosisCard({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WeeklyDiagnosis | null>(null);

  async function generate() {
    setLoading(true);
    try {
      const { data: resp } = await api.get<WeeklyDiagnosis>(
        '/trafego/optimization/weekly-diagnosis',
      );
      setData(resp);
      showSuccess(`Diagnóstico gerado com ${resp.model}`);
    } catch (err: any) {
      showError(
        err?.response?.data?.message ?? 'Falha ao gerar diagnóstico.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-violet-600" />
            <h4 className="text-sm font-bold text-foreground">
              Diagnóstico semanal
            </h4>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Compara últimos 7 dias vs anteriores. Claude gera resumo
            acionável em 3 parágrafos.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-md bg-violet-600 hover:bg-violet-700 text-white shadow-sm disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {data ? 'Regenerar' : 'Gerar diagnóstico'}
          </button>
        )}
      </div>

      {data && (
        <div className="p-4 space-y-4">
          {/* Mini-KPIs do período */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <DeltaKpi
              label="Gasto"
              value={fmtBRL(data.metrics.this_week.spend_brl)}
              delta={data.metrics.deltas.spend_pct}
              invertColor
            />
            <DeltaKpi
              label="Leads"
              value={String(Math.round(data.metrics.this_week.leads))}
              delta={data.metrics.deltas.leads_pct}
            />
            <DeltaKpi
              label="CPL"
              value={fmtBRL(data.metrics.this_week.cpl_brl)}
              delta={data.metrics.deltas.cpl_pct}
              invertColor
            />
          </div>

          {/* Diagnosis em markdown simples */}
          <div className="text-sm text-foreground space-y-2 prose prose-sm max-w-none">
            {data.diagnosis.split('\n').map((line, i) => {
              if (line.trim().length === 0) return null;
              if (line.startsWith('### ')) {
                return (
                  <h5
                    key={i}
                    className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-3"
                  >
                    {line.replace(/^###\s+/, '')}
                  </h5>
                );
              }
              if (line.startsWith('- ') || line.startsWith('* ')) {
                return (
                  <div key={i} className="flex gap-2 text-[13px]">
                    <span className="text-violet-600">•</span>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: line
                          .replace(/^[-*]\s+/, '')
                          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
                      }}
                    />
                  </div>
                );
              }
              return (
                <p
                  key={i}
                  className="text-[13px] leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: line.replace(
                      /\*\*(.+?)\*\*/g,
                      '<strong>$1</strong>',
                    ),
                  }}
                />
              );
            })}
          </div>

          <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
            {data.period.from} → {data.period.to} · gerado por {data.model}
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Clique em "Gerar diagnóstico" pra ver a análise da semana.
        </div>
      )}
    </div>
  );
}

function DeltaKpi({
  label,
  value,
  delta,
  invertColor,
}: {
  label: string;
  value: string;
  delta: number | null;
  invertColor?: boolean;
}) {
  const color =
    delta === null
      ? 'text-muted-foreground'
      : (delta > 0) === (invertColor ? false : true)
        ? 'text-emerald-500'
        : 'text-red-500';
  const Icon =
    delta === null ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  return (
    <div className="bg-muted/30 rounded p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-base font-bold text-foreground">{value}</div>
      <div className={`flex items-center justify-center gap-1 text-[10px] ${color}`}>
        <Icon size={10} />
        {delta !== null ? `${(delta * 100).toFixed(1)}%` : '—'}
      </div>
    </div>
  );
}

// ─── 2. Keywords pra pausar ──────────────────────────────────────────────

function KeywordsToPauseCard({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    threshold: { min_spend_brl: number; days: number };
    total_wasted_brl: number;
    items: KeywordToPause[];
  } | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data: resp } = await api.get<{
        threshold: { min_spend_brl: number; days: number };
        total_wasted_brl: number;
        items: KeywordToPause[];
      }>('/trafego/optimization/keywords-to-pause', {
        params: { min_spend_brl: 30, days: 30, limit: 50 },
      });
      setData(resp);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao listar.');
    } finally {
      setLoading(false);
    }
  }

  async function negative(item: KeywordToPause) {
    if (!canManage || !item.ad_group_id) return;
    if (!confirm(`Negativar "${item.text}" como EXACT no ad_group "${item.ad_group_name}"?`))
      return;
    setActingId(item.id);
    try {
      await api.post(`/trafego/ad-groups/${item.ad_group_id}/negatives`, {
        scope: 'AD_GROUP',
        negatives: [{ text: item.text, match_type: 'EXACT' }],
        reason: `Negativada via "Keywords pra pausar" (gasto ${fmtBRL(item.cost_brl)}, 0 conv em ${data?.threshold.days}d)`,
      });
      showSuccess(`"${item.text}" enfileirada como negativa.`);
      await load();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao negativar.');
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <div className="flex items-center gap-2">
            <ShieldX size={16} className="text-red-500" />
            <h4 className="text-sm font-bold text-foreground">
              Keywords pra negativar (gasto sem conv)
            </h4>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Termos com gasto ≥ R$30 e 0 conversões em 30d. Negativar EXACT
            corta o gasto nesse termo específico mantendo as variações.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-md bg-card hover:bg-accent border border-border disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ShieldX size={13} />
          )}
          {data ? 'Atualizar' : 'Listar'}
        </button>
      </div>

      {data && (
        <>
          <div className="px-4 py-2 bg-red-500/5 border-b border-border text-[11px]">
            <strong>Total desperdiçado:</strong>{' '}
            <span className="font-mono text-red-700 dark:text-red-400">
              {fmtBRL(data.total_wasted_brl)}
            </span>{' '}
            em {data.items.length} termo{data.items.length === 1 ? '' : 's'} · janela{' '}
            {data.threshold.days}d · gasto mínimo {fmtBRL(data.threshold.min_spend_brl)}
          </div>
          {data.items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum termo "ofensor" no momento — bom sinal!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Termo</th>
                    <th className="text-left px-3 py-2">Campanha / Grupo</th>
                    <th className="text-right px-3 py-2">Gasto</th>
                    <th className="text-right px-3 py-2">Clicks</th>
                    <th className="text-right px-3 py-2 w-32">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">
                        {item.text}
                        {item.match_type && (
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            ({item.match_type})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="text-foreground truncate max-w-[200px]">
                          {item.campaign_name ?? '—'}
                        </div>
                        <div className="text-muted-foreground truncate max-w-[200px]">
                          {item.ad_group_name ?? '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {fmtBRL(item.cost_brl)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item.clicks}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => negative(item)}
                          disabled={
                            !canManage ||
                            !item.ad_group_id ||
                            actingId === item.id
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {actingId === item.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <ShieldX size={11} />
                          )}
                          Negativar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Clique em "Listar" pra ver os termos com 0 conversão.
        </div>
      )}
    </div>
  );
}

// ─── 3. Sugestão de Budget ───────────────────────────────────────────────

function BudgetSuggestionsCard({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    target_cpl_brl: number | null;
    items: BudgetSuggestion[];
  } | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data: resp } = await api.get<{
        target_cpl_brl: number | null;
        items: BudgetSuggestion[];
      }>('/trafego/optimization/budget-suggestions');
      setData(resp);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao calcular.');
    } finally {
      setLoading(false);
    }
  }

  async function applyBudget(item: BudgetSuggestion) {
    if (!canManage || !item.suggested_daily_brl) return;
    if (
      !confirm(
        `Aplicar novo budget R$ ${item.suggested_daily_brl} (atual R$ ${item.current_daily_brl.toFixed(2)}) em "${item.campaign_name}"?`,
      )
    )
      return;
    setActingId(item.campaign_id);
    try {
      await api.patch(`/trafego/campaigns/${item.campaign_id}/budget`, {
        new_amount_brl: item.suggested_daily_brl,
        reason: `Sugestão IA Otimiza: ${item.reasoning.slice(0, 200)}`,
      });
      showSuccess('Atualização de budget enfileirada.');
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao aplicar.');
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <div className="flex items-center gap-2">
            <DollarSign size={16} className="text-emerald-600" />
            <h4 className="text-sm font-bold text-foreground">
              Sugestão de budget por campanha
            </h4>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Heurística: CPL ≤ meta → escalar +20%. CPL &gt; meta×1.5 →
            reduzir 20%. Configure meta de CPL em Settings.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-md bg-card hover:bg-accent border border-border disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <DollarSign size={13} />
          )}
          {data ? 'Atualizar' : 'Calcular'}
        </button>
      </div>

      {data && (
        <>
          {data.target_cpl_brl === null && (
            <div className="px-4 py-2 bg-amber-500/5 border-b border-border text-[11px] flex items-start gap-2">
              <Info size={13} className="text-amber-600 shrink-0 mt-0.5" />
              <span>
                Meta de CPL não configurada — sugestões serão "manter".
                Configure em <strong>Configurações → Tráfego</strong> pra
                receber recomendações de aumento/redução.
              </span>
            </div>
          )}
          {data.items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma campanha ativa com dados pra projetar.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Campanha</th>
                    <th className="text-right px-3 py-2">CPL</th>
                    <th className="text-right px-3 py-2">Conv 30d</th>
                    <th className="text-right px-3 py-2">Atual/dia</th>
                    <th className="text-right px-3 py-2">Sugerido</th>
                    <th className="text-left px-3 py-2">Recomendação</th>
                    <th className="text-right px-3 py-2 w-24">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.campaign_id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">
                        {item.campaign_name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item.cpl_brl > 0 ? fmtBRL(item.cpl_brl) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item.conv_30d.toFixed(0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item.current_daily_brl > 0
                          ? fmtBRL(item.current_daily_brl)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {item.suggested_daily_brl !== null ? (
                          <span
                            className={
                              item.recommendation === 'INCREASE'
                                ? 'text-emerald-500'
                                : 'text-red-500'
                            }
                          >
                            {fmtBRL(item.suggested_daily_brl)}
                            {item.change_pct !== null && (
                              <span className="text-[10px] ml-1">
                                ({item.change_pct > 0 ? '+' : ''}
                                {fmtPct(item.change_pct)})
                              </span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-md">
                        <RecommendationBadge rec={item.recommendation} />
                        <div className="mt-0.5">{item.reasoning}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(item.recommendation === 'INCREASE' ||
                          item.recommendation === 'DECREASE') &&
                          item.suggested_daily_brl !== null && (
                            <button
                              type="button"
                              onClick={() => applyBudget(item)}
                              disabled={
                                !canManage || actingId === item.campaign_id
                              }
                              className="text-[11px] font-semibold px-2 py-1 rounded bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {actingId === item.campaign_id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                'Aplicar'
                              )}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Clique em "Calcular" pra ver sugestões.
        </div>
      )}
    </div>
  );
}

function RecommendationBadge({
  rec,
}: {
  rec: BudgetSuggestion['recommendation'];
}) {
  const styles: Record<typeof rec, { color: string; label: string }> = {
    INCREASE: {
      color:
        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
      label: 'Aumentar',
    },
    DECREASE: {
      color: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
      label: 'Reduzir',
    },
    KEEP: {
      color: 'bg-muted text-muted-foreground border-border',
      label: 'Manter',
    },
    INSUFFICIENT_DATA: {
      color:
        'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
      label: 'Sem dados',
    },
  };
  const s = styles[rec];
  return (
    <span
      className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${s.color}`}
    >
      {s.label}
    </span>
  );
}
