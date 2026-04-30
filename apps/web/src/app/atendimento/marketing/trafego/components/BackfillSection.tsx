'use client';

import { useEffect, useState } from 'react';
import {
  Database,
  Loader2,
  Play,
  X,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface BackfillStatus {
  backfill_status: 'NONE' | 'RUNNING' | 'DONE' | 'ERROR';
  backfill_target_from: string | null;
  backfill_cursor: string | null;
  backfill_total_months: number;
  backfill_done_months: number;
  backfill_completed_at: string | null;
  backfill_error: string | null;
  progress_pct: number;
}

const PRESETS = [
  { months: 12, label: '12 meses' },
  { months: 24, label: '24 meses (recomendado)' },
  { months: 36, label: '36 meses' },
  { months: 60, label: '5 anos (max)' },
];

export function BackfillSection({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [presetMonths, setPresetMonths] = useState(24);
  const [starting, setStarting] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<BackfillStatus>('/trafego/backfill/status');
      setStatus(data);
    } catch {
      // conta sem backfill ainda — silencioso
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Polling enquanto RUNNING
    const t = setInterval(() => {
      if (status?.backfill_status === 'RUNNING') load();
    }, 30_000);
    return () => clearInterval(t);
  }, [status?.backfill_status]);

  async function start() {
    if (!canManage) return;
    setStarting(true);
    try {
      const targetFrom = monthsAgoIso(presetMonths);
      await api.post('/trafego/backfill/start', { target_from: targetFrom });
      showSuccess('Backfill iniciado. Acompanhe o progresso aqui.');
      setShowStart(false);
      await load();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro ao iniciar backfill.');
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!canManage) return;
    if (!confirm('Cancelar o backfill? Os meses já importados ficam no banco.')) return;
    try {
      await api.post('/trafego/backfill/cancel');
      showSuccess('Backfill cancelado.');
      await load();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro ao cancelar.');
    }
  }

  if (loading) return null;

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-primary" />
          <h3 className="text-sm font-bold text-foreground">
            Histórico de campanhas
          </h3>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        O sync diário guarda <strong>30 dias rolling</strong>. Pra IA poder
        analisar histórico longo (YoY, tendência), baixe os meses anteriores.
        Roda em segundo plano (~1h pra 24 meses) sem atrapalhar nada.
      </p>

      {!status || status.backfill_status === 'NONE' ? (
        <div>
          {!showStart ? (
            <button
              onClick={() => setShowStart(true)}
              disabled={!canManage}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
            >
              <Database size={14} /> Baixar histórico completo
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  Quantos meses retroativos?
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.months}
                      onClick={() => setPresetMonths(p.months)}
                      className={`text-xs font-bold px-3 py-2 rounded-md border ${
                        presetMonths === p.months
                          ? 'bg-violet-500/10 border-violet-500/50 text-violet-700'
                          : 'border-border hover:bg-accent'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={start}
                  disabled={starting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                >
                  {starting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Iniciar
                </button>
                <button
                  onClick={() => setShowStart(false)}
                  className="px-4 py-2 text-sm font-bold rounded-md bg-card hover:bg-accent border border-border"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      ) : status.backfill_status === 'RUNNING' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 size={14} className="animate-spin text-violet-600" />
            <strong>Em andamento</strong> — {status.backfill_done_months} de{' '}
            {status.backfill_total_months} meses ({status.progress_pct}%)
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
              style={{ width: `${status.progress_pct}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Próximo lote roda a cada 5min · Cursor:{' '}
            {status.backfill_cursor
              ? new Date(status.backfill_cursor).toISOString().slice(0, 7)
              : '—'}
          </p>
          {canManage && (
            <button
              onClick={cancel}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-card hover:bg-red-500/10 hover:text-red-600 border border-border"
            >
              <X size={12} /> Cancelar backfill
            </button>
          )}
        </div>
      ) : status.backfill_status === 'DONE' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 size={14} /> <strong>Concluído</strong> em{' '}
            {status.backfill_completed_at &&
              new Date(status.backfill_completed_at).toLocaleDateString('pt-BR')}{' '}
            — {status.backfill_done_months} meses importados.
          </div>
          {canManage && (
            <button
              onClick={() => setShowStart(true)}
              className="text-[11px] underline text-muted-foreground hover:text-foreground"
            >
              Re-rodar backfill (cobre período diferente)
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle size={14} className="mt-0.5" />
            <div>
              <strong>Erro</strong>: {status.backfill_error ?? '—'}
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setShowStart(true)}
              className="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Play size={12} /> Tentar de novo
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function monthsAgoIso(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}
