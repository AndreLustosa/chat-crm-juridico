'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Bell,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
} from 'lucide-react';
import api from '@/lib/api';
import { useRole } from '@/lib/useRole';
import { showError, showSuccess } from '@/lib/toast';

interface Alert {
  id: string;
  kind: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  context: Record<string, any> | null;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'MUTED';
  campaign_id: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

const SEVERITY_STYLE: Record<
  Alert['severity'],
  { color: string; border: string; icon: any; label: string }
> = {
  CRITICAL: {
    color: 'text-red-500',
    border: 'border-l-red-500',
    icon: AlertCircle,
    label: 'CRÍTICO',
  },
  WARNING: {
    color: 'text-amber-500',
    border: 'border-l-amber-500',
    icon: AlertTriangle,
    label: 'AVISO',
  },
  INFO: {
    color: 'text-sky-500',
    border: 'border-l-sky-500',
    icon: Info,
    label: 'INFO',
  },
};

const KIND_LABEL: Record<string, string> = {
  HIGH_CPL: 'CPL acima do alvo',
  LOW_CTR: 'CTR abaixo do alvo',
  ZERO_CONVERSIONS: 'Zero conversões na janela',
  OVERSPEND: 'Gasto acima do esperado',
  PAUSED_BUT_SPENDING: 'Campanha pausada com gasto',
  NO_DATA: 'Sem dados sincronizados',
  NO_LEADS_2D: 'Sem leads há 2 dias',
  DAILY_HIGH_SPEND_NO_CONV: 'Gasto alto hoje sem conversão',
  CTR_DROP: 'Queda de CTR vs semana anterior',
  BUDGET_DEPLETED_EARLY: 'Orçamento esgotou antes das 14h',
  LOW_QUALITY_SCORE: 'Quality Score baixo',
};

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMin = Math.floor((now - then) / 60_000);
  if (diffMin < 60) return diffMin <= 1 ? 'agora' : `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `há ${diffD}d`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AlertasPage() {
  const router = useRouter();
  const perms = useRole();

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState<
    'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'
  >('ALL');
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'ALL'>('OPEN');

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 200 };
      if (statusFilter === 'OPEN') params.status = 'OPEN';
      const { data } = await api.get<Alert[]>('/trafego/alerts', { params });
      setAlerts(data);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao listar alertas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (severityFilter === 'ALL') return alerts;
    return alerts.filter((a) => a.severity === severityFilter);
  }, [alerts, severityFilter]);

  async function markResolved(a: Alert) {
    if (!perms.canManageTrafego) return;
    setActing(a.id);
    try {
      await api.patch(`/trafego/alerts/${a.id}`, { status: 'RESOLVED' });
      showSuccess('Alerta marcado como resolvido.');
      await load();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha.');
    } finally {
      setActing(null);
    }
  }

  if (!perms.canViewTrafego) {
    return (
      <div className="p-8">
        <div className="bg-card border border-border rounded-xl p-8 text-center max-w-md mx-auto">
          <h2 className="text-base font-bold text-foreground mb-2">
            Acesso restrito
          </h2>
        </div>
      </div>
    );
  }

  const counts = {
    CRITICAL: alerts.filter((a) => a.severity === 'CRITICAL').length,
    WARNING: alerts.filter((a) => a.severity === 'WARNING').length,
    INFO: alerts.filter((a) => a.severity === 'INFO').length,
  };

  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8">
      <button
        type="button"
        onClick={() => router.push('/atendimento/marketing/trafego')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={14} />
        Voltar para Tráfego
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-amber-400 flex items-center justify-center">
          <Bell size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alertas</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de alertas gerados automaticamente pelo sistema
            (avaliados a cada sync).
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border">
          {(
            [
              { v: 'ALL', l: 'Todos', count: alerts.length },
              { v: 'CRITICAL', l: 'Crítico', count: counts.CRITICAL },
              { v: 'WARNING', l: 'Aviso', count: counts.WARNING },
              { v: 'INFO', l: 'Info', count: counts.INFO },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setSeverityFilter(opt.v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                severityFilter === opt.v
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.l}{' '}
              {opt.count > 0 && (
                <span className="ml-1 text-[10px] tabular-nums opacity-70">
                  ({opt.count})
                </span>
              )}
            </button>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as 'OPEN' | 'ALL')
          }
          className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg"
        >
          <option value="OPEN">Apenas abertos</option>
          <option value="ALL">Todos (incluindo resolvidos)</option>
        </select>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-accent disabled:opacity-50"
        >
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
      </div>

      {/* Lista timeline */}
      {loading ? (
        <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando alertas...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-3" />
          <h3 className="text-base font-bold text-foreground mb-1">
            Nenhum alerta no período
          </h3>
          <p className="text-sm text-muted-foreground">
            Suas campanhas estão saudáveis ou ainda não foram avaliadas.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const sty = SEVERITY_STYLE[a.severity];
            const Icon = sty.icon;
            const resolved = a.status !== 'OPEN';
            return (
              <div
                key={a.id}
                className={`bg-card border border-border border-l-4 ${sty.border} rounded-xl p-4 ${resolved ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <Icon size={18} className={`shrink-0 mt-0.5 ${sty.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${sty.color}`}>
                        ● {sty.label}
                      </span>
                      {resolved && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                          ✓ {a.status}
                          {a.acknowledged_at &&
                            ` em ${fmtDateTime(a.acknowledged_at)}`}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {fmtDateTime(a.created_at)} · {timeAgo(a.created_at)}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-foreground mb-1">
                      {KIND_LABEL[a.kind] ?? a.kind}
                    </h4>
                    <p className="text-sm text-foreground mb-2">{a.message}</p>
                    {a.context?.cost_brl && (
                      <p className="text-[11px] text-muted-foreground">
                        Gasto envolvido:{' '}
                        <strong>
                          {new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(a.context.cost_brl)}
                        </strong>
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      {!resolved && perms.canManageTrafego && (
                        <button
                          type="button"
                          onClick={() => markResolved(a)}
                          disabled={acting === a.id}
                          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 disabled:opacity-50"
                        >
                          {acting === a.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={11} />
                          )}
                          Marcar como resolvido
                        </button>
                      )}
                      {a.campaign_id && (
                        <Link
                          href={`/atendimento/marketing/trafego/campanhas/${a.campaign_id}`}
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          Ver campanha →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
