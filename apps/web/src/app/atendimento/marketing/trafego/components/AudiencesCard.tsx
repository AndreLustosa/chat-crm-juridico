'use client';

import { useEffect, useState } from 'react';
import {
  Users,
  Loader2,
  Plus,
  RefreshCw,
  Upload,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type AudienceKind =
  | 'CLIENTES_ATIVOS'
  | 'LEADS_QUALIFICADOS'
  | 'LOOKALIKE_BASE'
  | 'CUSTOM';

interface Audience {
  id: string;
  google_user_list_id: string | null;
  google_resource_name: string | null;
  name: string;
  description: string | null;
  kind: AudienceKind;
  membership_lifespan_days: number;
  status: 'DRAFT' | 'SYNCING' | 'READY' | 'ERROR';
  error_message: string | null;
  google_size_reported: number | null;
  local_size: number;
  last_synced_at: string | null;
  created_at: string;
}

const KIND_INFO: Record<AudienceKind, { label: string; description: string }> = {
  CLIENTES_ATIVOS: {
    label: 'Clientes Ativos',
    description:
      'Clientes que assinaram contrato. Use pra EXCLUIR das campanhas de prospect.',
  },
  LEADS_QUALIFICADOS: {
    label: 'Leads Qualificados',
    description: 'Leads que avançaram no funil mas ainda não fecharam — alvo de remarketing.',
  },
  LOOKALIKE_BASE: {
    label: 'Base p/ Similar',
    description: 'Mesma fonte dos clientes — Google gera audiences similares.',
  },
  CUSTOM: {
    label: 'Customizada',
    description: 'Lista gerenciada manualmente pelo admin.',
  },
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-zinc-500/15 text-zinc-600',
  SYNCING: 'bg-amber-500/15 text-amber-600',
  READY: 'bg-emerald-500/15 text-emerald-600',
  ERROR: 'bg-red-500/15 text-red-600',
};

export function AudiencesCard({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Audience[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Audience[]>('/trafego/audiences');
      setItems(data);
    } catch {
      showError('Erro carregando audiências.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function rebuild(id: string) {
    if (!canManage) return;
    setRunning(id);
    try {
      await api.post(`/trafego/audiences/${id}/rebuild`);
      showSuccess('Rebuild iniciado. Recarregando em 30s...');
      setTimeout(() => load(), 30_000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro no rebuild.');
    } finally {
      setRunning(null);
    }
  }

  async function sync(id: string) {
    if (!canManage) return;
    setRunning(id);
    try {
      const { data } = await api.post<{ message?: string }>(
        `/trafego/audiences/${id}/sync`,
      );
      showSuccess(data.message ?? 'Sync enfileirado.');
      setTimeout(() => load(), 30_000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro no sync.');
    } finally {
      setRunning(null);
    }
  }

  async function deleteAudience(a: Audience) {
    if (!canManage) return;
    if (
      !confirm(
        `Apagar "${a.name}"? ${
          a.google_user_list_id
            ? 'Ela também precisa ser removida no Google Ads pra evitar drift.'
            : 'Está só no CRM, sem reflexo no Google Ads.'
        }`,
      )
    )
      return;
    try {
      await api.delete(`/trafego/audiences/${a.id}`);
      setItems((prev) => prev.filter((x) => x.id !== a.id));
      showSuccess('Audiência removida.');
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro ao remover.');
    }
  }

  async function createAudience(kind: AudienceKind) {
    if (!canManage) return;
    setCreating(true);
    try {
      await api.post('/trafego/audiences', { kind });
      showSuccess('Audiência criada em modo DRAFT.');
      setShowCreate(false);
      await load();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro ao criar.');
    } finally {
      setCreating(false);
    }
  }

  const existingKinds = new Set(items.map((i) => i.kind));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Users size={18} className="text-primary" />
            <h3 className="text-base font-bold text-foreground">
              Audiências (Customer Match)
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Listas sincronizadas com o Google Ads. Servem pra excluir clientes
            das campanhas de prospect e fazer remarketing inteligente.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card hover:bg-accent"
          >
            <Plus size={15} />
            Nova
          </button>
        )}
      </div>

      {showCreate && canManage && (
        <div className="p-4 border-b border-border bg-muted/20 grid grid-cols-1 md:grid-cols-2 gap-2">
          {(Object.keys(KIND_INFO) as AudienceKind[])
            .filter((k) => !existingKinds.has(k))
            .map((k) => (
              <button
                key={k}
                onClick={() => createAudience(k)}
                disabled={creating}
                className="text-left p-3 rounded-lg border border-border hover:bg-accent disabled:opacity-50"
              >
                <p className="text-sm font-bold">{KIND_INFO[k].label}</p>
                <p className="text-[11px] text-muted-foreground">
                  {KIND_INFO[k].description}
                </p>
              </button>
            ))}
          {existingKinds.size === 4 && (
            <p className="col-span-full text-xs text-muted-foreground text-center py-3">
              Todos os tipos disponíveis já têm audiência criada.
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-10 text-center">
          <Users size={36} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhuma audiência ainda. Crie a primeira em "Nova" — recomendamos
            começar com <strong>Clientes Ativos</strong> pra excluir das
            campanhas e parar de pagar pra alcançar quem já é cliente.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Lista</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Local</th>
              <th className="text-right px-4 py-3">Google</th>
              <th className="text-right px-4 py-3 w-72">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr
                key={a.id}
                className="border-t border-border hover:bg-accent/30"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {KIND_INFO[a.kind].label}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md ${
                      STATUS_BADGE[a.status] ?? STATUS_BADGE.DRAFT
                    }`}
                  >
                    {a.status}
                  </span>
                  {a.error_message && (
                    <div className="text-[10px] text-amber-700 mt-0.5 flex items-start gap-1">
                      <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                      <span>{a.error_message.slice(0, 80)}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {a.local_size}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                  {a.google_size_reported ?? '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center gap-1 justify-end">
                    {canManage && a.kind !== 'CUSTOM' && (
                      <button
                        onClick={() => rebuild(a.id)}
                        disabled={running === a.id}
                        title="Recompute do CRM"
                        className="px-2 py-1 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
                      >
                        {running === a.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                      </button>
                    )}
                    {canManage && (
                      <button
                        onClick={() => sync(a.id)}
                        disabled={running === a.id}
                        title="Sincronizar com Google Ads"
                        className="px-2 py-1 text-xs rounded bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-700 disabled:opacity-50"
                      >
                        <Upload size={12} />
                      </button>
                    )}
                    {canManage && (
                      <button
                        onClick={() => deleteAudience(a)}
                        title="Remover localmente"
                        className="px-2 py-1 text-xs rounded border border-border hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="p-3 text-[11px] text-muted-foreground bg-muted/20 border-t border-border">
        ⚠️ Sync com Google Ads ainda não publica members (D2 — aguardando
        revisão LGPD/OAB). O hash dos contatos já é gerado localmente e o
        diff entre CRM e lista é calculado a cada rebuild.
      </div>
    </div>
  );
}
