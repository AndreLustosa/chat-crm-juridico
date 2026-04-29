'use client';

import { useEffect, useState } from 'react';
import { Star, Loader2, Inbox, Tag } from 'lucide-react';
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
