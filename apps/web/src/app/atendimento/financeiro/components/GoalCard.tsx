'use client';

/**
 * GoalCard — substitui o antigo MonthlyGoalCard.
 *
 * Diferenças principais:
 *  - Faz seu proprio fetch de /financeiro/goals/current-month (suporta scope+kind)
 *  - Toggle Realizada/Contratada no canto do card
 *  - Subtítulo dinâmico ("do escritório" ou "de Dra. X")
 *  - Projeção de fechamento ("Projeção: R$ X (X% da meta)")
 *  - Estado vazio com CTA "Definir meta" (admin only)
 *  - Fallback "meta do escritório" quando filtro=advogado mas ele não tem meta individual
 *  - Cor da barra com regra de ressalva temporal (vinda do backend via 'status')
 *  - Abre o modal multi-step (GoalsManagerModal) pra cadastro/edição
 */

import { useCallback, useEffect, useState } from 'react';
import { Target, Pencil, Loader2, ArrowUpRight } from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';
import { useRole } from '@/lib/useRole';
import GoalsManagerModal from './GoalsManagerModal';

type GoalKind = 'REALIZED' | 'CONTRACTED';

interface CurrentMonthGoal {
  hasGoal: boolean;
  goalId?: string;
  scope: 'OFFICE' | 'LAWYER';
  lawyerId: string | null;
  lawyerName: string | null;
  kind: GoalKind;
  year: number;
  month: number;
  target: number | null;
  realized: number;
  progressPct: number | null;
  projection: number | null;
  status: 'on_track' | 'warning' | 'behind' | 'achieved' | null;
  officeFallback: { goalId: string; target: number } | null;
}

interface LawyerLite { id: string; name: string }

interface GoalCardProps {
  /** lawyerId do filtro do header. Vazio = escritorio. */
  lawyerId: string;
  /** Lista de advogados (passada do page.tsx, ja carregada) */
  lawyers?: LawyerLite[];
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v || 0);

/* ──────────────────────────────────────────────────────────────
   Card
────────────────────────────────────────────────────────────── */

export default function GoalCard({ lawyerId, lawyers = [] }: GoalCardProps) {
  const { isAdmin, isFinanceiro } = useRole();
  const canEdit = isAdmin || isFinanceiro;

  const [kind, setKind] = useState<GoalKind>('REALIZED');
  const [data, setData] = useState<CurrentMonthGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/financeiro/goals/current-month', {
        params: {
          scope: lawyerId || 'OFFICE',
          kind,
        },
      });
      setData(r.data);
    } catch (e: any) {
      // Erro 403 (associado vendo de outro) — silencioso
      if (e?.response?.status !== 403) {
        showError('Erro ao carregar meta do mês');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [lawyerId, kind]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
        <div className="h-3 w-32 bg-muted rounded mb-3" />
        <div className="h-6 w-40 bg-muted rounded mb-2" />
        <div className="h-2 w-full bg-muted rounded-full" />
      </div>
    );
  }

  if (!data) return null;

  // Subtitulo dinamico baseado no escopo + kind
  const scopeLabel = data.scope === 'OFFICE'
    ? 'do escritório'
    : `de ${data.lawyerName || 'advogado'}`;
  const kindLabel = kind === 'REALIZED' ? 'realizada' : 'contratada';

  // ─── Estado vazio: lawyer sem meta individual + tem fallback escritorio ───
  if (!data.hasGoal && data.officeFallback) {
    return (
      <>
        <FallbackCard
          data={data}
          kind={kind}
          setKind={setKind}
          canEdit={canEdit}
          onOpenModal={() => setShowModal(true)}
        />
        {showModal && (
          <GoalsManagerModal
            lawyers={lawyers}
            defaultScope={lawyerId || 'OFFICE'}
            defaultKind={kind}
            onClose={() => setShowModal(false)}
            onSaved={() => {
              setShowModal(false);
              fetchData();
            }}
          />
        )}
      </>
    );
  }

  // ─── Estado vazio: sem meta nenhuma cadastrada ───
  if (!data.hasGoal) {
    if (!canEdit) {
      // Não-admin sem meta cadastrada: card oculto (nada a mostrar)
      return null;
    }
    return (
      <>
        <div className="bg-card border border-dashed border-border rounded-xl p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Target size={14} className="text-muted-foreground" />
              <div>
                <div className="text-xs font-bold text-foreground">Sem meta cadastrada</div>
                <div className="text-[10px] text-muted-foreground">
                  Defina a meta {kindLabel} {scopeLabel} para acompanhar o progresso.
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90"
            >
              <Pencil size={11} /> Definir meta
            </button>
          </div>
        </div>
        {showModal && (
          <GoalsManagerModal
            lawyers={lawyers}
            defaultScope={lawyerId || 'OFFICE'}
            defaultKind={kind}
            onClose={() => setShowModal(false)}
            onSaved={() => {
              setShowModal(false);
              fetchData();
            }}
          />
        )}
      </>
    );
  }

  // ─── Estado normal: meta cadastrada com progresso ───
  const target = data.target!;
  const pct = Math.min(100, Math.max(0, data.progressPct || 0));
  const barColor = colorForStatus(data.status);
  const projectionPct = target > 0 && data.projection
    ? (data.projection / target) * 100
    : null;

  return (
    <>
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Target size={14} className="text-purple-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Meta do mês
              </h3>
              <div className="text-[10px] text-muted-foreground truncate">
                {kindLabel} {scopeLabel}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Toggle Realizada/Contratada */}
            <KindToggle kind={kind} setKind={setKind} />
            {canEdit && (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1 text-[10px] font-bold text-purple-400 hover:text-purple-300 hover:underline"
                title="Editar / definir nova meta"
              >
                <Pencil size={10} /> Editar
              </button>
            )}
          </div>
        </div>

        {/* Valor da meta + atingido */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-base md:text-lg font-bold text-foreground tabular-nums">
            {fmt(data.realized)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            / {fmt(target)}
          </span>
        </div>

        {/* Barra de progresso */}
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
          <span>{(data.progressPct || 0).toFixed(1)}% atingido</span>
          <span>{labelForStatus(data.status)}</span>
        </div>

        {/* Projeção de fechamento */}
        {data.projection !== null && projectionPct !== null && (
          <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground flex items-center gap-1">
              <ArrowUpRight size={10} className="text-cyan-400" />
              <strong className="text-cyan-400">Projeção</strong> de fechamento
            </span>
            <span className="text-foreground tabular-nums">
              {fmt(data.projection)}{' '}
              <span className="text-muted-foreground">
                ({projectionPct.toFixed(0)}% da meta)
              </span>
            </span>
          </div>
        )}
      </div>

      {showModal && (
        <GoalsManagerModal
          lawyers={lawyers}
          defaultScope={lawyerId || 'OFFICE'}
          defaultKind={kind}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            fetchData();
          }}
        />
      )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────
   Fallback: lawyer sem meta individual mas com meta do escritório
────────────────────────────────────────────────────────────── */

function FallbackCard({ data, kind, setKind, canEdit, onOpenModal }: any) {
  const target = data.officeFallback.target;
  const pct = target > 0 ? Math.min(100, (data.realized / target) * 100) : 0;

  return (
    <div className="bg-card border border-amber-500/20 border-dashed rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Target size={14} className="text-amber-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Meta do mês (escritório)
            </h3>
            <div className="text-[10px] text-amber-400">
              Sem meta individual definida para {data.lawyerName || 'esse advogado'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <KindToggle kind={kind} setKind={setKind} />
          {canEdit && (
            <button
              onClick={onOpenModal}
              className="text-[10px] font-bold text-amber-400 hover:underline"
            >
              Definir →
            </button>
          )}
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold text-foreground tabular-nums">
          {fmt(data.realized)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">/ {fmt(target)}</span>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-muted-foreground/40"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {pct.toFixed(1)}% da meta do escritório
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Toggle Realizada/Contratada
────────────────────────────────────────────────────────────── */

function KindToggle({ kind, setKind }: { kind: GoalKind; setKind: (k: GoalKind) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/30 rounded-md p-0.5">
      <button
        onClick={() => setKind('REALIZED')}
        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
          kind === 'REALIZED' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Realizada
      </button>
      <button
        onClick={() => setKind('CONTRACTED')}
        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
          kind === 'CONTRACTED' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Contratada
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Helpers de status (cor e label)
────────────────────────────────────────────────────────────── */

function colorForStatus(status: CurrentMonthGoal['status']): string {
  switch (status) {
    case 'achieved': return 'bg-emerald-400';
    case 'on_track': return 'bg-emerald-400';
    case 'warning':  return 'bg-amber-400';
    case 'behind':   return 'bg-red-400';
    default: return 'bg-muted-foreground/40';
  }
}

function labelForStatus(status: CurrentMonthGoal['status']): string {
  switch (status) {
    case 'achieved': return '🎯 Meta atingida';
    case 'on_track': return '✓ No alvo';
    case 'warning':  return '⚠️ Atenção';
    case 'behind':   return '🔴 Distante';
    default: return '';
  }
}
