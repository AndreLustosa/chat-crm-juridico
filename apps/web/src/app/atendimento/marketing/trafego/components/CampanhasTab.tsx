'use client';

import { useEffect, useState } from 'react';
import { Star, Loader2, Inbox, Tag, Pause, Play, Edit3 } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface Campaign {
  id: string;
  google_campaign_id: string;
  name: string;
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
  channel_type: string | null;
  daily_budget_brl: number | null;
  is_favorite: boolean;
  is_archived_internal: boolean;
  tags: string[];
  notes: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  ENABLED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PAUSED: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REMOVED: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  ENABLED: 'Ativa',
  PAUSED: 'Pausada',
  REMOVED: 'Removida',
};

const fmtBRL = (v: number | null) =>
  v === null
    ? '—'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(v);

export function CampanhasTab({ canManage }: { canManage: boolean }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [budgetEditId, setBudgetEditId] = useState<string | null>(null);
  const [budgetInputBrl, setBudgetInputBrl] = useState('');
  const [budgetReason, setBudgetReason] = useState('');
  const [budgetValidateOnly, setBudgetValidateOnly] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<Campaign[]>('/trafego/campaigns');
      setCampaigns(data);
    } catch {
      showError('Erro ao carregar campanhas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function pauseOrResume(c: Campaign) {
    if (!canManage) return;
    const action = c.status === 'PAUSED' ? 'resume' : 'pause';
    const confirmMsg =
      action === 'pause'
        ? `Pausar a campanha "${c.name}" no Google Ads?`
        : `Reativar a campanha "${c.name}" no Google Ads?`;
    if (!confirm(confirmMsg)) return;
    setActingId(c.id);
    try {
      await api.post(`/trafego/campaigns/${c.id}/${action}`, {});
      showSuccess(
        action === 'pause' ? 'Pausa enfileirada.' : 'Reativacao enfileirada.',
      );
      // Optimistic UI: status muda em ~5s; resync sera no proximo cron, mas o
      // mirror local do worker ja atualiza o cache.
      setTimeout(load, 4000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao executar acao.');
    } finally {
      setActingId(null);
    }
  }

  function openBudgetModal(c: Campaign) {
    if (!canManage) return;
    setBudgetEditId(c.id);
    setBudgetInputBrl(c.daily_budget_brl?.toString() ?? '');
    setBudgetReason('');
    setBudgetValidateOnly(false);
  }

  async function submitBudget() {
    if (!budgetEditId) return;
    const n = parseFloat(budgetInputBrl.replace(',', '.'));
    if (!Number.isFinite(n) || n < 1) {
      showError('Informe valor valido (>= 1 BRL).');
      return;
    }
    setActingId(budgetEditId);
    try {
      await api.patch(`/trafego/campaigns/${budgetEditId}/budget`, {
        new_amount_brl: n,
        reason: budgetReason || undefined,
        validate_only: budgetValidateOnly,
      });
      showSuccess(
        budgetValidateOnly
          ? 'Validacao em dry-run enfileirada.'
          : 'Atualizacao de orcamento enfileirada.',
      );
      setBudgetEditId(null);
      setTimeout(load, 4000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao atualizar orcamento.');
    } finally {
      setActingId(null);
    }
  }

  async function toggleFavorite(c: Campaign) {
    if (!canManage) return;
    try {
      await api.patch(`/trafego/campaigns/${c.id}`, {
        is_favorite: !c.is_favorite,
      });
      setCampaigns((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, is_favorite: !c.is_favorite } : x,
        ),
      );
      showSuccess(c.is_favorite ? 'Removida dos favoritos' : 'Marcada como favorita');
    } catch {
      showError('Erro ao atualizar campanha.');
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 size={28} className="animate-spin mb-2" />
        <p className="text-sm">Carregando campanhas...</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <Inbox size={40} className="mx-auto text-muted-foreground mb-3" />
        <h3 className="text-base font-bold text-foreground mb-1">
          Nenhuma campanha ainda
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Após o primeiro sync com a Google Ads API, as campanhas aparecem aqui
          com métricas, status e ferramentas operacionais.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3 w-10"></th>
            <th className="text-left px-4 py-3">Campanha</th>
            <th className="text-left px-4 py-3">Tipo</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Orçamento/dia</th>
            <th className="text-left px-4 py-3">Tags</th>
            <th className="text-right px-4 py-3 w-28">Ações</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr
              key={c.id}
              className="border-t border-border hover:bg-accent/30 transition-colors"
            >
              <td className="px-4 py-3">
                <button
                  onClick={() => toggleFavorite(c)}
                  disabled={!canManage}
                  className="text-muted-foreground hover:text-amber-500 disabled:cursor-not-allowed"
                  title={c.is_favorite ? 'Remover favorita' : 'Marcar favorita'}
                >
                  <Star
                    size={16}
                    fill={c.is_favorite ? 'currentColor' : 'none'}
                    className={c.is_favorite ? 'text-amber-500' : ''}
                  />
                </button>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-foreground">{c.name}</div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  ID {c.google_campaign_id}
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {c.channel_type ?? '—'}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    STATUS_BADGE[c.status] ?? 'bg-muted text-muted-foreground'
                  }`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {fmtBRL(c.daily_budget_brl)}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1 flex-wrap">
                  {c.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] font-semibold px-1.5 py-0.5 bg-primary/10 text-primary rounded"
                    >
                      <Tag size={9} className="inline mr-0.5" />
                      {t}
                    </span>
                  ))}
                  {c.tags.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex gap-1">
                  <button
                    onClick={() => openBudgetModal(c)}
                    disabled={!canManage || actingId === c.id}
                    title="Editar orçamento"
                    className="p-1.5 rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => pauseOrResume(c)}
                    disabled={!canManage || actingId === c.id || c.status === 'REMOVED'}
                    title={c.status === 'PAUSED' ? 'Reativar' : 'Pausar'}
                    className="p-1.5 rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                  >
                    {c.status === 'PAUSED' ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {budgetEditId !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBudgetEditId(null);
          }}
        >
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-foreground mb-1">
              Atualizar orçamento diário
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Altera o orçamento da campanha no Google Ads. Em "modo conselheiro",
              o sistema só registra a sugestão sem aplicar.
            </p>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Novo valor diário (R$)
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={budgetInputBrl}
              onChange={(e) => setBudgetInputBrl(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm mb-3"
              autoFocus
            />
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Motivo (opcional, fica no audit log)
            </label>
            <input
              type="text"
              value={budgetReason}
              onChange={(e) => setBudgetReason(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm mb-3"
              placeholder="Ex: aumentar pra capturar mais leads em fim de mês"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <input
                type="checkbox"
                checked={budgetValidateOnly}
                onChange={(e) => setBudgetValidateOnly(e.target.checked)}
              />
              Modo conselheiro (validar sem aplicar)
            </label>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setBudgetEditId(null)}
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={submitBudget}
                disabled={actingId === budgetEditId}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actingId === budgetEditId ? 'Enviando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
