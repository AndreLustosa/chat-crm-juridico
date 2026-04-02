'use client';

import { useState } from 'react';
import { ArrowUp, ArrowDown, Minus, ArrowUpDown } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { fmtBRL } from '../utils';
import type { TeamPerformanceEntry, TeamAverages, Quartile } from '../types';

type RoleTab = 'TODOS' | 'ADVOGADO' | 'OPERADOR' | 'ESTAGIARIO';

interface Props {
  members: TeamPerformanceEntry[];
  averages: TeamAverages;
  activeTab: RoleTab;
}

const QUARTILE_STYLES: Record<Quartile, string> = {
  TOP: 'border-l-4 border-emerald-500 bg-emerald-500/5',
  MID: 'border-l-4 border-amber-500 bg-amber-500/5',
  LOW: 'border-l-4 border-red-500 bg-red-500/5',
};

function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) return <span className="flex items-center gap-0.5 text-emerald-500 text-[9px] font-bold"><ArrowUp size={9} />+{delta}</span>;
  if (delta < 0) return <span className="flex items-center gap-0.5 text-red-500 text-[9px] font-bold"><ArrowDown size={9} />{delta}</span>;
  return <span className="text-muted-foreground text-[9px]"><Minus size={9} /></span>;
}

function VsAvgBadge({ value, avg }: { value: number; avg: number }) {
  if (avg === 0) return null;
  const diff = Math.round(((value - avg) / avg) * 100);
  if (diff === 0) return null;
  if (diff > 0) return <span className="text-[8px] text-emerald-500 font-semibold">+{diff}%</span>;
  return <span className="text-[8px] text-red-500 font-semibold">{diff}%</span>;
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
    : score >= 50
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
      : 'bg-red-500/15 text-red-400 border-red-500/25';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{score}</span>;
}

function MiniSparkline({ data }: { data: { date: string; value: number }[] }) {
  if (!data || data.length < 2) return null;
  return (
    <div className="w-14 h-5">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={1} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceTable({ members, averages, activeTab }: Props) {
  const [sortField, setSortField] = useState<string>('compositeScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = activeTab === 'TODOS'
    ? members
    : members.filter(m => m.role === activeTab);

  const sorted = [...filtered].sort((a, b) => {
    let va: any, vb: any;
    if (sortField === 'name') return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    if (sortField === 'compositeScore') { va = a.compositeScore; vb = b.compositeScore; }
    else if (sortField === 'scoreDelta') { va = a.scoreDelta; vb = b.scoreDelta; }
    else {
      // Dig into role-specific KPIs
      const aKPI = a.advogadoKPIs || a.operadorKPIs || a.estagiarioKPIs || {} as any;
      const bKPI = b.advogadoKPIs || b.operadorKPIs || b.estagiarioKPIs || {} as any;
      va = aKPI[sortField] ?? a.sharedTasks?.[sortField as keyof typeof a.sharedTasks] ?? 0;
      vb = bKPI[sortField] ?? b.sharedTasks?.[sortField as keyof typeof b.sharedTasks] ?? 0;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SH = ({ field, label, className = '' }: { field: string; label: string; className?: string }) => (
    <button onClick={() => toggleSort(field)} className={`flex items-center gap-0.5 hover:text-foreground transition-colors ${className}`}>
      {label}
      {sortField === field && <ArrowUpDown size={8} className="text-primary" />}
    </button>
  );

  return (
    <div className="overflow-x-auto">
      {/* Table header */}
      <div className="hidden md:grid grid-cols-[40px_1fr_60px_50px_repeat(4,80px)_50px] gap-1.5 mb-2 text-[8px] text-muted-foreground font-bold uppercase tracking-wider px-2">
        <SH field="rank" label="#" className="justify-center" />
        <SH field="name" label="Membro" />
        <SH field="compositeScore" label="Score" className="justify-center" />
        <SH field="scoreDelta" label="Delta" className="justify-center" />
        {activeTab === 'ADVOGADO' && (<>
          <SH field="caseWinRate" label="Win Rate" className="justify-center" />
          <SH field="totalCollected" label="Coletas" className="justify-end" />
          <SH field="collectionRate" label="Tx Coleta" className="justify-center" />
          <SH field="deadlineCompletionRate" label="Prazos" className="justify-center" />
        </>)}
        {activeTab === 'OPERADOR' && (<>
          <SH field="conversionRate" label="Conversao" className="justify-center" />
          <SH field="closedConversations" label="Fechadas" className="justify-center" />
          <SH field="stagesAdvanced" label="Pipeline" className="justify-center" />
          <SH field="leadsLost" label="Perdas" className="justify-center" />
        </>)}
        {activeTab === 'ESTAGIARIO' && (<>
          <SH field="taskCompletionRate" label="Tarefas" className="justify-center" />
          <SH field="petitionApprovalRate" label="Peticoes" className="justify-center" />
          <SH field="deadlinesCompletedOnTime" label="Prazos" className="justify-center" />
          <SH field="documentsUploaded" label="Volume" className="justify-center" />
        </>)}
        {activeTab === 'TODOS' && (<>
          <SH field="tasksCompleted" label="Tarefas OK" className="justify-center" />
          <SH field="tasksOverdue" label="Atrasadas" className="justify-center" />
          <span className="text-center">KPI</span>
          <span className="text-center">Trend</span>
        </>)}
        <span className="text-center">Spark</span>
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {sorted.map((m) => {
          const kpis = m.advogadoKPIs || m.operadorKPIs || m.estagiarioKPIs;

          return (
            <div key={m.userId} className={`rounded-lg p-2 ${QUARTILE_STYLES[m.quartile]}`}>
              {/* Desktop */}
              <div className="hidden md:grid grid-cols-[40px_1fr_60px_50px_repeat(4,80px)_50px] gap-1.5 items-center">
                <span className="text-xs font-black text-center text-muted-foreground">#{m.rank}</span>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{m.name}</p>
                    <p className="text-[8px] text-muted-foreground">{m.role}</p>
                  </div>
                </div>
                <div className="flex justify-center"><ScoreBadge score={m.compositeScore} /></div>
                <div className="flex justify-center"><DeltaBadge delta={m.scoreDelta} /></div>

                {activeTab === 'ADVOGADO' && m.advogadoKPIs && (<>
                  <div className="text-center"><span className="text-xs font-bold">{m.advogadoKPIs.caseWinRate}%</span><br /><VsAvgBadge value={m.advogadoKPIs.caseWinRate} avg={averages.advogado?.caseWinRate || 0} /></div>
                  <div className="text-right text-xs font-semibold text-emerald-500">{fmtBRL(m.advogadoKPIs.totalCollected)}</div>
                  <div className="text-center"><span className="text-xs font-bold">{m.advogadoKPIs.collectionRate}%</span><br /><VsAvgBadge value={m.advogadoKPIs.collectionRate} avg={averages.advogado?.collectionRate || 0} /></div>
                  <div className="text-center"><span className="text-xs font-bold">{m.advogadoKPIs.deadlineCompletionRate}%</span></div>
                </>)}
                {activeTab === 'OPERADOR' && m.operadorKPIs && (<>
                  <div className="text-center"><span className="text-xs font-bold">{m.operadorKPIs.conversionRate}%</span><br /><VsAvgBadge value={m.operadorKPIs.conversionRate} avg={averages.operador?.conversionRate || 0} /></div>
                  <div className="text-center text-xs font-bold">{m.operadorKPIs.closedConversations}</div>
                  <div className="text-center text-xs font-bold">{m.operadorKPIs.stagesAdvanced}</div>
                  <div className="text-center"><span className={`text-xs font-bold ${m.operadorKPIs.leadsLost > 0 ? 'text-red-500' : ''}`}>{m.operadorKPIs.leadsLost}</span></div>
                </>)}
                {activeTab === 'ESTAGIARIO' && m.estagiarioKPIs && (<>
                  <div className="text-center"><span className="text-xs font-bold">{m.estagiarioKPIs.taskCompletionRate}%</span><br /><VsAvgBadge value={m.estagiarioKPIs.taskCompletionRate} avg={averages.estagiario?.taskCompletionRate || 0} /></div>
                  <div className="text-center text-xs font-bold">{m.estagiarioKPIs.petitionApprovalRate}%</div>
                  <div className="text-center text-xs font-bold">{m.estagiarioKPIs.deadlinesCompletedOnTime}</div>
                  <div className="text-center text-xs font-bold">{m.estagiarioKPIs.documentsUploaded}</div>
                </>)}
                {activeTab === 'TODOS' && (<>
                  <div className="text-center text-xs font-bold">{m.sharedTasks.tasksCompleted}</div>
                  <div className="text-center"><span className={`text-xs font-bold ${m.sharedTasks.tasksOverdue > 0 ? 'text-red-500' : ''}`}>{m.sharedTasks.tasksOverdue}</span></div>
                  <div className="text-center text-[9px] font-semibold text-muted-foreground">
                    {m.advogadoKPIs ? `${m.advogadoKPIs.caseWinRate}% win` : m.operadorKPIs ? `${m.operadorKPIs.conversionRate}% conv` : `${m.sharedTasks.taskCompletionRate}% ok`}
                  </div>
                  <div className="text-center"><DeltaBadge delta={m.scoreDelta} /></div>
                </>)}
                <div className="flex justify-center"><MiniSparkline data={m.dailyActivity} /></div>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-muted-foreground w-6 text-center">#{m.rank}</span>
                  <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{m.name}</p>
                    <p className="text-[8px] text-muted-foreground">{m.role}</p>
                  </div>
                  <ScoreBadge score={m.compositeScore} />
                  <DeltaBadge delta={m.scoreDelta} />
                </div>
                <div className="grid grid-cols-4 gap-1 text-center text-[9px]">
                  <div><p className="font-bold">{m.sharedTasks.tasksCompleted}</p><p className="text-muted-foreground">OK</p></div>
                  <div><p className={`font-bold ${m.sharedTasks.tasksOverdue > 0 ? 'text-red-500' : ''}`}>{m.sharedTasks.tasksOverdue}</p><p className="text-muted-foreground">Atras.</p></div>
                  <div><p className="font-bold">{m.sharedTasks.taskCompletionRate}%</p><p className="text-muted-foreground">Taxa</p></div>
                  <div><MiniSparkline data={m.dailyActivity} /></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
