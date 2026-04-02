'use client';

import type { PeriodKey } from '../types';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'custom', label: 'Custom' },
];

interface Props {
  active: PeriodKey;
  onSelect: (key: PeriodKey) => void;
  onCustomRange?: (start: string, end: string) => void;
}

export function PeriodSelector({ active, onSelect, onCustomRange }: Props) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => p.key !== 'custom' ? onSelect(p.key) : onSelect('custom')}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
            active === p.key
              ? 'bg-primary/10 text-primary border border-primary/20'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent'
          }`}
        >
          {p.label}
        </button>
      ))}
      {active === 'custom' && onCustomRange && (
        <div className="flex items-center gap-1.5 ml-1">
          <input
            type="date"
            className="text-xs px-2 py-1 rounded-lg border border-border bg-card text-foreground"
            onChange={(e) => {
              const end = (document.getElementById('dash-end-date') as HTMLInputElement)?.value;
              if (e.target.value && end) onCustomRange(e.target.value, end);
            }}
          />
          <span className="text-xs text-muted-foreground">a</span>
          <input
            id="dash-end-date"
            type="date"
            className="text-xs px-2 py-1 rounded-lg border border-border bg-card text-foreground"
            onChange={(e) => {
              const start = (document.getElementById('dash-end-date')?.previousElementSibling?.previousElementSibling as HTMLInputElement)?.value;
              if (start && e.target.value) onCustomRange(start, e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
