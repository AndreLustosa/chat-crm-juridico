'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  Edit3,
  TrendingUp,
  FileText,
  Plus,
  ShieldX,
  Star,
  Activity,
  KeyRound,
  Search,
  Megaphone,
  Trash2,
  AlertCircle,
  Clock,
  Smartphone,
  Monitor,
  Tablet,
  Tv,
  HelpCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { showError, showSuccess } from '@/lib/toast';
import { KpiCard } from '../../components/KpiCard';
import { BiddingStrategyModal } from '../../components/BiddingStrategyModal';
import { CreateRsaModal } from '../../components/CreateRsaModal';
import { ImpressionShareSegmentedBar } from '../../components/ImpressionShareBar';
import { AdStrengthBadge } from '../../components/AdStrengthBadge';
import { MatchTypeBadge } from '../../components/MatchTypeBadge';
import { AddNegativesModal } from '../../components/AddNegativesModal';

interface CampaignFull {
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
  ad_strength:
    | 'POOR'
    | 'AVERAGE'
    | 'GOOD'
    | 'EXCELLENT'
    | 'PENDING'
    | 'NO_ADS'
    | null;
  metrics_window?: {
    days: number;
    spend_brl: number;
    conversions: number;
    clicks: number;
    impressions: number;
    cpl_brl: number;
    ctr: number;
    avg_cpc_brl: number;
    impression_share: number | null;
    lost_is_budget: number | null;
    lost_is_rank: number | null;
    top_impression_share: number | null;
    abs_top_impression_share: number | null;
  };
}

interface HourlyMetrics {
  days: number;
  cells: {
    dow: number;
    hour: number;
    impressions: number;
    clicks: number;
    cost_brl: number;
    conversions: number;
    cpl_brl: number;
    ctr: number;
  }[];
}

interface DeviceMetrics {
  days: number;
  total_cost_brl: number;
  total_conversions: number;
  items: {
    device: string;
    impressions: number;
    clicks: number;
    cost_brl: number;
    conversions: number;
    cpl_brl: number;
    ctr: number;
    spend_share: number;
    conv_share: number;
  }[];
}

interface AdGroup {
  id: string;
  name: string;
  status: string;
  google_ad_group_id: string;
}

interface Keyword {
  id: string;
  text: string;
  match_type: string;
  status: string;
  negative: boolean;
  quality_score: number | null;
  cpc_bid_brl: number | null;
  ad_group_id: string;
}

interface Ad {
  id: string;
  ad_type: string;
  status: string;
  approval_status: string | null;
  ad_strength: string | null;
  final_urls: string[];
  headlines: { text?: string }[];
  descriptions: { text?: string }[];
  path1: string | null;
  path2: string | null;
  ad_group_id: string;
}

interface SearchTerm {
  id: string;
  search_term: string;
  match_type: string | null;
  status: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  cost_brl: number;
  clicks: number;
  conversions: number;
  cpl_brl: number;
  ctr: number;
}

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

type Tab =
  | 'overview'
  | 'keywords'
  | 'search-terms'
  | 'ads'
  | 'schedule'
  | 'devices'
  | 'negatives';

const VALID_TABS: Tab[] = [
  'overview',
  'keywords',
  'search-terms',
  'ads',
  'schedule',
  'devices',
  'negatives',
];

export default function CampaignDetailPage() {
  return (
    <Suspense fallback={null}>
      <CampaignDetailPageInner />
    </Suspense>
  );
}

function CampaignDetailPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const perms = useRole();
  const id = params.id;

  // Tab via URL (?tab=keywords) pra deep-link.
  const tab: Tab = (() => {
    const t = searchParams.get('tab');
    return t && (VALID_TABS as string[]).includes(t) ? (t as Tab) : 'overview';
  })();
  function setTab(next: Tab) {
    const sp = new URLSearchParams(searchParams.toString());
    if (next === 'overview') sp.delete('tab');
    else sp.set('tab', next);
    const qs = sp.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  const [campaign, setCampaign] = useState<CampaignFull | null>(null);
  const [adGroups, setAdGroups] = useState<AdGroup[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([]);
  const [hourly, setHourly] = useState<HourlyMetrics | null>(null);
  const [devices, setDevices] = useState<DeviceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [biddingOpen, setBiddingOpen] = useState(false);
  const [rsaOpen, setRsaOpen] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [negativesModalOpen, setNegativesModalOpen] = useState(false);

  // ─── Load ────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    try {
      // 1) Campaign meta + metrics
      const { data: list } = await api.get<CampaignFull[]>(
        '/trafego/campaigns',
        { params: { days: 30 } },
      );
      const found = list.find((c) => c.id === id);
      if (!found) {
        showError('Campanha não encontrada.');
        router.push('/atendimento/marketing/trafego');
        return;
      }
      setCampaign(found);

      // 2) Ad groups da campanha
      const { data: ag } = await api.get<AdGroup[]>('/trafego/ad-groups', {
        params: { campaign_id: id },
      });
      setAdGroups(ag);

      // 3) Keywords + Ads (em paralelo) por ad_group
      if (ag.length > 0) {
        const kwResults = await Promise.all(
          ag.map((g) =>
            api
              .get<Keyword[]>(`/trafego/ad-groups/${g.id}/keywords`)
              .then((r) => r.data.map((k) => ({ ...k, ad_group_id: g.id })))
              .catch(() => []),
          ),
        );
        const adsResults = await Promise.all(
          ag.map((g) =>
            api
              .get<Ad[]>(`/trafego/ad-groups/${g.id}/ads`)
              .then((r) => r.data.map((a) => ({ ...a, ad_group_id: g.id })))
              .catch(() => []),
          ),
        );
        setKeywords(kwResults.flat());
        setAds(adsResults.flat());
      }

      // 4) Search terms + hourly + devices em paralelo
      const [{ data: terms }, hourlyResp, deviceResp] = await Promise.all([
        api.get<SearchTerm[]>('/trafego/search-terms', {
          params: { campaign_id: id, limit: 200 },
        }),
        api
          .get<HourlyMetrics>(`/trafego/campaigns/${id}/hourly-metrics`, {
            params: { days: 30 },
          })
          .catch(() => ({ data: null })),
        api
          .get<DeviceMetrics>(`/trafego/campaigns/${id}/device-metrics`, {
            params: { days: 30 },
          })
          .catch(() => ({ data: null })),
      ]);
      setSearchTerms(terms);
      setHourly(hourlyResp.data ?? null);
      setDevices(deviceResp.data ?? null);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao carregar campanha.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ─── Actions ─────────────────────────────────────────────────────────
  async function pauseOrResume() {
    if (!campaign || !perms.canManageTrafego) return;
    const action = campaign.status === 'PAUSED' ? 'resume' : 'pause';
    const confirmMsg =
      action === 'pause'
        ? `Pausar "${campaign.name}" no Google Ads?`
        : `Reativar "${campaign.name}"?`;
    if (!confirm(confirmMsg)) return;
    setActing(true);
    try {
      await api.post(`/trafego/campaigns/${campaign.id}/${action}`);
      showSuccess(action === 'pause' ? 'Pausa enfileirada.' : 'Reativação enfileirada.');
      setTimeout(load, 4000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha.');
    } finally {
      setActing(false);
    }
  }

  async function toggleFavorite() {
    if (!campaign || !perms.canManageTrafego) return;
    try {
      await api.patch(`/trafego/campaigns/${campaign.id}`, {
        is_favorite: !campaign.is_favorite,
      });
      setCampaign({ ...campaign, is_favorite: !campaign.is_favorite });
    } catch {
      showError('Erro ao atualizar favorito.');
    }
  }

  async function negativeTerm(term: SearchTerm) {
    if (!perms.canManageTrafego || !term.ad_group_id) return;
    if (
      !confirm(
        `Adicionar "${term.search_term}" como negativa EXACT em "${term.ad_group_name}"?`,
      )
    )
      return;
    try {
      await api.post(`/trafego/ad-groups/${term.ad_group_id}/negatives`, {
        scope: 'AD_GROUP',
        negatives: [{ text: term.search_term, match_type: 'EXACT' }],
        reason: `Negativada via detalhe campanha (gasto ${fmtBRL(term.cost_brl)}, ${term.conversions} conv)`,
      });
      showSuccess(`"${term.search_term}" enfileirada.`);
      setTimeout(load, 3000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao negativar.');
    }
  }

  async function removeKeyword(kw: Keyword) {
    if (!perms.canManageTrafego) return;
    if (!confirm(`Remover keyword "${kw.text}" da campanha?`)) return;
    try {
      await api.delete(`/trafego/keywords/${kw.id}`);
      showSuccess('Keyword removida.');
      setTimeout(load, 3000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao remover.');
    }
  }

  // ─── Permissions ─────────────────────────────────────────────────────
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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) return null;

  const m = campaign.metrics_window;
  const positiveKw = keywords.filter((k) => !k.negative);
  const negativeKw = keywords.filter((k) => k.negative);

  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8">
      {/* Voltar */}
      <button
        type="button"
        onClick={() => router.push('/atendimento/marketing/trafego')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={14} />
        Voltar para Tráfego
      </button>

      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">
                {campaign.name}
              </h1>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[campaign.status] ?? 'bg-muted text-muted-foreground'}`}
              >
                {STATUS_LABEL[campaign.status] ?? campaign.status}
              </span>
              <AdStrengthBadge strength={campaign.ad_strength} />
              {perms.canManageTrafego && (
                <button
                  type="button"
                  onClick={toggleFavorite}
                  className="text-muted-foreground hover:text-amber-500"
                  title={campaign.is_favorite ? 'Remover favorita' : 'Marcar favorita'}
                >
                  <Star
                    size={16}
                    fill={campaign.is_favorite ? 'currentColor' : 'none'}
                    className={campaign.is_favorite ? 'text-amber-500' : ''}
                  />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              ID Google: {campaign.google_campaign_id}
            </p>
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground flex-wrap">
              <span>
                <strong className="text-foreground">Tipo:</strong>{' '}
                {campaign.channel_type ?? '—'}
              </span>
              <span>•</span>
              <span>
                <strong className="text-foreground">Lance:</strong>{' '}
                {campaign.bidding_strategy ?? '—'}
              </span>
              <span>•</span>
              <span>
                <strong className="text-foreground">Budget/dia:</strong>{' '}
                {fmtBRL(campaign.daily_budget_brl)}
              </span>
            </div>
          </div>

          {perms.canManageTrafego && (
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={pauseOrResume}
                disabled={acting || campaign.status === 'REMOVED'}
                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-accent disabled:opacity-50"
              >
                {campaign.status === 'PAUSED' ? (
                  <>
                    <Play size={13} /> Reativar
                  </>
                ) : (
                  <>
                    <Pause size={13} /> Pausar
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setBiddingOpen(true)}
                disabled={campaign.status === 'REMOVED'}
                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-accent disabled:opacity-50"
              >
                <TrendingUp size={13} /> Lances
              </button>
              {adGroups.length === 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setRsaOpen({ id: adGroups[0].id, name: adGroups[0].name })
                  }
                  disabled={campaign.status === 'REMOVED'}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                >
                  <Plus size={13} /> Novo RSA
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* P2 — Barra de saúde (impression share segmentada) */}
      {m && (
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-foreground">
              Saúde da campanha (30d)
            </h3>
            <div className="flex items-center gap-3 text-[11px]">
              {m.top_impression_share !== null && (
                <span className="text-muted-foreground">
                  No top:{' '}
                  <strong className="text-foreground">
                    {(m.top_impression_share * 100).toFixed(0)}%
                  </strong>
                </span>
              )}
              {m.abs_top_impression_share !== null && (
                <span className="text-muted-foreground">
                  Topo absoluto:{' '}
                  <strong className="text-foreground">
                    {(m.abs_top_impression_share * 100).toFixed(0)}%
                  </strong>
                </span>
              )}
            </div>
          </div>
          <ImpressionShareSegmentedBar
            share={m.impression_share}
            lostBudget={m.lost_is_budget}
            lostRank={m.lost_is_rank}
          />
        </div>
      )}

      {/* KPIs (30d) */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard
          label="Gasto 30d"
          value={fmtBRL(m?.spend_brl ?? 0)}
          accent="primary"
        />
        <KpiCard
          label="Conversões"
          value={String(Math.round(m?.conversions ?? 0))}
          accent="success"
        />
        <KpiCard
          label="CPL"
          value={m && m.conversions > 0 ? fmtBRL(m.cpl_brl) : '—'}
          accent="warning"
        />
        <KpiCard
          label="CPC"
          value={m && m.clicks > 0 ? fmtBRL(m.avg_cpc_brl) : '—'}
          accent="muted"
        />
        <KpiCard
          label="CTR"
          value={m && m.impressions > 0 ? fmtPct(m.ctr) : '—'}
          accent="muted"
        />
        <KpiCard
          label="Tx. conv"
          value={
            m && m.clicks > 0
              ? fmtPct(m.conversions / m.clicks)
              : '—'
          }
          accent="muted"
          hint="conv / clicks"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto no-scrollbar">
        <TabButton
          active={tab === 'overview'}
          onClick={() => setTab('overview')}
          icon={Activity}
          label="Visão geral"
        />
        <TabButton
          active={tab === 'keywords'}
          onClick={() => setTab('keywords')}
          icon={KeyRound}
          label={`Palavras-chave (${positiveKw.length})`}
        />
        <TabButton
          active={tab === 'search-terms'}
          onClick={() => setTab('search-terms')}
          icon={Search}
          label={`Termos de busca (${searchTerms.length})`}
        />
        <TabButton
          active={tab === 'ads'}
          onClick={() => setTab('ads')}
          icon={Megaphone}
          label={`Anúncios (${ads.length})`}
        />
        <TabButton
          active={tab === 'schedule'}
          onClick={() => setTab('schedule')}
          icon={Clock}
          label="Horários"
        />
        <TabButton
          active={tab === 'devices'}
          onClick={() => setTab('devices')}
          icon={Smartphone}
          label="Dispositivos"
        />
        <TabButton
          active={tab === 'negatives'}
          onClick={() => setTab('negatives')}
          icon={ShieldX}
          label={`Negativas (${negativeKw.length})`}
        />
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <OverviewTab
          campaign={campaign}
          adGroups={adGroups}
          hourly={hourly}
        />
      )}
      {tab === 'keywords' && (
        <KeywordsTab
          keywords={positiveKw}
          adGroups={adGroups}
          canManage={perms.canManageTrafego}
          onRemove={removeKeyword}
          searchTerms={searchTerms}
        />
      )}
      {tab === 'search-terms' && (
        <SearchTermsTab
          terms={searchTerms}
          canManage={perms.canManageTrafego}
          onNegative={negativeTerm}
        />
      )}
      {tab === 'ads' && <AdsTab ads={ads} adGroups={adGroups} />}
      {tab === 'schedule' && <ScheduleTab data={hourly} />}
      {tab === 'devices' && <DevicesTab data={devices} />}
      {tab === 'negatives' && (
        <NegativesTab
          negatives={negativeKw}
          adGroups={adGroups}
          canManage={perms.canManageTrafego}
          onRemove={removeKeyword}
          onAdd={() => setNegativesModalOpen(true)}
        />
      )}

      {/* Modais */}
      {biddingOpen && (
        <BiddingStrategyModal
          campaign={{
            id: campaign.id,
            name: campaign.name,
            bidding_strategy: campaign.bidding_strategy,
          }}
          onClose={() => setBiddingOpen(false)}
          onUpdated={() => setTimeout(load, 4000)}
        />
      )}
      {rsaOpen && (
        <CreateRsaModal
          adGroup={{
            id: rsaOpen.id,
            name: rsaOpen.name,
            campaign_id: campaign.id,
            campaign: { name: campaign.name },
          }}
          onClose={() => setRsaOpen(null)}
          onCreated={() => setTimeout(load, 5000)}
        />
      )}
      <AddNegativesModal
        open={negativesModalOpen}
        campaignId={campaign.id}
        campaignName={campaign.name}
        defaultAdGroupId={adGroups.length === 1 ? adGroups[0].id : null}
        onClose={() => setNegativesModalOpen(false)}
        onSaved={() => setTimeout(load, 4000)}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

// ─── Tab: Visão geral ─────────────────────────────────────────────────────

function OverviewTab({
  campaign,
  adGroups,
  hourly,
}: {
  campaign: CampaignFull;
  adGroups: AdGroup[];
  hourly: HourlyMetrics | null;
}) {
  const m = campaign.metrics_window;
  // Timeseries derivada do hourly (agrega por dia da semana já existe na API,
  // mas pra gráfico temporal precisamos reagrupar por dia). Pra MVP usamos
  // hourly mesmo agregando.
  const dailySeries = useMemo(() => {
    if (!hourly?.cells) return [];
    // hourly.cells já está no formato (dow, hour) agregado — não temos data
    // bruta aqui, então o gráfico vai mostrar "padrão semanal". Em vez disso,
    // reaproveitamos os dados como "performance ao longo do tempo" via index.
    // Para um gráfico real de tendência, seria preciso outro endpoint.
    // Por ora: agrega por dow (domingo→sábado) — visão semanal típica.
    const byDow = new Map<number, { spend: number; conv: number; clicks: number; impressions: number }>();
    for (const c of hourly.cells) {
      const cur = byDow.get(c.dow) ?? {
        spend: 0,
        conv: 0,
        clicks: 0,
        impressions: 0,
      };
      cur.spend += c.cost_brl;
      cur.conv += c.conversions;
      cur.clicks += c.clicks;
      cur.impressions += c.impressions;
      byDow.set(c.dow, cur);
    }
    const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return labels.map((label, dow) => {
      const v = byDow.get(dow) ?? { spend: 0, conv: 0, clicks: 0, impressions: 0 };
      return {
        label,
        spend: v.spend,
        conv: v.conv,
        cpc: v.clicks > 0 ? v.spend / v.clicks : 0,
        cpl: v.conv > 0 ? v.spend / v.conv : 0,
        ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      };
    });
  }, [hourly]);

  return (
    <div className="space-y-4">
      {/* Posição no leilão (3 mini-cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <AuctionPositionCard
          label="Topo absoluto"
          value={m?.abs_top_impression_share ?? null}
          hint="1ª posição"
          colorThreshold={{ good: 0.2, warn: 0.05 }}
        />
        <AuctionPositionCard
          label="Topo (1ª–4ª)"
          value={m?.top_impression_share ?? null}
          hint="Acima da dobra"
          colorThreshold={{ good: 0.5, warn: 0.25 }}
        />
        <AuctionPositionCard
          label="Imp. Share"
          value={m?.impression_share ?? null}
          hint="% das buscas que apareceu"
          colorThreshold={{ good: 0.5, warn: 0.25 }}
        />
      </div>

      {/* Gráficos */}
      {dailySeries.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-bold text-foreground mb-1">
              CPC × CPL × CTR por dia da semana
            </h3>
            <p className="text-[11px] text-muted-foreground mb-4">
              Agregado dos últimos 30 dias. Dias em que CPL é alto sem CPC
              alto = problema de conversão na LP/match.
            </p>
            <DualAxisChart series={dailySeries} />
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-bold text-foreground mb-1">
              Gasto × Conversões por dia da semana
            </h3>
            <p className="text-[11px] text-muted-foreground mb-4">
              Barras = gasto, linha = conversões. Mostra os melhores e
              piores dias da semana.
            </p>
            <SpendVsConvChart series={dailySeries} />
          </div>
        </div>
      )}

      {/* Estrutura + Ad Groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-3">
            Estrutura da campanha
          </h3>
          <div className="space-y-2 text-sm">
            <Row k="Tipo" v={campaign.channel_type ?? '—'} />
            <Row k="Estratégia de lance" v={campaign.bidding_strategy ?? '—'} />
            <Row k="Budget diário" v={fmtBRL(campaign.daily_budget_brl)} />
            <Row k="Status" v={STATUS_LABEL[campaign.status] ?? campaign.status} />
            <Row k="Ad groups" v={String(adGroups.length)} />
            {campaign.tags.length > 0 && (
              <Row
                k="Tags"
                v={
                  <div className="flex gap-1 flex-wrap">
                    {campaign.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-semibold px-1.5 py-0.5 bg-primary/10 text-primary rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                }
              />
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-3">
            Ad Groups ({adGroups.length})
          </h3>
          {adGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum ad_group nesta campanha. Crie um diretamente no Google
              Ads ou aguarde o sync próximo cron.
            </p>
          ) : (
            <ul className="space-y-1">
              {adGroups.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0"
                >
                  <span className="text-foreground font-medium">{g.name}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      g.status === 'ENABLED'
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {g.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {campaign.notes && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-2">
            Notas internas
          </h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {campaign.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function AuctionPositionCard({
  label,
  value,
  hint,
  colorThreshold,
}: {
  label: string;
  value: number | null;
  hint: string;
  colorThreshold: { good: number; warn: number };
}) {
  const display =
    value === null ? '—' : `${(value * 100).toFixed(1)}%`;
  const color =
    value === null
      ? 'text-muted-foreground'
      : value >= colorThreshold.good
        ? 'text-emerald-500'
        : value >= colorThreshold.warn
          ? 'text-amber-500'
          : 'text-red-500';
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>
        {display}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}

/**
 * Gráfico SVG inline com 2 eixos: esquerdo (CPC + CPL em R$) e direito (CTR %).
 */
function DualAxisChart({
  series,
}: {
  series: { label: string; cpc: number; cpl: number; ctr: number }[];
}) {
  const W = 100;
  const H = 100;
  const maxLeft =
    Math.max(
      ...series.map((s) => Math.max(s.cpc, s.cpl)),
      1,
    ) * 1.1;
  const maxRight = Math.max(...series.map((s) => s.ctr), 0.01) * 1.1;

  function xPos(i: number): number {
    return (i / Math.max(1, series.length - 1)) * W;
  }
  function yPosLeft(v: number): number {
    return H - (v / maxLeft) * H;
  }
  function yPosRight(v: number): number {
    return H - (v / maxRight) * H;
  }
  function pathOf(values: number[], yFn: (v: number) => number): string {
    return values
      .map((v, i) => {
        const x = xPos(i);
        const y = yFn(v);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-48"
        role="img"
        aria-label="CPC, CPL e CTR por dia da semana"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="currentColor"
            strokeWidth={0.2}
            className="text-border"
          />
        ))}
        <path
          d={pathOf(series.map((s) => s.cpc), yPosLeft)}
          fill="none"
          stroke="rgb(59 130 246)"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathOf(series.map((s) => s.cpl), yPosLeft)}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathOf(series.map((s) => s.ctr), yPosRight)}
          fill="none"
          stroke="rgb(245 158 11)"
          strokeWidth={1}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground tabular-nums">
        {series.map((s) => (
          <span key={s.label}>{s.label}</span>
        ))}
      </div>
      <div className="flex gap-4 mt-3 pt-3 border-t border-border text-[11px] flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-muted-foreground">CPC (R$, esq.)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">CPL (R$, esq.)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-0.5 bg-amber-500"
            style={{ borderTop: '1px dashed rgb(245 158 11)' }}
          />
          <span className="text-muted-foreground">CTR (%, dir.)</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Gráfico SVG: barras (gasto) + linha sobreposta (conversões).
 */
function SpendVsConvChart({
  series,
}: {
  series: { label: string; spend: number; conv: number }[];
}) {
  const W = 100;
  const H = 100;
  const maxSpend = Math.max(...series.map((s) => s.spend), 1) * 1.1;
  const maxConv = Math.max(...series.map((s) => s.conv), 1) * 1.1;
  const barWidth = W / series.length;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-48"
        role="img"
        aria-label="Gasto e conversões por dia da semana"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="currentColor"
            strokeWidth={0.2}
            className="text-border"
          />
        ))}
        {/* Barras de gasto */}
        {series.map((s, i) => {
          const x = i * barWidth + barWidth * 0.15;
          const barW = barWidth * 0.7;
          const barH = (s.spend / maxSpend) * H;
          const y = H - barH;
          return (
            <rect
              key={`bar-${i}`}
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill="rgb(99 102 241)"
              opacity={0.55}
            />
          );
        })}
        {/* Linha de conversões */}
        <path
          d={series
            .map((s, i) => {
              const x = i * barWidth + barWidth / 2;
              const y = H - (s.conv / maxConv) * H;
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(' ')}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground tabular-nums">
        {series.map((s) => (
          <span key={s.label}>{s.label}</span>
        ))}
      </div>
      <div className="flex gap-4 mt-3 pt-3 border-t border-border text-[11px] flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-indigo-500/55" />
          <span className="text-muted-foreground">Gasto (R$)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">Conversões</span>
        </div>
      </div>
    </div>
  );
}

function Row({
  k,
  v,
}: {
  k: string;
  v: string | React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground font-medium text-right">{v}</span>
    </div>
  );
}

// ─── Tab: Keywords ────────────────────────────────────────────────────────

function KeywordsTab({
  keywords,
  adGroups,
  canManage,
  onRemove,
  searchTerms,
}: {
  keywords: Keyword[];
  adGroups: AdGroup[];
  canManage: boolean;
  onRemove: (kw: Keyword) => void;
  searchTerms: SearchTerm[];
}) {
  const adGroupMap = useMemo(
    () => new Map(adGroups.map((g) => [g.id, g.name])),
    [adGroups],
  );

  // Proxy de métricas por keyword: agrega search_terms cujo "termo digitado"
  // bateria com a keyword. Inexato mas é o melhor que temos sem
  // metrics_per_keyword. Qualidade: termos exatos contam pra keyword
  // exata, termos contendo a keyword contam pra phrase/broad.
  const metricsByKw = useMemo(() => {
    const m = new Map<
      string,
      { spend: number; clicks: number; conversions: number }
    >();
    for (const kw of keywords) {
      const text = kw.text.toLowerCase();
      const matches = searchTerms.filter((t) => {
        const term = t.search_term.toLowerCase();
        if (kw.match_type === 'EXACT') return term === text;
        if (kw.match_type === 'PHRASE') return term.includes(text);
        return term.split(/\s+/).some((w) => w === text) || term.includes(text);
      });
      const spend = matches.reduce((s, t) => s + t.cost_brl, 0);
      const clicks = matches.reduce((s, t) => s + t.clicks, 0);
      const conv = matches.reduce((s, t) => s + t.conversions, 0);
      m.set(kw.id, { spend, clicks, conversions: conv });
    }
    return m;
  }, [keywords, searchTerms]);

  // Ordenação local
  const [sortKey, setSortKey] = useState<
    'spend' | 'clicks' | 'conv' | 'qs' | 'text'
  >('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'text' ? 'asc' : 'desc');
    }
  }
  const sorted = useMemo(() => {
    const arr = [...keywords];
    arr.sort((a, b) => {
      let av: any;
      let bv: any;
      const ma = metricsByKw.get(a.id);
      const mb = metricsByKw.get(b.id);
      switch (sortKey) {
        case 'text':
          av = a.text;
          bv = b.text;
          break;
        case 'qs':
          av = a.quality_score ?? -1;
          bv = b.quality_score ?? -1;
          break;
        case 'spend':
          av = ma?.spend ?? 0;
          bv = mb?.spend ?? 0;
          break;
        case 'clicks':
          av = ma?.clicks ?? 0;
          bv = mb?.clicks ?? 0;
          break;
        case 'conv':
          av = ma?.conversions ?? 0;
          bv = mb?.conversions ?? 0;
          break;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [keywords, metricsByKw, sortKey, sortDir]);

  if (keywords.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <KeyRound size={36} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Nenhuma palavra-chave nesta campanha. Adicione no Google Ads ou
          aguarde o sync.
        </p>
      </div>
    );
  }

  function SortHead({
    label,
    k,
    align = 'left',
  }: {
    label: string;
    k: typeof sortKey;
    align?: 'left' | 'right';
  }) {
    const active = sortKey === k;
    return (
      <th
        className={`px-3 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} cursor-pointer hover:text-foreground`}
        onClick={() => toggleSort(k)}
      >
        <span className={active ? 'text-foreground' : ''}>
          {label} {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </th>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm min-w-[1000px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <SortHead label="Keyword" k="text" />
            <th className="text-left px-3 py-2.5">Match</th>
            <th className="text-left px-3 py-2.5">Ad group</th>
            <SortHead label="QS" k="qs" align="right" />
            <SortHead label="Gasto" k="spend" align="right" />
            <SortHead label="Clicks" k="clicks" align="right" />
            <SortHead label="Conv" k="conv" align="right" />
            <th className="text-right px-3 py-2.5">CPL</th>
            <th className="text-left px-3 py-2.5">Status</th>
            <th className="text-right px-3 py-2.5 w-20">Ação</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((kw) => {
            const mx = metricsByKw.get(kw.id);
            const offender =
              !!mx && mx.spend > 10 && mx.conversions === 0;
            const cpl = mx && mx.conversions > 0 ? mx.spend / mx.conversions : 0;
            return (
              <tr
                key={kw.id}
                className={`border-t border-border ${offender ? 'bg-red-500/5' : ''}`}
              >
                <td className="px-3 py-2 font-mono text-xs">
                  {offender && (
                    <AlertCircle
                      size={11}
                      className="inline text-red-500 mr-1"
                    />
                  )}
                  {kw.text}
                </td>
                <td className="px-3 py-2">
                  <MatchTypeBadge type={kw.match_type} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {adGroupMap.get(kw.ad_group_id) ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <QualityScoreBadge score={kw.quality_score} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {mx ? fmtBRL(mx.spend) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {mx?.clicks ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {mx ? mx.conversions.toFixed(1) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {cpl > 0 ? fmtBRL(cpl) : '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      kw.status === 'ENABLED'
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {kw.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => onRemove(kw)}
                      title="Remover keyword"
                      className="p-1 text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        * Métricas por keyword são proxy via search_terms (Gasto/Conv reais
        agregados pelos termos disparados). Pra exatidão use o relatório
        oficial do Google Ads.
      </div>
    </div>
  );
}

function QualityScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
        —
      </span>
    );
  }
  const color =
    score >= 7
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
      : score >= 4
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        : 'bg-red-500/15 text-red-700 dark:text-red-400';
  return (
    <span
      className={`inline-block text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${color}`}
    >
      {score}/10
    </span>
  );
}

// ─── Tab: Search terms ────────────────────────────────────────────────────

function SearchTermsTab({
  terms,
  canManage,
  onNegative,
}: {
  terms: SearchTerm[];
  canManage: boolean;
  onNegative: (term: SearchTerm) => void;
}) {
  const [filter, setFilter] = useState<
    'all' | 'with-conv' | 'without-conv'
  >('all');

  const visible = useMemo(() => {
    if (filter === 'with-conv') return terms.filter((t) => t.conversions > 0);
    if (filter === 'without-conv')
      return terms.filter((t) => t.cost_brl > 5 && t.conversions === 0);
    return terms;
  }, [terms, filter]);

  if (terms.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <Search size={36} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Nenhum termo cacheado. Aguarde o próximo sync.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(
          [
            { v: 'all', l: 'Todos' },
            { v: 'with-conv', l: 'Com conversão' },
            { v: 'without-conv', l: 'Candidatos a negativa' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => setFilter(opt.v)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
              filter === opt.v
                ? 'bg-violet-500/15 text-violet-700 border border-violet-500/30'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.l}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2.5">Termo</th>
              <th className="text-right px-3 py-2.5">Clicks</th>
              <th className="text-right px-3 py-2.5">Conv.</th>
              <th className="text-right px-3 py-2.5">Gasto</th>
              <th className="text-right px-3 py-2.5">CTR</th>
              <th className="text-right px-3 py-2.5 w-24">Ação</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
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
                    {t.search_term}
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
                    {canManage && t.conversions === 0 && t.ad_group_id && (
                      <button
                        type="button"
                        onClick={() => onNegative(t)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-700"
                      >
                        <ShieldX size={11} /> Negativar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhum termo bate com o filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Ads ─────────────────────────────────────────────────────────────

function AdsTab({ ads, adGroups }: { ads: Ad[]; adGroups: AdGroup[] }) {
  const adGroupMap = useMemo(
    () => new Map(adGroups.map((g) => [g.id, g.name])),
    [adGroups],
  );

  if (ads.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <Megaphone size={36} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Nenhum anúncio nesta campanha ainda. Crie via botão "Novo RSA" no
          header.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ads.map((ad) => (
        <RsaCard
          key={ad.id}
          ad={ad}
          adGroupName={adGroupMap.get(ad.ad_group_id) ?? '—'}
        />
      ))}
    </div>
  );
}

const STRENGTH_PROGRESS: Record<
  string,
  { pct: number; color: string; label: string }
> = {
  EXCELLENT: { pct: 100, color: 'bg-emerald-500', label: 'EXCELENTE' },
  GOOD: { pct: 75, color: 'bg-sky-500', label: 'BOM' },
  AVERAGE: { pct: 50, color: 'bg-amber-500', label: 'MÉDIO' },
  POOR: { pct: 25, color: 'bg-red-500', label: 'FRACO' },
  PENDING: { pct: 0, color: 'bg-muted-foreground', label: 'PENDENTE' },
  NO_ADS: { pct: 0, color: 'bg-muted-foreground', label: 'SEM ANÚNCIOS' },
};

function RsaCard({ ad, adGroupName }: { ad: Ad; adGroupName: string }) {
  const headlines = (ad.headlines ?? [])
    .map((h) => h?.text ?? '')
    .filter(Boolean);
  const descriptions = (ad.descriptions ?? [])
    .map((d) => d?.text ?? '')
    .filter(Boolean);
  const finalUrl = ad.final_urls?.[0] ?? null;

  const [showAllHeadlines, setShowAllHeadlines] = useState(false);
  const headlinesPreview = 6;
  const visibleHeadlines = showAllHeadlines
    ? headlines
    : headlines.slice(0, headlinesPreview);

  const headlineCountColor =
    headlines.length === 15
      ? 'text-emerald-500'
      : headlines.length >= 8
        ? 'text-amber-500'
        : 'text-red-500';
  const descriptionCountColor =
    descriptions.length === 4
      ? 'text-emerald-500'
      : descriptions.length === 3
        ? 'text-amber-500'
        : 'text-red-500';

  const strength = STRENGTH_PROGRESS[ad.ad_strength ?? 'PENDING'] ??
    STRENGTH_PROGRESS.PENDING;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-foreground">{ad.ad_type}</span>
          <span className="text-[10px] text-muted-foreground">
            · {adGroupName}
          </span>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              ad.status === 'ENABLED'
                ? 'bg-emerald-500/15 text-emerald-600'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {ad.status}
          </span>
          {ad.approval_status && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                ad.approval_status === 'APPROVED'
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : ad.approval_status === 'DISAPPROVED'
                    ? 'bg-red-500/15 text-red-700'
                    : 'bg-amber-500/15 text-amber-700'
              }`}
            >
              {ad.approval_status}
            </span>
          )}
        </div>
      </div>

      {/* Ad Strength com barra de progresso visual */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          <span>Força do anúncio</span>
          <strong className="text-foreground tabular-nums">{strength.label}</strong>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${strength.color}`}
            style={{ width: `${strength.pct}%` }}
          />
        </div>
      </div>

      {/* Headlines em grid com expansão */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          <span>
            Headlines{' '}
            <span className={`tabular-nums font-bold ${headlineCountColor}`}>
              ({headlines.length}/15)
            </span>
          </span>
          {headlines.length < 8 && (
            <span className="text-red-500 font-bold normal-case tracking-normal flex items-center gap-1">
              <AlertCircle size={10} /> Recomenda-se ≥8
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {visibleHeadlines.map((h, i) => (
            <span
              key={i}
              className="text-xs px-2 py-1.5 bg-muted/40 rounded border border-border truncate"
              title={h}
            >
              {h}
            </span>
          ))}
          {headlines.length > headlinesPreview && (
            <button
              type="button"
              onClick={() => setShowAllHeadlines((v) => !v)}
              className="text-xs px-2 py-1.5 bg-violet-500/10 rounded border border-violet-500/30 text-violet-700 dark:text-violet-300 font-semibold hover:bg-violet-500/20"
            >
              {showAllHeadlines
                ? 'Mostrar menos'
                : `+${headlines.length - headlinesPreview} mais`}
            </button>
          )}
        </div>
      </div>

      {/* Descrições */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          <span>
            Descrições{' '}
            <span className={`tabular-nums font-bold ${descriptionCountColor}`}>
              ({descriptions.length}/4)
            </span>
          </span>
          {descriptions.length < 3 && (
            <span className="text-red-500 font-bold normal-case tracking-normal flex items-center gap-1">
              <AlertCircle size={10} /> Recomenda-se ≥3
            </span>
          )}
        </div>
        <div className="space-y-1">
          {descriptions.map((d, i) => (
            <div
              key={i}
              className="text-xs px-2 py-1.5 bg-muted/40 rounded border border-border"
            >
              {d}
            </div>
          ))}
        </div>
      </div>

      {finalUrl && (
        <div className="text-xs text-muted-foreground mb-3">
          <strong className="text-foreground">URL:</strong>{' '}
          <a
            href={finalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:underline"
          >
            {finalUrl}
          </a>
          {(ad.path1 || ad.path2) && (
            <span className="font-mono">
              {' '}
              /{ad.path1 ?? ''}
              {ad.path2 ? `/${ad.path2}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Horários (heatmap hora × dia da semana) ─────────────────────────

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function ScheduleTab({ data }: { data: HourlyMetrics | null }) {
  if (!data || data.cells.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <Clock size={36} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Sem dados horários ainda. Aguarde o próximo sync (segments.hour
          é populado a cada 6h pelo cron).
        </p>
      </div>
    );
  }

  // Encontra max conversions pra escala de cor
  const maxConv = Math.max(...data.cells.map((c) => c.conversions), 1);
  const totalConv = data.cells.reduce((s, c) => s + c.conversions, 0);
  const totalCost = data.cells.reduce((s, c) => s + c.cost_brl, 0);

  function cellColor(conv: number): string {
    if (conv === 0) return 'bg-muted';
    const intensity = conv / maxConv;
    if (intensity < 0.2) return 'bg-violet-500/15';
    if (intensity < 0.4) return 'bg-violet-500/30';
    if (intensity < 0.6) return 'bg-violet-500/50';
    if (intensity < 0.8) return 'bg-violet-500/70';
    return 'bg-violet-500/90';
  }

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Heatmap: hora × dia da semana
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Quanto mais escuro, mais conversões. Dados dos últimos {data.days}
              {' '}dias agregados.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>
              Total:{' '}
              <strong className="text-foreground">
                {totalConv.toFixed(1)}
              </strong>{' '}
              conv
            </span>
            <span>
              Gasto:{' '}
              <strong className="text-foreground">
                {fmtBRL(totalCost)}
              </strong>
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* Header das horas */}
            <div className="flex items-center mb-1">
              <div className="w-10 shrink-0" />
              {Array.from({ length: 24 }).map((_, hour) => (
                <div
                  key={hour}
                  className="flex-1 text-[9px] text-center text-muted-foreground tabular-nums min-w-[16px]"
                >
                  {hour % 3 === 0 ? hour : ''}
                </div>
              ))}
            </div>

            {/* Grid 7×24 */}
            {DOW_LABELS.map((dowLabel, dow) => (
              <div
                key={dow}
                className="flex items-center mb-0.5"
              >
                <div className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {dowLabel}
                </div>
                {Array.from({ length: 24 }).map((_, hour) => {
                  const cell = data.cells.find(
                    (c) => c.dow === dow && c.hour === hour,
                  );
                  if (!cell) return null;
                  return (
                    <div
                      key={hour}
                      className={`flex-1 h-7 mx-0.5 rounded-sm transition-colors hover:ring-2 hover:ring-violet-400 cursor-pointer ${cellColor(cell.conversions)} min-w-[16px]`}
                      title={`${dowLabel} ${hour}h — ${cell.conversions.toFixed(1)} conv • ${fmtBRL(cell.cost_brl)} • CPL ${cell.conversions > 0 ? fmtBRL(cell.cpl_brl) : '—'}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legenda */}
        <div className="flex items-center justify-end gap-2 mt-4 text-[10px] text-muted-foreground">
          <span>Menos</span>
          <div className="w-4 h-3 rounded-sm bg-muted" />
          <div className="w-4 h-3 rounded-sm bg-violet-500/15" />
          <div className="w-4 h-3 rounded-sm bg-violet-500/30" />
          <div className="w-4 h-3 rounded-sm bg-violet-500/50" />
          <div className="w-4 h-3 rounded-sm bg-violet-500/70" />
          <div className="w-4 h-3 rounded-sm bg-violet-500/90" />
          <span>Mais</span>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Dispositivos ────────────────────────────────────────────────────

const DEVICE_META: Record<
  string,
  { icon: any; label: string; color: string }
> = {
  MOBILE: {
    icon: Smartphone,
    label: 'Mobile',
    color: 'bg-violet-500',
  },
  DESKTOP: {
    icon: Monitor,
    label: 'Desktop',
    color: 'bg-emerald-500',
  },
  TABLET: {
    icon: Tablet,
    label: 'Tablet',
    color: 'bg-amber-500',
  },
  CONNECTED_TV: {
    icon: Tv,
    label: 'Connected TV',
    color: 'bg-sky-500',
  },
  OTHER: {
    icon: HelpCircle,
    label: 'Outro',
    color: 'bg-muted-foreground',
  },
};

function DevicesTab({ data }: { data: DeviceMetrics | null }) {
  if (!data || data.items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <Smartphone size={36} className="mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Sem dados por dispositivo ainda. Aguarde o próximo sync.
        </p>
      </div>
    );
  }

  // Detecta o melhor device por CPL (entre os com >=3 conversões)
  const winners = data.items.filter((i) => i.conversions >= 3);
  const bestByCpl = winners.length > 0
    ? winners.reduce((b, c) => (c.cpl_brl < b.cpl_brl ? c : b))
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Donut visual */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-1">
          Distribuição de gasto
        </h3>
        <p className="text-[11px] text-muted-foreground mb-4">
          Como o orçamento se divide entre dispositivos.
        </p>

        {/* Donut SVG */}
        <DeviceDonut items={data.items} totalCost={data.total_cost_brl} />

        {/* Legenda */}
        <div className="space-y-1 mt-4">
          {data.items.map((item) => {
            const meta = DEVICE_META[item.device] ?? DEVICE_META.OTHER;
            const Icon = meta.icon;
            const isWinner = bestByCpl?.device === item.device;
            return (
              <div
                key={item.device}
                className={`flex items-center gap-2 p-2 rounded text-xs ${
                  isWinner ? 'bg-emerald-500/10 border border-emerald-500/30' : ''
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${meta.color}`} />
                <Icon size={12} className="text-muted-foreground" />
                <span className="font-semibold text-foreground flex-1">
                  {meta.label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {(item.spend_share * 100).toFixed(0)}%
                </span>
                <span className="tabular-nums font-semibold text-foreground">
                  {fmtBRL(item.cost_brl)}
                </span>
                {isWinner && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                    melhor CPL
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabela detalhada */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Detalhes</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Performance por dispositivo nos últimos {data.days} dias.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Device</th>
                <th className="text-right px-3 py-2">Conv</th>
                <th className="text-right px-3 py-2">Gasto</th>
                <th className="text-right px-3 py-2">CPL</th>
                <th className="text-right px-3 py-2">CTR</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const meta = DEVICE_META[item.device] ?? DEVICE_META.OTHER;
                return (
                  <tr key={item.device} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${meta.color}`} />
                        <span className="text-xs font-semibold">
                          {meta.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.conversions.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtBRL(item.cost_brl)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {item.conversions > 0 ? fmtBRL(item.cpl_brl) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.impressions > 0 ? fmtPct(item.ctr) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Donut de dispositivos — SVG inline sem dep externa. Cada segmento tem
 * tamanho proporcional ao spend_share.
 */
function DeviceDonut({
  items,
  totalCost,
}: {
  items: DeviceMetrics['items'];
  totalCost: number;
}) {
  const size = 200;
  const radius = 80;
  const strokeWidth = 28;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = items.map((item) => {
    const meta = DEVICE_META[item.device] ?? DEVICE_META.OTHER;
    const length = item.spend_share * circumference;
    const seg = {
      device: item.device,
      label: meta.label,
      strokeColor: cssColorFromBg(meta.color),
      length,
      offset,
      pct: item.spend_share,
    };
    offset += length;
    return seg;
  });

  return (
    <div className="flex justify-center">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/30"
          />
          {segments.map((seg) => (
            <circle
              key={seg.device}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.strokeColor}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.length} ${circumference}`}
              strokeDashoffset={-seg.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Gasto total
          </div>
          <div className="text-lg font-bold text-foreground tabular-nums">
            {fmtBRL(totalCost)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mapeia classes Tailwind bg-* pra cor CSS. Restrito aos devices conhecidos. */
function cssColorFromBg(bg: string): string {
  if (bg.includes('violet')) return 'rgb(139 92 246)';
  if (bg.includes('emerald')) return 'rgb(16 185 129)';
  if (bg.includes('amber')) return 'rgb(245 158 11)';
  if (bg.includes('sky')) return 'rgb(14 165 233)';
  return 'rgb(115 115 115)';
}

// ─── Tab: Negatives ───────────────────────────────────────────────────────

function NegativesTab({
  negatives,
  adGroups,
  canManage,
  onRemove,
  onAdd,
}: {
  negatives: Keyword[];
  adGroups: AdGroup[];
  canManage: boolean;
  onRemove: (kw: Keyword) => void;
  onAdd: () => void;
}) {
  const adGroupMap = useMemo(
    () => new Map(adGroups.map((g) => [g.id, g.name])),
    [adGroups],
  );
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return negatives;
    return negatives.filter((n) => n.text.toLowerCase().includes(q));
  }, [negatives, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            Palavras negativas
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            <strong className="text-foreground">{negatives.length}</strong>{' '}
            palavra{negatives.length === 1 ? '' : 's'} negativa
            {negatives.length === 1 ? '' : 's'} ativa
            {negatives.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {negatives.length > 0 && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar..."
              className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg w-48"
            />
          )}
          {canManage && (
            <button
              type="button"
              onClick={onAdd}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white"
            >
              <ShieldX size={13} />
              Adicionar negativa
            </button>
          )}
        </div>
      </div>

      {negatives.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <ShieldX size={36} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhuma palavra negativa configurada. Use o botão acima ou negative
            termos via Tab "Termos de busca".
          </p>
        </div>
      ) : (
        <NegativesTable
          rows={filtered}
          adGroupMap={adGroupMap}
          canManage={canManage}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

function NegativesTable({
  rows,
  adGroupMap,
  canManage,
  onRemove,
}: {
  rows: Keyword[];
  adGroupMap: Map<string, string>;
  canManage: boolean;
  onRemove: (kw: Keyword) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <div className="px-4 py-2 border-b border-border bg-red-500/5 text-xs">
        <strong>{rows.length}</strong> palavra
        {rows.length === 1 ? '' : 's'} negativa
        {rows.length === 1 ? '' : 's'} no filtro
      </div>
      <table className="w-full text-sm min-w-[600px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2.5">Palavra</th>
            <th className="text-left px-3 py-2.5">Match</th>
            <th className="text-left px-3 py-2.5">Ad group</th>
            <th className="text-right px-3 py-2.5 w-20">Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((kw) => (
            <tr key={kw.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{kw.text}</td>
              <td className="px-3 py-2">
                <MatchTypeBadge type={kw.match_type} />
              </td>
              <td className="px-3 py-2 text-xs">
                {adGroupMap.get(kw.ad_group_id) ?? '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onRemove(kw)}
                    title="Remover negativa"
                    className="p-1 text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
