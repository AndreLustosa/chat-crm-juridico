'use client';

const STYLES: Record<string, { color: string; label: string }> = {
  EXACT: {
    color:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    label: 'Exata',
  },
  PHRASE: {
    color: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
    label: 'Frase',
  },
  BROAD: {
    color: 'bg-muted text-muted-foreground border-border',
    label: 'Ampla',
  },
};

/**
 * Badge colorido para o tipo de match de uma keyword:
 *   EXACT  = verde (mais restrito, matches só no termo exato)
 *   PHRASE = azul (médio, frase contida)
 *   BROAD  = cinza (mais amplo, default)
 */
export function MatchTypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const sty = STYLES[type] ?? STYLES.BROAD;
  return (
    <span
      className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${sty.color}`}
      title={type}
    >
      {sty.label}
    </span>
  );
}
