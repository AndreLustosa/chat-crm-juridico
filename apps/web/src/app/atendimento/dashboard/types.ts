/* ─── Dashboard shared types ─── */

export type PeriodKey = 'today' | '7d' | '30d' | '90d' | 'custom';

export interface PeriodFilter {
  key: PeriodKey;
  startDate: string; // ISO
  endDate: string;   // ISO
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/* ─── Core dashboard data (existing API shape) ─── */

export interface TeamMember {
  userId: string;
  name: string;
  role: string;
  openConversations: number;
  activeCases: number;
  pendingTasks: number;
  overdueTasks: number;
  totalCollected: number;
  totalReceivable: number;
}

export interface DashboardData {
  user: { id: string; name: string; role: string };
  conversations: { open: number; pendingTransfers: number };
  leadPipeline: { stage: string; count: number }[];
  legalCases: { total: number; byStage: { stage: string; count: number }[] };
  trackingCases: { total: number; byStage: { stage: string; count: number }[] };
  upcomingEvents: DashboardEvent[];
  tasks: { pending: number; inProgress: number; overdue: number };
  inboxStats?: { closedToday: number; closedThisWeek: number; closedThisMonth: number };
  financials: {
    totalContracted: number;
    totalCollected: number;
    totalReceivable: number;
    totalOverdue: number;
    overdueCount: number;
  };
  recentDjen: DjenItem[];
  teamMetrics: TeamMember[];
}

export interface DashboardEvent {
  id: string;
  type: string;
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  priority: string;
  lead_name: string | null;
  legal_case_id: string | null;
}

export interface DjenItem {
  id: string;
  numero_processo: string;
  tipo_comunicacao: string | null;
  data_disponibilizacao: string;
  lead_name: string | null;
  legal_case_id: string | null;
}

/* ─── Analytics endpoint types ─── */

export interface RevenueTrendMonth {
  month: string;
  contracted: number;
  collected: number;
  receivable: number;
}

export interface RevenueTrendData {
  months: RevenueTrendMonth[];
}

export interface FunnelStage {
  stage: string;
  count: number;
  conversionRate: number;
  avgDays: number;
}

export interface LeadFunnelData {
  stages: FunnelStage[];
  totalLeads: number;
  totalClients: number;
  overallConversionRate: number;
}

export interface TaskCompletionData {
  completed: number;
  pending: number;
  overdue: number;
  completionRate: number;
}

export interface CaseDurationStage {
  stage: string;
  avgDays: number;
  count: number;
}

export interface CaseDurationData {
  stages: CaseDurationStage[];
}

export interface AgingBucket {
  range: string;
  count: number;
  total: number;
}

export interface FinancialAgingData {
  buckets: AgingBucket[];
  grandTotal: number;
}

export interface AiUsageMonth {
  month: string;
  tokens: number;
  cost: number;
}

export interface AiUsageModel {
  model: string;
  tokens: number;
  cost: number;
}

export interface AiUsageData {
  byMonth: AiUsageMonth[];
  byModel: AiUsageModel[];
  totalCost: number;
}

export interface LeadSourceItem {
  source: string;
  count: number;
  percentage: number;
}

export interface LeadSourcesData {
  sources: LeadSourceItem[];
}

export interface ResponseTimeData {
  avgMinutes: number;
  medianMinutes: number;
  byDay: { date: string; avgMinutes: number }[];
}

export interface ConversionVelocityData {
  avgDays: number;
  medianDays: number;
  byMonth: { month: string; avgDays: number; count: number }[];
}

export interface TeamPerformanceMember {
  userId: string;
  name: string;
  closedPerDay: { date: string; count: number }[];
  casesAdvancedPerWeek: number;
  collectionRate: number;
}

export interface TeamPerformanceData {
  members: TeamPerformanceMember[];
}
