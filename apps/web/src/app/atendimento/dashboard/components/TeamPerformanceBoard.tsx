'use client';

import { useState } from 'react';
import { Trophy, Users } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { PodiumCards } from './PodiumCards';
import { PerformanceTable } from './PerformanceTable';
import type { TeamPerformanceResponse } from '../types';

type RoleTab = 'TODOS' | 'ADVOGADO' | 'OPERADOR' | 'ESTAGIARIO';

interface Props {
  data: TeamPerformanceResponse | null;
  loading: boolean;
}

const TABS: { key: RoleTab; label: string }[] = [
  { key: 'TODOS', label: 'Todos' },
  { key: 'ADVOGADO', label: 'Advogados' },
  { key: 'OPERADOR', label: 'Operadores' },
  { key: 'ESTAGIARIO', label: 'Estagiarios' },
];

export function TeamPerformanceBoard({ data, loading }: Props) {
  const [activeTab, setActiveTab] = useState<RoleTab>('TODOS');

  if (loading) {
    return (
      <WidgetCard title="Performance da Equipe" icon={<Trophy size={15} className="text-amber-500" />} loading>
        <div />
      </WidgetCard>
    );
  }

  if (!data || data.members.length === 0) {
    return (
      <WidgetCard title="Performance da Equipe" icon={<Trophy size={15} className="text-amber-500" />}>
        <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de equipe
        </div>
      </WidgetCard>
    );
  }

  const filtered = activeTab === 'TODOS'
    ? data.members
    : data.members.filter(m => m.role === activeTab);

  const tabCounts: Record<string, number> = {
    TODOS: data.members.length,
    ADVOGADO: data.members.filter(m => m.role === 'ADVOGADO').length,
    OPERADOR: data.members.filter(m => m.role === 'OPERADOR').length,
    ESTAGIARIO: data.members.filter(m => m.role === 'ESTAGIARIO').length,
  };

  // Sort by score for podium
  const sortedForPodium = [...filtered].sort((a, b) => b.compositeScore - a.compositeScore);

  return (
    <WidgetCard
      title="Performance da Equipe"
      icon={<Trophy size={15} className="text-amber-500" />}
      badge={`${data.members.length} membros`}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          if (tabCounts[tab.key] === 0 && tab.key !== 'TODOS') return null;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                activeTab === tab.key
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent'
              }`}
            >
              {tab.label}
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key ? 'bg-primary/20' : 'bg-muted'
              }`}>
                {tabCounts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Podium for top 3 */}
      <PodiumCards members={sortedForPodium} />

      {/* Detailed table */}
      <PerformanceTable
        members={filtered}
        averages={data.teamAverages}
        activeTab={activeTab}
      />
    </WidgetCard>
  );
}
