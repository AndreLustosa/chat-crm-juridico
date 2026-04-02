interface Props {
  label: string;
  count: number;
  max: number;
  color: string;
  emoji?: string;
}

export function PipelineBar({ label, count, max, color, emoji }: Props) {
  const pct = max > 0 ? Math.max(2, (count / max) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          {emoji && <span>{emoji}</span>}
          {label}
        </span>
        <span className="text-muted-foreground tabular-nums font-bold">{count}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
