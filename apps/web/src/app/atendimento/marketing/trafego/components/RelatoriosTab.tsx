'use client';

import { useEffect, useState } from 'react';
import { FileDown, Loader2, FileText, Calendar } from 'lucide-react';
import api, { API_BASE_URL } from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface ReportHistory {
  id: string;
  kind: string;
  display_name: string;
  generated_at: string;
  params: { from: string; to: string; label?: string };
  user: { id: string; name: string } | null;
}

const PRESETS = [
  { id: 'last_7d', label: 'Últimos 7 dias', days: 7 },
  { id: 'last_30d', label: 'Últimos 30 dias', days: 30 },
  { id: 'this_month', label: 'Este mês' },
  { id: 'last_month', label: 'Mês passado' },
  { id: 'custom', label: 'Personalizado' },
] as const;

type PresetId = (typeof PRESETS)[number]['id'];

export function RelatoriosTab({ canManage }: { canManage: boolean }) {
  const [history, setHistory] = useState<ReportHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [preset, setPreset] = useState<PresetId>('last_30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  async function loadHistory() {
    try {
      const { data } = await api.get<ReportHistory[]>('/trafego/reports?limit=20');
      setHistory(data);
    } catch {
      // silencioso — histórico vazio na primeira vez é normal
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  function rangeForPreset(p: PresetId): { from: string; to: string; label: string } | null {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    if (p === 'last_7d') {
      const from = new Date(today);
      from.setUTCDate(from.getUTCDate() - 7);
      return { from: fmt(from), to: fmt(today), label: 'Últimos 7 dias' };
    }
    if (p === 'last_30d') {
      const from = new Date(today);
      from.setUTCDate(from.getUTCDate() - 30);
      return { from: fmt(from), to: fmt(today), label: 'Últimos 30 dias' };
    }
    if (p === 'this_month') {
      const from = new Date(today);
      from.setUTCDate(1);
      const monthName = new Intl.DateTimeFormat('pt-BR', {
        month: 'long',
        year: 'numeric',
      }).format(today);
      return { from: fmt(from), to: fmt(today), label: monthName };
    }
    if (p === 'last_month') {
      const from = new Date(today);
      from.setUTCDate(1);
      from.setUTCMonth(from.getUTCMonth() - 1);
      const to = new Date(today);
      to.setUTCDate(0); // último dia do mês anterior
      const monthName = new Intl.DateTimeFormat('pt-BR', {
        month: 'long',
        year: 'numeric',
      }).format(from);
      return { from: fmt(from), to: fmt(to), label: monthName };
    }
    if (p === 'custom') {
      if (!customFrom || !customTo) return null;
      return {
        from: customFrom,
        to: customTo,
        label: `${customFrom} a ${customTo}`,
      };
    }
    return null;
  }

  async function generate() {
    if (!canManage && preset !== 'last_7d' && preset !== 'last_30d') return;
    const range = rangeForPreset(preset);
    if (!range) {
      showError('Preencha as datas customizadas (de/até).');
      return;
    }

    setGenerating(true);
    try {
      // Faz GET autenticado e baixa como blob
      const token = localStorage.getItem('token');
      const url = `${API_BASE_URL}/trafego/reports/generate?from=${range.from}&to=${range.to}&label=${encodeURIComponent(range.label)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Erro ${res.status}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `trafego_${range.from}_a_${range.to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      showSuccess('Relatório gerado e baixado.');
      // Recarrega histórico depois de ~1s pra incluir o novo
      setTimeout(loadHistory, 1500);
    } catch (e: any) {
      const msg = e?.message || 'Erro ao gerar relatório';
      showError(msg.slice(0, 200));
    } finally {
      setGenerating(false);
    }
  }

  async function downloadHistory(h: ReportHistory) {
    // Reaproveita params do histórico pra regenerar o mesmo PDF
    const { from, to, label } = h.params;
    setGenerating(true);
    try {
      const token = localStorage.getItem('token');
      const url = `${API_BASE_URL}/trafego/reports/generate?from=${from}&to=${to}${label ? `&label=${encodeURIComponent(label)}` : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const blob = await res.blob();
      const dl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dl;
      a.download = `trafego_${from}_a_${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(dl);
    } catch (e: any) {
      showError(e?.message || 'Erro ao baixar PDF');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ─── Gerador ───────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <FileText size={20} className="text-primary mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Gerar relatório PDF
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Snapshot completo: KPIs do período, performance por campanha,
              resumo diário.
            </p>
          </div>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                preset === p.id
                  ? 'border-primary bg-primary/10 text-primary font-semibold'
                  : 'border-border hover:bg-accent text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom dates */}
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                De
              </label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Até
              </label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        )}

        <button
          onClick={generate}
          disabled={generating}
          className="w-full sm:w-auto flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-4 py-2.5 rounded-lg shadow-md hover:opacity-90 disabled:opacity-50"
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <FileDown size={16} />
          )}
          Gerar e baixar PDF
        </button>
      </section>

      {/* ─── Histórico ─────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-muted-foreground" />
          <h3 className="text-sm font-bold text-foreground">
            Relatórios anteriores
          </h3>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" />
            Carregando...
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Nenhum relatório gerado ainda.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border hover:bg-accent/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {h.display_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Por {h.user?.name ?? '—'} ·{' '}
                    {new Date(h.generated_at).toLocaleString('pt-BR')}
                  </div>
                </div>
                <button
                  onClick={() => downloadHistory(h)}
                  disabled={generating}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border border-border bg-card hover:bg-accent disabled:opacity-50"
                >
                  <FileDown size={13} />
                  Baixar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
