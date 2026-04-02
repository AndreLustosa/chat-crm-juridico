'use client';

import { useRole } from '@/lib/useRole';
import { useDashboardData } from './hooks/useDashboardData';
import { usePeriodFilter } from './hooks/usePeriodFilter';
import { MotionWidget } from './components/MotionWidget';
import {
  useRevenueTrend, useLeadFunnel, useTaskCompletion,
  useCaseDuration, useFinancialAging, useAiUsage,
  useLeadSources, useResponseTime, useConversionVelocity,
} from './hooks/useAnalyticsData';

import { DashboardHeader } from './components/DashboardHeader';
import { PeriodSelector } from './components/PeriodSelector';
import { StatsGrid } from './components/StatsGrid';
import { InboxStats } from './components/InboxStats';
import { FinancialStats } from './components/FinancialStats';
import { LeadPipeline } from './components/LeadPipeline';
import { LegalCasesPipeline } from './components/LegalCasesPipeline';
import { TeamMetrics } from './components/TeamMetrics';
import { UpcomingEvents } from './components/UpcomingEvents';
import { DjenPublications } from './components/DjenPublications';
import { QuickActions } from './components/QuickActions';

import { RevenueTrendChart } from './components/charts/RevenueTrendChart';
import { LeadFunnelChart } from './components/charts/LeadFunnelChart';
import { TaskCompletionChart } from './components/charts/TaskCompletionChart';
import { CaseDurationChart } from './components/charts/CaseDurationChart';
import { FinancialAgingChart } from './components/charts/FinancialAgingChart';
import { AiUsageChart } from './components/charts/AiUsageChart';
import { LeadSourcesChart } from './components/charts/LeadSourcesChart';
import { ConversionVelocityWidget } from './components/charts/ConversionVelocityWidget';
import { ResponseTimeWidget } from './components/charts/ResponseTimeWidget';

/* ═══════════════════════════════════════════════════════════════
   Dashboard — Composicao principal
   ═══════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const roleInfo = useRole();
  const { isAdmin, isAdvogado, isOperador, isEstagiario, isFinanceiro } = roleInfo;

  const { period, setPeriod, setCustomRange } = usePeriodFilter('30d');
  const { data, loading } = useDashboardData(period);

  // Analytics hooks — cada widget carrega independentemente
  const revenue = useRevenueTrend(12);
  const funnel = useLeadFunnel(period);
  const tasks = useTaskCompletion(period);
  const caseDuration = useCaseDuration();
  const aging = useFinancialAging();
  const aiUsage = useAiUsage(6, isAdmin);
  const sources = useLeadSources(period);
  const responseTime = useResponseTime(period);
  const velocity = useConversionVelocity(period);

  // Visibility per role
  const showInbox = isAdmin || isOperador;
  const showFinancials = isAdmin || isAdvogado || isFinanceiro;
  const showRevenue = isAdmin || isAdvogado || isFinanceiro;
  const showFunnel = isAdmin || isOperador;
  const showTasks = isAdmin || isAdvogado || isOperador || isEstagiario;
  const showPipeline = isAdmin || isOperador;
  const showCases = isAdmin || isAdvogado || isEstagiario;
  const showCaseDuration = isAdmin || isAdvogado;
  const showAging = isAdmin || isAdvogado || isFinanceiro;
  const showVelocity = isAdmin || isOperador;
  const showResponse = isAdmin || isOperador;
  const showSources = isAdmin || isOperador;
  const showAi = isAdmin;
  const showTeam = isAdmin;
  const showEvents = isAdmin || isAdvogado || isOperador || isEstagiario;
  const showDjen = isAdmin || isAdvogado || isEstagiario;

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
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 pb-28 md:pb-6">

        {/* Row 1: Header + Period Selector */}
        <MotionWidget>
          <div className="space-y-3">
            <DashboardHeader data={data} isAdmin={isAdmin} />
            <PeriodSelector active={period.key} onSelect={setPeriod} onCustomRange={setCustomRange} />
          </div>
        </MotionWidget>

        {/* Row 2: Stats Grid */}
        <MotionWidget delay={0.05}>
          <StatsGrid data={data} />
        </MotionWidget>

        {/* Row 3: Inbox + Financial Stats */}
        <MotionWidget delay={0.1}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showInbox && data.inboxStats && (
              <InboxStats
                closedToday={data.inboxStats.closedToday}
                closedThisWeek={data.inboxStats.closedThisWeek}
                closedThisMonth={data.inboxStats.closedThisMonth}
              />
            )}
            {showFinancials && (
              <div className={showInbox && data.inboxStats ? '' : 'md:col-span-2'}>
                <FinancialStats financials={data.financials} />
              </div>
            )}
          </div>
        </MotionWidget>

        {/* Row 4: Revenue Trend (full width) */}
        {showRevenue && (
          <MotionWidget delay={0.15}>
            <RevenueTrendChart data={revenue.data} loading={revenue.loading} />
          </MotionWidget>
        )}

        {/* Row 5: Lead Funnel + Task Completion */}
        <MotionWidget delay={0.2}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showFunnel && <LeadFunnelChart data={funnel.data} loading={funnel.loading} />}
            {showTasks && <TaskCompletionChart data={tasks.data} loading={tasks.loading} />}
          </div>
        </MotionWidget>

        {/* Row 6: Lead Pipeline (admin/operator) */}
        {showPipeline && (
          <MotionWidget delay={0.25}>
            <LeadPipeline pipeline={data.leadPipeline} />
          </MotionWidget>
        )}

        {/* Row 7: Legal Cases Pipeline (2 columns) */}
        {showCases && (
          <MotionWidget delay={0.3}>
            <LegalCasesPipeline legalCases={data.legalCases} trackingCases={data.trackingCases} />
          </MotionWidget>
        )}

        {/* Row 8: Case Duration + Financial Aging */}
        <MotionWidget delay={0.35}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showCaseDuration && <CaseDurationChart data={caseDuration.data} loading={caseDuration.loading} />}
            {showAging && <FinancialAgingChart data={aging.data} loading={aging.loading} />}
          </div>
        </MotionWidget>

        {/* Row 9: Velocity + Response Time + Lead Sources (3 col) */}
        <MotionWidget delay={0.4}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {showVelocity && <ConversionVelocityWidget data={velocity.data} loading={velocity.loading} />}
            {showResponse && <ResponseTimeWidget data={responseTime.data} loading={responseTime.loading} />}
            {showSources && <LeadSourcesChart data={sources.data} loading={sources.loading} />}
          </div>
        </MotionWidget>

        {/* Row 10: AI Usage (admin) */}
        {showAi && (
          <MotionWidget delay={0.45}>
            <AiUsageChart data={aiUsage.data} loading={aiUsage.loading} />
          </MotionWidget>
        )}

        {/* Row 11: Team Metrics (admin) */}
        {showTeam && (
          <MotionWidget delay={0.5}>
            <TeamMetrics members={data.teamMetrics} />
          </MotionWidget>
        )}

        {/* Row 12: Events + DJEN (2 columns) */}
        <MotionWidget delay={0.55}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showEvents && <UpcomingEvents events={data.upcomingEvents} />}
            {showDjen && <DjenPublications items={data.recentDjen} />}
          </div>
        </MotionWidget>

        {/* Row 13: Quick Actions */}
        <MotionWidget delay={0.6}>
          <QuickActions roleInfo={roleInfo} />
        </MotionWidget>
      </div>
    </div>
  );
}
