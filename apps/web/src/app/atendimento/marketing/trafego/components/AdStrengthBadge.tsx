'use client';

const STYLES: Record<
  string,
  { color: string; label: string; rank: number }
> = {
  EXCELLENT: {
    color:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    label: 'Excelente',
    rank: 4,
  },
  GOOD: {
    color: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
    label: 'Bom',
    rank: 3,
  },
  AVERAGE: {
    color:
      'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    label: 'Médio',
    rank: 2,
  },
  POOR: {
    color: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
    label: 'Fraco',
    rank: 1,
  },
  PENDING: {
    color: 'bg-muted text-muted-foreground border-border',
    label: 'Pendente',
    rank: 0,
  },
  NO_ADS: {
    color: 'bg-muted text-muted-foreground border-border',
    label: 'Sem anúncios',
    rank: 0,
  },
};

/**
 * Badge da força do anúncio (Google Ad Strength). Mostra a melhor força
 * entre todos os RSAs ENABLED da campanha (calculado no backend via
 * STRENGTH_RANK).
 */
export function AdStrengthBadge({ strength }: { strength: string | null }) {
  if (!strength) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const sty = STYLES[strength] ?? STYLES.PENDING;
  return (
    <span
      className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${sty.color}`}
      title={`Ad Strength: ${strength}`}
    >
      {sty.label}
    </span>
  );
}
