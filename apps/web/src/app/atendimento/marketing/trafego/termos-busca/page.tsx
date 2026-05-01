'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Inbox,
  Search,
  ShieldX,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { showError, showSuccess } from '@/lib/toast';
import { AddNegativesModal } from '../components/AddNegativesModal';

interface SearchTerm {
  id: string;
  search_term: string;
  match_type: string | null;
  status: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  cost_brl: number;
  clicks: number;
  conversions: number;
  cpl_brl: number;
  ctr: number;
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
 * Página dedicada de termos de busca cross-campaign. Diferente do card
 * que existe na CampanhasTab (filtra por status/spend), aqui o foco é:
 *   1. Banner de "candidatos a negativar" (gasto > R$3 + 0 conv)
 *   2. Lista completa com coluna de Campanha visível
 *   3. Negativar em batch cross-campaign
 */
export default function TermosBuscaPage() {
  const router = useRouter();
  const perms = useRole();

  const [terms, setTerms] = useState<SearchTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [campaignFilter, setCampaignFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'WITH_CONV' | 'NO_CONV'
  >('ALL');

  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    new Set(),
  );
  const [negativesOpen, setNegativesOpen] = useState(false);
  const [presetTerms, setPresetTerms] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<SearchTerm[]>('/trafego/search-terms', {
        params: { limit: 500 },
      });
      setTerms(data);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao listar termos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Sugestões automáticas: gasto > R$3 + 0 conv
  const suggestions = useMemo(() => {
    return terms.filter(
      (t) =>
        t.cost_brl > 3 &&
        t.conversions === 0 &&
        !dismissedSuggestions.has(t.id) &&
        t.status !== 'EXCLUDED',
    );
  }, [terms, dismissedSuggestions]);

  const totalWasted = suggestions.reduce((s, t) => s + t.cost_brl, 0);

  // Filtros aplicados na tabela
  const campaigns = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of terms) {
      if (t.campaign_id && t.campaign_name) {
        map.set(t.campaign_id, t.campaign_name);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [terms]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return terms.filter((t) => {
      if (campaignFilter !== 'ALL' && t.campaign_id !== campaignFilter)
        return false;
      if (statusFilter === 'WITH_CONV' && t.conversions <= 0) return false;
      if (statusFilter === 'NO_CONV' && (t.conversions > 0 || t.cost_brl < 0.5))
        return false;
      if (q && !t.search_term.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [terms, campaignFilter, statusFilter, search]);

  function dismissSuggestion(id: string) {
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function openNegativeAll() {
    setPresetTerms(suggestions.map((s) => s.search_term));
    setNegativesOpen(true);
  }

  async function negativeOne(t: SearchTerm) {
    if (!perms.canManageTrafego || !t.ad_group_id) return;
    if (
      !confirm(
        `Adicionar "${t.search_term}" como negativa EXACT em "${t.ad_group_name}"?`,
      )
    )
      return;
    try {
      await api.post(`/trafego/ad-groups/${t.ad_group_id}/negatives`, {
        scope: 'AD_GROUP',
        negatives: [{ text: t.search_term, match_type: 'EXACT' }],
        reason: `Negativada via /termos-busca (gasto ${fmtBRL(t.cost_brl)})`,
      });
      showSuccess(`"${t.search_term}" enfileirada.`);
      dismissSuggestion(t.id);
      setTimeout(load, 3000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha.');
    }
  }

  if (!perms.canViewTrafego) {
    return (
      <div className="p-8">
        <div className="bg-card border border-border rounded-xl p-8 text-center max-w-md mx-auto">
          <h2 className="text-base font-bold text-foreground mb-2">
            Acesso restrito
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8">
      <button
        type="button"
        onClick={() => router.push('/atendimento/marketing/trafego')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={14} />
        Voltar para Tráfego
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-400 flex items-center justify-center">
          <Search size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Termos de busca
          </h1>
          <p className="text-sm text-muted-foreground">
            O que os usuários realmente digitaram no Google em todas as
            campanhas.
          </p>
        </div>
      </div>

      {/* Banner de sugestões de negativação automática */}
      {suggestions.length > 0 && perms.canManageTrafego && (
        <div className="mb-6 bg-red-500/5 border border-red-500/30 rounded-xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-base font-bold text-foreground">
                {suggestions.length} termo
                {suggestions.length === 1 ? '' : 's'} gastando sem converter —{' '}
                <span className="text-red-700 dark:text-red-400">
                  {fmtBRL(totalWasted)}
                </span>{' '}
                potencial economia
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Termos com gasto &gt; R$3 e 0 conversões nos últimos 30 dias.
                Clique em um chip pra dispensar essa sugestão (não negativa).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {suggestions.slice(0, 24).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => dismissSuggestion(s.id)}
                className="text-[11px] font-mono px-2 py-1 bg-card border border-red-500/30 rounded hover:bg-red-500/10 text-foreground"
                title={`${fmtBRL(s.cost_brl)} • ${s.clicks} clicks • Clique pra dispensar`}
              >
                {s.search_term}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({fmtBRL(s.cost_brl)})
                </span>
              </button>
            ))}
            {suggestions.length > 24 && (
              <span className="text-[11px] text-muted-foreground self-center px-2">
                +{suggestions.length - 24} mais
              </span>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={openNegativeAll}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm"
            >
              <ShieldX size={13} />
              Negativar todos ({suggestions.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('NO_CONV');
                window.scrollTo({ top: 600, behavior: 'smooth' });
              }}
              className="px-3 py-2 text-xs font-bold rounded-lg border border-border hover:bg-accent"
            >
              Revisar um a um
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg"
        >
          <option value="ALL">Todas as campanhas</option>
          {campaigns.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border">
          {(
            [
              { v: 'ALL', l: 'Todos' },
              { v: 'WITH_CONV', l: 'Com conversão' },
              { v: 'NO_CONV', l: 'Sem conversão' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setStatusFilter(opt.v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                statusFilter === opt.v
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
            placeholder="Buscar termo..."
            className="pl-7 pr-3 py-1.5 text-xs bg-card border border-border rounded-lg w-52"
          />
        </div>

        <span className="text-[11px] text-muted-foreground ml-auto">
          {filtered.length}/{terms.length} termo{terms.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando termos...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Inbox size={40} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Nenhum termo bate com os filtros.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5">Termo</th>
                <th className="text-left px-3 py-2.5">Campanha / Grupo</th>
                <th className="text-right px-3 py-2.5">Clicks</th>
                <th className="text-right px-3 py-2.5">Conv</th>
                <th className="text-right px-3 py-2.5">Gasto</th>
                <th className="text-right px-3 py-2.5">CTR</th>
                <th className="text-right px-3 py-2.5 w-32">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const offender = t.cost_brl > 5 && t.conversions === 0;
                const winner = t.conversions > 0;
                return (
                  <tr
                    key={t.id}
                    className={`border-t border-border ${
                      winner
                        ? 'bg-emerald-500/5'
                        : offender
                          ? 'bg-red-500/5'
                          : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {winner && (
                        <CheckCircle2
                          size={11}
                          className="inline text-emerald-500 mr-1"
                        />
                      )}
                      {offender && (
                        <AlertTriangle
                          size={11}
                          className="inline text-red-500 mr-1"
                        />
                      )}
                      {t.search_term}
                      {t.match_type && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          ({t.match_type})
                        </span>
                      )}
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
                      {t.clicks}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.conversions.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {fmtBRL(t.cost_brl)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtPct(t.ctr)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {t.status === 'EXCLUDED' ? (
                        <span className="text-[10px] text-muted-foreground">
                          Já negativado
                        </span>
                      ) : t.conversions === 0 && t.ad_group_id ? (
                        <button
                          type="button"
                          onClick={() => negativeOne(t)}
                          disabled={!perms.canManageTrafego}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-700 disabled:opacity-40"
                        >
                          <ShieldX size={11} /> Negativar
                        </button>
                      ) : winner ? (
                        <span title="Termo convertendo">
                          <CheckCircle2 size={14} className="text-emerald-500 inline" />
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de batch negativas (cross-campaign permitido) */}
      <AddNegativesModal
        open={negativesOpen}
        campaignId={null}
        campaignName="Cross-campaign"
        defaultTerms={presetTerms}
        allowAllCampaigns
        onClose={() => setNegativesOpen(false)}
        onSaved={() => {
          for (const id of suggestions.map((s) => s.id)) {
            dismissSuggestion(id);
          }
          setTimeout(load, 4000);
        }}
      />
    </div>
  );
}
