'use client';

import { useState, useEffect, useCallback } from 'react';
import { DollarSign, Zap, RefreshCw, TrendingUp, Bot, MessageSquare, Brain, CheckCircle2, AlertTriangle, ExternalLink, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface OpenAiData {
  configured: boolean;
  today_usd:  number | null;
  month_usd:  number | null;
  byModel:    Array<{ model: string; input_tokens: number; output_tokens: number; total_tokens: number; calls: number; cached_tokens: number }>;
  last7Days:  Array<{ date: string; cost_usd: number }>;
  error:      string | null;
}

interface LocalSummary {
  cost_usd: number; total_tokens: number;
  prompt_tokens: number; completion_tokens: number; calls: number;
}
interface ModelLocal  { model: string; cost_usd: number; total_tokens: number; calls: number; }
interface TypeLocal   { call_type: string; cost_usd: number; total_tokens: number; calls: number; }
interface DayLocal    { date: string; cost_usd: number; total_tokens: number; calls: number; }

interface AiCosts {
  openai:    OpenAiData;
  today:     LocalSummary;
  month:     LocalSummary;
  byModel:   ModelLocal[];
  byType:    TypeLocal[];
  last7Days: DayLocal[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(val: number, d = 4) {
  if (val === 0)    return '$0.0000';
  if (val < 0.0001) return `$${val.toFixed(7)}`;
  if (val < 0.01)   return `$${val.toFixed(5)}`;
  return `$${val.toFixed(d)}`;
}

function fmtTokens(val: number) {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000)     return `${(val / 1_000).toFixed(1)}k`;
  return String(val);
}

const TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  chat:    { label: 'Chat principal',    icon: <MessageSquare size={13} />, color: 'text-primary bg-primary/10 border-primary/20' },
  memory:  { label: 'Memória / resumo',  icon: <Brain size={13} />,         color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  whisper: { label: 'Transcrição (voz)', icon: <Zap size={13} />,           color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
};

// ── Componente ───────────────────────────────────────────────────────────────

export default function AiCostsPage() {
  const router = useRouter();
  const [data, setData] = useState<AiCosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/settings/ai-costs');
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
        <header className="px-8 mb-6 shrink-0">
          <h1 className="text-2xl font-bold">Custos de IA</h1>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="animate-spin text-muted-foreground" size={24} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col pt-8 bg-background">
        <header className="px-8 mb-6"><h1 className="text-2xl font-bold">Custos de IA</h1></header>
        <div className="px-8">
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl p-4 text-sm font-semibold">{error}</div>
        </div>
      </div>
    );
  }

  const { openai, today, month, byType, last7Days } = data;
  const hasOpenAi  = openai.configured && !openai.error && openai.month_usd !== null;
  const hasLocalData = month.calls > 0;

  // Gráfico usa dados reais da OpenAI (por custo) quando disponível, senão dados locais
  const chartDays = hasOpenAi && openai.last7Days?.length
    ? openai.last7Days
    : last7Days;
  const maxBar = Math.max(...chartDays.map((d) => d.cost_usd), 0.000001);

  // Breakdown por modelo usa dados da OpenAI (tokens) quando disponível
  const modelRows = hasOpenAi && openai.byModel?.length ? openai.byModel : null;
  const localModelRows = data.byModel;
  const maxLocalModel = Math.max(...localModelRows.map((m) => m.cost_usd), 0.000001);

  return (
    <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
      <header className="px-8 mb-6 shrink-0 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Custos de IA</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            {hasOpenAi
              ? 'Valores reais cobrados pela OpenAI (Admin Key ativa).'
              : 'Configure a Admin Key em Ajustes IA para ver valores exatos da OpenAI.'}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors px-2 py-1.5 rounded-lg hover:bg-muted/50">
            Ver na OpenAI <ExternalLink size={11} />
          </a>
          <button onClick={fetchData} className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all" title="Atualizar">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6">

        {/* ── Banner Admin Key não configurada ─────────────────────────── */}
        {!openai.configured && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-400">Admin Key não configurada</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Para ver os valores exatos cobrados pela OpenAI, configure a Admin Key em Ajustes IA.
                Crie em <span className="font-mono text-primary text-[11px]">platform.openai.com/settings/organization/admin-keys</span>
              </p>
            </div>
            <button
              onClick={() => router.push('/atendimento/settings/ai')}
              className="flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg hover:bg-primary/20 transition-all shrink-0"
            >
              <Settings size={12} /> Ajustes IA
            </button>
          </div>
        )}

        {/* ── Banner erro na Admin Key ──────────────────────────────────── */}
        {openai.configured && openai.error && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold text-red-400">Erro ao consultar a OpenAI</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">{openai.error}</p>
            </div>
          </div>
        )}

        {/* ── Cards de custo: Hoje / Mês ────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">

          {/* Hoje */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <DollarSign size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Hoje</p>
                  <p className="text-[11px] text-muted-foreground">{today.calls} chamadas</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-foreground tabular-nums">
                  {hasOpenAi ? fmtUsd(openai.today_usd ?? 0) : fmtUsd(today.cost_usd)}
                </p>
                {hasOpenAi && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                    <CheckCircle2 size={9} /> REAL
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Total tk</p>
                <p className="text-sm font-bold text-foreground">{fmtTokens(today.total_tokens)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Entrada</p>
                <p className="text-sm font-bold text-foreground">{fmtTokens(today.prompt_tokens)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Saída</p>
                <p className="text-sm font-bold text-foreground">{fmtTokens(today.completion_tokens)}</p>
              </div>
            </div>
          </div>

          {/* Mês */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <TrendingUp size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Este mês</p>
                  <p className="text-[11px] text-muted-foreground">{month.calls} chamadas</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-foreground tabular-nums">
                  {hasOpenAi ? fmtUsd(openai.month_usd ?? 0) : fmtUsd(month.cost_usd)}
                </p>
                {hasOpenAi && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                    <CheckCircle2 size={9} /> REAL
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Total tk</p>
                <p className="text-sm font-bold text-foreground">{fmtTokens(month.total_tokens)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Entrada</p>
                <p className="text-sm font-bold text-foreground">{fmtTokens(month.prompt_tokens)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Saída</p>
                <p className="text-sm font-bold text-foreground">{fmtTokens(month.completion_tokens)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Gráfico 7 dias ───────────────────────────────────────────── */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <TrendingUp size={16} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Últimos 7 dias</h4>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  {hasOpenAi ? 'Custo real cobrado (OpenAI)' : 'Estimativa local'}
                </p>
              </div>
            </div>
            {hasOpenAi && (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 size={9} /> REAL
              </span>
            )}
          </div>
          <div className="p-5">
            <div className="flex items-end gap-2 h-32">
              {chartDays.map((day) => {
                const pct = (day.cost_usd / maxBar) * 100;
                const shortDate = new Date(day.date + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                const localDay = last7Days.find((d) => d.date === day.date);
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="relative w-full flex justify-center">
                      <div className="absolute bottom-full mb-1.5 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                        <div className="bg-popover border border-border text-foreground text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap">
                          <p className="font-black">{fmtUsd(day.cost_usd, 5)}</p>
                          {localDay && <p className="text-muted-foreground">{fmtTokens(localDay.total_tokens)} tokens · {localDay.calls} calls</p>}
                        </div>
                        <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 -mt-1.5" />
                      </div>
                      <div
                        className="w-full rounded-t-lg bg-primary/60 hover:bg-primary transition-colors"
                        style={{ height: `${Math.max(pct, day.cost_usd > 0 ? 4 : 0)}%`, minHeight: day.cost_usd > 0 ? '4px' : '0' }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{shortDate}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Por modelo ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between bg-primary/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bot size={16} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">Por modelo</h4>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Este mês</p>
                </div>
              </div>
              {hasOpenAi && modelRows?.length ? (
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 size={9} /> REAL
                </span>
              ) : null}
            </div>

            {/* OpenAI real: tokens por modelo */}
            {hasOpenAi && modelRows?.length ? (
              <div className="divide-y divide-border/40">
                {modelRows.map((m) => {
                  const maxTk = Math.max(...modelRows.map((x) => x.total_tokens), 1);
                  const pct = (m.total_tokens / maxTk) * 100;
                  return (
                    <div key={m.model} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground font-mono">{m.model}</span>
                        <div className="flex items-center gap-2 text-right">
                          <span className="text-[10px] text-muted-foreground">
                            {m.calls} calls · {fmtTokens(m.input_tokens)}↑ {fmtTokens(m.output_tokens)}↓
                            {m.cached_tokens > 0 && <span className="text-emerald-500"> · {fmtTokens(m.cached_tokens)} cached</span>}
                          </span>
                        </div>
                      </div>
                      <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Fallback local: estimativa */
              <div className="divide-y divide-border/40">
                {localModelRows.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">Nenhum dado ainda.</p>
                ) : (
                  localModelRows.map((m) => {
                    const pct = (m.cost_usd / maxLocalModel) * 100;
                    return (
                      <div key={m.model} className="px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground font-mono">{m.model}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">{m.calls} calls · {fmtTokens(m.total_tokens)} tk</span>
                            <span className="text-xs font-bold text-foreground tabular-nums">{fmtUsd(m.cost_usd)}</span>
                          </div>
                        </div>
                        <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                          <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Por tipo de chamada */}
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border flex items-center gap-3 bg-primary/5">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Zap size={16} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Por tipo de chamada</h4>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Este mês</p>
              </div>
            </div>
            <div className="divide-y divide-border/40">
              {byType.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Nenhum dado ainda.</p>
              ) : (
                byType.map((t) => {
                  const meta = TYPE_LABELS[t.call_type] ?? { label: t.call_type, icon: <Zap size={13} />, color: 'text-muted-foreground bg-muted border-border' };
                  return (
                    <div key={t.call_type} className="px-4 py-3 flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold shrink-0 ${meta.color}`}>
                        {meta.icon}{meta.label}
                      </span>
                      <div className="flex-1 text-right">
                        <p className="text-xs font-bold text-foreground tabular-nums">{fmtUsd(t.cost_usd)}</p>
                        <p className="text-[10px] text-muted-foreground">{t.calls} calls · {fmtTokens(t.total_tokens)} tk</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Nota ─────────────────────────────────────────────────────── */}
        <div className="bg-card/50 rounded-2xl border border-border p-4 text-[12px] text-muted-foreground space-y-1.5">
          <p className="font-bold text-foreground text-xs">ℹ️ Fontes de dados</p>
          {hasOpenAi ? (
            <p><span className="text-emerald-400 font-semibold">Hoje</span> e <span className="text-emerald-400 font-semibold">Este mês</span> vêm da API real da OpenAI (<code className="font-mono text-primary">/v1/organization/costs</code>). O breakdown por tipo de chamada (chat / memória) vem do rastreamento local.</p>
          ) : (
            <p>Configure a <strong>Admin Key</strong> em <button onClick={() => router.push('/atendimento/settings/ai')} className="text-primary hover:underline">Ajustes IA</button> para ver os valores reais cobrados pela OpenAI. Sem ela, os dados são estimativas calculadas com base nos tokens exatos capturados em cada chamada.</p>
          )}
          <p>Fatura oficial: <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">platform.openai.com/usage</a></p>
        </div>

      </div>
    </div>
  );
}
