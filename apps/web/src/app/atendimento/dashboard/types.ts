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

/* ─── Team Performance (comparacoes agressivas) ─── */

export type Quartile = 'TOP' | 'MID' | 'LOW';

export interface AdvogadoKPIs {
  activeCases: number;
  casesFiledThisPeriod: number;
  avgDaysToFile: number;
  caseWinRate: number; // 0-100
  totalSentenced: number;
  wonAndPartial: number;
  deadlinesCreated: number;
  deadlinesCompleted: number;
  deadlinesMissed: number;
  deadlineCompletionRate: number; // 0-100
  petitionsDrafted: number;
  petitionsApproved: number;
  petitionsProtocoled: number;
  petitionApprovalRate: number; // 0-100
  totalContracted: number;
  totalCollected: number;
  totalReceivable: number;
  collectionRate: number; // 0-100
}

export interface OperadorKPIs {
  openConversations: number;
  closedConversations: number;
  avgResponseTimeMinutes: number;
  medianResponseTimeMinutes: number;
  leadsHandled: number;
  leadsConverted: number;
  conversionRate: number; // 0-100
  avgConversionDays: number;
  stagesAdvanced: number;
  leadsLost: number;
  tasksCompleted: number;
  taskCompletionRate: number; // 0-100
}

export interface EstagiarioKPIs {
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
  taskCompletionRate: number; // 0-100
  avgTaskCompletionDays: number;
  petitionsDrafted: number;
  petitionsInReview: number;
  petitionsApproved: number;
  petitionApprovalRate: number; // 0-100
  deadlinesManaged: number;
  deadlinesCompletedOnTime: number;
  documentsUploaded: number;
}

export interface SharedTaskKPIs {
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
  taskCompletionRate: number;
}

export interface TeamPerformanceEntry {
  userId: string;
  name: string;
  role: string;
  compositeScore: number; // 0-100
  previousScore: number;
  scoreDelta: number; // current - previous
  rank: number; // 1-based within role
  quartile: Quartile;
  advogadoKPIs?: AdvogadoKPIs;
  operadorKPIs?: OperadorKPIs;
  estagiarioKPIs?: EstagiarioKPIs;
  sharedTasks: SharedTaskKPIs;
  dailyActivity: { date: string; value: number }[]; // 7 points for sparkline
}

export interface TeamAverages {
  advogado: Partial<AdvogadoKPIs>;
  operador: Partial<OperadorKPIs>;
  estagiario: Partial<EstagiarioKPIs>;
  tasks: Partial<SharedTaskKPIs>;
}

export interface TeamPerformanceResponse {
  period: { startDate: string; endDate: string };
  previousPeriod: { startDate: string; endDate: string };
  members: TeamPerformanceEntry[];
  teamAverages: TeamAverages;
}
