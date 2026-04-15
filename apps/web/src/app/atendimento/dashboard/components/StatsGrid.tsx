'use client';

import {
  MessageSquare, ListTodo, Scale, BookOpen, ArrowLeftRight,
  Users, UserCheck, TrendingUp, Clock, Zap, AlertTriangle,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { DashboardData, LeadFunnelData, ResponseTimeData, ConversionVelocityData, TimeSeriesPoint } from '../types';

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
  responseTime?: ResponseTimeData | null;
  velocity?: ConversionVelocityData | null;
}

/* ─── Helpers ─── */

function formatMinutes(min: number): string {
  if (min < 1) return '<1';
  if (min < 60) return `${Math.round(min)}`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}` : `${h}h`;
}

function conversionColor(rate: number): string {
  if (rate >= 30) return 'text-emerald-400 bg-emerald-500/10';
  if (rate >= 10) return 'text-amber-400 bg-amber-500/10';
  return 'text-red-400 bg-red-500/10';
}

/* ─── Component ─── */

export function StatsGrid({ data, aggressive, funnel, responseTime, velocity }: Props) {
  // Default grid for roles without aggressive dashboard
  if (!aggressive) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <AggressiveCard
          icon={MessageSquare}
          label="Conversas Abertas"
          value={data.conversations.open}
          color="text-blue-500 bg-blue-500/10"
          sub={data.conversations.pendingTransfers > 0 ? `${data.conversations.pendingTransfers} transferencia(s)` : undefined}
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

  // ─── ADMIN/OPERADOR: 8 cards agressivos ───
  const totalLeads = data.leadPipeline.reduce((s, p) => s + p.count, 0);
  const conversionRate = funnel?.overallConversionRate ?? 0;
  const medianResponse = responseTime?.medianMinutes ?? 0;
  const avgConvDays = velocity?.avgDays ?? 0;

  // Build sparkline from response time byDay
  const responseTrend: TimeSeriesPoint[] = responseTime?.byDay
    ? responseTime.byDay.slice(-7).map(d => ({ date: d.date, value: d.avgMinutes }))
    : [];

  // Build sparkline from velocity byMonth
  const velocityTrend: TimeSeriesPoint[] = velocity?.byMonth
    ? velocity.byMonth.slice(-6).map(d => ({ date: d.month, value: d.avgDays }))
    : [];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Row 1 */}
      <AggressiveCard
        icon={MessageSquare}
        label="Conversas Abertas"
        value={data.conversations.open}
        color="text-blue-400 bg-blue-500/10"
        trendColor="#60a5fa"
        large
      />
      <AggressiveCard
        icon={ArrowLeftRight}
        label="Transferencias"
        value={data.conversations.pendingTransfers}
        color="text-orange-400 bg-orange-500/10"
        trendColor="#fb923c"
        sub={data.conversations.pendingTransfers > 0 ? 'pendentes' : 'nenhuma'}
        pulse={data.conversations.pendingTransfers > 0}
      />
      <AggressiveCard
        icon={Users}
        label="Leads no Funil"
        value={totalLeads}
        color="text-sky-400 bg-sky-500/10"
        trendColor="#38bdf8"
        large
      />
      <AggressiveCard
        icon={UserCheck}
        label="Leads Convertidos"
        value={funnel?.totalClients ?? 0}
        color="text-emerald-400 bg-emerald-500/10"
        trendColor="#34d399"
        sub={funnel ? `de ${funnel.totalLeads} total` : undefined}
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
        icon={Clock}
        label="Tempo Resposta"
        value={formatMinutes(medianResponse)}
        suffix="min"
        color="text-cyan-400 bg-cyan-500/10"
        trendColor="#22d3ee"
        trend={responseTrend}
        sub={medianResponse > 30 ? 'acima do ideal' : medianResponse > 0 ? 'bom ritmo' : undefined}
      />
      <AggressiveCard
        icon={Zap}
        label="Vel. Conversao"
        value={avgConvDays > 0 ? Math.round(avgConvDays) : '—'}
        suffix={avgConvDays > 0 ? 'dias' : undefined}
        color="text-violet-400 bg-violet-500/10"
        trendColor="#a78bfa"
        trend={velocityTrend}
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
    </div>
  );
}
