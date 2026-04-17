'use client';

import {
  ListTodo, Scale, BookOpen,
  Users, UserCheck, UserX, TrendingUp, AlertTriangle,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { DashboardData, LeadFunnelData, TimeSeriesPoint } from '../types';

/* ─── Stat Card inline (evita dependencia circular) ─── */

interface CardProps {
  icon: any;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
  trend?: TimeSeriesPoint[];
  trendColor?: string;
  pulse?: boolean;
  large?: boolean;
  suffix?: string;
}

function AggressiveCard({ icon: Icon, label, value, color, sub, trend, trendColor = '#6366f1', pulse, large, suffix }: CardProps) {
  return (
    <div className={`bg-card border rounded-xl p-3 relative overflow-hidden transition-all ${
      pulse ? 'border-red-500/60 shadow-[0_0_15px_rgba(239,68,68,0.15)] animate-pulse' : 'border-border'
    }`}>
      {/* Sparkline background */}
      {trend && trend.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-10 opacity-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Area
                type="monotone"
                dataKey="value"
                stroke={trendColor}
                fill={trendColor}
                strokeWidth={1.5}
                fillOpacity={0.3}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="relative z-10">
        <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center mb-2`}>
          <Icon size={14} />
        </div>
        <p className={`font-black text-foreground leading-none ${large ? 'text-2xl' : 'text-xl'}`}>
          {value}{suffix && <span className="text-sm font-semibold text-muted-foreground ml-0.5">{suffix}</span>}
        </p>
        <p className="text-[9px] text-muted-foreground mt-1 uppercase font-bold tracking-wider">{label}</p>
        {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ─── Props ─── */

interface Props {
  data: DashboardData;
  aggressive?: boolean;
  funnel?: LeadFunnelData | null;
}

/* ─── Helpers ─── */

function conversionColor(rate: number): string {
  if (rate >= 30) return 'text-emerald-400 bg-emerald-500/10';
  if (rate >= 10) return 'text-amber-400 bg-amber-500/10';
  return 'text-red-400 bg-red-500/10';
}

/* ─── Component ─── */

export function StatsGrid({ data, aggressive, funnel }: Props) {
  // Default grid for roles without aggressive dashboard
  if (!aggressive) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <AggressiveCard
          icon={UserCheck}
          label="Leads em Atendimento"
          value={data.leadsInService}
          color="text-blue-500 bg-blue-500/10"
          trendColor="#3b82f6"
        />
        <AggressiveCard
          icon={ListTodo}
          label="Tarefas Pendentes"
          value={data.tasks.pending + data.tasks.inProgress}
          color="text-amber-500 bg-amber-500/10"
          sub={data.tasks.overdue > 0 ? `${data.tasks.overdue} atrasada(s)` : undefined}
          trendColor="#f59e0b"
        />
        <AggressiveCard
          icon={Scale}
          label="Casos Ativos"
          value={data.legalCases.total}
          color="text-purple-500 bg-purple-500/10"
          trendColor="#8b5cf6"
        />
        <AggressiveCard
          icon={BookOpen}
          label="Processos"
          value={data.trackingCases.total}
          color="text-teal-500 bg-teal-500/10"
          trendColor="#14b8a6"
        />
      </div>
    );
  }

  // ─── ADMIN/OPERADOR: cards agressivos ───
  const conversionRate = funnel?.overallConversionRate ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Row 1 */}
      <AggressiveCard
        icon={UserCheck}
        label="Leads em Atendimento"
        value={data.leadsInService}
        color="text-blue-400 bg-blue-500/10"
        trendColor="#60a5fa"
        large
      />
      <AggressiveCard
        icon={Users}
        label="Leads Geral"
        value={data.leadsTotal}
        color="text-indigo-400 bg-indigo-500/10"
        trendColor="#818cf8"
        sub="exclui perdidos"
      />
      <AggressiveCard
        icon={UserCheck}
        label="Leads Convertidos"
        value={funnel?.totalClients ?? 0}
        color="text-emerald-400 bg-emerald-500/10"
        trendColor="#34d399"
        sub={funnel ? `de ${funnel.totalLeads} total` : undefined}
      />
      <AggressiveCard
        icon={UserX}
        label="Leads Perdidos"
        value={data.leadsLost}
        color="text-rose-400 bg-rose-500/10"
        trendColor="#fb7185"
      />

      {/* Row 2 */}
      <AggressiveCard
        icon={TrendingUp}
        label="Taxa de Conversao"
        value={`${conversionRate.toFixed(1)}`}
        suffix="%"
        color={conversionColor(conversionRate)}
        trendColor={conversionRate >= 30 ? '#34d399' : conversionRate >= 10 ? '#fbbf24' : '#f87171'}
        large
      />
      <AggressiveCard
        icon={AlertTriangle}
        label="Tarefas Atrasadas"
        value={data.tasks.overdue}
        color="text-red-400 bg-red-500/10"
        trendColor="#f87171"
        pulse={data.tasks.overdue > 0}
        large
        sub={data.tasks.overdue > 0 ? 'requer atencao!' : 'tudo em dia'}
      />
      <AggressiveCard
        icon={BookOpen}
        label="Processos"
        value={data.trackingCases.total}
        color="text-teal-400 bg-teal-500/10"
        trendColor="#2dd4bf"
        sub={`${data.legalCases.total} em prepara\u00e7\u00e3o`}
      />
    </div>
  );
}
