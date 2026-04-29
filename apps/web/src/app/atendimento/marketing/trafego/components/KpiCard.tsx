'use client';

import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  trend?: { delta: number; label?: string };
  icon?: LucideIcon;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'muted';
  loading?: boolean;
}

const ACCENT: Record<NonNullable<KpiCardProps['accent']>, string> = {
  primary: 'text-primary',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-red-500',
  muted: 'text-muted-foreground',
};

export function KpiCard({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  accent = 'primary',
  loading = false,
}: KpiCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon size={18} className={ACCENT[accent]} strokeWidth={2} />}
      </div>

      {loading ? (
        <div className="h-8 w-24 rounded bg-muted/50 animate-pulse" />
      ) : (
        <span className={`text-2xl font-bold ${ACCENT[accent]} truncate`}>
          {value}
        </span>
      )}

      {(hint || trend) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {trend && (
            <span
              className={`font-semibold ${
                trend.delta > 0
                  ? 'text-emerald-500'
                  : trend.delta < 0
                    ? 'text-red-500'
                    : 'text-muted-foreground'
              }`}
            >
              {trend.delta > 0 ? '+' : ''}
              {trend.delta.toFixed(1)}%
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
          {trend?.label && <span className="truncate">{trend.label}</span>}
        </div>
      )}
    </div>
  );
}
