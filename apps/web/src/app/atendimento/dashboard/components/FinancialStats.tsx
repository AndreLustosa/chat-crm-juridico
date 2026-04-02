'use client';

import { DollarSign, TrendingUp, Clock, AlertTriangle } from 'lucide-react';
import { StatCard } from './StatCard';
import { fmtBRL } from '../utils';
import type { DashboardData } from '../types';

interface Props {
  financials: DashboardData['financials'];
}

export function FinancialStats({ financials }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={DollarSign}
        label="Contratado"
        value={fmtBRL(financials.totalContracted)}
        color="text-indigo-500 bg-indigo-500/10"
        trendColor="#6366f1"
      />
      <StatCard
        icon={TrendingUp}
        label="Recebido"
        value={fmtBRL(financials.totalCollected)}
        color="text-emerald-500 bg-emerald-500/10"
        trendColor="#10b981"
      />
      <StatCard
        icon={Clock}
        label="A Receber"
        value={fmtBRL(financials.totalReceivable)}
        color="text-amber-500 bg-amber-500/10"
        trendColor="#f59e0b"
      />
      <StatCard
        icon={AlertTriangle}
        label="Em Atraso"
        value={fmtBRL(financials.totalOverdue)}
        color="text-red-500 bg-red-500/10"
        sub={financials.overdueCount > 0 ? `${financials.overdueCount} parcela(s)` : undefined}
        trendColor="#ef4444"
      />
    </div>
  );
}
