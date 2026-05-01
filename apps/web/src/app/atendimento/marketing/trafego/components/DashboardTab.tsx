'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  DollarSign,
  Users,
  TrendingUp,
  Target,
  MousePointerClick,
  PauseCircle,
  PlayCircle,
  Activity,
  Gauge,
  Eye,
  Percent,
  GitCompare,
  Bell,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { KpiCard, type KpiTooltipInfo } from './KpiCard';

type Period = 'today' | '7d' | '30d' | 'month' | 'prev_month';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  month: 'Mês atual',
  prev_month: 'Mês anterior',
};

interface DashboardData {
  connected: boolean;
  synced?: boolean;
  message?: string;
  account?: {
    customer_id: string;
    account_name: string | null;
    last_sync_at: string | null;
  } | null;
  period?: Period;
  kpis?: {
    spend_today_brl: number;
    spend_month_brl: number;
    spend_range_brl: number;
    leads_today: number;
    leads_avg_7d: number;
    leads_range: number;
    clicks_range: number;
    impressions_range: number;
    conversion_rate: number;
    cpl_brl: number;
    ctr: number;
    avg_cpc_brl: number;
    roas_estimated: number;
    active_campaigns: number;
    paused_campaigns: number;
  };
  compare?: {
    spend_brl: number;
    leads: number;
    clicks: number;
    impressions: number;
    cpl_brl: number;
    ctr: number;
    avg_cpc_brl: number;
    conversion_rate: number;
    range_from: string;
    range_to: string;
  };
  cpc_cpl_timeseries?: {
    date: string;
    cpc_brl: number;
    cpl_brl: number;
    spend_brl: number;
    clicks: number;
  }[];
  pacing?: {
    target_monthly_brl: number;
    target_to_date_brl: number;
    spent_brl: number;
    pct_used: number;
    pct_expected: number;
    status: 'AHEAD' | 'ON_TRACK' | 'BEHIND';
  } | null;
  timeseries?: { date: string; spend_brl: number; leads: number }[];
  top_campaigns?: {
    id: string;
    name: string;
    channel_type: string | null;
    cost_brl: number;
    conversions: number;
    cpl_brl: number;
  }[];
  at_risk_campaigns?: { id: string; name: string; reason: string }[];
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(v || 0);

const fmtPct = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v || 0);

const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    notation: v >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(v || 0);

/**
 * Cor do ROAS por faixa: vermelho (deficit), amarelo (perto do break-even),
 * verde (lucrativo), muted quando nao ha dados (sync sem conversions_value).
 */
function roasAccent(
  roas: number,
): 'danger' | 'warning' | 'success' | 'muted' {
  if (roas <= 0) return 'muted';
  if (roas < 1) return 'danger';
  if (roas < 2) return 'warning';
  return 'success';
}

function roasHint(roas: number): string | undefined {
  if (roas <= 0) {
    // ROAS depende de conversions_value > 0. Se for 0, normalmente eh
    // ConversionAction sem valor padrao configurado no Google.
    return 'Sem valor de conversão — defina default_value nas ConversionActions';
  }
  if (roas < 1) return 'Abaixo do break-even (1x)';
  if (roas < 2) return 'Próximo do break-even';
  return undefined;
}

/**
 * Calcula delta fraccional entre period atual e comparativo.
 * Retorna null quando comparativo for 0 (não dá pra dividir).
 */
function delta(current: number, previous: number): number | null {
  if (!previous || previous === 0) return null;
  return (current - previous) / previous;
}

interface RecentAlert {
  id: string;
  kind: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  status: string;
  campaign_id: string | null;
  created_at: string;
}

const VALID_PERIODS: Period[] = ['today', '7d', '30d', 'month', 'prev_month'];

const KPI_HELP: Record<
  | 'spend'
  | 'leads'
  | 'cpl'
  | 'cpc'
  | 'ctr'
  | 'conversionRate'
  | 'impressions'
  | 'roas'
  | 'monthlySpend'
  | 'activeCampaigns'
  | 'pausedCampaigns',
  KpiTooltipInfo
> = {
  spend: {
    title: 'Gasto do periodo',
    description: 'Quanto foi investido em Google Ads dentro do periodo selecionado.',
    ideal: 'Nao existe valor universal: o ideal e gastar o suficiente para gerar leads qualificados sem ultrapassar o CPL-alvo e a meta mensal.',
    howTo: 'Defina orcamento mensal, acompanhe o pacing, pause termos ruins e concentre verba nas campanhas com menor CPL e melhor conversao em cliente.',
  },
  leads: {
    title: 'Leads gerados',
    description: 'Quantidade de contatos/conversoes atribuida ao Google Ads no periodo.',
    ideal: 'Deve crescer mantendo qualidade. Se o volume sobe e o CPL/ROAS pioram, o trafego esta ficando caro ou pouco qualificado.',
    howTo: 'Melhore palavras-chave, anuncios, landing pages e atendimento rapido no WhatsApp; corte buscas sem intencao juridica real.',
  },
  cpl: {
    title: 'CPL - custo por lead',
    description: 'Media paga para gerar um lead. Formula: gasto dividido pela quantidade de leads.',
    ideal: 'Quanto menor, melhor, desde que o lead seja qualificado. Para escritorio juridico, compare com ticket medio e taxa de fechamento.',
    howTo: 'Negativar termos irrelevantes, separar campanhas por area, melhorar pagina/formulario e priorizar audiencias e palavras que viram cliente.',
  },
  cpc: {
    title: 'CPC - custo por clique',
    description: 'Media paga por cada clique no anuncio. Indica competitividade e eficiencia do leilao.',
    ideal: 'Menor que a media historica da conta e sustentavel para gerar leads dentro do CPL-alvo.',
    howTo: 'Aumente qualidade do anuncio, use palavras mais especificas, ajuste lances/horarios e remova termos caros que nao convertem.',
  },
  ctr: {
    title: 'CTR - taxa de cliques',
    description: 'Percentual de impressoes que viraram clique. Mostra se anuncio e oferta chamam atencao.',
    ideal: 'Em pesquisa, busque acima de 4% a 6%; em display/branding, valores menores podem ser normais.',
    howTo: 'Escreva anuncios mais aderentes a dor do cliente, inclua cidade/area juridica, extensoes e palavras-chave bem agrupadas.',
  },
  conversionRate: {
    title: 'Taxa de conversao',
    description: 'Percentual de cliques que viraram lead/conversao.',
    ideal: 'Quanto maior, melhor. Uma boa referencia inicial e acima de 8% a 12% em trafego de alta intencao.',
    howTo: 'Otimize landing page, deixe WhatsApp/formulario facil, carregamento rapido, prova social e mensagem alinhada ao anuncio.',
  },
  impressions: {
    title: 'Impressoes',
    description: 'Quantidade de vezes que os anuncios apareceram. Mede alcance, nao resultado sozinho.',
    ideal: 'O suficiente para gerar cliques e leads; muitas impressoes com CTR baixo indicam anuncio ou publico fraco.',
    howTo: 'Revise correspondencias, segmentacao, criativos e limite exibicoes em pesquisas amplas que nao trazem intencao de contratar.',
  },
  roas: {
    title: 'ROAS estimado',
    description: 'Retorno estimado sobre o investimento: valor de conversao dividido pelo gasto.',
    ideal: 'Acima de 1x paga o investimento; acima de 2x tende a ser saudavel, dependendo de honorarios, margem e ciclo de fechamento.',
    howTo: 'Configure valor de conversao, acompanhe contratos fechados, invista nas campanhas que geram receita e reduza gasto onde so ha lead ruim.',
  },
  monthlySpend: {
    title: 'Gasto no mes',
    description: 'Total investido desde o inicio do mes atual, usado para controlar ritmo de verba.',
    ideal: 'Deve ficar proximo do pacing esperado: nem queimar a verba cedo, nem sobrar verba quando ha campanhas rentaveis.',
    howTo: 'Configure meta mensal, distribua verba por campanha, acompanhe diariamente e ajuste orcamento conforme CPL e qualidade dos leads.',
  },
  activeCampaigns: {
    title: 'Campanhas ativas',
    description: 'Campanhas habilitadas e aptas a veicular anuncios.',
    ideal: 'Ter apenas campanhas com objetivo claro, verba suficiente e acompanhamento de conversao funcionando.',
    howTo: 'Mantenha ativas as campanhas lucrativas ou em teste controlado; organize por area juridica, regiao e estrategia de lance.',
  },
  pausedCampaigns: {
    title: 'Campanhas pausadas',
    description: 'Campanhas desligadas temporariamente. Nao gastam verba nem geram leads enquanto pausadas.',
    ideal: 'Zero pausadas sem motivo. Pausar e saudavel quando a campanha esta cara, duplicada, sazonal ou aguardando ajuste.',
    howTo: 'Revise o motivo de pausa, corrija tracking/anuncios/landing page e reative so quando houver verba, meta e criterio de sucesso.',
  },
};

export function DashboardTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Período persistido via URL param (?period=...). Permite link
  // compartilhável manter contexto. Compare também via ?compare=1.
  const initialPeriod = (() => {
    const p = searchParams.get('period');
    return p && (VALID_PERIODS as string[]).includes(p) ? (p as Period) : '7d';
  })();
  const initialCompare = searchParams.get('compare') === '1';

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriodState] = useState<Period>(initialPeriod);
  const [compareOn, setCompareOnState] = useState(initialCompare);
  const [recentAlerts, setRecentAlerts] = useState<RecentAlert[]>([]);

  function setPeriod(p: Period) {
    setPeriodState(p);
    const params = new URLSearchParams(searchParams.toString());
    if (p === '7d') params.delete('period');
    else params.set('period', p);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  function setCompareOn(v: boolean) {
    setCompareOnState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set('compare', '1');
    else params.delete('compare');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  // Carrega 5 alertas mais recentes em paralelo com o dashboard
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<RecentAlert[]>(
          '/trafego/alerts?limit=5',
        );
        if (!cancelled)
          setRecentAlerts(Array.isArray(data) ? data.slice(0, 5) : []);
      } catch {
        // alertas é nice-to-have — silencioso
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get<DashboardData>('/trafego/dashboard', {
          params: { period },
        });
        if (!cancelled) setData(res.data);
      } catch {
        if (!cancelled) setData({ connected: false, message: 'Erro ao carregar dashboard.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  // Estado de "ainda nao sincronizou"
  if (!loading && data?.connected && !data.synced) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Activity size={40} className="mx-auto text-muted-foreground mb-3" />
        <h3 className="text-lg font-bold text-foreground mb-1">
          Aguardando primeiro sync
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          A conta foi conectada com sucesso. O primeiro sync acontece
          automaticamente às 06h, ou você pode disparar manualmente em
          Configurações.
        </p>
      </div>
    );
  }

  const k = data?.kpis;
  const isToday = period === 'today';
  const isPrevMonth = period === 'prev_month';
  const periodLabel = PERIOD_LABELS[period];

  // Spend label do KPI principal muda conforme período: hoje/mês são
  // valores instantâneos; 7d/30d/prev_month são totais da janela.
  const primarySpendLabel = isToday
    ? 'Gasto hoje'
    : period === 'month'
      ? 'Gasto no mês'
      : isPrevMonth
        ? 'Gasto mês ant.'
        : `Gasto ${periodLabel.toLowerCase()}`;
  const primarySpendValue =
    isToday
      ? k?.spend_today_brl ?? 0
      : period === 'month'
        ? k?.spend_month_brl ?? 0
        : k?.spend_range_brl ?? 0;

  // Compute deltas (period vs compare)
  const cmp = data?.compare;
  const dSpend = compareOn && cmp ? delta(k?.spend_range_brl ?? 0, cmp.spend_brl) : null;
  const dLeads = compareOn && cmp ? delta(k?.leads_range ?? 0, cmp.leads) : null;
  const dCpl = compareOn && cmp ? delta(k?.cpl_brl ?? 0, cmp.cpl_brl) : null;
  const dCpc = compareOn && cmp ? delta(k?.avg_cpc_brl ?? 0, cmp.avg_cpc_brl) : null;
  const dCtr = compareOn && cmp ? delta(k?.ctr ?? 0, cmp.ctr) : null;
  const dConvRate = compareOn && cmp ? delta(k?.conversion_rate ?? 0, cmp.conversion_rate) : null;
  const dImp = compareOn && cmp ? delta(k?.impressions_range ?? 0, cmp.impressions) : null;

  return (
    <div className="space-y-6">
      {/* ─── Seletor de período + toggle comparar ───────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PeriodSelector value={period} onChange={setPeriod} disabled={loading} />
        <button
          type="button"
          onClick={() => setCompareOn(!compareOn)}
          disabled={loading || !data?.compare}
          title={
            compareOn
              ? 'Esconder comparação'
              : 'Comparar com período anterior'
          }
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
            compareOn
              ? 'bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-accent'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <GitCompare size={13} />
          {compareOn
            ? `Comparar: ${cmp?.range_from ?? ''} → ${cmp?.range_to ?? ''}`
            : 'Comparar com anterior'}
        </button>
      </div>

      {/* ─── Linha 1: KPIs principais (4 cards) ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={primarySpendLabel}
          value={fmtBRL(primarySpendValue)}
          icon={DollarSign}
          accent="primary"
          delta={dSpend}
          tooltip={KPI_HELP.spend}
          loading={loading}
        />
        <KpiCard
          label={isToday ? 'Leads hoje' : `Leads ${periodLabel.toLowerCase()}`}
          value={String(
            isToday ? k?.leads_today ?? 0 : k?.leads_range ?? 0,
          )}
          icon={Users}
          accent={
            isToday && (k?.leads_today ?? 0) === 0 && (k?.leads_avg_7d ?? 0) > 0
              ? 'warning'
              : 'success'
          }
          hint={
            isToday
              ? `média 7d: ${(k?.leads_avg_7d ?? 0).toFixed(1)}/dia`
              : undefined
          }
          delta={isToday ? null : dLeads}
          tooltip={KPI_HELP.leads}
          loading={loading}
        />
        <KpiCard
          label={`CPL · ${periodLabel.toLowerCase()}`}
          value={fmtBRL(k?.cpl_brl ?? 0)}
          icon={Target}
          accent="warning"
          delta={dCpl}
          deltaInverted
          tooltip={KPI_HELP.cpl}
          loading={loading}
        />
        <KpiCard
          label={`CPC · ${periodLabel.toLowerCase()}`}
          value={fmtBRL(k?.avg_cpc_brl ?? 0)}
          accent="muted"
          delta={dCpc}
          deltaInverted
          tooltip={KPI_HELP.cpc}
          loading={loading}
        />
      </div>

      {/* ─── Linha 2: KPIs de eficiência (4 cards) ──────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={`CTR · ${periodLabel.toLowerCase()}`}
          value={fmtPct(k?.ctr ?? 0)}
          icon={MousePointerClick}
          accent="muted"
          delta={dCtr}
          tooltip={KPI_HELP.ctr}
          loading={loading}
        />
        <KpiCard
          label="Tx. conversão"
          value={fmtPct(k?.conversion_rate ?? 0)}
          icon={Percent}
          accent="muted"
          hint="conv / clicks"
          delta={dConvRate}
          tooltip={KPI_HELP.conversionRate}
          loading={loading}
        />
        <KpiCard
          label="Impressões"
          value={fmtNum(k?.impressions_range ?? 0)}
          icon={Eye}
          accent="muted"
          hint={`${fmtNum(k?.clicks_range ?? 0)} cliques`}
          delta={dImp}
          tooltip={KPI_HELP.impressions}
          loading={loading}
        />
        <KpiCard
          label="ROAS estimado · 30d"
          value={`${(k?.roas_estimated ?? 0).toFixed(2)}x`}
          accent={roasAccent(k?.roas_estimated ?? 0)}
          hint={roasHint(k?.roas_estimated ?? 0)}
          tooltip={KPI_HELP.roas}
          loading={loading}
        />
      </div>

      {/* ─── Linha 3: status de campanhas + gasto mensal ────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Gasto no mês"
          value={fmtBRL(k?.spend_month_brl ?? 0)}
          icon={TrendingUp}
          accent="primary"
          hint={
            data?.pacing
              ? `meta R$ ${(data.pacing.target_monthly_brl ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : 'configure meta em Settings p/ pacing'
          }
          tooltip={KPI_HELP.monthlySpend}
          loading={loading}
        />
        <KpiCard
          label="Campanhas ativas"
          value={String(k?.active_campaigns ?? 0)}
          icon={PlayCircle}
          accent="success"
          tooltip={KPI_HELP.activeCampaigns}
          loading={loading}
        />
        <KpiCard
          label="Campanhas pausadas"
          value={String(k?.paused_campaigns ?? 0)}
          icon={PauseCircle}
          accent="muted"
          tooltip={KPI_HELP.pausedCampaigns}
          loading={loading}
        />
      </div>

      {/* ─── Pacing card (só renderiza com meta configurada) ────────────── */}
      {data?.pacing && <PacingCard pacing={data.pacing} loading={loading} />}

      {/* ─── Gráficos (2x2 — Evolução, CPC×CPL, Top campanhas) ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-1">
            Evolução diária
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Gasto vs. leads nos últimos 30 dias
          </p>
          <Timeseries data={data?.timeseries ?? []} />
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-1">
            CPC × CPL ao longo do tempo
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Custo por click vs custo por lead no período selecionado.
            Tendência de queda = otimização funcionando.
          </p>
          <CpcCplChart data={data?.cpc_cpl_timeseries ?? []} />
        </div>

        <div className="bg-card border border-border rounded-xl p-5 lg:col-span-2">
          <h3 className="text-sm font-bold text-foreground mb-1">
            Top campanhas
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Menor gasto com conversões nos últimos 7 dias
          </p>
          <TopCampaigns data={data?.top_campaigns ?? []} />
        </div>
      </div>

      {/* ─── Alertas recentes (P1.E) ────────────────────────────────────── */}
      {recentAlerts.length > 0 && (
        <RecentAlerts alerts={recentAlerts} />
      )}

      {/* Footer: ultimo sync */}
      {data?.account?.last_sync_at && (
        <p className="text-[11px] text-muted-foreground text-right">
          Último sync:{' '}
          {new Date(data.account.last_sync_at).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}

// ─── Alertas recentes ────────────────────────────────────────────────────

const ALERT_SEVERITY_STYLE: Record<
  RecentAlert['severity'],
  { color: string; icon: LucideIcon; label: string }
> = {
  CRITICAL: {
    color: 'text-red-500',
    icon: AlertCircle,
    label: 'Crítico',
  },
  WARNING: {
    color: 'text-amber-500',
    icon: AlertTriangle,
    label: 'Aviso',
  },
  INFO: {
    color: 'text-sky-500',
    icon: Info,
    label: 'Info',
  },
};

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMin = Math.floor((now - then) / 60_000);
  if (diffMin < 60) return diffMin <= 1 ? 'agora' : `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `há ${diffD}d`;
}

function RecentAlerts({ alerts }: { alerts: RecentAlert[] }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Alertas recentes
          </h3>
        </div>
        <Link
          href="?tab=alertas"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Ver todos →
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {alerts.map((a) => {
          const sty = ALERT_SEVERITY_STYLE[a.severity] ?? ALERT_SEVERITY_STYLE.INFO;
          const Icon = a.status !== 'OPEN' ? CheckCircle2 : sty.icon;
          const iconColor =
            a.status !== 'OPEN' ? 'text-emerald-500' : sty.color;
          return (
            <li
              key={a.id}
              className="flex items-start gap-3 px-5 py-3 text-sm hover:bg-accent/30"
            >
              <Icon size={14} className={`shrink-0 mt-0.5 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${sty.color}`}>
                    {sty.label}
                  </span>
                  {a.status !== 'OPEN' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                      · Resolvido
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {timeAgo(a.created_at)}
                  </span>
                </div>
                <p className="text-sm text-foreground mt-0.5">{a.message}</p>
                {a.campaign_id && (
                  <Link
                    href={`/atendimento/marketing/trafego/campanhas/${a.campaign_id}`}
                    className="text-[11px] text-primary hover:underline mt-0.5 inline-block"
                  >
                    Ver campanha →
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Seletor de período ────────────────────────────────────────────────────

function PeriodSelector({
  value,
  onChange,
  disabled,
}: {
  value: Period;
  onChange: (p: Period) => void;
  disabled?: boolean;
}) {
  const options: Period[] = ['today', '7d', '30d', 'month', 'prev_month'];
  return (
    <div
      role="tablist"
      aria-label="Selecionar período"
      className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border"
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {PERIOD_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}

// ─── Card de Pacing mensal ────────────────────────────────────────────────

function PacingCard({
  pacing,
  loading,
}: {
  pacing: NonNullable<DashboardData['pacing']>;
  loading: boolean;
}) {
  const accent =
    pacing.status === 'AHEAD'
      ? 'text-red-500 bg-red-500/10 border-red-500/30'
      : pacing.status === 'BEHIND'
        ? 'text-amber-500 bg-amber-500/10 border-amber-500/30'
        : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
  const statusLabel =
    pacing.status === 'AHEAD'
      ? 'Acelerando'
      : pacing.status === 'BEHIND'
        ? 'Atrasado'
        : 'No ritmo';

  // Larguras das barras (clamp 0..100 — display)
  const usedPct = Math.min(100, Math.max(0, pacing.pct_used * 100));
  const expectedPct = Math.min(100, Math.max(0, pacing.pct_expected * 100));

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Gauge size={18} className="text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Pacing mensal
          </h3>
        </div>
        <span
          className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${accent}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="relative h-3 rounded-full bg-muted overflow-hidden mb-2">
        {/* Linha tracejada da meta esperada (até hoje) */}
        <div
          aria-label={`Meta até hoje: ${expectedPct.toFixed(0)}%`}
          className="absolute top-0 bottom-0 w-px bg-foreground/40"
          style={{ left: `${expectedPct}%` }}
        />
        {/* Barra do realizado */}
        <div
          aria-label={`Usado: ${usedPct.toFixed(0)}%`}
          className={`absolute top-0 bottom-0 left-0 transition-all ${
            pacing.status === 'AHEAD'
              ? 'bg-red-500/70'
              : pacing.status === 'BEHIND'
                ? 'bg-amber-500/70'
                : 'bg-emerald-500/70'
          }`}
          style={{ width: `${usedPct}%` }}
        />
      </div>

      {loading ? (
        <div className="h-4 w-40 rounded bg-muted/50 animate-pulse" />
      ) : (
        <div className="flex justify-between items-center text-[11px] text-muted-foreground tabular-nums flex-wrap gap-1">
          <span>
            Gasto:{' '}
            <strong className="text-foreground">
              {fmtBRL(pacing.spent_brl)}
            </strong>{' '}
            ({usedPct.toFixed(0)}%)
          </span>
          <span>
            Meta até hoje:{' '}
            <strong className="text-foreground">
              {fmtBRL(pacing.target_to_date_brl)}
            </strong>{' '}
            ({expectedPct.toFixed(0)}%)
          </span>
          <span>
            Meta mensal:{' '}
            <strong className="text-foreground">
              {fmtBRL(pacing.target_monthly_brl)}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Componentes auxiliares ────────────────────────────────────────────────

/**
 * Gráfico de linhas CPC × CPL ao longo do tempo. Sem dep externa —
 * SVG inline com 2 polilines + grid horizontal. Detecta tendência:
 * linhas descendentes = otimização funcionando.
 */
function CpcCplChart({
  data,
}: {
  data: { date: string; cpc_brl: number; cpl_brl: number; clicks: number }[];
}) {
  // Filtra dias com 0 clicks (CPC=0 falso) — não dilui a linha
  const points = data.filter((d) => d.clicks > 0);

  if (points.length < 2) {
    return (
      <div className="h-48 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground text-center px-4">
        Sem dados suficientes no período. Selecione 7 dias ou mais.
      </div>
    );
  }

  // Escala: 0 → max(cpl + 10%) — CPL geralmente é maior que CPC
  const maxY = Math.max(
    ...points.map((p) => Math.max(p.cpc_brl, p.cpl_brl)),
    1,
  ) * 1.1;
  const width = 100; // viewBox %
  const height = 100;

  function pointsToPath(values: number[]): string {
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - (v / maxY) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }

  const cpcPath = pointsToPath(points.map((p) => p.cpc_brl));
  const cplPath = pointsToPath(points.map((p) => p.cpl_brl));

  // Médias do período pra mostrar embaixo
  const avgCpc = points.reduce((s, p) => s + p.cpc_brl, 0) / points.length;
  const avgCpl = points.reduce((s, p) => s + p.cpl_brl, 0) / points.length;

  // Tendência (slope simples — primeiro vs último)
  const cpcTrend =
    points.length >= 2 && points[0].cpc_brl > 0
      ? (points[points.length - 1].cpc_brl - points[0].cpc_brl) /
        points[0].cpc_brl
      : 0;
  const cplTrend =
    points.length >= 2 && points[0].cpl_brl > 0
      ? (points[points.length - 1].cpl_brl - points[0].cpl_brl) /
        points[0].cpl_brl
      : 0;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-48"
        role="img"
        aria-label="CPC e CPL ao longo do tempo"
      >
        {/* Grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={height * f}
            y2={height * f}
            stroke="currentColor"
            strokeWidth={0.2}
            className="text-border"
          />
        ))}
        {/* CPC line (azul) */}
        <path
          d={cpcPath}
          fill="none"
          stroke="rgb(59 130 246)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {/* CPL line (verde) */}
        <path
          d={cplPath}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="flex justify-between mt-2 text-[10px] text-muted-foreground tabular-nums">
        <span>{points[0]?.date.slice(8, 10)}/{points[0]?.date.slice(5, 7)}</span>
        <span>
          {points[points.length - 1]?.date.slice(8, 10)}/
          {points[points.length - 1]?.date.slice(5, 7)}
        </span>
      </div>
      <div className="flex justify-between mt-3 pt-3 border-t border-border text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-muted-foreground">
            CPC: <strong className="text-foreground">{fmtBRL(avgCpc)}</strong>
            {Math.abs(cpcTrend) > 0.01 && (
              <span
                className={`ml-1 ${cpcTrend < 0 ? 'text-emerald-500' : 'text-red-500'}`}
                title="diminuir CPC é bom"
              >
                ({cpcTrend > 0 ? '+' : ''}
                {(cpcTrend * 100).toFixed(0)}%)
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">
            CPL: <strong className="text-foreground">{fmtBRL(avgCpl)}</strong>
            {Math.abs(cplTrend) > 0.01 && (
              <span
                className={`ml-1 ${cplTrend < 0 ? 'text-emerald-500' : 'text-red-500'}`}
                title="diminuir CPL é bom"
              >
                ({cplTrend > 0 ? '+' : ''}
                {(cplTrend * 100).toFixed(0)}%)
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Gráfico de barras simples (sem dependência de lib) — barras verticais
 * com altura proporcional ao gasto. Tooltip via title nativo.
 */
function Timeseries({
  data,
}: {
  data: { date: string; spend_brl: number; leads: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="h-48 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
        Sem dados ainda — aguarde primeiro sync.
      </div>
    );
  }

  const maxSpend = Math.max(...data.map((d) => d.spend_brl), 1);
  const totalSpend = data.reduce((s, d) => s + d.spend_brl, 0);
  const totalLeads = data.reduce((s, d) => s + d.leads, 0);

  return (
    <div>
      <div className="flex items-end h-48 gap-px">
        {data.map((d) => {
          const heightPct = (d.spend_brl / maxSpend) * 100;
          const dayLabel = d.date.slice(8, 10) + '/' + d.date.slice(5, 7);
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col-reverse min-w-[8px]"
              title={`${dayLabel}: ${fmtBRL(d.spend_brl)} • ${d.leads} leads`}
            >
              <div
                className="bg-primary/70 hover:bg-primary rounded-t transition-colors"
                style={{ height: `${heightPct}%`, minHeight: d.spend_brl > 0 ? '2px' : '0' }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-muted-foreground tabular-nums">
        <span>{data[0]?.date.slice(8, 10) + '/' + data[0]?.date.slice(5, 7)}</span>
        <span>{data[data.length - 1]?.date.slice(8, 10) + '/' + data[data.length - 1]?.date.slice(5, 7)}</span>
      </div>
      <div className="flex justify-between mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground">
        <span>
          Total gasto: <strong className="text-foreground">{fmtBRL(totalSpend)}</strong>
        </span>
        <span>
          Total leads: <strong className="text-foreground">{totalLeads}</strong>
        </span>
      </div>
    </div>
  );
}

/**
 * Lista compacta de top 5 campanhas com CPL/gasto/conversões.
 */
function TopCampaigns({
  data,
}: {
  data: {
    id: string;
    name: string;
    channel_type: string | null;
    cost_brl: number;
    conversions: number;
    cpl_brl: number;
  }[];
}) {
  if (data.length === 0) {
    return (
      <div className="h-48 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground text-center px-4">
        Sem campanhas com conversões nos últimos 7 dias.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((c, i) => (
        <div
          key={c.id}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30"
        >
          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground truncate" title={c.name}>
              {c.name}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {c.channel_type ?? '—'} · {c.conversions} conv · {fmtBRL(c.cost_brl)} gasto
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-bold text-foreground tabular-nums">
              {fmtBRL(c.cpl_brl)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              CPL
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
