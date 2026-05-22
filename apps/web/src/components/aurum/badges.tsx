import { cn } from '@/lib/utils';

const CHIP = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide';

/** Bolinha colorida (cor por prop) — usada pra marcar área/categoria. */
export function AreaDot({ color, label }: { color: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {label && <span className="text-xs text-ink-2">{label}</span>}
    </span>
  );
}

// Prioridades do CRM (URGENTE/ALTA/NORMAL/BAIXA) — mapeadas pras cores Aurum.
const PRIO_STYLE: Record<string, { c: string; bg: string; label: string }> = {
  URGENTE: { c: '#FF9AA9', bg: 'rgba(255,92,114,0.12)', label: 'Urgente' },
  ALTA: { c: '#F7DBA0', bg: 'rgba(230,190,106,0.12)', label: 'Alta' },
  NORMAL: { c: '#A8C9FF', bg: 'rgba(91,157,255,0.12)', label: 'Normal' },
  BAIXA: { c: '#A6AEC0', bg: 'rgba(255,255,255,0.06)', label: 'Baixa' },
};

export function PriorityBadge({ prioridade, className }: { prioridade?: string | null; className?: string }) {
  const s = PRIO_STYLE[(prioridade || 'NORMAL').toUpperCase()] || PRIO_STYLE.NORMAL;
  return (
    <span className={cn(CHIP, className)} style={{ color: s.c, background: s.bg, boxShadow: `inset 0 0 0 1px ${s.c}22` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.c }} />
      {s.label}
    </span>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'gold' | 'jade' | 'crimson' | 'azure';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'text-ink-2 bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]',
    gold: 'text-aurum-bright bg-aurum/[0.10] shadow-[inset_0_0_0_1px_rgba(230,190,106,0.25)]',
    jade: 'text-jade-bright bg-jade/[0.10] shadow-[inset_0_0_0_1px_rgba(67,224,160,0.25)]',
    crimson: 'text-crimson-bright bg-crimson/[0.10] shadow-[inset_0_0_0_1px_rgba(255,92,114,0.25)]',
    azure: 'text-azure-bright bg-azure/[0.10] shadow-[inset_0_0_0_1px_rgba(91,157,255,0.25)]',
  };
  return <span className={cn(CHIP, tones[tone], className)}>{children}</span>;
}
