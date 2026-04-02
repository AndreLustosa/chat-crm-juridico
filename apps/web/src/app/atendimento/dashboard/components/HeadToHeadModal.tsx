'use client';

import { X, ArrowRight } from 'lucide-react';
import { fmtBRL } from '../utils';
import type { TeamPerformanceEntry } from '../types';

interface Props {
  memberA: TeamPerformanceEntry;
  memberB: TeamPerformanceEntry;
  onClose: () => void;
}

function CompareRow({ label, a, b, format = 'number', higherIsBetter = true }: {
  label: string; a: number; b: number; format?: 'number' | 'percent' | 'currency' | 'minutes';
  higherIsBetter?: boolean;
}) {
  const fmt = (v: number) => {
    if (format === 'percent') return `${v}%`;
    if (format === 'currency') return fmtBRL(v);
    if (format === 'minutes') return `${v}min`;
    return String(v);
  };

  const aWins = higherIsBetter ? a > b : a < b;
  const bWins = higherIsBetter ? b > a : b < a;
  const tie = a === b;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center py-1.5 border-b border-border/50 last:border-0">
      <div className={`text-right text-xs font-bold ${aWins ? 'text-emerald-500' : tie ? 'text-foreground' : 'text-red-400'}`}>
        {fmt(a)}
      </div>
      <div className="text-[9px] text-muted-foreground font-semibold text-center w-24 truncate">
        {label}
      </div>
      <div className={`text-left text-xs font-bold ${bWins ? 'text-emerald-500' : tie ? 'text-foreground' : 'text-red-400'}`}>
        {fmt(b)}
      </div>
    </div>
  );
}

export function HeadToHeadModal({ memberA, memberB, onClose }: Props) {
  const sameRole = memberA.role === memberB.role;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-foreground">Comparacao Direta</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X size={16} /></button>
        </div>

        {!sameRole && (
          <div className="mb-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-500 font-semibold">
            Atencao: comparando roles diferentes ({memberA.role} vs {memberB.role})
          </div>
        )}

        {/* Names */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mb-4">
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-primary/20 text-primary text-sm font-bold flex items-center justify-center mx-auto mb-1">
              {memberA.name.charAt(0)}
            </div>
            <p className="text-xs font-bold text-foreground">{memberA.name}</p>
            <p className="text-[9px] text-muted-foreground">{memberA.role}</p>
          </div>
          <span className="text-muted-foreground text-xs font-bold">VS</span>
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-primary/20 text-primary text-sm font-bold flex items-center justify-center mx-auto mb-1">
              {memberB.name.charAt(0)}
            </div>
            <p className="text-xs font-bold text-foreground">{memberB.name}</p>
            <p className="text-[9px] text-muted-foreground">{memberB.role}</p>
          </div>
        </div>

        {/* Score comparison */}
        <CompareRow label="Score" a={memberA.compositeScore} b={memberB.compositeScore} />
        <CompareRow label="Tarefas OK" a={memberA.sharedTasks.tasksCompleted} b={memberB.sharedTasks.tasksCompleted} />
        <CompareRow label="Atrasadas" a={memberA.sharedTasks.tasksOverdue} b={memberB.sharedTasks.tasksOverdue} higherIsBetter={false} />
        <CompareRow label="Taxa Tarefas" a={memberA.sharedTasks.taskCompletionRate} b={memberB.sharedTasks.taskCompletionRate} format="percent" />

        {/* Advogado-specific */}
        {memberA.advogadoKPIs && memberB.advogadoKPIs && (<>
          <div className="mt-3 mb-1 text-[9px] text-muted-foreground font-bold uppercase">Advogado</div>
          <CompareRow label="Win Rate" a={memberA.advogadoKPIs.caseWinRate} b={memberB.advogadoKPIs.caseWinRate} format="percent" />
          <CompareRow label="Coletas" a={memberA.advogadoKPIs.totalCollected} b={memberB.advogadoKPIs.totalCollected} format="currency" />
          <CompareRow label="Tx Coleta" a={memberA.advogadoKPIs.collectionRate} b={memberB.advogadoKPIs.collectionRate} format="percent" />
          <CompareRow label="Prazos OK" a={memberA.advogadoKPIs.deadlineCompletionRate} b={memberB.advogadoKPIs.deadlineCompletionRate} format="percent" />
          <CompareRow label="Peticoes" a={memberA.advogadoKPIs.petitionsProtocoled} b={memberB.advogadoKPIs.petitionsProtocoled} />
          <CompareRow label="Casos Ativos" a={memberA.advogadoKPIs.activeCases} b={memberB.advogadoKPIs.activeCases} />
        </>)}

        {/* Operador-specific */}
        {memberA.operadorKPIs && memberB.operadorKPIs && (<>
          <div className="mt-3 mb-1 text-[9px] text-muted-foreground font-bold uppercase">Operador</div>
          <CompareRow label="Conversao" a={memberA.operadorKPIs.conversionRate} b={memberB.operadorKPIs.conversionRate} format="percent" />
          <CompareRow label="Tempo Resp." a={memberA.operadorKPIs.avgResponseTimeMinutes} b={memberB.operadorKPIs.avgResponseTimeMinutes} format="minutes" higherIsBetter={false} />
          <CompareRow label="Fechadas" a={memberA.operadorKPIs.closedConversations} b={memberB.operadorKPIs.closedConversations} />
          <CompareRow label="Pipeline" a={memberA.operadorKPIs.stagesAdvanced} b={memberB.operadorKPIs.stagesAdvanced} />
          <CompareRow label="Perdas" a={memberA.operadorKPIs.leadsLost} b={memberB.operadorKPIs.leadsLost} higherIsBetter={false} />
        </>)}

        {/* Estagiario-specific */}
        {memberA.estagiarioKPIs && memberB.estagiarioKPIs && (<>
          <div className="mt-3 mb-1 text-[9px] text-muted-foreground font-bold uppercase">Estagiario</div>
          <CompareRow label="Tx Tarefas" a={memberA.estagiarioKPIs.taskCompletionRate} b={memberB.estagiarioKPIs.taskCompletionRate} format="percent" />
          <CompareRow label="Tx Peticoes" a={memberA.estagiarioKPIs.petitionApprovalRate} b={memberB.estagiarioKPIs.petitionApprovalRate} format="percent" />
          <CompareRow label="Prazos OK" a={memberA.estagiarioKPIs.deadlinesCompletedOnTime} b={memberB.estagiarioKPIs.deadlinesCompletedOnTime} />
          <CompareRow label="Documentos" a={memberA.estagiarioKPIs.documentsUploaded} b={memberB.estagiarioKPIs.documentsUploaded} />
        </>)}
      </div>
    </div>
  );
}
