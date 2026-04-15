'use client';

/**
 * DashboardStrip — Faixa compacta de KPIs no topo da página de processos.
 *
 * Filosofia: ao abrir a tela o advogado deve enxergar INSTANTANEAMENTE o
 * estado operacional (urgentes, atrasados, prazos da semana, valor em
 * causas). Os cards são clicáveis — cada um aplica o filtro correspondente,
 * virando também um atalho de navegação.
 *
 * Reage aos filtros já aplicados: se o usuário filtrar por área X, os KPIs
 * recalculam dentro desse escopo.
 */

import { useMemo } from 'react';
import {
  FileText,
  AlertTriangle,
  Clock,
  Calendar,
  DollarSign,
  TrendingUp,
  X as XIcon,
  ChevronRight,
} from 'lucide-react';

// ─── Tipos (subset de LegalCase) ─────────────────────────────

export interface DashboardStripLegalCase {
  id: string;
  priority: string;
  claim_value: string | null;
  stage_changed_at: string;
  updated_at: string;
  legal_area: string | null;
  tracking_stage: string | null;
  calendar_events?: {
    id: string;
    type: string;
    start_at: string;
  }[];
}

interface Props {
  cases: DashboardStripLegalCase[];
  onClose: () => void;
  onFilterUrgent: () => void;
  onFilterWithoutMovement: () => void;
  onFilterNext7Days: () => void;
  onSwitchToAgenda: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────

const fmtMoney = (v: number): string => {
  if (!v) return 'R$ 0';
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (v >= 1_000) return `R$ ${(v / 1000).toFixed(0)}k`;
  return `R$ ${v}`;
};

const fmtMoneyFull = (v: number): string =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Componente ──────────────────────────────────────────────

export function DashboardStrip({
  cases,
  onClose,
  onFilterUrgent,
  onFilterWithoutMovement,
  onFilterNext7Days,
  onSwitchToAgenda,
}: Props) {
  const metrics = useMemo(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    let totalValue = 0;
    let urgentCount = 0;
    let withoutMovementCount = 0;
    let upcoming7dCount = 0;
    let audiencias7d = 0;
    let prazos7d = 0;

    const areaMap = new Map<string, number>();

    cases.forEach(c => {
      totalValue += Number(c.claim_value) || 0;
      if (c.priority === 'URGENTE') urgentCount++;

      const lastMove = new Date(c.stage_changed_at || c.updated_at).getTime();
      if (now - lastMove > thirtyDays) withoutMovementCount++;

      if (c.legal_area) {
        areaMap.set(c.legal_area, (areaMap.get(c.legal_area) || 0) + 1);
      }

      (c.calendar_events || []).forEach(ev => {
        const t = new Date(ev.start_at).getTime();
        if (Number.isNaN(t)) return;
        if (t >= now && t <= now + sevenDays) {
          upcoming7dCount++;
          const tp = (ev.type || '').toUpperCase();
          if (tp.includes('AUDIENCI')) audiencias7d++;
          else if (tp.includes('PRAZO')) prazos7d++;
        }
      });
    });

    const topAreas = Array.from(areaMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return {
      total: cases.length,
      totalValue,
      urgentCount,
      withoutMovementCount,
      upcoming7dCount,
      audiencias7d,
      prazos7d,
      topAreas,
    };
  }, [cases]);

  // Card base
  const Card = ({
    icon: Icon,
    label,
    value,
    sub,
    accent,
    accentBg,
    accentBorder,
    onClick,
    disabled,
    valueTitle,
  }: {
    icon: typeof FileText;
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    accent: string;
    accentBg: string;
    accentBorder: string;
    onClick?: () => void;
    disabled?: boolean;
    valueTitle?: string;
  }) => {
    const clickable = !!onClick && !disabled;
    return (
      <button
        onClick={clickable ? onClick : undefined}
        disabled={!clickable}
        className={`flex-1 min-w-[150px] flex items-start gap-2.5 p-3 rounded-xl border ${accentBorder} ${accentBg} text-left transition-all ${
          clickable ? 'hover:brightness-125 hover:border-opacity-60 cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${accentBg} border ${accentBorder}`}>
          <Icon size={14} className={accent} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </div>
          <div className={`text-[17px] font-bold ${accent} leading-tight mt-0.5`} title={valueTitle}>
            {value}
          </div>
          {sub && (
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>
          )}
        </div>
        {clickable && (
          <ChevronRight size={11} className="text-muted-foreground opacity-50 shrink-0 self-center" />
        )}
      </button>
    );
  };

  return (
    <div className="px-6 py-3 border-b border-border bg-gradient-to-b from-accent/10 to-transparent">
      <div className="flex items-start gap-2">
        <div className="flex-1 flex items-stretch gap-2 flex-wrap">
          {/* 1. Total ativos */}
          <Card
            icon={FileText}
            label="Total ativos"
            value={metrics.total.toString()}
            sub={
              metrics.topAreas.length > 0
                ? `Top: ${metrics.topAreas[0][0]}${metrics.topAreas.length > 1 ? ` +${metrics.topAreas.length - 1}` : ''}`
                : 'Sem área'
            }
            accent="text-foreground"
            accentBg="bg-accent/40"
            accentBorder="border-border"
          />

          {/* 2. Urgentes (clicável) */}
          <Card
            icon={AlertTriangle}
            label="Urgentes"
            value={metrics.urgentCount.toString()}
            sub={
              metrics.urgentCount > 0
                ? `${Math.round((metrics.urgentCount / Math.max(metrics.total, 1)) * 100)}% do total`
                : 'Nenhum urgente'
            }
            accent="text-red-400"
            accentBg="bg-red-500/10"
            accentBorder="border-red-500/25"
            onClick={onFilterUrgent}
            disabled={metrics.urgentCount === 0}
          />

          {/* 3. Sem movimento +30d (clicável) */}
          <Card
            icon={Clock}
            label="Sem movimento +30d"
            value={metrics.withoutMovementCount.toString()}
            sub={metrics.withoutMovementCount > 0 ? 'Requerem ação' : 'Tudo em dia ✓'}
            accent="text-amber-400"
            accentBg="bg-amber-500/10"
            accentBorder="border-amber-500/25"
            onClick={onFilterWithoutMovement}
            disabled={metrics.withoutMovementCount === 0}
          />

          {/* 4. Próximos 7 dias → abre Agenda */}
          <Card
            icon={Calendar}
            label="Próximos 7 dias"
            value={metrics.upcoming7dCount.toString()}
            sub={
              metrics.upcoming7dCount > 0
                ? `${metrics.audiencias7d} audiência${metrics.audiencias7d !== 1 ? 's' : ''}${
                    metrics.prazos7d > 0 ? ` • ${metrics.prazos7d} prazo${metrics.prazos7d > 1 ? 's' : ''}` : ''
                  }`
                : 'Sem eventos'
            }
            accent="text-sky-400"
            accentBg="bg-sky-500/10"
            accentBorder="border-sky-500/25"
            onClick={metrics.upcoming7dCount > 0 ? onSwitchToAgenda : undefined}
            disabled={metrics.upcoming7dCount === 0}
          />

          {/* 5. Valor em causas */}
          <Card
            icon={DollarSign}
            label="Valor em causas"
            value={fmtMoney(metrics.totalValue)}
            valueTitle={fmtMoneyFull(metrics.totalValue)}
            sub={
              metrics.total > 0
                ? `Média ${fmtMoney(metrics.totalValue / metrics.total)}/processo`
                : '—'
            }
            accent="text-emerald-400"
            accentBg="bg-emerald-500/10"
            accentBorder="border-emerald-500/25"
          />
        </div>

        {/* Botão fechar strip */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all shrink-0 mt-1"
          title="Ocultar painel de KPIs"
        >
          <XIcon size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Botão pequeno para reexibir a strip ─────────────────────

export function DashboardStripReopenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] font-semibold flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="Mostrar painel de KPIs"
    >
      <TrendingUp size={13} /> KPIs
    </button>
  );
}
