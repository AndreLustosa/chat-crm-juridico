'use client';

import { useState } from 'react';
import { Activity, ArrowUpDown } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { fmtBRL, calcAgentScore } from '../utils';
import type { TeamMember } from '../types';

type SortField = 'name' | 'openConversations' | 'activeCases' | 'pendingTasks' | 'overdueTasks' | 'totalCollected' | 'totalReceivable' | 'score';

interface Props {
  members: TeamMember[];
}

export function TeamMetrics({ members }: Props) {
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  if (members.length === 0) return null;

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sorted = [...members].sort((a, b) => {
    let va: number, vb: number;
    if (sortField === 'name') {
      return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    }
    if (sortField === 'score') { va = calcAgentScore(a); vb = calcAgentScore(b); }
    else { va = a[sortField]; vb = b[sortField]; }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  const teamMaxLoad = Math.max(...members.map((m) => m.openConversations + m.activeCases + m.pendingTasks), 1);
  const avgLoad = teamMaxLoad / Math.max(members.length, 1);

  const SortHeader = ({ field, label, className = '' }: { field: SortField; label: string; className?: string }) => (
    <button onClick={() => toggleSort(field)} className={`flex items-center gap-0.5 hover:text-foreground transition-colors ${className}`}>
      {label}
      {sortField === field && <ArrowUpDown size={9} className="text-primary" />}
    </button>
  );

  return (
    <WidgetCard
      title="Equipe — Carga de Trabalho"
      icon={<Activity size={15} className="text-primary" />}
      badge={`${members.length} membro(s)`}
    >
      {/* Header row */}
      <div className="hidden md:grid grid-cols-[1fr_70px_70px_70px_70px_100px_100px_60px] gap-2 mb-2 text-[9px] text-muted-foreground font-bold uppercase tracking-wider px-1">
        <SortHeader field="name" label="Membro" />
        <SortHeader field="openConversations" label="Conversas" className="justify-center" />
        <SortHeader field="activeCases" label="Casos" className="justify-center" />
        <SortHeader field="pendingTasks" label="Tarefas" className="justify-center" />
        <SortHeader field="overdueTasks" label="Atrasadas" className="justify-center" />
        <SortHeader field="totalCollected" label="Recebido" className="justify-end" />
        <SortHeader field="totalReceivable" label="A Receber" className="justify-end" />
        <SortHeader field="score" label="Score" className="justify-center" />
      </div>

      <div className="space-y-1.5">
        {sorted.map((member) => {
          const load = member.openConversations + member.activeCases + member.pendingTasks;
          const loadPct = Math.max(3, (load / teamMaxLoad) * 100);
          const loadColor = load > avgLoad * 1.5 ? 'bg-red-500' : load > avgLoad ? 'bg-amber-500' : 'bg-emerald-500';
          const score = calcAgentScore(member);
          const scoreBadgeClass = score >= 80
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
            : score >= 60
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
              : 'bg-red-500/15 text-red-400 border border-red-500/25';

          return (
            <div key={member.userId} className="bg-muted/30 rounded-lg p-2.5">
              {/* Desktop */}
              <div className="hidden md:grid grid-cols-[1fr_70px_70px_70px_70px_100px_100px_60px] gap-2 items-center">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{member.name}</p>
                    <p className="text-[9px] text-muted-foreground">{member.role === 'ADMIN' ? 'Admin' : member.role}</p>
                  </div>
                </div>
                <span className="text-xs text-center font-bold text-foreground">{member.openConversations}</span>
                <span className="text-xs text-center font-bold text-foreground">{member.activeCases}</span>
                <span className="text-xs text-center font-bold text-foreground">{member.pendingTasks}</span>
                <span className={`text-xs text-center font-bold ${member.overdueTasks > 0 ? 'text-red-500' : 'text-foreground'}`}>{member.overdueTasks}</span>
                <span className="text-xs text-right font-semibold text-emerald-500">{fmtBRL(member.totalCollected)}</span>
                <span className="text-xs text-right font-semibold text-amber-500">{fmtBRL(member.totalReceivable)}</span>
                <div className="flex justify-center">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scoreBadgeClass}`}>{score}</span>
                </div>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{member.name}</p>
                    <p className="text-[9px] text-muted-foreground">{member.role === 'ADMIN' ? 'Admin' : member.role}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scoreBadgeClass}`}>{score}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div><p className="text-xs font-bold text-foreground">{member.openConversations}</p><p className="text-[8px] text-muted-foreground">Conv.</p></div>
                  <div><p className="text-xs font-bold text-foreground">{member.activeCases}</p><p className="text-[8px] text-muted-foreground">Casos</p></div>
                  <div><p className="text-xs font-bold text-foreground">{member.pendingTasks}</p><p className="text-[8px] text-muted-foreground">Tarefas</p></div>
                  <div><p className={`text-xs font-bold ${member.overdueTasks > 0 ? 'text-red-500' : 'text-foreground'}`}>{member.overdueTasks}</p><p className="text-[8px] text-muted-foreground">Atras.</p></div>
                </div>
              </div>

              <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden" title={`Carga: ${load} itens`}>
                <div className={`h-full rounded-full transition-all duration-500 ${loadColor}`} style={{ width: `${loadPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}
