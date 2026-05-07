'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, RefreshCw, AlertCircle, CheckCircle2, PowerOff } from 'lucide-react';
import { showError, showSuccess } from '@/lib/toast';
import api from '@/lib/api';

interface CronEntry {
  name: string;
  description: string | null;
  schedule: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
  last_duration_ms: number | null;
  run_count: number;
}

type FilterMode = 'all' | 'active' | 'disabled' | 'error';

const REFRESH_INTERVAL_MS = 30_000;

export default function CronsPage() {
  const [crons, setCrons] = useState<CronEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await api.get<CronEntry[]>('/admin/crons');
      setCrons(res.data);
    } catch (e: any) {
      if (!silent) showError('Erro ao carregar crons');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const toggle = async (name: string, currentlyEnabled: boolean) => {
    try {
      setTogglingName(name);
      await api.patch(`/admin/crons/${name}`, { enabled: !currentlyEnabled });
      setCrons((prev) =>
        prev.map((c) => (c.name === name ? { ...c, enabled: !currentlyEnabled } : c)),
      );
      showSuccess(currentlyEnabled ? `${name} desativado` : `${name} ativado`);
    } catch {
      showError('Erro ao alterar cron');
    } finally {
      setTogglingName(null);
    }
  };

  const stats = {
    total: crons.length,
    active: crons.filter((c) => c.enabled).length,
    disabled: crons.filter((c) => !c.enabled).length,
    error: crons.filter((c) => c.last_status === 'error').length,
  };

  const filtered = crons.filter((c) => {
    if (filter === 'active') return c.enabled;
    if (filter === 'disabled') return !c.enabled;
    if (filter === 'error') return c.last_status === 'error';
    return true;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Clock size={20} className="text-primary" />
            Crons (Tarefas Agendadas)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Liga/desliga tarefas automaticas em tempo real. Auto-atualiza a cada 30s.
          </p>
        </div>
        <button
          onClick={() => load()}
          disabled={refreshing || loading}
          className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-xl text-sm font-medium text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={stats.total} onClick={() => setFilter('all')} active={filter === 'all'} />
        <StatCard label="Ativos" value={stats.active} onClick={() => setFilter('active')} active={filter === 'active'} accent="text-emerald-500" />
        <StatCard label="Desativados" value={stats.disabled} onClick={() => setFilter('disabled')} active={filter === 'disabled'} accent="text-muted-foreground" />
        <StatCard label="Com erro" value={stats.error} onClick={() => setFilter('error')} active={filter === 'error'} accent="text-rose-500" />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground text-sm">
          Carregando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground text-sm">
          {crons.length === 0
            ? 'Nenhum cron registrado ainda. Os crons aparecem aqui automaticamente apos a primeira execucao.'
            : 'Nenhum cron com esse filtro.'}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-foreground/[0.03] text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                <th className="text-left px-4 py-3">Nome / Descricao</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Schedule</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Ultima execucao</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Duracao</th>
                <th className="text-right px-4 py-3">Ligado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.name}
                  className="border-t border-border hover:bg-foreground/[0.02] transition-colors"
                >
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-foreground font-mono text-[12px]">{c.name}</div>
                    {c.description && (
                      <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                        {c.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top hidden md:table-cell">
                    <code className="text-[11px] bg-foreground/[0.05] px-2 py-1 rounded font-mono text-muted-foreground">
                      {c.schedule || '—'}
                    </code>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusBadge cron={c} />
                  </td>
                  <td className="px-4 py-3 align-top hidden lg:table-cell text-[12px] text-muted-foreground">
                    {c.last_run_at ? formatRelative(c.last_run_at) : 'nunca'}
                    {c.run_count > 0 && (
                      <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                        {c.run_count} execucao{c.run_count !== 1 ? 'oes' : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top hidden lg:table-cell text-[12px] text-muted-foreground">
                    {c.last_duration_ms != null ? formatDuration(c.last_duration_ms) : '—'}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <Toggle
                      enabled={c.enabled}
                      disabled={togglingName === c.name}
                      onClick={() => toggle(c.name, c.enabled)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Erro detalhado */}
      {filtered.some((c) => c.last_status === 'error' && c.last_error) && filter === 'error' && (
        <div className="bg-card border border-rose-500/30 rounded-xl p-4 space-y-3">
          <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-500" />
            Detalhes dos erros
          </h3>
          {filtered
            .filter((c) => c.last_status === 'error' && c.last_error)
            .map((c) => (
              <div key={c.name} className="text-[12px] border-t border-border pt-2">
                <div className="font-mono font-semibold text-foreground">{c.name}</div>
                <pre className="text-rose-500 mt-1 whitespace-pre-wrap break-all font-mono text-[11px]">
                  {c.last_error}
                </pre>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  onClick,
  active,
  accent,
}: {
  label: string;
  value: number;
  onClick: () => void;
  active: boolean;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-card border rounded-xl p-4 transition-colors ${
        active ? 'border-primary/40 bg-primary/[0.03]' : 'border-border hover:bg-foreground/[0.02]'
      }`}
    >
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${accent || 'text-foreground'}`}>{value}</div>
    </button>
  );
}

function StatusBadge({ cron }: { cron: CronEntry }) {
  if (!cron.enabled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-medium">
        <PowerOff size={11} /> desativado
      </span>
    );
  }
  if (cron.last_status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 text-[11px] font-medium">
        <AlertCircle size={11} /> erro
      </span>
    );
  }
  if (cron.last_status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[11px] font-medium">
        <CheckCircle2 size={11} /> ok
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-foreground/[0.05] text-muted-foreground text-[11px] font-medium">
      aguardando
    </span>
  );
}

function Toggle({
  enabled,
  disabled,
  onClick,
}: {
  enabled: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
        enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'ha poucos segundos';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `ha ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `ha ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `ha ${diffD}d`;
  return d.toLocaleDateString('pt-BR');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}min ${Math.floor((ms % 60_000) / 1000)}s`;
}
