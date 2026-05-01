'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Loader2,
  Inbox,
  ShieldX,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface SearchTerm {
  id: string;
  search_term: string;
  match_type: string | null;
  status: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  impressions: number;
  clicks: number;
  cost_brl: number;
  conversions: number;
  cpl_brl: number;
  ctr: number;
  last_seen_at: string;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(v || 0);

const fmtPct = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);

/**
 * Card de Termos de Pesquisa — última camada de visibilidade do que o
 * usuário REALMENTE digitou no Google. Ordenado por gasto. Filtra por
 * "ofensores" (zero conversões + gasto > X) pra acelerar negativação.
 *
 * "Negativar" enfileira mutate scope=AD_GROUP no Google Ads usando o
 * endpoint /trafego/ad-groups/:id/negatives existente. Match type
 * default: EXACT (mais conservador — bloqueia só o termo idêntico).
 */
export function SearchTermsCard({ canManage }: { canManage: boolean }) {
  const [terms, setTerms] = useState<SearchTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'OFFENDERS' | 'ALL' | 'WINNERS'>(
    'OFFENDERS',
  );
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean> = {
        limit: 200,
      };
      if (filter === 'OFFENDERS') {
        params.zero_conv_only = true;
        params.min_spend_brl = 5;
      }
      if (search.trim().length > 0) params.search = search.trim();
      const { data } = await api.get<SearchTerm[]>('/trafego/search-terms', {
        params,
      });
      // No filtro WINNERS, traz tudo e filtra client-side por conversions > 0
      const items =
        filter === 'WINNERS'
          ? data.filter((t) => t.conversions > 0)
          : data;
      setTerms(items);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Falha ao listar termos';
      showError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const totals = useMemo(() => {
    const cost = terms.reduce((s, t) => s + t.cost_brl, 0);
    const conv = terms.reduce((s, t) => s + t.conversions, 0);
    const clicks = terms.reduce((s, t) => s + t.clicks, 0);
    return { cost, conv, clicks };
  }, [terms]);

  async function negativeTerm(t: SearchTerm) {
    if (!canManage || !t.ad_group_id) {
      if (!t.ad_group_id)
        showError('Termo sem ad_group local — sincronize antes.');
      return;
    }
    if (
      !confirm(
        `Adicionar "${t.search_term}" como negativa EXACT no ad_group "${t.ad_group_name}"?`,
      )
    )
      return;
    setActingId(t.id);
    try {
      await api.post(`/trafego/ad-groups/${t.ad_group_id}/negatives`, {
        scope: 'AD_GROUP',
        negatives: [{ text: t.search_term, match_type: 'EXACT' }],
        reason: `Negativada via Search Terms Report (gasto ${fmtBRL(t.cost_brl)}, ${t.conversions} conv)`,
      });
      showSuccess(`Negativa "${t.search_term}" enfileirada.`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? 'Falha ao enfileirar negativa';
      showError(msg);
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Search size={18} className="text-primary" />
          <h3 className="text-base font-bold text-foreground">
            Termos de pesquisa (30d)
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          O que os usuários REALMENTE digitaram no Google antes de clicar nos
          seus anúncios. Ordenado por gasto. Sync diário (06h Maceió) ou via
          "Sincronizar agora".
        </p>
      </div>

      {/* Filtros */}
      <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border">
          {(
            [
              { v: 'OFFENDERS', l: 'Ofensores (sem conv + gasto)' },
              { v: 'WINNERS', l: 'Convertendo' },
              { v: 'ALL', l: 'Todos' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setFilter(opt.v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                filter === opt.v
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.l}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load();
            }}
            placeholder="Filtrar por termo..."
            className="pl-7 pr-3 py-1.5 text-xs bg-card border border-border rounded-lg w-52"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-accent disabled:opacity-50"
        >
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {terms.length} termo{terms.length === 1 ? '' : 's'} •{' '}
          <strong className="text-foreground">{fmtBRL(totals.cost)}</strong> em
          gasto •{' '}
          <strong className="text-foreground">
            {totals.conv.toFixed(1)}
          </strong>{' '}
          conv
        </span>
      </div>

      {loading ? (
        <div className="p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando termos...</p>
        </div>
      ) : terms.length === 0 ? (
        <div className="p-10 text-center">
          <Inbox size={36} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {filter === 'OFFENDERS'
              ? 'Nenhum termo com gasto e zero conversões — ótimo sinal! Ou então o sync ainda não rodou.'
              : 'Nenhum termo encontrado. Faça um sync e volte aqui.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5">Termo</th>
                <th className="text-left px-3 py-2.5">Match</th>
                <th className="text-left px-3 py-2.5">Campanha / Ad Group</th>
                <th className="text-right px-3 py-2.5">Imp</th>
                <th className="text-right px-3 py-2.5">Clicks</th>
                <th className="text-right px-3 py-2.5">CTR</th>
                <th className="text-right px-3 py-2.5">Custo</th>
                <th className="text-right px-3 py-2.5">Conv</th>
                <th className="text-right px-3 py-2.5">CPL</th>
                <th className="text-right px-3 py-2.5 w-32">Ação</th>
              </tr>
            </thead>
            <tbody>
              {terms.map((t) => {
                const offender = t.cost_brl >= 5 && t.conversions === 0;
                return (
                  <tr
                    key={t.id}
                    className={`border-t border-border hover:bg-accent/30 ${
                      offender ? 'bg-red-500/5' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {offender && (
                        <AlertTriangle
                          size={11}
                          className="inline text-red-500 mr-1"
                        />
                      )}
                      {t.conversions > 0 && (
                        <CheckCircle2
                          size={11}
                          className="inline text-emerald-500 mr-1"
                        />
                      )}
                      {t.search_term}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {t.match_type ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="text-foreground truncate max-w-[200px]">
                        {t.campaign_name ?? '—'}
                      </div>
                      <div className="text-muted-foreground truncate max-w-[200px]">
                        {t.ad_group_name ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.impressions}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.clicks}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.impressions > 0 ? fmtPct(t.ctr) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {fmtBRL(t.cost_brl)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.conversions.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.conversions > 0 ? fmtBRL(t.cpl_brl) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => negativeTerm(t)}
                        disabled={
                          !canManage ||
                          !t.ad_group_id ||
                          actingId === t.id
                        }
                        title={
                          !t.ad_group_id
                            ? 'Termo sem ad_group local'
                            : 'Adicionar como negativa EXACT'
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {actingId === t.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <ShieldX size={11} />
                        )}
                        Negativar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
