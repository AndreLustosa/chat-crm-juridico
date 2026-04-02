'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { TimeSeriesPoint } from '../types';

interface Props {
  icon: any;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
  trend?: TimeSeriesPoint[];
  trendColor?: string;
}

export function StatCard({ icon: Icon, label, value, color, sub, trend, trendColor = '#6366f1' }: Props) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 relative overflow-hidden">
      {/* Sparkline background */}
      {trend && trend.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-8 opacity-20">
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
        <div className={`w-6 h-6 rounded-lg ${color} flex items-center justify-center mb-1.5`}>
          <Icon size={13} />
        </div>
        <p className="text-lg font-bold text-foreground leading-none">{value}</p>
        <p className="text-[9px] text-muted-foreground mt-0.5 uppercase font-semibold tracking-wide">{label}</p>
        {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
