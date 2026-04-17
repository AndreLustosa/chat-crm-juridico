'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import type {
  PeriodFilter, RevenueTrendData, LeadFunnelData, TaskCompletionData,
  CaseDurationData, CasesByAreaData, FinancialAgingData, AiUsageData, LeadSourcesData,
  ResponseTimeData, ConversionVelocityData,
} from '../types';
import type { Scope } from '../sectionVisibility';

function useAnalyticsEndpoint<T>(endpoint: string, params?: Record<string, string>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paramKey = params ? JSON.stringify(params) : '';

  const fetch = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(endpoint, { params });
      setData(r.data);
    } catch {
      setError(`Erro ao carregar ${endpoint}`);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, paramKey, enabled]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

function periodParams(period?: PeriodFilter): Record<string, string> {
  if (!period) return {};
  return { startDate: period.startDate, endDate: period.endDate };
}

function withScope(params: Record<string, string>, scope?: Scope): Record<string, string> {
  return scope ? { ...params, scope } : params;
}

export function useRevenueTrend(months = 12, scope?: Scope) {
  return useAnalyticsEndpoint<RevenueTrendData>(
    '/dashboard/revenue-trend',
    withScope({ months: String(months) }, scope),
  );
}

export function useLeadFunnel(period?: PeriodFilter, scope?: Scope) {
  return useAnalyticsEndpoint<LeadFunnelData>(
    '/dashboard/lead-funnel',
    withScope(periodParams(period), scope),
  );
}

export function useTaskCompletion(period?: PeriodFilter, scope?: Scope) {
  return useAnalyticsEndpoint<TaskCompletionData>(
    '/dashboard/task-completion',
    withScope(periodParams(period), scope),
  );
}

export function useCaseDuration(scope?: Scope) {
  return useAnalyticsEndpoint<CaseDurationData>(
    '/dashboard/case-duration',
    withScope({}, scope),
  );
}

export function useCasesByArea(scope?: Scope) {
  return useAnalyticsEndpoint<CasesByAreaData>(
    '/dashboard/cases-by-area',
    withScope({}, scope),
  );
}

export function useFinancialAging(scope?: Scope) {
  return useAnalyticsEndpoint<FinancialAgingData>(
    '/dashboard/financial-aging',
    withScope({}, scope),
  );
}

export function useAiUsage(months = 6, enabled = true) {
  return useAnalyticsEndpoint<AiUsageData>('/dashboard/ai-usage', { months: String(months) }, enabled);
}

export function useLeadSources(period?: PeriodFilter, scope?: Scope) {
  return useAnalyticsEndpoint<LeadSourcesData>(
    '/dashboard/lead-sources',
    withScope(periodParams(period), scope),
  );
}

export function useResponseTime(period?: PeriodFilter, scope?: Scope) {
  return useAnalyticsEndpoint<ResponseTimeData>(
    '/dashboard/response-time',
    withScope(periodParams(period), scope),
  );
}

export function useConversionVelocity(period?: PeriodFilter, scope?: Scope) {
  return useAnalyticsEndpoint<ConversionVelocityData>(
    '/dashboard/conversion-velocity',
    withScope(periodParams(period), scope),
  );
}
