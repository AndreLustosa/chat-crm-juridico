import { cn } from '@/lib/utils';

/** Painel glass do cockpit. glow=true adiciona a borda dourada hairline. */
export function Panel({
  children,
  className,
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div className={cn('aurum-glass relative rounded-2xl p-5', glow && 'aurum-ring-gold', className)}>
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  sub,
  icon,
  action,
}: {
  title: string;
  sub?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-ink-2">
            {icon}
          </span>
        )}
        <div>
          <h3 className="text-[15px] font-semibold text-ink-1">{title}</h3>
          {sub && <p className="text-xs text-ink-3">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
