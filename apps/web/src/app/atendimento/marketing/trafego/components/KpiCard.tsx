'use client';

import { useRef, useState } from 'react';
import { HelpCircle, LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface KpiTooltipInfo {
  title?: string;
  description: string;
  ideal: string;
  howTo: string;
}

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  trend?: { delta: number; label?: string };
  /**
   * Delta automático calculado vs período anterior (em fração 0..1, ex
   * 0.12 = +12%). Renderiza ▲/▼ + cor.
   */
  delta?: number | null;
  /**
   * Quando `true`, queda do KPI é boa (verde) e subida é ruim (vermelho).
   * Use pra CPC, CPL, custo (quanto menor, melhor).
   */
  deltaInverted?: boolean;
  tooltip?: KpiTooltipInfo;
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
  delta,
  deltaInverted = false,
  tooltip,
  icon: Icon,
  accent = 'primary',
  loading = false,
}: KpiCardProps) {
  return (
    <div className="relative bg-card border border-border rounded-xl p-4 flex flex-col gap-2 shadow-sm overflow-visible">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {tooltip && <MetricHelp info={tooltip} label={label} />}
          {Icon && <Icon size={18} className={ACCENT[accent]} strokeWidth={2} />}
        </div>
      </div>

      {loading ? (
        <div className="h-8 w-24 rounded bg-muted/50 animate-pulse" />
      ) : (
        <span className={`text-2xl font-bold ${ACCENT[accent]} truncate`}>
          {value}
        </span>
      )}

      {(hint || trend || (delta !== undefined && delta !== null)) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          {/* Delta automatico (▲/▼ + %) calculado contra periodo comparativo */}
          {delta !== undefined && delta !== null && (
            <DeltaBadge delta={delta} inverted={deltaInverted} />
          )}
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

function MetricHelp({
  info,
  label,
}: {
  info: KpiTooltipInfo;
  label: string;
}) {
  const title = info.title ?? label;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });

  const showTooltip = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect || typeof window === 'undefined') {
      setOpen(true);
      return;
    }

    const margin = 16;
    const width = Math.min(320, window.innerWidth - margin * 2);
    const estimatedHeight = 260;
    const left = Math.min(
      Math.max(rect.right - width, margin),
      window.innerWidth - width - margin,
    );
    const belowTop = rect.bottom + 8;
    const top =
      belowTop + estimatedHeight > window.innerHeight
        ? Math.max(rect.top - estimatedHeight - 8, margin)
        : belowTop;

    setPosition({ left, top });
    setOpen(true);
  };

  return (
    <span className="inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Entender ${label}`}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setOpen(false)}
        onFocus={showTooltip}
        onBlur={() => setOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <HelpCircle size={14} strokeWidth={2.2} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[9999] w-[min(320px,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 text-left shadow-xl"
          style={{ left: position.left, top: position.top }}
        >
          <span className="block text-[12px] font-bold text-foreground mb-1">
            {title}
          </span>
          <span className="block text-[11px] leading-relaxed text-muted-foreground">
            {info.description}
          </span>
          <span className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-foreground/70">
            Valor ideal
          </span>
          <span className="block text-[11px] leading-relaxed text-muted-foreground">
            {info.ideal}
          </span>
          <span className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-foreground/70">
            Como conquistar
          </span>
          <span className="block text-[11px] leading-relaxed text-muted-foreground">
            {info.howTo}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Delta badge inline com seta + percentual + cor semantica.
 * `inverted=true` para metricas onde menor é melhor (CPC, CPL).
 */
function DeltaBadge({
  delta,
  inverted,
}: {
  delta: number;
  inverted: boolean;
}) {
  // delta vem como fração (0.12 = +12%)
  const pct = delta * 100;
  // "Melhorou" quando subida não é invertida E delta>0, OU quando é invertida E delta<0
  const isImproving = inverted ? delta < 0 : delta > 0;
  const isFlat = Math.abs(pct) < 0.1;

  const Icon = isFlat ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const color = isFlat
    ? 'text-muted-foreground'
    : isImproving
      ? 'text-emerald-500'
      : 'text-red-500';

  return (
    <span
      className={`inline-flex items-center gap-0.5 font-bold ${color}`}
      title={`Vs período anterior: ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
    >
      <Icon size={10} strokeWidth={3} />
      {pct > 0 ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}
