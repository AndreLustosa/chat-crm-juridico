'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Bell,
  Loader2,
  Zap,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface Alert {
  id: string;
  kind: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'MUTED';
  created_at: string;
}

const SEVERITY_STYLE: Record<string, { icon: any; color: string; bg: string }> = {
  CRITICAL: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/30' },
  WARNING: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
  INFO: { icon: Info, color: 'text-sky-500', bg: 'bg-sky-500/10 border-sky-500/30' },
};

const KIND_LABEL: Record<string, string> = {
  HIGH_CPL: 'CPL acima da meta',
  LOW_CTR: 'CTR abaixo da meta',
  BUDGET_EXHAUSTED: 'Orçamento esgotado',
  ZERO_CONVERSIONS: 'Sem conversões',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  PAUSED_BUT_SPENDING: 'Pausada mas gastando',
  OVERSPEND: 'Gasto acima do esperado',
  NO_DATA: 'Sem dados recentes',
  API_ERROR: 'Erro na API',
};

export function AlertasTab({ canManage }: { canManage: boolean }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Alert[]>('/trafego/alerts?status=OPEN&limit=50');
      setAlerts(data);
    } catch {
      showError('Erro ao carregar alertas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Polling leve a cada 60s — refresca lista quando worker cria alertas novos
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  async function evaluateNow() {
    if (!canManage) return;
    setEvaluating(true);
    try {
      await api.post('/trafego/evaluate-alerts');
      showSuccess('Avaliação iniciada. Recarregando em 10s...');
      // Aguarda worker processar e recarrega
      setTimeout(() => load(), 10_000);
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Erro ao iniciar avaliação';
      showError(msg);
    } finally {
      setEvaluating(false);
    }
  }

  async function acknowledge(a: Alert, status: 'ACKNOWLEDGED' | 'RESOLVED' | 'MUTED') {
    if (!canManage) return;
    try {
      await api.patch(`/trafego/alerts/${a.id}`, { status });
      setAlerts((prev) => prev.filter((x) => x.id !== a.id));
      showSuccess('Alerta atualizado');
    } catch {
      showError('Erro ao atualizar alerta.');
    }
  }

  // Header com botão "Avaliar agora" — sempre visível, mesmo loading/vazio
  const Header = () => (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-base font-bold text-foreground">
          Alertas operacionais
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {alerts.length === 0
            ? 'Avaliados automaticamente após cada sync (06h Maceió)'
            : `${alerts.length} alerta(s) aberto(s)`}
        </p>
      </div>
      {canManage && (
        <button
          onClick={evaluateNow}
          disabled={evaluating}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-50"
        >
          {evaluating ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Zap size={15} />
          )}
          Avaliar agora
        </button>
      )}
    </div>
  );

  if (loading) {
    return (
      <div>
        <Header />
        <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando alertas...</p>
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div>
        <Header />
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Bell size={40} className="mx-auto text-emerald-500 mb-3" />
          <h3 className="text-base font-bold text-foreground mb-1">
            Tudo em ordem 🎉
          </h3>
          <p className="text-sm text-muted-foreground">
            Nenhum alerta operacional aberto. Continuaremos monitorando
            automaticamente após cada sync.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header />
      <div className="space-y-3">
      {alerts.map((a) => {
        const style = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.INFO;
        const Icon = style.icon;
        return (
          <div
            key={a.id}
            className={`rounded-xl border p-4 flex gap-3 ${style.bg}`}
          >
            <Icon size={18} className={`shrink-0 mt-0.5 ${style.color}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold uppercase tracking-wider ${style.color}`}>
                  {a.severity}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {KIND_LABEL[a.kind] ?? a.kind}
                </span>
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {new Date(a.created_at).toLocaleString('pt-BR')}
                </span>
              </div>
              <p className="text-sm text-foreground">{a.message}</p>
              {canManage && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => acknowledge(a, 'ACKNOWLEDGED')}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-card hover:bg-accent border border-border"
                  >
                    Reconhecer
                  </button>
                  <button
                    onClick={() => acknowledge(a, 'RESOLVED')}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-card hover:bg-accent border border-border"
                  >
                    Resolver
                  </button>
                  <button
                    onClick={() => acknowledge(a, 'MUTED')}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-card hover:bg-accent border border-border"
                  >
                    Silenciar
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
