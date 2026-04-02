'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import type { PeriodFilter, TeamPerformanceResponse } from '../types';

export function useTeamPerformance(period?: PeriodFilter, enabled = true) {
  const [data, setData] = useState<TeamPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (period) {
        params.startDate = period.startDate;
        params.endDate = period.endDate;
      }
      const r = await api.get('/dashboard/team-performance', { params });
      setData(r.data);
    } catch {
      setError('Erro ao carregar performance da equipe');
    } finally {
      setLoading(false);
    }
  }, [period?.startDate, period?.endDate, enabled]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
