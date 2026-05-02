'use client';

import { useEffect, useState } from 'react';
import {
  Globe,
  Loader2,
  Sparkles,
  Gauge,
  X,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface LandingPage {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  pagespeed_mobile: number;
  pagespeed_desktop: number;
  lcp_ms: number | null;
  cls_x100: number | null;
  inp_ms: number | null;
  last_pagespeed_at: string | null;
  last_analyzed_at: string | null;
  has_analysis: boolean;
  clicks_30d: number;
  conversions_30d: number;
  created_at: string;
}

interface AnalysisIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'OAB' | 'CRO' | 'PERFORMANCE' | 'COPY' | 'UX';
  title: string;
  suggestion: string;
}

interface AnalysisResult {
  summary: string;
  score_cro: number;
  issues: AnalysisIssue[];
  model: string;
  analyzed_at: string;
}

const SEVERITY_STYLE: Record<
  AnalysisIssue['severity'],
  { color: string; icon: LucideIcon; label: string }
> = {
  CRITICAL: {
    color: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
    icon: AlertCircle,
    label: 'Crítico',
  },
  HIGH: {
    color:
      'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
    icon: AlertTriangle,
    label: 'Alto',
  },
  MEDIUM: {
    color:
      'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    icon: Info,
    label: 'Médio',
  },
  LOW: {
    color: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
    icon: Info,
    label: 'Baixo',
  },
};

const CATEGORY_LABEL: Record<AnalysisIssue['category'], string> = {
  OAB: 'OAB',
  CRO: 'Conversão',
  PERFORMANCE: 'Performance',
  COPY: 'Copy',
  UX: 'UX',
};

type ApiError = {
  response?: {
    data?: {
      message?: string;
    };
  };
};

function getApiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as ApiError)?.response?.data?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function pageSpeedColor(score: number): string {
  if (score === 0) return 'text-muted-foreground';
  if (score < 50) return 'text-red-500';
  if (score < 90) return 'text-amber-500';
  return 'text-emerald-500';
}

function pageSpeedBg(score: number): string {
  if (score === 0) return 'bg-muted';
  if (score < 50) return 'bg-red-500';
  if (score < 90) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function LandingPagesTab({ canManage }: { canManage: boolean }) {
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState<{
    page: LandingPage;
    result: AnalysisResult;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<LandingPage[]>('/trafego/landing-pages');
      setPages(data);
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Erro ao listar Landing Pages.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshPageSpeed(p: LandingPage) {
    if (!canManage) return;
    setActingId(p.id);
    try {
      await api.post(`/trafego/landing-pages/${p.id}/pagespeed`);
      showSuccess('PageSpeed atualizado.');
      await load();
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Falha ao rodar PageSpeed Insights.'));
    } finally {
      setActingId(null);
    }
  }

  async function analyze(p: LandingPage) {
    if (!canManage) return;
    setActingId(p.id);
    try {
      const { data } = await api.post<{
        page: { id: string; url: string; last_analyzed_at: string };
        analysis: AnalysisResult;
      }>(`/trafego/landing-pages/${p.id}/analyze`);
      showSuccess(
        `IA analisou ${data.analysis.issues.length} problemas em ${data.analysis.model}`,
      );
      setAnalysisOpen({ page: p, result: data.analysis });
      await load();
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Falha na análise IA.'));
    } finally {
      setActingId(null);
    }
  }

  async function viewLastAnalysis(p: LandingPage) {
    setActingId(p.id);
    try {
      const { data } = await api.get<{ analysis: AnalysisResult }>(
        `/trafego/landing-pages/${p.id}`,
      );
      if (!data?.analysis) {
        showError('Esta LP ainda não foi analisada.');
        return;
      }
      setAnalysisOpen({ page: p, result: data.analysis as AnalysisResult });
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, 'Falha ao buscar análise.'));
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Globe size={18} className="text-primary" />
            Landing Pages
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Detectadas automaticamente pelas URLs finais dos anúncios sincronizados.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 size={28} className="animate-spin mb-2" />
          <p className="text-sm">Carregando Landing Pages...</p>
        </div>
      ) : pages.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Globe size={40} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="text-base font-bold text-foreground mb-1">
            Nenhuma landing page detectada
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Rode uma sincronização do Google Ads para importar os anúncios. As
            URLs finais aparecerão aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pages.map((p) => (
            <LandingPageCard
              key={p.id}
              page={p}
              canManage={canManage}
              actingId={actingId}
              onRefreshPageSpeed={() => refreshPageSpeed(p)}
              onAnalyze={() => analyze(p)}
              onViewAnalysis={() => viewLastAnalysis(p)}
            />
          ))}
        </div>
      )}

      {analysisOpen && (
        <AnalysisModal
          page={analysisOpen.page}
          result={analysisOpen.result}
          onClose={() => setAnalysisOpen(null)}
        />
      )}
    </div>
  );
}

function LandingPageCard({
  page,
  canManage,
  actingId,
  onRefreshPageSpeed,
  onAnalyze,
  onViewAnalysis,
}: {
  page: LandingPage;
  canManage: boolean;
  actingId: string | null;
  onRefreshPageSpeed: () => void;
  onAnalyze: () => void;
  onViewAnalysis: () => void;
}) {
  const acting = actingId === page.id;
  const lcpDisplay = page.lcp_ms ? `${(page.lcp_ms / 1000).toFixed(1)}s` : '—';
  const clsDisplay =
    page.cls_x100 !== null ? (page.cls_x100 / 100).toFixed(2) : '—';
  const inpDisplay = page.inp_ms ? `${page.inp_ms}ms` : '—';

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-foreground hover:underline truncate"
              >
                {page.title ?? page.url}
              </a>
              <ExternalLink size={11} className="text-muted-foreground" />
            </div>
            <p
              className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono"
              title={page.url}
            >
              {page.url}
            </p>
            {page.campaign_name && (
              <p className="text-[11px] text-violet-700 dark:text-violet-400 mt-0.5">
                ↳ {page.campaign_name}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-3 border-b border-border">
        <PageSpeedScore label="Mobile" score={page.pagespeed_mobile} />
        <PageSpeedScore label="Desktop" score={page.pagespeed_desktop} />
      </div>

      <div className="px-4 py-3 grid grid-cols-3 gap-2 text-center text-[11px] border-b border-border">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">
            LCP
          </div>
          <div
            className={`font-bold tabular-nums ${
              !page.lcp_ms
                ? 'text-muted-foreground'
                : page.lcp_ms > 4000
                  ? 'text-red-500'
                  : page.lcp_ms > 2500
                    ? 'text-amber-500'
                    : 'text-emerald-500'
            }`}
          >
            {lcpDisplay}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">
            CLS
          </div>
          <div
            className={`font-bold tabular-nums ${
              page.cls_x100 === null
                ? 'text-muted-foreground'
                : page.cls_x100 > 25
                  ? 'text-red-500'
                  : page.cls_x100 > 10
                    ? 'text-amber-500'
                    : 'text-emerald-500'
            }`}
          >
            {clsDisplay}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">
            INP
          </div>
          <div
            className={`font-bold tabular-nums ${
              !page.inp_ms
                ? 'text-muted-foreground'
                : page.inp_ms > 500
                  ? 'text-red-500'
                  : page.inp_ms > 200
                    ? 'text-amber-500'
                    : 'text-emerald-500'
            }`}
          >
            {inpDisplay}
          </div>
        </div>
      </div>

      <div className="p-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {page.last_pagespeed_at
            ? `PageSpeed: ${new Date(page.last_pagespeed_at).toLocaleString('pt-BR')}`
            : 'Sem PageSpeed ainda'}
        </div>
        {canManage && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onRefreshPageSpeed}
              disabled={acting}
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-card hover:bg-accent border border-border disabled:opacity-50"
              title="Rodar PageSpeed Insights"
            >
              {acting ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Gauge size={11} />
              )}
              PageSpeed
            </button>
            {page.has_analysis ? (
              <button
                type="button"
                onClick={onViewAnalysis}
                disabled={acting}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-700 disabled:opacity-50"
              >
                <Sparkles size={11} />
                Ver análise
              </button>
            ) : (
              <button
                type="button"
                onClick={onAnalyze}
                disabled={acting}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                title="Analisar com IA"
              >
                {acting ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Sparkles size={11} />
                )}
                Analisar com IA
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PageSpeedScore({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        PageSpeed {label}
      </div>
      <div className="flex items-center gap-2">
        <div
          className={`text-2xl font-bold tabular-nums ${pageSpeedColor(score)}`}
        >
          {score === 0 ? '—' : score}
        </div>
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${pageSpeedBg(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function AnalysisModal({
  page,
  result,
  onClose,
}: {
  page: LandingPage;
  result: AnalysisResult;
  onClose: () => void;
}) {
  // Ordenar por severidade (CRITICAL > HIGH > MEDIUM > LOW)
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...result.issues].sort(
    (a, b) => order[a.severity] - order[b.severity],
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={18} className="text-violet-600" />
              <h3 className="text-lg font-bold text-foreground">
                Análise IA — {page.title ?? page.url}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground truncate font-mono">
              {page.url}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {result.model} · {new Date(result.analyzed_at).toLocaleString('pt-BR')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 border-b border-border bg-violet-500/5">
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold tabular-nums text-violet-600">
              {result.score_cro}
            </div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Score CRO
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-violet-600 transition-all"
                  style={{ width: `${result.score_cro}%` }}
                />
              </div>
            </div>
          </div>
          <p className="text-sm text-foreground mt-3">{result.summary}</p>
        </div>

        <div className="p-5 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Issues identificados ({sorted.length})
          </h4>
          {sorted.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2
                size={32}
                className="mx-auto text-emerald-500 mb-2"
              />
              <p className="text-sm text-muted-foreground">
                Nenhum problema identificado pela IA.
              </p>
            </div>
          ) : (
            sorted.map((issue, idx) => {
              const sty = SEVERITY_STYLE[issue.severity];
              const Icon = sty.icon;
              return (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${sty.color}`}
                >
                  <div className="flex items-start gap-2">
                    <Icon size={14} className="shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          {sty.label}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {CATEGORY_LABEL[issue.category]}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground mb-1">
                        {issue.title}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {issue.suggestion}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
