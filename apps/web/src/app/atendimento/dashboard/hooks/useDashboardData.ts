'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';
import type { DashboardData, PeriodFilter } from '../types';

export function useDashboardData(period?: PeriodFilter) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (period) {
        params.startDate = period.startDate;
        params.endDate = period.endDate;
      }
      const r = await api.get('/dashboard', { params });
      setData(r.data);
    } catch {
      setError('Erro ao carregar dashboard');
      showError('Erro ao carregar dashboard');
    } finally {
      setLoading(false);
    }
  }, [period?.startDate, period?.endDate]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
