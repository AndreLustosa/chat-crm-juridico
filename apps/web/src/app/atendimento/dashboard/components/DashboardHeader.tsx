'use client';

import { Download } from 'lucide-react';
import { getGreeting, formatDateFull, firstName, exportDashboardCSV } from '../utils';
import type { DashboardData } from '../types';

interface Props {
  data: DashboardData;
  isAdmin: boolean;
}

export function DashboardHeader({ data, isAdmin }: Props) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          {getGreeting()}, {firstName(data.user.name)}
        </h1>
        <p className="text-sm text-muted-foreground capitalize">{formatDateFull()}</p>
      </div>
      <button
        onClick={() => exportDashboardCSV(data, isAdmin)}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent border border-border transition-all"
        title="Exportar dados como CSV"
        aria-label="Exportar CSV"
      >
        <Download size={14} />
        Exportar CSV
      </button>
    </div>
  );
}
