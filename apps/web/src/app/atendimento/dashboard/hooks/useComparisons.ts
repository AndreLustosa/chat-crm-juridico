'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import type { PeriodFilter, ComparisonsData } from '../types';

export function useComparisons(period?: PeriodFilter, enabled = true) {
  const [data, setData] = useState<ComparisonsData | null>(null);
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
      const r = await api.get('/dashboard/comparisons', { params });
      setData(r.data);
    } catch {
      setError('Erro ao carregar comparações');
    } finally {
      setLoading(false);
    }
  }, [period?.startDate, period?.endDate, enabled]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
