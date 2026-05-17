'use client';

// MODO MONITORAMENTO (2026-05-17): essa tab foi simplificada pra READ-ONLY do
// ponto de vista do Google Ads. Todas as acoes de mutate (pause/resume/delete,
// budget edit, bidding strategy, create campaign/RSA) foram removidas — sao
// operadas exclusivamente pelo gestor de trafego Claude via MCP server.
//
// Continuam disponiveis: filtros, ordenacao, busca, favoritos (CRM-side),
// tags (CRM-side), navegacao pra detail. Essas sao anotacoes internas do
// escritorio, nao tocam no Google Ads.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Star,
  Loader2,
  Inbox,
  Tag,
  X,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { SearchTermsCard } from './SearchTermsCard';
import { ImpressionShareBar } from './ImpressionShareBar';
import { AdStrengthBadge } from './AdStrengthBadge';

interface MetricsWindow {
  days: number;
  spend_brl: number;
  conversions: number;
  clicks: number;
  impressions: number;
  cpl_brl: number;
  ctr: number;
  avg_cpc_brl: number;
  // P2: impression share fields
  impression_share: number | null;
  lost_is_budget: number | null;
  lost_is_rank: number | null;
  top_impression_share: number | null;
  abs_top_impression_share: number | null;
}

interface Campaign {
  id: string;
  google_campaign_id: string;
  name: string;
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
  channel_type: string | null;
  daily_budget_brl: number | null;
  bidding_strategy: string | null;
  is_favorite: boolean;
  is_archived_internal: boolean;
  tags: string[];
  notes: string | null;
  ad_strength: 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT' | 'PENDING' | 'NO_ADS' | null;
  metrics_window?: MetricsWindow;
}

type SortKey =
  | 'favorite'
  | 'name'
  | 'channel_type'
  | 'status'
  | 'daily_budget_brl'
  | 'conversions'
  | 'cpl_brl'
  | 'ctr'
  | 'imp_share';

const STATUS_BADGE: Record<string, string> = {
  ENABLED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PAUSED: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REMOVED: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  ENABLED: 'Ativa',
  PAUSED: 'Pausada',
  REMOVED: 'Removida',
};

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'ENABLED', label: 'Ativas' },
  { value: 'PAUSED', label: 'Pausadas' },
];

const fmtBRL = (v: number | null) =>
  v === null
    ? '—'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(v);

const fmtPct = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);

/**
 * Sugere tags com base no nome da campanha. Heurística simples:
 *   - "Search"|"Pesquisa"  → "search"
 *   - "PMax"|"Performance Max" → "pmax"
 *   - "Display" → "display"
 *   - "Trabalhista"|"Civil"|"Criminal"|"Família"|"Previdenciário" → área
 */
function getApiErrorMessage(err: unknown, fallback: string) {
  if (typeof err !== 'object' || err === null || !('response' in err)) {
    return fallback;
  }
  const response = (err as { response?: { data?: { message?: unknown } } })
    .response;
  return typeof response?.data?.message === 'string'
    ? response.data.message
    : fallback;
}

function suggestTagsFromName(name: string): string[] {
  const n = name.toLowerCase();
  const out = new Set<string>();
  if (/(search|pesquisa)/.test(n)) out.add('search');
  if (/(pmax|performance.?max)/.test(n)) out.add('pmax');
  if (/display/.test(n)) out.add('display');
  if (/youtube|video/.test(n)) out.add('video');
  if (/(trabalhista|trabalho|clt)/.test(n)) out.add('trabalhista');
  if (/(c[ií]vel|civil)/.test(n)) out.add('civil');
  if (/(criminal|penal)/.test(n)) out.add('criminal');
  if (/(fam[ií]lia|div[oó]rcio|alimento)/.test(n)) out.add('familia');
  if (/(previdenci[aá]rio|inss|aposentadoria)/.test(n)) out.add('previdenciario');
  if (/(empresarial|empresa|tribut[aá]rio)/.test(n)) out.add('empresarial');
  return [...out];
}

export function CampanhasTab({ canManage }: { canManage: boolean }) {
  // `canManage` aqui controla apenas anotacoes INTERNAS do CRM (favoritos,
  // tags, edicao de notas). Acoes de mutate no Google Ads (pause, resume,
  // delete, budget, bidding) NAO sao mais expostas — operadas via MCP server
  // pelo gestor de trafego.
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tagsEditId, setTagsEditId] = useState<string | null>(null);
  const [tagsInput, setTagsInput] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('favorite');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Campaign[]>('/trafego/campaigns', {
        params: { days: 30 },
      });
      setCampaigns(data);
    } catch {
      showError('Erro ao carregar campanhas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Tags conhecidas (todas as tags atuais + 5 mais populares como sugestão)
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of campaigns) {
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [campaigns]);

  // Aplica filtros (status + tag + busca por nome) + ordenação por coluna
  const filteredCampaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = campaigns.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (tagFilter && !c.tags.includes(tagFilter)) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });

    // Ordena: favoritas sempre primeiro independente do sortKey escolhido
    // (exceto quando sortKey === 'favorite', aí é o critério principal).
    const sorted = [...filtered].sort((a, b) => {
      // Favoritas no topo (a menos que esteja ordenando por outra coisa que justifique)
      if (sortKey !== 'favorite') {
        if (a.is_favorite && !b.is_favorite) return -1;
        if (!a.is_favorite && b.is_favorite) return 1;
      }

      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case 'favorite':
          av = a.is_favorite ? 1 : 0;
          bv = b.is_favorite ? 1 : 0;
          break;
        case 'name':
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
          break;
        case 'channel_type':
          av = (a.channel_type ?? '').toLowerCase();
          bv = (b.channel_type ?? '').toLowerCase();
          break;
        case 'status':
          av = a.status;
          bv = b.status;
          break;
        case 'daily_budget_brl':
          av = a.daily_budget_brl ?? -1;
          bv = b.daily_budget_brl ?? -1;
          break;
        case 'conversions':
          av = a.metrics_window?.conversions ?? 0;
          bv = b.metrics_window?.conversions ?? 0;
          break;
        case 'cpl_brl':
          // CPL=0 vai pro fim (sem conversões = sem CPL)
          av = a.metrics_window?.cpl_brl || Number.POSITIVE_INFINITY;
          bv = b.metrics_window?.cpl_brl || Number.POSITIVE_INFINITY;
          break;
        case 'ctr':
          av = a.metrics_window?.ctr ?? 0;
          bv = b.metrics_window?.ctr ?? 0;
          break;
        case 'imp_share':
          av = a.metrics_window?.impression_share ?? -1;
          bv = b.metrics_window?.impression_share ?? -1;
          break;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [campaigns, statusFilter, tagFilter, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Default direction por tipo: numéricos = desc (maior primeiro), texto = asc
      const isNumeric =
        key === 'daily_budget_brl' ||
        key === 'conversions' ||
        key === 'cpl_brl' ||
        key === 'ctr' ||
        key === 'favorite';
      // CPL: asc default (menor é melhor)
      setSortDir(key === 'cpl_brl' ? 'asc' : isNumeric ? 'desc' : 'asc');
    }
  }

  async function toggleFavorite(c: Campaign) {
    if (!canManage) return;
    try {
      await api.patch(`/trafego/campaigns/${c.id}`, {
        is_favorite: !c.is_favorite,
      });
      setCampaigns((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, is_favorite: !c.is_favorite } : x,
        ),
      );
      showSuccess(c.is_favorite ? 'Removida dos favoritos' : 'Marcada como favorita');
    } catch {
      showError('Erro ao atualizar campanha.');
    }
  }

  function openTagsEditor(c: Campaign) {
    if (!canManage) return;
    setTagsEditId(c.id);
    setTagsInput(c.tags.join(', '));
  }

  async function saveTags(c: Campaign) {
    if (!canManage) return;
    const tags = tagsInput
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    setActingId(c.id);
    try {
      await api.patch(`/trafego/campaigns/${c.id}`, { tags });
      setCampaigns((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, tags } : x)),
      );
      setTagsEditId(null);
      showSuccess('Tags atualizadas.');
    } catch {
      showError('Erro ao salvar tags.');
    } finally {
      setActingId(null);
    }
  }

  async function applySuggestedTags(c: Campaign) {
    if (!canManage) return;
    const suggested = suggestTagsFromName(c.name);
    if (suggested.length === 0) {
      showError('Sem sugestões para esta campanha.');
      return;
    }
    const merged = [...new Set([...c.tags, ...suggested])];
    setActingId(c.id);
    try {
      await api.patch(`/trafego/campaigns/${c.id}`, { tags: merged });
      setCampaigns((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, tags: merged } : x)),
      );
      showSuccess(`Sugestões aplicadas: ${suggested.join(', ')}`);
    } catch {
      showError('Erro ao aplicar sugestões.');
    } finally {
      setActingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 size={28} className="animate-spin mb-2" />
        <p className="text-sm">Carregando campanhas...</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <Inbox size={40} className="mx-auto text-muted-foreground mb-3" />
        <h3 className="text-base font-bold text-foreground mb-1">
          Nenhuma campanha ainda
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Após o primeiro sync com a Google Ads API, as campanhas aparecem
          aqui com métricas e status pra monitoramento. Operacao (criar,
          pausar, ajustar) eh feita pelo gestor de trafego via MCP.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ─── Filtros ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === opt.value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
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
            placeholder="Buscar por nome..."
            className="pl-7 pr-3 py-1.5 text-xs bg-card border border-border rounded-lg w-52"
          />
        </div>

        {allTags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[11px] text-muted-foreground">tags:</span>
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                tagFilter === null
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted'
              }`}
            >
              todas
            </button>
            {allTags.slice(0, 8).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTagFilter(tagFilter === t ? null : t)}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                  tagFilter === t
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                }`}
              >
                <Tag size={9} className="inline mr-0.5" />
                {t}
              </button>
            ))}
          </div>
        )}

        <span className="text-[11px] text-muted-foreground ml-auto">
          {filteredCampaigns.length}/{campaigns.length} campanha
          {campaigns.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ─── Tabela ────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <SortableHeader
                k="favorite"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="left"
                width="w-8"
              />
              <SortableHeader
                label="Campanha"
                k="name"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <SortableHeader
                label="Tipo"
                k="channel_type"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <SortableHeader
                label="Status"
                k="status"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <SortableHeader
                label="Orçamento/dia"
                k="daily_budget_brl"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Conv (30d)"
                k="conversions"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="right"
                title="Conversões últimos 30 dias"
              />
              <SortableHeader
                label="CPL (30d)"
                k="cpl_brl"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="right"
                title="Custo por lead últimos 30 dias"
              />
              <SortableHeader
                label="CTR (30d)"
                k="ctr"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="right"
                title="Click-through rate últimos 30 dias"
              />
              <SortableHeader
                label="Imp. Share"
                k="imp_share"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="left"
                title="Parcela de impressões (% das buscas em que apareceu)"
              />
              <th className="text-left px-3 py-3" title="Força do anúncio (Google) — calculada a partir do melhor RSA da campanha">
                Ad Strength
              </th>
              <th className="text-left px-3 py-3">Tags</th>
            </tr>
          </thead>
          <tbody>
            {filteredCampaigns.map((c) => {
              const m = c.metrics_window;
              return (
                <tr
                  key={c.id}
                  className="border-t border-border hover:bg-accent/30 transition-colors"
                >
                  <td className="px-3 py-3">
                    <button
                      onClick={() => toggleFavorite(c)}
                      disabled={!canManage}
                      className="text-muted-foreground hover:text-amber-500 disabled:cursor-not-allowed"
                      title={c.is_favorite ? 'Remover favorita' : 'Marcar favorita'}
                    >
                      <Star
                        size={16}
                        fill={c.is_favorite ? 'currentColor' : 'none'}
                        className={c.is_favorite ? 'text-amber-500' : ''}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/atendimento/marketing/trafego/campanhas/${c.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline transition-colors"
                    >
                      {c.name}
                    </Link>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      ID {c.google_campaign_id}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {c.channel_type ?? '—'}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        STATUS_BADGE[c.status] ?? 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {fmtBRL(c.daily_budget_brl)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {m?.conversions ?? 0}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {m && m.conversions > 0 ? fmtBRL(m.cpl_brl) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {m && m.impressions > 0 ? fmtPct(m.ctr) : '—'}
                  </td>
                  <td className="px-3 py-3 w-32">
                    <ImpressionShareBar share={m?.impression_share ?? null} />
                  </td>
                  <td className="px-3 py-3">
                    <AdStrengthBadge strength={c.ad_strength} />
                  </td>
                  <td className="px-3 py-3">
                    {tagsEditId === c.id ? (
                      <TagsEditor
                        value={tagsInput}
                        onChange={setTagsInput}
                        onSave={() => saveTags(c)}
                        onCancel={() => setTagsEditId(null)}
                        knownTags={allTags}
                        suggestions={suggestTagsFromName(c.name)}
                      />
                    ) : (
                      <div
                        className="flex gap-1 flex-wrap items-center cursor-pointer"
                        onClick={() => openTagsEditor(c)}
                        title={canManage ? 'Editar tags' : ''}
                      >
                        {c.tags.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] font-semibold px-1.5 py-0.5 bg-primary/10 text-primary rounded"
                          >
                            <Tag size={9} className="inline mr-0.5" />
                            {t}
                          </span>
                        ))}
                        {c.tags.length === 0 && canManage && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              applySuggestedTags(c);
                            }}
                            className="text-[10px] text-muted-foreground hover:text-primary"
                          >
                            + sugerir
                          </button>
                        )}
                        {c.tags.length === 0 && !canManage && (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredCampaigns.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma campanha bate com os filtros.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('ALL');
                      setTagFilter(null);
                      setSearch('');
                    }}
                    className="text-primary font-semibold hover:underline"
                  >
                    Limpar filtros
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Search Terms Report — leitura apenas */}
      <SearchTermsCard canManage={canManage} />
    </div>
  );
}

// ─── Header de tabela ordenável ──────────────────────────────────────────

function SortableHeader({
  label,
  k,
  sortKey,
  sortDir,
  onToggle,
  align = 'left',
  width,
  title,
}: {
  label?: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onToggle: (k: SortKey) => void;
  align?: 'left' | 'right';
  width?: string;
  title?: string;
}) {
  const active = sortKey === k;
  const Icon = active
    ? sortDir === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <th
      className={`px-3 py-3 ${align === 'right' ? 'text-right' : 'text-left'} ${width ?? ''}`}
      title={title}
    >
      <button
        type="button"
        onClick={() => onToggle(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label && <span>{label}</span>}
        <Icon
          size={11}
          strokeWidth={active ? 3 : 2}
          className={active ? '' : 'opacity-50'}
        />
      </button>
    </th>
  );
}

// ─── Editor de tags inline com autocomplete ─────────────────────────────────

function TagsEditor({
  value,
  onChange,
  onSave,
  onCancel,
  knownTags,
  suggestions,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  knownTags: string[];
  suggestions: string[];
}) {
  // Autocomplete: tags já presentes neste valor + sugeridas
  const currentTokens = value
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const lastToken = currentTokens[currentTokens.length - 1] ?? '';
  const candidates = useMemo(() => {
    const pool = [...new Set([...knownTags, ...suggestions])];
    return pool
      .filter((t) => !currentTokens.slice(0, -1).includes(t))
      .filter((t) => t.startsWith(lastToken) && t !== lastToken)
      .slice(0, 6);
  }, [knownTags, suggestions, currentTokens, lastToken]);

  function pickSuggestion(t: string) {
    const tokens = currentTokens.slice(0, -1);
    tokens.push(t);
    onChange(tokens.join(', ') + ', ');
  }

  return (
    <div className="flex flex-col gap-1 min-w-[220px]">
      <div className="flex gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSave();
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
          placeholder="ex: search, trabalhista"
          className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded"
        />
        <button
          type="button"
          onClick={onSave}
          className="px-2 py-1 text-[11px] font-bold rounded bg-violet-600 hover:bg-violet-700 text-white"
        >
          OK
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-1.5 py-1 text-[11px] rounded hover:bg-accent text-muted-foreground"
        >
          <X size={12} />
        </button>
      </div>
      {(candidates.length > 0 || suggestions.length > 0) && (
        <div className="flex gap-1 flex-wrap">
          {candidates.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pickSuggestion(t)}
              className="text-[10px] font-semibold px-1.5 py-0.5 bg-primary/10 text-primary rounded hover:bg-primary/20"
            >
              {t}
            </button>
          ))}
          {candidates.length === 0 &&
            suggestions
              .filter((s) => !currentTokens.includes(s))
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-500/10 text-amber-700 rounded hover:bg-amber-500/20"
                  title="Sugestão automática baseada no nome"
                >
                  + {s}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
