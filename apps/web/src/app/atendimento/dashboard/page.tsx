'use client';

import { useState } from 'react';
import {
  LayoutDashboard, Scale, BarChart2, Wallet, Users, Download,
} from 'lucide-react';
import { useRole } from '@/lib/useRole';
import { exportDashboardPdf } from './exportDashboardPdf';
import { useDashboardData } from './hooks/useDashboardData';
import { usePeriodFilter } from './hooks/usePeriodFilter';
import { useTeamPerformance } from './hooks/useTeamPerformance';
import { useComparisons } from './hooks/useComparisons';
import { MotionWidget } from './components/MotionWidget';
import { DashboardSection } from './components/DashboardSection';
import { SectionNav } from './components/SectionNav';
import { visibleSections } from './sectionVisibility';
import {
  useRevenueTrend, useLeadFunnel, useTaskCompletion,
  useCaseDuration, useCasesByArea, useFinancialAging, useAiUsage,
  useLeadSources, useResponseTime, useConversionVelocity,
} from './hooks/useAnalyticsData';

import { DashboardHeader } from './components/DashboardHeader';
import { PeriodSelector } from './components/PeriodSelector';
import { StatsGrid } from './components/StatsGrid';
import { InboxStats } from './components/InboxStats';
import { FinancialStats } from './components/FinancialStats';
import { LeadPipeline } from './components/LeadPipeline';
import { LegalCasesPipeline } from './components/LegalCasesPipeline';
import { TeamPerformanceBoard } from './components/TeamPerformanceBoard';
import { ComparisonsBoard } from './components/ComparisonsBoard';
import { UpcomingEvents } from './components/UpcomingEvents';
import { DjenPublications } from './components/DjenPublications';
import { QuickActions } from './components/QuickActions';
import { TeamOnline } from './components/TeamOnline';
import { OperatorPerformanceStrip } from './components/OperatorPerformanceStrip';

import { RevenueTrendChart } from './components/charts/RevenueTrendChart';
import { LeadFunnelChart } from './components/charts/LeadFunnelChart';
import { TaskCompletionChart } from './components/charts/TaskCompletionChart';
import { CaseDurationChart } from './components/charts/CaseDurationChart';
import { CasesByAreaChart } from './components/charts/CasesByAreaChart';
import { FinancialAgingChart } from './components/charts/FinancialAgingChart';
import { AiUsageChart } from './components/charts/AiUsageChart';
import { LeadSourcesChart } from './components/charts/LeadSourcesChart';
import { ConversionVelocityWidget } from './components/charts/ConversionVelocityWidget';
import { ResponseTimeWidget } from './components/charts/ResponseTimeWidget';

/* ═══════════════════════════════════════════════════════════════
   Dashboard — Organização por seções de perfil
   ═══════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const roleInfo = useRole();
  const { isAdmin } = roleInfo;
  const sections = visibleSections(roleInfo);

  const { period, setPeriod, setCustomRange } = usePeriodFilter('30d');
  const { data, loading } = useDashboardData(period);

  const showGeral = sections.includes('geral');
  const showAdvogados = sections.includes('advogados');
  const showComercial = sections.includes('comercial');
  const showFinanceiro = sections.includes('financeiro');
  const showEstagiarios = sections.includes('estagiarios');

  /* ──────────────────────────────────────────────────────────────────
   * Analytics — cada seção busca dados com seu scope específico.
   * Para ADMIN (vê Geral + outras): as hooks "overview" carregam sem scope
   * para alimentar StatsGrid; as hooks scopadas alimentam seções específicas.
   * Para papéis não-admin (veem só uma seção): scope=default da seção.
   * ────────────────────────────────────────────────────────────────── */

  // === Overview (Geral) — sem scope, só carrega quando Geral está visível ===
  const funnelOverview = useLeadFunnel(period);

  // === Comercial — scope=comercial ===
  const funnelComercial = useLeadFunnel(period, showComercial ? 'comercial' : undefined);
  const sourcesComercial = useLeadSources(period, showComercial ? 'comercial' : undefined);
  const responseTimeComercial = useResponseTime(period, showComercial ? 'comercial' : undefined);
  const velocityComercial = useConversionVelocity(period, showComercial ? 'comercial' : undefined);
  const tasksComercial = useTaskCompletion(period, showComercial ? 'comercial' : undefined);

  // === Advogados — scope=juridico ===
  const caseDuration = useCaseDuration(showAdvogados ? 'juridico' : undefined);
  const casesByArea = useCasesByArea(showAdvogados ? 'juridico' : undefined);

  // === Financeiro — scope=financeiro ===
  const revenue = useRevenueTrend(12, showFinanceiro ? 'financeiro' : undefined);
  const aging = useFinancialAging(showFinanceiro ? 'financeiro' : undefined);

  // === Estagiários — scope=estagiarios ===
  const tasksEstagiarios = useTaskCompletion(period, showEstagiarios ? 'estagiarios' : undefined);

  // === AI Usage (admin-only) ===
  const aiUsage = useAiUsage(6, isAdmin);

  // === Comparisons (só carrega se Geral estiver visível) ===
  const comparisons = useComparisons(period, showGeral);

  // === Export PDF ===
  const [exportingPdf, setExportingPdf] = useState(false);
  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const periodLabels: Record<string, string> = {
        today: 'Hoje',
        '7d': 'Últimos 7 dias',
        '30d': 'Últimos 30 dias',
        '90d': 'Últimos 90 dias',
        custom: 'Período personalizado',
      };
      await exportDashboardPdf({
        sectionIds: ['pdf-stats-grid', 'pdf-comparisons', 'pdf-team-perf'],
        periodLabel: periodLabels[period.key] ?? period.key,
        userName: data?.user.name,
      });
    } catch (err) {
      console.error('[dashboard] erro ao exportar PDF', err);
    } finally {
      setExportingPdf(false);
    }
  };

  // === TeamPerformance: uma instância por contexto ===
  // Geral: sem scope (agrega todos os papéis)
  const teamPerfGeral = useTeamPerformance(period, showGeral);
  // Comercial: scope=comercial (ranking dos comerciais)
  const teamPerfComercial = useTeamPerformance(period, showComercial && !showGeral, 'comercial');
  // Estagiários: scope=estagiarios (ranking dos estagiários supervisionados)
  const teamPerfEstagiarios = useTeamPerformance(period, showEstagiarios && !showGeral, 'estagiarios');

  // Full-page loading
  if (loading && !data) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 md:p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="animate-pulse space-y-2">
            <div className="h-8 w-60 bg-muted rounded-lg" />
            <div className="h-4 w-44 bg-muted rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-3 animate-pulse">
                <div className="w-6 h-6 rounded-lg bg-muted mb-1.5" />
                <div className="h-5 w-12 bg-muted rounded mb-1" />
                <div className="h-2 w-16 bg-muted rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-56" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-7xl mx-auto p-4 md:p-6 pb-28 md:pb-6 space-y-4">

        {/* Cabeçalho + filtro de período (sempre visíveis) */}
        <MotionWidget>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <DashboardHeader data={data} isAdmin={isAdmin} />
              </div>
              {showGeral && (
                <button
                  onClick={handleExportPdf}
                  disabled={exportingPdf}
                  className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[12px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Baixar PDF"
                >
                  <Download size={14} strokeWidth={2.5} />
                  {exportingPdf ? 'Gerando...' : 'Baixar PDF'}
                </button>
              )}
            </div>
            <PeriodSelector active={period.key} onSelect={setPeriod} onCustomRange={setCustomRange} />
          </div>
        </MotionWidget>

        {/* Navegação entre seções (sticky) */}
        <SectionNav sections={sections} />

        <div className="space-y-8">

          {/* ═══════════ SEÇÃO: GERAL ═══════════ */}
          {showGeral && (
            <DashboardSection
              id="geral"
              title="Visão Geral"
              subtitle="KPIs consolidados do escritório"
              icon={<LayoutDashboard size={20} strokeWidth={2} />}
            >
              <div id="pdf-stats-grid">
                <StatsGrid
                  data={data}
                  aggressive={true}
                  funnel={funnelOverview.data}
                />
              </div>

              <div id="pdf-comparisons">
                <ComparisonsBoard data={comparisons.data} loading={comparisons.loading} />
              </div>

              {data.inboxStats && (
                <InboxStats
                  closedToday={data.inboxStats.closedToday}
                  closedThisWeek={data.inboxStats.closedThisWeek}
                  closedThisMonth={data.inboxStats.closedThisMonth}
                  isOperador={true}
                />
              )}

              <div id="pdf-team-perf">
                <TeamPerformanceBoard data={teamPerfGeral.data} loading={teamPerfGeral.loading} />
              </div>

              {isAdmin && <AiUsageChart data={aiUsage.data} loading={aiUsage.loading} />}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UpcomingEvents events={data.upcomingEvents} />
                <TeamOnline />
              </div>
            </DashboardSection>
          )}

          {/* ═══════════ SEÇÃO: ADVOGADOS ═══════════ */}
          {showAdvogados && (
            <DashboardSection
              id="advogados"
              title="Advogados"
              subtitle="Processos, prazos e publicações"
              icon={<Scale size={20} strokeWidth={2} />}
            >
              <LegalCasesPipeline
                legalCases={data.legalCases}
                trackingCases={data.trackingCases}
              />

              <CasesByAreaChart data={casesByArea.data} loading={casesByArea.loading} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CaseDurationChart data={caseDuration.data} loading={caseDuration.loading} />
                <DjenPublications items={data.recentDjen} />
              </div>
            </DashboardSection>
          )}

          {/* ═══════════ SEÇÃO: COMERCIAL ═══════════ */}
          {showComercial && (
            <DashboardSection
              id="comercial"
              title="Comercial"
              subtitle="Leads, conversão e atendimento"
              icon={<BarChart2 size={20} strokeWidth={2} />}
            >
              <OperatorPerformanceStrip
                funnel={funnelComercial.data}
                responseTime={responseTimeComercial.data}
                tasks={tasksComercial.data}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <LeadFunnelChart data={funnelComercial.data} loading={funnelComercial.loading} />
                <LeadSourcesChart data={sourcesComercial.data} loading={sourcesComercial.loading} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ResponseTimeWidget data={responseTimeComercial.data} loading={responseTimeComercial.loading} />
                <ConversionVelocityWidget data={velocityComercial.data} loading={velocityComercial.loading} />
              </div>

              <LeadPipeline pipeline={data.leadPipeline} />

              {/* Ranking dos comerciais — exibido apenas quando o usuário não vê
                  a Geral (onde o TeamPerformanceBoard consolidado já aparece). */}
              {!showGeral && (
                <TeamPerformanceBoard data={teamPerfComercial.data} loading={teamPerfComercial.loading} />
              )}
            </DashboardSection>
          )}

          {/* ═══════════ SEÇÃO: FINANCEIRO ═══════════ */}
          {showFinanceiro && (
            <DashboardSection
              id="financeiro"
              title="Financeiro"
              subtitle="Receita, recebimentos e aging"
              icon={<Wallet size={20} strokeWidth={2} />}
            >
              <FinancialStats financials={data.financials} />
              <RevenueTrendChart data={revenue.data} loading={revenue.loading} />
              <FinancialAgingChart data={aging.data} loading={aging.loading} />
            </DashboardSection>
          )}

          {/* ═══════════ SEÇÃO: ESTAGIÁRIOS ═══════════ */}
          {showEstagiarios && (
            <DashboardSection
              id="estagiarios"
              title="Estagiários"
              subtitle="Tarefas e produtividade"
              icon={<Users size={20} strokeWidth={2} />}
            >
              <TaskCompletionChart data={tasksEstagiarios.data} loading={tasksEstagiarios.loading} />

              {/* Estagiários supervisionados — TeamPerformanceBoard com scope=estagiarios.
                  Exibido apenas quando não está na Geral (para evitar duplicação). */}
              {!showGeral && (
                <TeamPerformanceBoard data={teamPerfEstagiarios.data} loading={teamPerfEstagiarios.loading} />
              )}

              <UpcomingEvents events={data.upcomingEvents} />
            </DashboardSection>
          )}
        </div>

        {/* Ações rápidas no rodapé (sempre) */}
        <MotionWidget delay={0.1}>
          <QuickActions roleInfo={roleInfo} />
        </MotionWidget>
      </div>
    </div>
  );
}
