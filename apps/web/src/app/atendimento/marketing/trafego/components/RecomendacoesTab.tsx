'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Lightbulb,
  Loader2,
  RefreshCw,
  CheckCircle2,
  X,
  ShieldAlert,
  ShieldCheck,
  Zap,
  TrendingUp,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type Status =
  | 'PENDING'
  | 'READY'
  | 'OAB_BLOCKED'
  | 'APPLIED'
  | 'DISMISSED'
  | 'EXPIRED'
  | 'ERROR';

interface Recommendation {
  id: string;
  google_resource_name: string;
  recommendation_type: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  payload: any;
  impact_base: any;
  impact_potential: any;
  status: Status;
  oab_violations: any;
  oab_summary: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  error_message: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface ListResponse {
  items: Recommendation[];
  counts_by_status: Record<string, number>;
}

const TYPE_LABEL: Record<string, string> = {
  KEYWORD: 'Adicionar palavra-chave',
  KEYWORD_NEGATIVE: 'Adicionar palavra negativa',
  KEYWORD_MATCH_TYPE: 'Trocar match type',
  USE_BROAD_MATCH_KEYWORD: 'Migrar p/ broad match',
  CAMPAIGN_BUDGET: 'Ajustar orçamento',
  TEXT_AD: 'Anúncio de texto',
  RESPONSIVE_SEARCH_AD: 'Migrar p/ RSA',
  RESPONSIVE_SEARCH_AD_ASSET: 'Adicionar asset RSA',
  CALLOUT_ASSET: 'Adicionar callout',
  SITELINK_ASSET: 'Adicionar sitelink',
  CALL_ASSET: 'Adicionar extensão de chamada',
  TARGET_CPA_OPT_IN: 'Ativar Target CPA',
  TARGET_ROAS_OPT_IN: 'Ativar Target ROAS',
  MAXIMIZE_CONVERSIONS_OPT_IN: 'Ativar Max Conversions',
  MAXIMIZE_CLICKS_OPT_IN: 'Ativar Max Clicks',
  ENHANCED_CPC_OPT_IN: 'Ativar ECPC',
  MOVE_UNUSED_BUDGET: 'Realocar orçamento ocioso',
  OPTIMIZE_AD_ROTATION: 'Otimizar rotação de anúncios',
  SEARCH_PARTNERS_OPT_IN: 'Ativar Search Partners',
  IMPROVE_GOOGLE_TAG_COVERAGE: 'Melhorar cobertura da tag',
  IMPROVE_PERFORMANCE_MAX_AD_STRENGTH: 'Reforçar PMax',
  LEAD_FORM_ASSET: 'Adicionar Lead Form',
};

const STATUS_BADGE: Record<
  Status,
  { color: string; icon: any; label: string }
> = {
  PENDING: { color: 'bg-zinc-500/15 text-zinc-600', icon: Loader2, label: 'Pendente' },
  READY: { color: 'bg-sky-500/15 text-sky-600', icon: ShieldCheck, label: 'Pronta' },
  OAB_BLOCKED: { color: 'bg-amber-500/15 text-amber-600', icon: ShieldAlert, label: 'OAB' },
  APPLIED: { color: 'bg-emerald-500/15 text-emerald-600', icon: CheckCircle2, label: 'Aplicada' },
  DISMISSED: { color: 'bg-zinc-500/15 text-zinc-500', icon: X, label: 'Descartada' },
  EXPIRED: { color: 'bg-zinc-500/15 text-zinc-500', icon: X, label: 'Expirada' },
  ERROR: { color: 'bg-red-500/15 text-red-600', icon: ShieldAlert, label: 'Erro' },
};

const fmtBRL = (raw: unknown): string | null => {
  const v = typeof raw === 'string' ? Number(raw) : (raw as number | undefined);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(v / 1_000_000);
};

const fmtNum = (raw: unknown): string | null => {
  const v = typeof raw === 'string' ? Number(raw) : (raw as number | undefined);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v);
};

export function RecomendacoesTab({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'OPEN' | 'APPLIED' | 'OAB_BLOCKED' | 'ALL'>(
    'OPEN',
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filter === 'APPLIED') params.status = 'APPLIED';
      else if (filter === 'OAB_BLOCKED') params.status = 'OAB_BLOCKED';
      // OPEN é o default do backend (PENDING|READY|OAB_BLOCKED|ERROR)
      // ALL = sem filtro
      else if (filter === 'ALL') {
        // backend não tem opção "all" — buscamos por cada status e juntamos
        // pra simplicidade, em ALL usamos limite alto em READY+APPLIED+DISMISSED
        params.limit = '300';
      }
      const { data } = await api.get<ListResponse>('/trafego/recommendations', {
        params,
      });
      setItems(data.items);
      setCounts(data.counts_by_status);
    } catch {
      showError('Erro ao carregar recomendações.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function syncNow() {
    if (!canManage) return;
    setSyncing(true);
    try {
      await api.post('/trafego/recommendations/sync');
      showSuccess('Sync iniciado. Recarregando em 30s...');
      setTimeout(() => load(), 30_000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro no sync.');
    } finally {
      setSyncing(false);
    }
  }

  async function apply(rec: Recommendation, force = false) {
    if (!canManage) return;
    if (
      rec.status === 'OAB_BLOCKED' &&
      !confirm(
        `Esta recomendação foi bloqueada pelo filtro OAB:\n\n${rec.oab_summary}\n\nAplicar mesmo assim? (override)`,
      )
    ) {
      return;
    }
    setActionId(rec.id);
    try {
      await api.post(`/trafego/recommendations/${rec.id}/apply`, { force });
      showSuccess('Apply enfileirado. Atualizando em 30s...');
      setTimeout(() => load(), 30_000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro no apply.');
    } finally {
      setActionId(null);
    }
  }

  async function dismiss(rec: Recommendation) {
    if (!canManage) return;
    setActionId(rec.id);
    try {
      await api.post(`/trafego/recommendations/${rec.id}/dismiss`);
      showSuccess('Descartada. Atualizando...');
      setTimeout(() => load(), 30_000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro ao descartar.');
    } finally {
      setActionId(null);
    }
  }

  const totalOpen =
    (counts.PENDING ?? 0) +
    (counts.READY ?? 0) +
    (counts.OAB_BLOCKED ?? 0) +
    (counts.ERROR ?? 0);

  return (
    <div>
      <Header
        canManage={canManage}
        syncing={syncing}
        totalOpen={totalOpen}
        applied={counts.APPLIED ?? 0}
        oabBlocked={counts.OAB_BLOCKED ?? 0}
        onSync={syncNow}
      />

      <FilterTabs filter={filter} setFilter={setFilter} counts={counts} />

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty filter={filter} />
      ) : (
        <List
          items={items}
          actionId={actionId}
          canManage={canManage}
          onApply={apply}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}

function Header({
  canManage,
  syncing,
  totalOpen,
  applied,
  oabBlocked,
  onSync,
}: {
  canManage: boolean;
  syncing: boolean;
  totalOpen: number;
  applied: number;
  oabBlocked: number;
  onSync: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow">
          <Lightbulb size={18} className="text-white" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground">
            Recomendações Google Ads
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {totalOpen} aberta(s) · {applied} aplicada(s) ·{' '}
            <span className="text-amber-700">
              {oabBlocked} bloqueada(s) por OAB
            </span>
            {' · '}atualizada diariamente às 07:30 (Maceió)
          </p>
        </div>
      </div>
      {canManage && (
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          Atualizar agora
        </button>
      )}
    </div>
  );
}

function FilterTabs({
  filter,
  setFilter,
  counts,
}: {
  filter: 'OPEN' | 'APPLIED' | 'OAB_BLOCKED' | 'ALL';
  setFilter: (f: 'OPEN' | 'APPLIED' | 'OAB_BLOCKED' | 'ALL') => void;
  counts: Record<string, number>;
}) {
  const totalOpen =
    (counts.PENDING ?? 0) + (counts.READY ?? 0) + (counts.OAB_BLOCKED ?? 0) + (counts.ERROR ?? 0);
  const tabs: Array<{
    id: 'OPEN' | 'APPLIED' | 'OAB_BLOCKED' | 'ALL';
    label: string;
    count?: number;
  }> = [
    { id: 'OPEN', label: 'Abertas', count: totalOpen },
    { id: 'OAB_BLOCKED', label: 'OAB', count: counts.OAB_BLOCKED },
    { id: 'APPLIED', label: 'Aplicadas', count: counts.APPLIED },
    { id: 'ALL', label: 'Todas' },
  ];
  return (
    <div className="flex items-center gap-1 mb-3 text-xs">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setFilter(t.id)}
          className={`px-3 py-1.5 rounded-md font-semibold ${
            filter === t.id
              ? 'bg-amber-500/15 text-amber-700 border border-amber-500/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>
  );
}

function Loading() {
  return (
    <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
      <Loader2 size={28} className="animate-spin mb-2" />
      <p className="text-sm">Carregando recomendações...</p>
    </div>
  );
}

function Empty({ filter }: { filter: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-10 text-center">
      <Lightbulb size={36} className="mx-auto text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">
        {filter === 'OPEN'
          ? 'Sem recomendações abertas. Tudo em ordem 🎉'
          : 'Sem recomendações nesta categoria.'}
      </p>
    </div>
  );
}

function List({
  items,
  actionId,
  canManage,
  onApply,
  onDismiss,
}: {
  items: Recommendation[];
  actionId: string | null;
  canManage: boolean;
  onApply: (r: Recommendation, force?: boolean) => void;
  onDismiss: (r: Recommendation) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((r) => (
        <Card
          key={r.id}
          rec={r}
          loading={actionId === r.id}
          canManage={canManage}
          onApply={onApply}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function Card({
  rec,
  loading,
  canManage,
  onApply,
  onDismiss,
}: {
  rec: Recommendation;
  loading: boolean;
  canManage: boolean;
  onApply: (r: Recommendation, force?: boolean) => void;
  onDismiss: (r: Recommendation) => void;
}) {
  const st = STATUS_BADGE[rec.status];
  const StatusIcon = st.icon;
  const typeLabel = TYPE_LABEL[rec.recommendation_type] ?? rec.recommendation_type;

  // impact_potential: { conversions, cost_micros, clicks, impressions }
  const potConv = fmtNum(rec.impact_potential?.conversions);
  const potCost = fmtBRL(rec.impact_potential?.cost_micros);
  const potClicks = fmtNum(rec.impact_potential?.clicks);

  const showActions =
    canManage && ['READY', 'OAB_BLOCKED', 'PENDING', 'ERROR'].includes(rec.status);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
          <Lightbulb size={16} className="text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-bold">{typeLabel}</span>
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md ${st.color}`}
            >
              <StatusIcon size={11} />
              {st.label}
            </span>
            <span className="text-[11px] text-muted-foreground ml-auto">
              vista {new Date(rec.last_seen_at).toLocaleDateString('pt-BR')}
            </span>
          </div>

          {/* Impacto projetado */}
          {(potConv || potCost || potClicks) && (
            <div className="text-[12px] text-muted-foreground flex items-center gap-3 flex-wrap mb-2">
              <TrendingUp size={12} className="text-emerald-600" />
              <span>
                Potencial:{' '}
                {potConv && (
                  <span className="text-foreground font-semibold">
                    +{potConv} conv
                  </span>
                )}
                {potClicks && (
                  <>
                    {' · '}
                    <span className="text-foreground">+{potClicks} cliques</span>
                  </>
                )}
                {potCost && (
                  <>
                    {' · '}
                    <span className="text-foreground">{potCost} extra</span>
                  </>
                )}
              </span>
            </div>
          )}

          {/* Detalhes específicos */}
          <RecommendationDetails rec={rec} />

          {/* Mensagem OAB (se bloqueada) */}
          {rec.status === 'OAB_BLOCKED' && rec.oab_summary && (
            <div className="mt-2 text-[11px] flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-800">
              <ShieldAlert size={12} className="shrink-0 mt-0.5" />
              <span>{rec.oab_summary}</span>
            </div>
          )}
          {rec.status === 'ERROR' && rec.error_message && (
            <div className="mt-2 text-[11px] text-red-600">
              {rec.error_message}
            </div>
          )}
          {rec.status === 'APPLIED' && rec.resolved_at && (
            <div className="mt-1 text-[11px] text-muted-foreground italic">
              Aplicada em {new Date(rec.resolved_at).toLocaleString('pt-BR')}
              {rec.resolved_by && ` por ${rec.resolved_by}`}.
            </div>
          )}

          {/* Ações */}
          {showActions && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onApply(rec, rec.status === 'OAB_BLOCKED')}
                disabled={loading}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 disabled:opacity-50"
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                {rec.status === 'OAB_BLOCKED' ? 'Aplicar (override OAB)' : 'Aplicar'}
              </button>
              <button
                onClick={() => onDismiss(rec)}
                disabled={loading}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-card hover:bg-accent border border-border disabled:opacity-50"
              >
                <X size={11} /> Descartar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecommendationDetails({ rec }: { rec: Recommendation }) {
  const p = rec.payload ?? {};
  switch (rec.recommendation_type) {
    case 'KEYWORD':
    case 'USE_BROAD_MATCH_KEYWORD': {
      const text =
        p?.keyword_recommendation?.keyword?.text ??
        p?.use_broad_match_keyword_recommendation?.keyword?.text;
      const matchType =
        p?.keyword_recommendation?.keyword?.match_type ??
        p?.use_broad_match_keyword_recommendation?.keyword?.match_type;
      return text ? (
        <p className="text-sm text-foreground">
          <strong>"{text}"</strong>
          {matchType && (
            <span className="text-[11px] text-muted-foreground ml-1">
              ({matchType})
            </span>
          )}
        </p>
      ) : null;
    }
    case 'CAMPAIGN_BUDGET': {
      const current =
        p?.campaign_budget_recommendation?.current_budget_amount_micros;
      const recommended =
        p?.campaign_budget_recommendation?.recommended_budget_amount_micros;
      return current && recommended ? (
        <p className="text-sm text-foreground">
          {fmtBRL(current)} → <strong>{fmtBRL(recommended)}</strong>/dia
        </p>
      ) : null;
    }
    case 'TEXT_AD':
    case 'RESPONSIVE_SEARCH_AD':
    case 'RESPONSIVE_SEARCH_AD_ASSET': {
      const ad =
        p?.text_ad_recommendation?.ad ??
        p?.responsive_search_ad_recommendation?.ad ??
        p?.responsive_search_ad_asset_recommendation?.current_ad;
      const headlines = Array.isArray(ad?.headlines)
        ? ad.headlines.slice(0, 3).map((h: any) => h?.text).filter(Boolean).join(' • ')
        : null;
      return headlines ? (
        <p className="text-sm text-foreground italic">"{headlines}"</p>
      ) : null;
    }
    default:
      return null;
  }
}
