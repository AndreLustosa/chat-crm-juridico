'use client';

import { Trophy, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { fmtBRL } from '../utils';
import type { TeamPerformanceEntry } from '../types';

interface Props {
  members: TeamPerformanceEntry[];
}

const MEDAL_COLORS = [
  'from-amber-400 to-yellow-500 border-amber-400', // gold
  'from-gray-300 to-gray-400 border-gray-400',     // silver
  'from-orange-400 to-amber-600 border-orange-500', // bronze
];

const MEDAL_LABELS = ['1o', '2o', '3o'];

function getMainKPI(m: TeamPerformanceEntry): { label: string; value: string } {
  if (m.advogadoKPIs) return { label: 'Win Rate', value: `${m.advogadoKPIs.caseWinRate}%` };
  if (m.operadorKPIs) return { label: 'Conversao', value: `${m.operadorKPIs.conversionRate}%` };
  if (m.estagiarioKPIs) return { label: 'Tarefas OK', value: `${m.estagiarioKPIs.taskCompletionRate}%` };
  return { label: 'Score', value: String(m.compositeScore) };
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 0) return <span className="flex items-center gap-0.5 text-emerald-500 text-[10px] font-bold"><ArrowUp size={11} />+{delta}</span>;
  if (delta < 0) return <span className="flex items-center gap-0.5 text-red-500 text-[10px] font-bold"><ArrowDown size={11} />{delta}</span>;
  return <span className="flex items-center gap-0.5 text-muted-foreground text-[10px]"><Minus size={11} />0</span>;
}

export function PodiumCards({ members }: Props) {
  const top3 = members.slice(0, 3);
  if (top3.length === 0) return null;

  // Reorder for podium: [2nd, 1st, 3rd]
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3.length === 2 ? [top3[1], top3[0]] : [top3[0]];
  const rankMap = top3.length >= 3 ? [1, 0, 2] : top3.length === 2 ? [1, 0] : [0];

  return (
    <div className="grid grid-cols-3 gap-3 mb-4">
      {podiumOrder.map((m, idx) => {
        const actualRank = rankMap[idx];
        const isFirst = actualRank === 0;
        const kpi = getMainKPI(m);

        return (
          <div
            key={m.userId}
            className={`relative bg-card border-2 rounded-xl p-3 text-center transition-all ${
              isFirst ? `border-amber-400/60 shadow-lg shadow-amber-500/10 ${top3.length >= 2 ? '-mt-2' : ''}` : 'border-border'
            }`}
          >
            {/* Medal badge */}
            <div className={`w-8 h-8 rounded-full bg-gradient-to-b ${MEDAL_COLORS[actualRank]} mx-auto mb-2 flex items-center justify-center text-white text-[10px] font-black shadow-sm`}>
              {MEDAL_LABELS[actualRank]}
            </div>

            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-primary/20 text-primary text-sm font-bold flex items-center justify-center mx-auto mb-1">
              {m.name.charAt(0).toUpperCase()}
            </div>

            {/* Name + role */}
            <p className="text-xs font-bold text-foreground truncate">{m.name}</p>
            <p className="text-[9px] text-muted-foreground uppercase">{m.role}</p>

            {/* Score */}
            <p className={`text-2xl font-black mt-1 ${
              m.compositeScore >= 70 ? 'text-emerald-500' : m.compositeScore >= 50 ? 'text-amber-500' : 'text-red-500'
            }`}>
              {m.compositeScore}
            </p>
            <DeltaArrow delta={m.scoreDelta} />

            {/* Main KPI */}
            <div className="mt-1.5 px-2 py-1 rounded-lg bg-muted/50">
              <p className="text-[9px] text-muted-foreground uppercase">{kpi.label}</p>
              <p className="text-xs font-bold text-foreground">{kpi.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
