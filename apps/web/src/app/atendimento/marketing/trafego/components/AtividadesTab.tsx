'use client';

/**
 * Tab "Atividades" — mostra o audit trail completo de toda escrita no
 * Google Ads (TrafficMutateLog), com badge visual identificando se foi
 * o Claude (via MCP), a IA interna do CRM ou um humano clicando no
 * painel.
 *
 * Criada em 2026-05-17 quando o user pediu "tem como aparecer no menu
 * tudo o que está sendo feito pelo claude?" — antes disso, o backend
 * registrava em TrafficMutateLog mas nao havia tela pra visualizar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Filter,
  Loader2,
  RefreshCw,
  User,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
} from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';

interface MutateLog {
  id: string;
  created_at: string;
  operation: string;
  resource_type: string;
  resource_id: string | null;
  initiator: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'VALIDATED';
  validate_only: boolean;
  error_message: string | null;
  request_payload: unknown;
  response_payload: unknown;
}

type ActorKind = 'claude' | 'ai_internal' | 'human' | 'unknown';

interface ParsedActor {
  kind: ActorKind;
  label: string;
  detail: string | null;
}

const STATUS_FILTERS = [
  { value: '', label: 'Todos status' },
  { value: 'SUCCESS', label: 'Sucesso' },
  { value: 'FAILED', label: 'Falha' },
  { value: 'RUNNING', label: 'Executando' },
  { value: 'QUEUED', label: 'Na fila' },
  { value: 'VALIDATED', label: 'Validado (dry-run)' },
] as const;

const ACTOR_FILTERS = [
  { value: '', label: 'Todos atores' },
  { value: 'mcp:', label: 'Claude (MCP)' },
  { value: 'ai_agent:', label: 'IA interna' },
  { value: 'user:', label: 'Humano (painel)' },
] as const;

const POLLING_MS = 30_000;

export function AtividadesTab() {
  const [logs, setLogs] = useState<MutateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [actorFilter, setActorFilter] = useState<string>('');
  const [selected, setSelected] = useState<MutateLog | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const { data } = await api.get<MutateLog[]>('/trafego/mutate-logs', {
          params: {
            limit: 100,
            status: statusFilter || undefined,
            initiator: actorFilter || undefined,
          },
        });
        setLogs(data);
      } catch (err: any) {
        showError(err?.response?.data?.message ?? 'Falha ao carregar atividades.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, actorFilter],
  );

  // Carregamento inicial + reagir a mudança de filtro.
  useEffect(() => {
    load();
  }, [load]);

  // Polling — atualiza enquanto a aba esta aberta. Para se aba esta
  // hidden (Page Visibility API) pra nao queimar quota inutilmente.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') {
        load(true);
      }
    };
    const id = setInterval(tick, POLLING_MS);
    return () => clearInterval(id);
  }, [load]);

  const counts = useMemo(() => {
    const out = { claude: 0, ai_internal: 0, human: 0, unknown: 0 };
    for (const log of logs) {
      const actor = parseActor(log.initiator);
      out[actor.kind] += 1;
    }
    return out;
  }, [logs]);

  return (
    <div className="space-y-4">
      {/* Cabeçalho com counters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-foreground" />
          <h2 className="text-base font-bold text-foreground">
            Atividades — audit trail completo
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CounterBadge
            icon={<Bot size={13} />}
            label="Claude"
            count={counts.claude}
            tone="violet"
          />
          <CounterBadge
            icon={<Sparkles size={13} />}
            label="IA interna"
            count={counts.ai_internal}
            tone="amber"
          />
          <CounterBadge
            icon={<User size={13} />}
            label="Humano"
            count={counts.human}
            tone="slate"
          />
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-accent disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Atualizar
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Filter size={13} />
          <span className="text-xs font-semibold">Filtrar:</span>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background"
        >
          {ACTOR_FILTERS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Atualiza automaticamente a cada 30s · {logs.length} item{logs.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Tabela */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Carregando...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nenhuma atividade encontrada pra os filtros selecionados.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr className="text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-2.5">Quando</th>
                <th className="px-4 py-2.5">Quem</th>
                <th className="px-4 py-2.5">Ação</th>
                <th className="px-4 py-2.5">Recurso</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const actor = parseActor(log.initiator);
                return (
                  <tr
                    key={log.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatRelativeTime(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <ActorBadge actor={actor} />
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded">
                        {log.operation}
                      </code>
                      <span className="text-xs ml-1.5 text-muted-foreground">
                        {log.validate_only && '· dry-run'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-foreground/80">{log.resource_type}</span>
                      {log.resource_id && (
                        <code className="ml-1.5 text-[10px] text-muted-foreground">
                          {log.resource_id.slice(0, 14)}
                          {log.resource_id.length > 14 ? '…' : ''}
                        </code>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} />
                      {log.error_message && (
                        <p className="mt-0.5 text-[11px] text-red-700 dark:text-red-400 max-w-xs truncate">
                          {log.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(log)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                        title="Ver payload completo"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <DetailDrawer log={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function CounterBadge({
  icon,
  label,
  count,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: 'violet' | 'amber' | 'slate';
}) {
  const cls = {
    violet:
      'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
    amber:
      'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    slate:
      'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border ${cls}`}
    >
      {icon}
      {label}
      <span className="bg-background/60 px-1 rounded text-[10px]">{count}</span>
    </span>
  );
}

function ActorBadge({ actor }: { actor: ParsedActor }) {
  const config = {
    claude: {
      icon: <Bot size={11} />,
      cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
    },
    ai_internal: {
      icon: <Sparkles size={11} />,
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    },
    human: {
      icon: <User size={11} />,
      cls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
    },
    unknown: {
      icon: <Activity size={11} />,
      cls: 'bg-muted text-muted-foreground border-border',
    },
  }[actor.kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${config.cls}`}
      title={actor.detail ?? undefined}
    >
      {config.icon}
      {actor.label}
    </span>
  );
}

function StatusBadge({ status }: { status: MutateLog['status'] }) {
  const map: Record<
    MutateLog['status'],
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    SUCCESS: {
      label: 'Sucesso',
      cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
      icon: <CheckCircle2 size={11} />,
    },
    FAILED: {
      label: 'Falha',
      cls: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
      icon: <XCircle size={11} />,
    },
    VALIDATED: {
      label: 'Validado',
      cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
      icon: <CheckCircle2 size={11} />,
    },
    RUNNING: {
      label: 'Executando',
      cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
      icon: <Loader2 size={11} className="animate-spin" />,
    },
    QUEUED: {
      label: 'Na fila',
      cls: 'bg-muted text-muted-foreground border-border',
      icon: <Clock size={11} />,
    },
  };
  const c = map[status] ?? map.QUEUED;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${c.cls}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function DetailDrawer({
  log,
  onClose,
}: {
  log: MutateLog;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Detalhe da atividade
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {new Date(log.created_at).toLocaleString('pt-BR')} ·{' '}
              <code className="text-[10px]">{log.id}</code>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto space-y-3">
          <Field label="Operação">
            <code>{log.operation}</code> em <code>{log.resource_type}</code>
          </Field>
          <Field label="Initiator">
            <code>{log.initiator}</code>
          </Field>
          <Field label="Status">
            <StatusBadge status={log.status} />
            {log.validate_only && (
              <span className="ml-2 text-[11px] text-muted-foreground">
                · modo dry-run (sem efeito real)
              </span>
            )}
          </Field>
          {log.error_message && (
            <Field label="Erro">
              <pre className="text-[11px] text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2 whitespace-pre-wrap">
                {log.error_message}
              </pre>
            </Field>
          )}
          <Field label="Request payload">
            <pre className="text-[11px] bg-muted/40 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(log.request_payload, null, 2)}
            </pre>
          </Field>
          {log.response_payload != null && (
            <Field label="Response payload">
              <pre className="text-[11px] bg-muted/40 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(log.response_payload, null, 2)}
              </pre>
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </p>
      <div className="text-xs text-foreground">{children}</div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseActor(initiator: string): ParsedActor {
  if (initiator.startsWith('mcp:claude:')) {
    return {
      kind: 'claude',
      label: 'Claude',
      detail: `tool_call_id: ${initiator.slice('mcp:claude:'.length)}`,
    };
  }
  if (initiator.startsWith('mcp:')) {
    return { kind: 'claude', label: 'Claude (MCP)', detail: initiator };
  }
  if (initiator.startsWith('ai_agent:')) {
    return {
      kind: 'ai_internal',
      label: 'IA interna',
      detail: initiator.slice('ai_agent:'.length),
    };
  }
  if (initiator.startsWith('user:')) {
    return {
      kind: 'human',
      label: 'Humano',
      detail: initiator.slice('user:'.length),
    };
  }
  return { kind: 'unknown', label: 'Desconhecido', detail: initiator };
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s atrás`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m atrás`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h atrás`;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
