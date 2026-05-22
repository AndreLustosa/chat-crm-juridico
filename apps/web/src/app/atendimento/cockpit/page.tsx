'use client';

/*
 * Cockpit — piloto do visual "futurista" (ref JurisFlow, 2026-05-22).
 * Vitrine do design system Aurum consumindo dados REAIS de GET /dashboard.
 * Roda dark independente do tema ativo (experiência premium isolada);
 * NÃO substitui o /atendimento/dashboard analítico — é uma home alternativa.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TrendingUp, Radar, Sparkles, CalendarClock, Activity, PieChart,
  Flame, ArrowUpRight, Zap, ChevronRight, CircleCheck, AlarmClock, Scale,
  Loader2, MessageSquare,
} from 'lucide-react';
import api from '@/lib/api';
import { Panel, PanelHeader } from '@/components/aurum/ui';
import { AnimatedNumber, Reveal, Stagger, StaggerItem } from '@/components/aurum/motion';
import { Donut, ProgressRing } from '@/components/aurum/charts';
import { AreaDot, Pill, PriorityBadge } from '@/components/aurum/badges';

// ─── Tipos (subset do GET /dashboard) ───────────────────────────
interface DashEvent {
  id: string;
  type: string;
  title: string;
  start_at: string;
  status: string;
  priority?: string | null;
  lead?: { name: string | null } | null;
  legal_case_id?: string | null;
}
interface DjenItem { id: string; numero_processo?: string; tipo_comunicacao?: string | null; assunto?: string | null; data_disponibilizacao?: string }
interface DashData {
  user: { id: string; name: string };
  conversations: { open: number; pendingTransfers: number };
  leadsInService: number;
  leadsTotal: number;
  leadsLost: number;
  leadPipeline: { stage: string; count: number }[];
  trackingCases: { total: number; byStage: { stage: string; count: number }[] };
  upcomingEvents: DashEvent[];
  tasks: { pending: number; inProgress: number; overdue: number };
  financials: { totalContracted: number; totalCollected: number; totalReceivable: number; totalOverdue: number; overdueCount: number };
  recentDjen: DjenItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
function daysUntil(iso: string): number {
  const due = new Date(iso).getTime();
  const nowNaive = Date.now() - BRT_OFFSET_MS;
  return Math.round((due - nowNaive) / 86400000);
}
function brl(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
}
function urgencyColor(d: number) {
  if (d <= 0) return '#FF5C72';
  if (d <= 2) return '#E6BE6A';
  if (d <= 5) return '#5B9DFF';
  return '#43E0A0';
}
function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
const STAGE_COLOR: Record<string, string> = {
  DISTRIBUIDO: '#5B9DFF', CITACAO: '#E6BE6A', CONTESTACAO: '#FF5C72', REPLICA: '#43E0A0',
  PERICIA_AGENDADA: '#A8C9FF', INSTRUCAO: '#F7DBA0', JULGAMENTO: '#FF9AA9', RECURSO: '#86F5C8',
  TRANSITADO: '#A6AEC0', EXECUCAO: '#FFB35C', ENCERRADO: '#6A748A',
};
const STAGE_LABEL: Record<string, string> = {
  DISTRIBUIDO: 'Distribuído', CITACAO: 'Citação', CONTESTACAO: 'Contestação', REPLICA: 'Réplica',
  PERICIA_AGENDADA: 'Perícia', INSTRUCAO: 'Instrução', JULGAMENTO: 'Julgamento', RECURSO: 'Recurso',
  TRANSITADO: 'Trânsito', EXECUCAO: 'Execução', ENCERRADO: 'Encerrado',
};
const FEED_ICON: Record<string, { color: string }> = {
  Intimação: { color: '#FF9F5C' }, Intimacao: { color: '#FF9F5C' },
  Despacho: { color: '#5B9DFF' }, Sentença: { color: '#43E0A0' }, default: { color: '#E6BE6A' },
};

const dataHoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

export default function CockpitPage() {
  const router = useRouter();
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="relative min-h-full bg-[#05070d] text-ink-1 flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-aurum" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="relative min-h-full bg-[#05070d] text-ink-2 flex items-center justify-center py-32 text-sm">
        Não foi possível carregar o cockpit.
      </div>
    );
  }

  const firstName = (data.user?.name || 'Doutor(a)').split(' ')[0];
  const prazosCriticos = data.upcomingEvents.filter(e => daysUntil(e.start_at) <= 1).length;
  const taxaRecebimento = data.financials.totalContracted > 0
    ? Math.round((data.financials.totalCollected / data.financials.totalContracted) * 100)
    : 0;

  const urgentes = [...data.upcomingEvents]
    .sort((a, b) => daysUntil(a.start_at) - daysUntil(b.start_at))
    .slice(0, 6);

  const hojeISO = new Date().toISOString().slice(0, 10);
  const agendaHoje = data.upcomingEvents
    .filter(e => e.start_at.slice(0, 10) === hojeISO)
    .slice(0, 6);

  const focoEvento = urgentes[0];
  const totalCasos = data.trackingCases.total || 1;
  const donutSegments = data.trackingCases.byStage
    .filter(s => s.count > 0)
    .slice(0, 8)
    .map(s => ({ label: STAGE_LABEL[s.stage] || s.stage, value: s.count, color: STAGE_COLOR[s.stage] || '#A6AEC0' }));

  return (
    <div className="relative min-h-full overflow-hidden bg-[#05070d] text-ink-1">
      {/* Atmosphere — contido na area de conteudo (absolute, nao fixed) */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_-10%,#0c1322_0%,#070a12_45%,#05070d_100%)]" />
        <div className="absolute -left-[12%] -top-[18%] h-[60vh] w-[60vh] rounded-full bg-[radial-gradient(circle,rgba(230,190,106,0.16),transparent_62%)] blur-3xl animate-aurum-drift" />
        <div className="absolute -right-[10%] top-[28%] h-[55vh] w-[55vh] rounded-full bg-[radial-gradient(circle,rgba(67,224,160,0.10),transparent_60%)] blur-3xl animate-aurum-drift-slow" />
        <div className="absolute inset-0 aurum-grid-fade [background-size:64px_64px] [mask-image:radial-gradient(120%_90%_at_50%_0%,#000_30%,transparent_75%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1400px] space-y-5 p-5 lg:p-7">
        {/* Greeting */}
        <Reveal>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm capitalize text-ink-3">{dataHoje}</p>
              <h1 className="mt-1 text-[32px] font-semibold leading-none tracking-tight text-ink-1 sm:text-[38px]">
                {saudacao()}, <span className="aurum-text-gradient">{firstName}</span>.
              </h1>
              <p className="mt-2 text-[15px] text-ink-2">
                {prazosCriticos > 0 ? (
                  <>Você tem <span className="font-semibold text-crimson-bright">{prazosCriticos} prazo{prazosCriticos > 1 ? 's' : ''} crítico{prazosCriticos > 1 ? 's' : ''}</span> nas próximas 24h.</>
                ) : (
                  <>Nenhum prazo crítico nas próximas 24h. Bom trabalho.</>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={prazosCriticos > 0 ? 'crimson' : 'jade'}>
                <span className={`h-1.5 w-1.5 rounded-full ${prazosCriticos > 0 ? 'bg-crimson' : 'bg-jade'} animate-aurum-pulse-ring`} />
                {prazosCriticos > 0 ? 'Atenção aos prazos' : 'Tudo sob controle'}
              </Pill>
            </div>
          </div>
        </Reveal>

        {/* KPI strip */}
        <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Processos ativos" value={data.trackingCases.total} tone="gold" />
          <KpiCard label="Prazos na semana" value={data.upcomingEvents.length} trend={`${prazosCriticos} crítico(s)`} tone="crimson" />
          <KpiCard label="Honorários recebidos" value={data.financials.totalCollected} money trend={`${brl(data.financials.totalReceivable)} a receber`} tone="jade" />
          <KpiCard label="Taxa de recebimento" value={taxaRecebimento} suffix="%" ring tone="gold" />
        </Stagger>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Radar de prazos */}
          <Reveal delay={0.05} className="lg:col-span-2">
            <Panel className="h-full">
              <PanelHeader
                title="Radar de prazos"
                sub="Ordenado por urgência"
                icon={<Radar className="h-4 w-4 text-crimson" />}
              />
              <div className="space-y-1">
                {urgentes.length === 0 && <p className="py-8 text-center text-sm text-ink-3">Nenhum prazo ou evento próximo.</p>}
                {urgentes.map((e) => {
                  const d = daysUntil(e.start_at);
                  const c = urgencyColor(d);
                  return (
                    <div
                      key={e.id}
                      onClick={() => e.legal_case_id && router.push(`/atendimento/processos?openCase=${e.legal_case_id}`)}
                      className="group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg" style={{ background: `${c}1a`, color: c }}>
                        <span className="aurum-stat-mono text-sm font-bold leading-none">{d <= 0 ? '!' : d}</span>
                        <span className="text-[8px] uppercase">{d <= 0 ? 'hoje' : 'dias'}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-1">{e.title}</p>
                        <p className="truncate text-xs text-ink-3">{e.lead?.name || 'Sem cliente'}</p>
                      </div>
                      <PriorityBadge prioridade={e.priority} className="hidden sm:inline-flex" />
                      <ChevronRight className="h-4 w-4 text-ink-4 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  );
                })}
              </div>
            </Panel>
          </Reveal>

          {/* Foco do dia */}
          <Reveal delay={0.12}>
            <Panel glow className="flex h-full flex-col">
              <PanelHeader title="Foco do dia" icon={<Zap className="h-4 w-4 text-aurum" />} />
              {focoEvento ? (
                <div className="rounded-xl bg-gradient-to-br from-crimson/[0.12] to-transparent p-4 shadow-[inset_0_0_0_1px_rgba(255,92,114,0.18)]">
                  <div className="flex items-center gap-2 text-crimson-bright">
                    <AlarmClock className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {daysUntil(focoEvento.start_at) <= 0 ? 'Vence hoje' : `Em ${daysUntil(focoEvento.start_at)} dia(s)`}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium leading-snug text-ink-1">{focoEvento.title}</p>
                  <p className="mt-1 text-xs text-ink-3">{focoEvento.lead?.name || 'Sem cliente'}</p>
                  {focoEvento.legal_case_id && (
                    <button
                      onClick={() => router.push(`/atendimento/processos?openCase=${focoEvento.legal_case_id}`)}
                      className="aurum-btn mt-3 w-full !py-2 text-[13px]"
                    >
                      <Scale className="h-3.5 w-3.5" /> Abrir processo
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl bg-white/[0.02] p-4 text-sm text-ink-3">Sem foco urgente no momento.</div>
              )}

              <div className="mt-4 space-y-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-4">Tarefas</p>
                <FocoStat label="Pendentes" value={data.tasks.pending} color="#E6BE6A" />
                <FocoStat label="Em andamento" value={data.tasks.inProgress} color="#5B9DFF" />
                <FocoStat label="Atrasadas" value={data.tasks.overdue} color="#FF5C72" />
              </div>
            </Panel>
          </Reveal>

          {/* Agenda de hoje */}
          <Reveal delay={0.05} className="lg:col-span-2">
            <Panel className="h-full">
              <PanelHeader
                title="Agenda de hoje"
                icon={<CalendarClock className="h-4 w-4 text-azure" />}
                action={<Pill tone="azure">{agendaHoje.length} evento(s)</Pill>}
              />
              {agendaHoje.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-3">Nada agendado para hoje.</p>
              ) : (
                <div className="relative space-y-1 pl-1">
                  {agendaHoje.map((e) => {
                    const hora = new Date(e.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
                    return (
                      <div key={e.id} className="flex gap-3">
                        <span className="aurum-stat-mono mt-1 w-12 shrink-0 text-[11px] text-ink-3">{hora}</span>
                        <div className="relative flex flex-col items-center pt-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-aurum" style={{ boxShadow: '0 0 8px #E6BE6A' }} />
                          <span className="my-0.5 w-px flex-1 bg-white/10" />
                        </div>
                        <div className="mb-2 flex-1 rounded-lg bg-aurum/[0.06] px-3 py-2 shadow-[inset_0_0_0_1px_rgba(230,190,106,0.14)]">
                          <p className="text-[13px] font-medium text-ink-1">{e.title}</p>
                          <p className="text-[11px] text-ink-3">{e.lead?.name || 'Sem cliente'}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </Reveal>

          {/* Carteira por etapa */}
          <Reveal delay={0.12}>
            <Panel className="h-full">
              <PanelHeader title="Carteira por etapa" icon={<PieChart className="h-4 w-4 text-aurum" />} />
              {donutSegments.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-3">Sem processos em acompanhamento.</p>
              ) : (
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <Donut segments={donutSegments} size={134} stroke={18} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-semibold text-ink-1"><AnimatedNumber value={data.trackingCases.total} /></span>
                      <span className="text-[10px] text-ink-4">casos</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {donutSegments.map((s) => (
                      <div key={s.label} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-ink-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="aurum-stat-mono text-ink-3">{Math.round((s.value / totalCasos) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </Reveal>

          {/* Feed DJEN */}
          <Reveal delay={0.05}>
            <Panel className="h-full">
              <PanelHeader
                title="Publicações recentes"
                icon={<Activity className="h-4 w-4 text-jade" />}
                action={
                  <span className="flex items-center gap-1.5 text-[11px] text-jade">
                    <span className="h-1.5 w-1.5 rounded-full bg-jade animate-aurum-pulse-ring" /> DJEN
                  </span>
                }
              />
              {data.recentDjen.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-3">Nenhuma publicação recente.</p>
              ) : (
                <div className="space-y-3.5">
                  {data.recentDjen.slice(0, 6).map((f) => {
                    const cfg = FEED_ICON[f.tipo_comunicacao || 'default'] || FEED_ICON.default;
                    return (
                      <div key={f.id} className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${cfg.color}1a`, color: cfg.color }}>
                          <AlarmClock className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] leading-snug text-ink-2">
                            {f.tipo_comunicacao || 'Publicação'} · {f.assunto || f.numero_processo || 'Processo'}
                          </p>
                          <p className="aurum-stat-mono text-[10px] text-ink-4">{f.numero_processo}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                onClick={() => router.push('/atendimento/djen')}
                className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl border border-white/10 py-2 text-[12px] font-medium text-aurum/90 transition-colors hover:bg-white/[0.03] hover:text-aurum-bright"
              >
                Ver todas no DJEN <ArrowUpRight className="h-3 w-3" />
              </button>
            </Panel>
          </Reveal>
        </div>

        {/* Rodapé: atalhos */}
        <Reveal delay={0.1}>
          <div className="flex flex-wrap gap-3">
            <ShortcutCard icon={<MessageSquare className="h-4 w-4" />} label="Inbox" sub={`${data.conversations.open} abertas`} onClick={() => router.push('/atendimento')} />
            <ShortcutCard icon={<Scale className="h-4 w-4" />} label="Processos" sub={`${data.trackingCases.total} ativos`} onClick={() => router.push('/atendimento/processos')} />
            <ShortcutCard icon={<Sparkles className="h-4 w-4" />} label="Triagem" sub={`${data.tasks.pending} tarefas`} onClick={() => router.push('/atendimento/advogado')} />
            <ShortcutCard icon={<TrendingUp className="h-4 w-4" />} label="Dashboard" sub="Métricas completas" onClick={() => router.push('/atendimento/dashboard')} />
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function KpiCard({
  label, value, suffix = '', money = false, trend, tone, ring = false,
}: {
  label: string; value: number; suffix?: string; money?: boolean; trend?: string;
  tone: 'jade' | 'crimson' | 'gold' | 'azure'; ring?: boolean;
}) {
  return (
    <StaggerItem>
      <Panel className="h-full">
        <p className="text-[13px] text-ink-3">{label}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="text-[28px] font-semibold leading-none text-ink-1">
            {money ? <AnimatedNumber value={value} format={(n) => brl(n)} /> : <AnimatedNumber value={value} suffix={suffix} />}
          </div>
          {ring && (
            <ProgressRing value={value} size={52} stroke={5}>
              <span className="aurum-stat-mono text-[11px] font-semibold text-aurum-bright">{value}%</span>
            </ProgressRing>
          )}
        </div>
        {trend && <div className="mt-2.5"><Pill tone={tone}>{trend}</Pill></div>}
      </Panel>
    </StaggerItem>
  );
}

function FocoStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <CircleCheck className="h-4 w-4" style={{ color: value > 0 ? color : '#454e62' }} />
      <span className="text-ink-2">{label}</span>
      <span className="aurum-stat-mono ml-auto font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

function ShortcutCard({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="aurum-glass flex flex-1 min-w-[160px] items-center gap-3 rounded-2xl px-4 py-3 text-left transition-transform hover:-translate-y-0.5"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-aurum/[0.10] text-aurum">{icon}</span>
      <div>
        <p className="text-[13px] font-semibold text-ink-1">{label}</p>
        <p className="text-[11px] text-ink-3">{sub}</p>
      </div>
    </button>
  );
}
