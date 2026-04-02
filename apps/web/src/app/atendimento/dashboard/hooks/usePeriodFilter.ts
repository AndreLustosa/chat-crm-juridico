'use client';

import { useState, useMemo } from 'react';
import type { PeriodKey, PeriodFilter } from '../types';

function calcRange(key: PeriodKey, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  const now = new Date();
  const end = now.toISOString();

  switch (key) {
    case 'today': {
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      return { startDate: s.toISOString(), endDate: end };
    }
    case '7d': {
      const s = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { startDate: s.toISOString(), endDate: end };
    }
    case '30d': {
      const s = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { startDate: s.toISOString(), endDate: end };
    }
    case '90d': {
      const s = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      return { startDate: s.toISOString(), endDate: end };
    }
    case 'custom':
      return {
        startDate: customStart || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: customEnd || end,
      };
  }
}

export function usePeriodFilter(defaultKey: PeriodKey = '30d') {
  const [key, setKey] = useState<PeriodKey>(defaultKey);
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const period: PeriodFilter = useMemo(() => {
    const range = calcRange(key, customStart, customEnd);
    return { key, ...range };
  }, [key, customStart, customEnd]);

  const setPeriod = (newKey: PeriodKey) => setKey(newKey);

  const setCustomRange = (start: string, end: string) => {
    setCustomStart(start);
    setCustomEnd(end);
    setKey('custom');
  };

  return { period, setPeriod, setCustomRange };
}
