'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import type {
  PeriodFilter, RevenueTrendData, LeadFunnelData, TaskCompletionData,
  CaseDurationData, FinancialAgingData, AiUsageData, LeadSourcesData,
  ResponseTimeData, ConversionVelocityData,
} from '../types';

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

export function useRevenueTrend(months = 12) {
  return useAnalyticsEndpoint<RevenueTrendData>('/dashboard/revenue-trend', { months: String(months) });
}

export function useLeadFunnel(period?: PeriodFilter) {
  return useAnalyticsEndpoint<LeadFunnelData>('/dashboard/lead-funnel', periodParams(period));
}

export function useTaskCompletion(period?: PeriodFilter) {
  return useAnalyticsEndpoint<TaskCompletionData>('/dashboard/task-completion', periodParams(period));
}

export function useCaseDuration() {
  return useAnalyticsEndpoint<CaseDurationData>('/dashboard/case-duration');
}

export function useFinancialAging() {
  return useAnalyticsEndpoint<FinancialAgingData>('/dashboard/financial-aging');
}

export function useAiUsage(months = 6, enabled = true) {
  return useAnalyticsEndpoint<AiUsageData>('/dashboard/ai-usage', { months: String(months) }, enabled);
}

export function useLeadSources(period?: PeriodFilter) {
  return useAnalyticsEndpoint<LeadSourcesData>('/dashboard/lead-sources', periodParams(period));
}

export function useResponseTime(period?: PeriodFilter) {
  return useAnalyticsEndpoint<ResponseTimeData>('/dashboard/response-time', periodParams(period));
}

export function useConversionVelocity(period?: PeriodFilter) {
  return useAnalyticsEndpoint<ConversionVelocityData>('/dashboard/conversion-velocity', periodParams(period));
}
