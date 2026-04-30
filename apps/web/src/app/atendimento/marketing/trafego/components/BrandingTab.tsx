'use client';

import { useEffect, useState } from 'react';
import {
  Loader2,
  Layers,
  Tv,
  Image as ImageIcon,
  Type,
  PlayCircle,
  Star,
  AlertTriangle,
  Calculator,
  Plus,
  RefreshCw,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

interface AssetGroup {
  id: string;
  google_asset_group_id: string;
  google_resource_name: string;
  name: string;
  status: string;
  ad_strength: string | null;
  primary_status: string | null;
  campaign: { id: string; name: string; channel_type: string | null };
  _count: { group_assets: number };
}

interface ReachForecast {
  id: string;
  name: string;
  status: 'PENDING' | 'READY' | 'ERROR';
  summary: any;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
}

const AD_STRENGTH_BADGE: Record<string, string> = {
  EXCELLENT: 'bg-emerald-500/15 text-emerald-700',
  GOOD: 'bg-emerald-500/10 text-emerald-600',
  AVERAGE: 'bg-amber-500/15 text-amber-700',
  POOR: 'bg-red-500/15 text-red-700',
  UNRATED: 'bg-zinc-500/15 text-zinc-600',
};

const PERFORMANCE_BADGE: Record<string, string> = {
  BEST: 'bg-emerald-500/15 text-emerald-700',
  GOOD: 'bg-sky-500/15 text-sky-700',
  LOW: 'bg-red-500/15 text-red-700',
  LEARNING: 'bg-amber-500/15 text-amber-700',
  PENDING: 'bg-zinc-500/15 text-zinc-600',
};

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(v);

const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR').format(Math.round(v));

// ──────────────────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────────────────

export function BrandingTab({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-6">
      <AssetGroupsCard />
      <ReachPlannerCard canManage={canManage} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Asset Groups (PMax + Demand Gen)
// ──────────────────────────────────────────────────────────────────────────

function AssetGroupsCard() {
  const [groups, setGroups] = useState<AssetGroup[]>([]);
  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<AssetGroup[]>('/trafego/asset-groups');
      setGroups(data);
    } catch {
      showError('Erro ao carregar asset groups.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleExpand(g: AssetGroup) {
    if (expanded[g.id]) {
      setExpanded((prev) => {
        const cp = { ...prev };
        delete cp[g.id];
        return cp;
      });
      return;
    }
    try {
      const { data } = await api.get<any>(
        `/trafego/campaigns/${g.campaign.id}/asset-groups`,
      );
      const found = (data as any[]).find((x) => x.id === g.id);
      setExpanded((prev) => ({ ...prev, [g.id]: found?.group_assets ?? [] }));
    } catch {
      showError('Erro ao carregar assets.');
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-primary" />
          <h3 className="text-base font-bold text-foreground">
            Asset Groups (PMax / Demand Gen)
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Estruturas em PMax/Demand Gen. Cada grupo agrega headlines,
          imagens, vídeos e CTAs que o ML do Google combina.{' '}
          <strong>performance_label</strong> indica os criativos que valem
          a pena trocar (LOW = pouco usado).
        </p>
      </div>

      {loading ? (
        <div className="p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando asset groups...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="p-10 text-center">
          <Layers size={36} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhuma campanha PMax / Demand Gen sincronizada. Crie no Google
            Ads e aguarde o próximo sync.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((g) => (
            <div key={g.id}>
              <button
                onClick={() => toggleExpand(g)}
                className="w-full text-left p-4 hover:bg-accent/30 flex items-start gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <Layers size={16} className="text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold">{g.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md ${
                        g.status === 'ENABLED'
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-zinc-500/15 text-zinc-600'
                      }`}
                    >
                      {g.status}
                    </span>
                    {g.ad_strength && (
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-md ${
                          AD_STRENGTH_BADGE[g.ad_strength] ??
                          AD_STRENGTH_BADGE.UNRATED
                        }`}
                      >
                        Force: {g.ad_strength}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {g.campaign.name}
                    {g.campaign.channel_type && ` · ${g.campaign.channel_type}`}
                    {' · '}
                    {g._count.group_assets} asset(s)
                  </p>
                </div>
              </button>
              {expanded[g.id] && (
                <AssetGroupAssets assets={expanded[g.id]} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetGroupAssets({ assets }: { assets: any[] }) {
  if (assets.length === 0) {
    return (
      <div className="px-4 pb-4 text-[11px] text-muted-foreground">
        Sem assets associados.
      </div>
    );
  }
  return (
    <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-2">
      {assets.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-2 p-2 rounded-md border border-border bg-muted/20"
        >
          <FieldTypeIcon fieldType={a.field_type} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-0.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {a.field_type}
              </span>
              {a.performance_label && (
                <span
                  className={`text-[10px] px-1.5 py-0 rounded ${
                    PERFORMANCE_BADGE[a.performance_label] ??
                    PERFORMANCE_BADGE.PENDING
                  }`}
                >
                  {a.performance_label}
                </span>
              )}
            </div>
            <p className="text-xs text-foreground break-words">
              {a.asset_text ?? a.asset_url ?? '—'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldTypeIcon({ fieldType }: { fieldType: string }) {
  const icon = fieldType.includes('IMAGE') ? (
    <ImageIcon size={14} className="text-violet-600" />
  ) : fieldType.includes('VIDEO') ? (
    <PlayCircle size={14} className="text-red-600" />
  ) : fieldType.includes('LOGO') ? (
    <Star size={14} className="text-amber-600" />
  ) : (
    <Type size={14} className="text-sky-600" />
  );
  return <div className="mt-0.5 shrink-0">{icon}</div>;
}

// ──────────────────────────────────────────────────────────────────────────
// Reach Planner
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCTS = [
  { code: 'TRUEVIEW_IN_STREAM', label: 'TrueView in-stream (skippable)' },
  { code: 'BUMPER', label: 'Bumper (6s não-skippable)' },
  { code: 'NON_SKIPPABLE_IN_STREAM', label: 'Non-skippable (15-20s)' },
  { code: 'IN_FEED', label: 'In-feed (Discovery)' },
];

const DEFAULT_LOCATIONS = [
  { id: '1031307', label: 'Maceió' },
  { id: '20030', label: 'Brasil' },
  { id: '1031574', label: 'Recife' },
  { id: '1031307,1031574', label: 'Maceió + Recife' },
];

function ReachPlannerCard({ canManage }: { canManage: boolean }) {
  const [forecasts, setForecasts] = useState<ReachForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState(DEFAULT_LOCATIONS[0].id);
  const [productCode, setProductCode] = useState(DEFAULT_PRODUCTS[0].code);
  const [budgetBrl, setBudgetBrl] = useState(5000);
  const [durationDays, setDurationDays] = useState(30);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<ReachForecast[]>('/trafego/reach-forecasts');
      setForecasts(data);
    } catch {
      showError('Erro ao carregar forecasts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Poll mais rápido quando há PENDING
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function generate() {
    if (!canManage) return;
    setCreating(true);
    try {
      // location_ids pode vir como CSV (ex: "1031307,1031574")
      const location_ids = locationId.split(',').map((s) => s.trim()).filter(Boolean);
      await api.post('/trafego/reach-forecasts', {
        name: name || undefined,
        duration_days: durationDays,
        location_ids,
        products: [{ code: productCode, budget_brl: budgetBrl }],
      });
      showSuccess('Forecast em cálculo. Resultado em ~10s na lista.');
      setShowForm(false);
      setName('');
      setTimeout(() => load(), 10_000);
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Erro ao gerar forecast.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Tv size={18} className="text-primary" />
            <h3 className="text-base font-bold text-foreground">
              Reach Planner (Branding em Vídeo)
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Estima alcance e custo de campanhas YouTube/Demand Gen ANTES de
            criar. Útil pra justificar budget de branding.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card hover:bg-accent"
          >
            {showForm ? (
              <>
                <RefreshCw size={15} /> Fechar
              </>
            ) : (
              <>
                <Calculator size={15} /> Calcular
              </>
            )}
          </button>
        )}
      </div>

      {showForm && canManage && (
        <div className="p-4 border-b border-border bg-muted/20 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Nome (opcional)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Branding Maceió R$5k/mês"
              className="w-full px-3 py-2 text-sm rounded-md bg-card border border-border"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Localização
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-card border border-border"
            >
              {DEFAULT_LOCATIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Produto (formato YouTube)
            </label>
            <select
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-card border border-border"
            >
              {DEFAULT_PRODUCTS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Budget total (R$)
            </label>
            <input
              type="number"
              min={100}
              step={100}
              value={budgetBrl}
              onChange={(e) => setBudgetBrl(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded-md bg-card border border-border"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Duração (dias)
            </label>
            <input
              type="number"
              min={1}
              max={180}
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded-md bg-card border border-border"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              onClick={generate}
              disabled={creating}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
            >
              {creating ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plus size={15} />
              )}
              Gerar forecast
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando forecasts...</p>
        </div>
      ) : forecasts.length === 0 ? (
        <div className="p-10 text-center">
          <Tv size={36} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhum forecast ainda. Clique em "Calcular" pra gerar o primeiro.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-right px-4 py-3">Alcance (target)</th>
              <th className="text-right px-4 py-3">Impressões</th>
              <th className="text-right px-4 py-3">Custo total</th>
              <th className="text-right px-4 py-3">CPM</th>
              <th className="text-left px-4 py-3 w-28">Status</th>
            </tr>
          </thead>
          <tbody>
            {forecasts.map((f) => {
              const s = f.summary ?? {};
              return (
                <tr
                  key={f.id}
                  className="border-t border-border hover:bg-accent/30"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(f.created_at).toLocaleString('pt-BR')}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {fmtNum(s.on_target_reach ?? null)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {fmtNum(s.total_impressions ?? null)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {fmtBRL(s.total_cost_brl ?? null)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {fmtBRL(s.cpm_micros ? s.cpm_micros / 1_000_000 : null)}
                  </td>
                  <td className="px-4 py-3">
                    {f.status === 'PENDING' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600">
                        <Loader2 size={11} className="animate-spin" />
                        Calculando
                      </span>
                    ) : f.status === 'ERROR' ? (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-red-500/15 text-red-600"
                        title={f.error_message ?? ''}
                      >
                        <AlertTriangle size={11} />
                        Erro
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600">
                        Pronto
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
