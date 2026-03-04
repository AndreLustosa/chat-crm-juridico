'use client';

import { useState, useEffect, useCallback } from 'react';
import { DollarSign, Zap, RefreshCw, TrendingUp, Bot, MessageSquare, Brain, AlertTriangle, ExternalLink, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface OpenAiData {
  configured:          boolean;
  today_usd:           number | null;
  month_usd:           number | null;
  today_calls:         number | null;
  today_input_tokens:  number | null;
  today_output_tokens: number | null;
  month_calls:         number | null;
  month_input_tokens:  number | null;
  month_output_tokens: number | null;
  byModel:    Array<{ model: string; input_tokens: number; output_tokens: number; total_tokens: number; calls: number; cached_tokens: number; cost_usd: number }> | null;
  last7Days:  Array<{ date: string; cost_usd: number }> | null;
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
  usd_to_brl: number;
  openai:    OpenAiData;
  today:     LocalSummary;
  month:     LocalSummary;
  byModel:   ModelLocal[];
  byType:    TypeLocal[];
  last7Days: DayLocal[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(val: number | null | undefined, d = 4): string {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0.0000';
  if (n < 0.0001) return `$${n.toFixed(7)}`;
  if (n < 0.01)   return `$${n.toFixed(5)}`;
  return `$${n.toFixed(d)}`;
}

function fmtTokens(val: number | null | undefined): string {
  const n = Number(val) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtBrl(usd: number | null | undefined, rate: number): string {
  const n = Number(usd);
  if (!Number.isFinite(n) || n === 0) return 'R$\u00A00,00';
  const brl = n * rate;
  return brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function typeLabel(callType: string): { label: string; icon: React.ElementType; color: string } {
  const map: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    chat:    { label: 'Chat principal',    icon: MessageSquare, color: 'text-primary bg-primary/10 border-primary/20' },
    memory:  { label: 'Memória / resumo',  icon: Brain,         color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
    whisper: { label: 'Transcrição (voz)', icon: Zap,           color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  };
  return map[callType] ?? { label: callType, icon: Zap, color: 'text-muted-foreground bg-muted border-border' };
}

function safeMax(...values: number[]): number {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : 1;
}

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
      const res = await api.get<AiCosts>('/settings/ai-costs');
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
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl p-4 text-sm font-semibold">
            {error || 'Erro desconhecido'}
          </div>
        </div>
      </div>
    );
  }

  const rate       = data.usd_to_brl ?? 5.80;
  const openai     = data.openai   ?? { configured: false, today_usd: null, month_usd: null, byModel: null, last7Days: null, error: null };
  const today      = data.today    ?? { cost_usd: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, calls: 0 };
  const month      = data.month    ?? { cost_usd: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, calls: 0 };
  const byType     = data.byType   ?? [];
  const last7Days  = data.last7Days ?? [];
  const localModels = data.byModel ?? [];

  const hasOpenAi   = openai.configured && !openai.error && openai.month_usd !== null;
  const openaiDays  = hasOpenAi && (openai.last7Days?.length ?? 0) > 0 ? openai.last7Days! : null;
  const openaiModels = hasOpenAi && (openai.byModel?.length ?? 0) > 0 ? openai.byModel! : null;

  const chartDays = openaiDays ?? last7Days;
  const maxBar = safeMax(...chartDays.map((d) => d.cost_usd), 0.000001);

  const maxLocalModel = safeMax(...localModels.map((m) => m.cost_usd), 0.000001);

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
          <button onClick={fetchData}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            title="Atualizar">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6">

        {/* ── Admin Key não configurada ────────────────────────────────── */}
        {!openai.configured && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-400">Admin Key não configurada</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Configure em Ajustes IA para ver os valores exatos cobrados pela OpenAI.
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

        {/* ── Erro na Admin Key ────────────────────────────────────────── */}
        {openai.configured && openai.error && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold text-red-400">Erro ao consultar a OpenAI</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">{openai.error}</p>
            </div>
          </div>
        )}

        {/* ── Cards Hoje / Mês ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">

          <div className="bg-card rounded-2xl border border-border shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <DollarSign size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Hoje</p>
                  <p className="text-[11px] text-muted-foreground">
                    {hasOpenAi ? (openai.today_calls ?? 0) : today.calls} chamadas
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-foreground tabular-nums">
                  {hasOpenAi ? fmtUsd(openai.today_usd) : fmtUsd(today.cost_usd)}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {hasOpenAi ? fmtBrl(openai.today_usd, rate) : fmtBrl(today.cost_usd, rate)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Total tk</p>
                <p className="text-sm font-bold">
                  {fmtTokens(hasOpenAi ? ((openai.today_input_tokens ?? 0) + (openai.today_output_tokens ?? 0)) : today.total_tokens)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Entrada</p>
                <p className="text-sm font-bold">
                  {fmtTokens(hasOpenAi ? (openai.today_input_tokens ?? 0) : today.prompt_tokens)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Saída</p>
                <p className="text-sm font-bold">
                  {fmtTokens(hasOpenAi ? (openai.today_output_tokens ?? 0) : today.completion_tokens)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <TrendingUp size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Este mês</p>
                  <p className="text-[11px] text-muted-foreground">
                    {hasOpenAi ? (openai.month_calls ?? 0) : month.calls} chamadas
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-foreground tabular-nums">
                  {hasOpenAi ? fmtUsd(openai.month_usd) : fmtUsd(month.cost_usd)}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {hasOpenAi ? fmtBrl(openai.month_usd, rate) : fmtBrl(month.cost_usd, rate)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Total tk</p>
                <p className="text-sm font-bold">
                  {fmtTokens(hasOpenAi ? ((openai.month_input_tokens ?? 0) + (openai.month_output_tokens ?? 0)) : month.total_tokens)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Entrada</p>
                <p className="text-sm font-bold">
                  {fmtTokens(hasOpenAi ? (openai.month_input_tokens ?? 0) : month.prompt_tokens)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Saída</p>
                <p className="text-sm font-bold">
                  {fmtTokens(hasOpenAi ? (openai.month_output_tokens ?? 0) : month.completion_tokens)}
                </p>
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
                  {hasOpenAi ? 'Custo via OpenAI (Admin Key)' : 'Estimativa local'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-end gap-2 h-32">
              {chartDays.map((day, idx) => {
                const cost = Number(day.cost_usd) || 0;
                const pct  = Number.isFinite(cost / maxBar) ? (cost / maxBar) * 100 : 0;
                const dateStr = day.date ?? '';
                const shortDate = dateStr
                  ? new Date(dateStr + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                  : '';
                const localDay = last7Days.find((d) => d.date === dateStr);
                return (
                  <div key={dateStr || idx} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="relative w-full flex justify-center">
                      <div className="absolute bottom-full mb-1.5 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                        <div className="bg-popover border border-border text-foreground text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap">
                          <p className="font-black">{fmtUsd(cost, 5)} <span className="text-muted-foreground font-normal">/ {fmtBrl(cost, rate)}</span></p>
                          {localDay && (
                            <p className="text-muted-foreground">
                              {fmtTokens(localDay.total_tokens)} tokens · {localDay.calls} calls
                            </p>
                          )}
                        </div>
                        <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 -mt-1.5" />
                      </div>
                      <div
                        className="w-full rounded-t-lg bg-primary/60 hover:bg-primary transition-colors"
                        style={{ height: `${Math.max(pct, cost > 0 ? 4 : 0)}%`, minHeight: cost > 0 ? '4px' : '0' }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{shortDate}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Por modelo + Por tipo ────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">

          {/* Por modelo */}
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
            </div>

            {openaiModels ? (
              /* OpenAI — tokens + custo estimado por modelo */
              <div className="divide-y divide-border/40">
                {(() => {
                  const maxTk = safeMax(...openaiModels.map((x) => x.total_tokens ?? 0), 1);
                  return openaiModels.map((m) => {
                    const pct = Number.isFinite((m.total_tokens ?? 0) / maxTk)
                      ? ((m.total_tokens ?? 0) / maxTk) * 100 : 0;
                    return (
                      <div key={m.model ?? 'unknown'} className="px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground font-mono truncate max-w-[55%]">{m.model}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-muted-foreground">
                              {m.calls} calls · {fmtTokens(m.input_tokens)}↑ {fmtTokens(m.output_tokens)}↓
                              {(m.cached_tokens ?? 0) > 0 && (
                                <span className="text-emerald-500"> · {fmtTokens(m.cached_tokens)} cached</span>
                              )}
                            </span>
                            {(m.cost_usd ?? 0) > 0 && (
                              <span className="text-right">
                                <span className="text-xs font-bold text-foreground tabular-nums block">{fmtUsd(m.cost_usd)}</span>
                                <span className="text-[10px] text-muted-foreground tabular-nums block">{fmtBrl(m.cost_usd, rate)}</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              /* Fallback local */
              <div className="divide-y divide-border/40">
                {localModels.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">Nenhum dado ainda.</p>
                ) : (
                  localModels.map((m) => {
                    const pct = Number.isFinite(m.cost_usd / maxLocalModel)
                      ? (m.cost_usd / maxLocalModel) * 100 : 0;
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
                  const { label, icon: Icon, color } = typeLabel(t.call_type);
                  return (
                    <div key={t.call_type} className="px-4 py-3 flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold shrink-0 ${color}`}>
                        <Icon size={13} />{label}
                      </span>
                      <div className="flex-1 text-right">
                        <p className="text-xs font-bold text-foreground tabular-nums">{fmtUsd(t.cost_usd)}</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">{fmtBrl(t.cost_usd, rate)}</p>
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
            <p>
              Tokens via <code className="font-mono text-primary">/v1/organization/usage/completions</code> (Admin Key).
              Custos calculados pela tabela de preços oficial da OpenAI por modelo.
              O breakdown por tipo de chamada vem do rastreamento local.
            </p>
          ) : (
            <p>
              Configure a <strong>Admin Key</strong> em{' '}
              <button onClick={() => router.push('/atendimento/settings/ai')} className="text-primary hover:underline font-semibold">
                Ajustes IA
              </button>{' '}
              para ver os tokens e custos da organização OpenAI.
            </p>
          )}
          <p>
            Cotação USD/BRL: <span className="font-mono text-foreground">R$\u00A0{rate.toFixed(2)}</span>{' '}
            · Fatura oficial:{' '}
            <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer"
              className="font-mono text-primary hover:underline">
              platform.openai.com/usage
            </a>
          </p>
        </div>

      </div>
    </div>
  );
}
