'use client';

// MODO MONITORAMENTO (2026-05-17): pagina READ-ONLY. Botoes "Negativar" /
// "Negativar todos" removidos — operacao via gestor de trafego Claude
// (tools traffic_add_negative_to_ad_group / traffic_add_negative_to_campaign
// via MCP).
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Inbox,
  Search,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { showError } from '@/lib/toast';
import { Pagination } from '../components/Pagination';

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
 * Página dedicada de termos de busca cross-campaign. Read-only — exibe:
 *   1. Banner de "candidatos a negativar" (gasto > R$3 + 0 conv) — info
 *      pro operador identificar oportunidades. A negativacao em si eh
 *      delegada ao gestor de trafego Claude via MCP.
 *   2. Lista completa filtravel com coluna de Campanha visivel.
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
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Reset paginação quando filtros mudam
  useEffect(() => {
    setPage(1);
  }, [campaignFilter, statusFilter, search]);

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

  // Sugestões automáticas (informativas): gasto > R$3 + 0 conv
  const suggestions = useMemo(() => {
    return terms.filter(
      (t) =>
        t.cost_brl > 3 &&
        t.conversions === 0 &&
        t.status !== 'EXCLUDED',
    );
  }, [terms]);

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

      {/* Banner informativo de candidatos a negativacao */}
      {suggestions.length > 0 && (
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
                Negativacao eh feita pelo gestor de trafego via MCP
                (<code>traffic_add_negative_to_ad_group</code> ou{' '}
                <code>traffic_add_negative_to_campaign</code>).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 24).map((s) => (
              <span
                key={s.id}
                className="text-[11px] font-mono px-2 py-1 bg-card border border-red-500/30 rounded text-foreground"
                title={`${fmtBRL(s.cost_brl)} • ${s.clicks} clicks`}
              >
                {s.search_term}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({fmtBRL(s.cost_brl)})
                </span>
              </span>
            ))}
            {suggestions.length > 24 && (
              <span className="text-[11px] text-muted-foreground self-center px-2">
                +{suggestions.length - 24} mais
              </span>
            )}
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
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5">Termo</th>
                <th className="text-left px-3 py-2.5">Campanha / Grupo</th>
                <th className="text-right px-3 py-2.5">Clicks</th>
                <th className="text-right px-3 py-2.5">Conv</th>
                <th className="text-right px-3 py-2.5">Gasto</th>
                <th className="text-right px-3 py-2.5">CTR</th>
                <th className="text-left px-3 py-2.5 w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                .map((t) => {
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
                      <td className="px-3 py-2">
                        {t.status === 'EXCLUDED' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600">
                            Negativado
                          </span>
                        ) : winner ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">
                            Convertendo
                          </span>
                        ) : offender ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                            Sem conv
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
          <Pagination
            total={filtered.length}
            pageSize={PAGE_SIZE}
            currentPage={page}
            onPageChange={setPage}
            itemLabel="termo"
          />
        </div>
      )}
    </div>
  );
}
