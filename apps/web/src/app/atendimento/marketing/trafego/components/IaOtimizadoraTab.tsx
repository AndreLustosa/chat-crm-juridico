'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Sparkles,
  Loader2,
  Zap,
  CheckCircle2,
  Undo2,
  Eye,
  Settings,
  Bot,
  AlertTriangle,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type LoopKind = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'TRIGGERED';
type Action = 'EXECUTE' | 'SUGGEST' | 'BLOCK' | 'NOTIFY_ONLY' | 'FAILED';
type Feedback = 'APPROVED' | 'REVERTED' | 'IGNORED' | null;

interface Decision {
  id: string;
  loop_kind: LoopKind;
  decision_kind: string;
  resource_type: string | null;
  resource_name: string | null;
  confidence: string | null;
  reasons: unknown;
  inputs: unknown;
  action: Action;
  executed: boolean;
  mutate_log_id: string | null;
  human_feedback: Feedback;
  feedback_at: string | null;
  summary: string | null;
  created_at: string;
}

interface DecisionsResponse {
  items: Decision[];
  total: number;
  pending_count: number;
}

interface Policy {
  id: string;
  agent_enabled: boolean;
  mode: 'ADVISOR' | 'AUTONOMOUS';
  max_auto_actions_per_day: number;
  min_confidence_for_auto: string;
  auto_apply_negative_keywords: boolean;
  auto_apply_pause_disapproved: boolean;
  auto_apply_rsa_asset_recommendations: boolean;
  auto_apply_budget_changes: boolean;
  auto_apply_bidding_strategy_changes: boolean;
  max_budget_change_percent: string;
  max_budget_change_per_week: number;
  max_negatives_per_week: number;
  rollback_window_hours: number;
  notify_admin_email: boolean;
  notify_admin_whatsapp: boolean;
  notify_admin_inapp: boolean;
  escalation_hours: number;
  hourly_enabled: boolean;
  shadow_mode: boolean;
  daily_cron: string;
  weekly_cron: string;
  monthly_cron: string;
}

const KIND_LABEL: Record<string, string> = {
  PAUSE_AD_REPROVED: 'Pausar anúncio reprovado',
  CAMPAIGN_DEAD_ALERT: 'Campanha sem retorno',
  HIGH_CPL_WARNING: 'CPL acima do alvo',
  LOW_CTR_WARNING: 'CTR abaixo do alvo',
  ZERO_CONVERSIONS: 'Zero conversões',
  OVERSPEND: 'Gasto acima do orçamento',
  ADD_NEGATIVE_KEYWORD: 'Adicionar palavra negativa',
  BUDGET_INCREASE_SUGGESTION: 'Aumentar orçamento',
  AI_DECISIONS_AVAILABLE: 'Decisões disponíveis',
};

const ACTION_STYLE: Record<Action, { color: string; bg: string; label: string }> = {
  EXECUTE: { color: 'text-emerald-600', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'EXECUTADO' },
  SUGGEST: { color: 'text-sky-600', bg: 'bg-sky-500/10 border-sky-500/30', label: 'SUGESTÃO' },
  BLOCK: { color: 'text-red-600', bg: 'bg-red-500/10 border-red-500/30', label: 'BLOQUEADO' },
  NOTIFY_ONLY: { color: 'text-zinc-600', bg: 'bg-zinc-500/10 border-zinc-500/30', label: 'NOTIFICADO' },
  FAILED: { color: 'text-amber-600', bg: 'bg-amber-500/10 border-amber-500/30', label: 'FALHOU' },
};

export function IaOtimizadoraTab({ canManage }: { canManage: boolean }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'EXECUTED'>('PENDING');
  const [showPolicy, setShowPolicy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filter === 'PENDING') params.feedback = 'PENDING';
      else if (filter === 'EXECUTED') params.action = 'EXECUTE';
      const [decRes, polRes] = await Promise.all([
        api.get<DecisionsResponse>('/trafego/ai/decisions', { params }),
        api.get<Policy>('/trafego/ai/policy'),
      ]);
      setDecisions(decRes.data.items);
      setPendingCount(decRes.data.pending_count);
      setPolicy(polRes.data);
    } catch {
      showError('Erro ao carregar IA Otimizadora.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 60_000);
    return () => clearInterval(t);
  }, [loadAll]);

  async function trigger(loopKind: LoopKind = 'TRIGGERED') {
    if (!canManage) return;
    setRunning(true);
    try {
      await api.post('/trafego/ai/trigger', { loop_kind: loopKind });
      showSuccess(`Loop ${loopKind} enfileirado. Recarregando em 30s...`);
      setTimeout(() => loadAll(), 30_000);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao acionar IA';
      showError(msg);
    } finally {
      setRunning(false);
    }
  }

  async function feedback(d: Decision, fb: 'APPROVED' | 'REVERTED' | 'IGNORED') {
    if (!canManage) return;
    try {
      await api.post(`/trafego/ai/decisions/${d.id}/feedback`, {
        feedback: fb,
      });
      setDecisions((prev) => prev.filter((x) => x.id !== d.id));
      setPendingCount((c) => Math.max(0, c - 1));
      showSuccess('Feedback registrado.');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao registrar feedback';
      showError(msg);
    }
  }

  async function patchPolicy(patch: Partial<Policy>) {
    if (!canManage || !policy) return;
    try {
      const numericKeys = ['min_confidence_for_auto', 'max_budget_change_percent'];
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        payload[k] = numericKeys.includes(k) ? Number(v) : v;
      }
      const { data } = await api.patch<Policy>('/trafego/ai/policy', payload);
      setPolicy(data);
      showSuccess('Política da IA atualizada.');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao salvar política';
      showError(msg);
    }
  }

  return (
    <div>
      <Header
        canManage={canManage}
        running={running}
        pendingCount={pendingCount}
        agentEnabled={!!policy?.agent_enabled}
        onTrigger={() => trigger('TRIGGERED')}
        onTogglePolicy={() => setShowPolicy((v) => !v)}
      />

      {showPolicy && policy && (
        <PolicyPanel
          policy={policy}
          canManage={canManage}
          onChange={patchPolicy}
        />
      )}

      <FilterTabs filter={filter} setFilter={setFilter} pending={pendingCount} />

      {loading ? (
        <Loading />
      ) : decisions.length === 0 ? (
        <Empty filter={filter} agentEnabled={!!policy?.agent_enabled} />
      ) : (
        <DecisionList
          decisions={decisions}
          canManage={canManage}
          onFeedback={feedback}
        />
      )}
    </div>
  );
}

function Header({
  canManage,
  running,
  pendingCount,
  agentEnabled,
  onTrigger,
  onTogglePolicy,
}: {
  canManage: boolean;
  running: boolean;
  pendingCount: number;
  agentEnabled: boolean;
  onTrigger: () => void;
  onTogglePolicy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow">
          <Sparkles size={18} className="text-white" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            IA Otimizadora
            {agentEnabled ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-700">
                ON
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-500/10 border border-zinc-500/30 text-zinc-700">
                OFF
              </span>
            )}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} sugestão(ões) aguardando revisão`
              : 'Análise contínua das suas campanhas com supervisão humana'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {canManage && (
          <button
            onClick={onTogglePolicy}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card hover:bg-accent"
          >
            <Settings size={15} />
            Configurar
          </button>
        )}
        {canManage && (
          <button
            onClick={onTrigger}
            disabled={running || !agentEnabled}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
          >
            {running ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Zap size={15} />
            )}
            Avaliar agora
          </button>
        )}
      </div>
    </div>
  );
}

function FilterTabs({
  filter,
  setFilter,
  pending,
}: {
  filter: 'ALL' | 'PENDING' | 'EXECUTED';
  setFilter: (f: 'ALL' | 'PENDING' | 'EXECUTED') => void;
  pending: number;
}) {
  return (
    <div className="flex items-center gap-1 mb-3 text-xs">
      {(['PENDING', 'EXECUTED', 'ALL'] as const).map((f) => (
        <button
          key={f}
          onClick={() => setFilter(f)}
          className={`px-3 py-1.5 rounded-md font-semibold ${
            filter === f
              ? 'bg-violet-500/15 text-violet-700 border border-violet-500/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {f === 'PENDING'
            ? `Pendentes${pending > 0 ? ` (${pending})` : ''}`
            : f === 'EXECUTED'
              ? 'Executadas'
              : 'Todas'}
        </button>
      ))}
    </div>
  );
}

function Loading() {
  return (
    <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
      <Loader2 size={28} className="animate-spin mb-2" />
      <p className="text-sm">Carregando decisões da IA...</p>
    </div>
  );
}

function Empty({
  filter,
  agentEnabled,
}: {
  filter: 'ALL' | 'PENDING' | 'EXECUTED';
  agentEnabled: boolean;
}) {
  if (!agentEnabled) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <Bot size={36} className="mx-auto text-violet-500 mb-3" />
        <h3 className="text-base font-bold text-foreground mb-1">
          IA Otimizadora desativada
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Ative em <strong>Configurar</strong> pra começar a receber sugestões
          de otimização baseadas no comportamento das suas campanhas.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-card border border-border rounded-xl p-10 text-center">
      <CheckCircle2 size={36} className="mx-auto text-emerald-500 mb-2" />
      <p className="text-sm text-muted-foreground">
        {filter === 'PENDING'
          ? 'Nenhuma sugestão pendente. Tudo revisado!'
          : 'Sem decisões registradas no momento.'}
      </p>
    </div>
  );
}

function DecisionList({
  decisions,
  canManage,
  onFeedback,
}: {
  decisions: Decision[];
  canManage: boolean;
  onFeedback: (d: Decision, f: 'APPROVED' | 'REVERTED' | 'IGNORED') => void;
}) {
  return (
    <div className="space-y-3">
      {decisions.map((d) => (
        <DecisionCard
          key={d.id}
          decision={d}
          canManage={canManage}
          onFeedback={onFeedback}
        />
      ))}
    </div>
  );
}

function DecisionCard({
  decision,
  canManage,
  onFeedback,
}: {
  decision: Decision;
  canManage: boolean;
  onFeedback: (d: Decision, f: 'APPROVED' | 'REVERTED' | 'IGNORED') => void;
}) {
  const style = ACTION_STYLE[decision.action] ?? ACTION_STYLE.SUGGEST;
  const reasons: string[] = Array.isArray(decision.reasons)
    ? (decision.reasons as string[])
    : [];
  const showActions = canManage && !decision.human_feedback;
  return (
    <div className={`rounded-xl border p-4 ${style.bg}`}>
      <div className="flex items-start gap-3">
        <Sparkles size={16} className={`shrink-0 mt-0.5 ${style.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${style.color}`}>
              {style.label}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {KIND_LABEL[decision.decision_kind] ?? decision.decision_kind}
            </span>
            {decision.confidence && (
              <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 bg-card/50">
                conf {decision.confidence}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">
              {decision.loop_kind.toLowerCase()} ·{' '}
              {new Date(decision.created_at).toLocaleString('pt-BR')}
            </span>
          </div>

          <p className="text-sm font-medium text-foreground mb-1">
            {decision.summary ?? `${KIND_LABEL[decision.decision_kind]} em "${decision.resource_name ?? '—'}"`}
          </p>

          {reasons.length > 0 && (
            <ul className="text-[12px] text-muted-foreground list-disc pl-4 space-y-0.5 mb-2">
              {reasons.slice(0, 4).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          {decision.human_feedback && (
            <div className="text-[11px] text-muted-foreground italic">
              Você marcou como{' '}
              <strong>{feedbackLabel(decision.human_feedback)}</strong>
              {decision.feedback_at &&
                ` em ${new Date(decision.feedback_at).toLocaleString('pt-BR')}`}
              .
            </div>
          )}

          {showActions && decision.action === 'SUGGEST' && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onFeedback(decision, 'APPROVED')}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700"
              >
                <CheckCircle2 size={12} /> Aprovar
              </button>
              <button
                onClick={() => onFeedback(decision, 'IGNORED')}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-card hover:bg-accent border border-border"
              >
                <Eye size={12} /> Ignorar
              </button>
            </div>
          )}

          {showActions && decision.action === 'EXECUTE' && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onFeedback(decision, 'APPROVED')}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700"
              >
                <CheckCircle2 size={12} /> Confirmar
              </button>
              <button
                onClick={() => onFeedback(decision, 'REVERTED')}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700"
              >
                <Undo2 size={12} /> Reverter (manual)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function feedbackLabel(fb: 'APPROVED' | 'REVERTED' | 'IGNORED'): string {
  switch (fb) {
    case 'APPROVED':
      return 'aprovada';
    case 'REVERTED':
      return 'revertida';
    case 'IGNORED':
      return 'ignorada';
  }
}

function PolicyPanel({
  policy,
  canManage,
  onChange,
}: {
  policy: Policy;
  canManage: boolean;
  onChange: (patch: Partial<Policy>) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Settings size={14} className="text-muted-foreground" />
        <h4 className="text-sm font-bold text-foreground">Política da IA</h4>
      </div>

      <Toggle
        label="IA habilitada"
        description="Liga/desliga todos os loops automáticos"
        value={policy.agent_enabled}
        disabled={!canManage}
        onChange={(v) => onChange({ agent_enabled: v })}
      />

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
        <button
          onClick={() => canManage && onChange({ mode: 'ADVISOR' })}
          className={`text-left p-3 rounded-lg border ${
            policy.mode === 'ADVISOR'
              ? 'border-violet-500/50 bg-violet-500/10'
              : 'border-border'
          } ${!canManage ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent'}`}
        >
          <div className="flex items-center gap-2 mb-0.5">
            <Eye size={14} className="text-violet-600" />
            <span className="text-sm font-bold">Conselheira</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Apenas sugere — você decide cada ação manualmente.
          </p>
        </button>
        <button
          onClick={() => canManage && onChange({ mode: 'AUTONOMOUS' })}
          className={`text-left p-3 rounded-lg border ${
            policy.mode === 'AUTONOMOUS'
              ? 'border-violet-500/50 bg-violet-500/10'
              : 'border-border'
          } ${!canManage ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent'}`}
        >
          <div className="flex items-center gap-2 mb-0.5">
            <Zap size={14} className="text-violet-600" />
            <span className="text-sm font-bold">Autônoma</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Aplica ações com confidence ≥ {policy.min_confidence_for_auto}.
          </p>
        </button>
      </div>

      <div className="pt-2 border-t border-border">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Quais ações podem ser auto-aplicadas
        </p>
        <Toggle
          label="Pausar anúncios reprovados pelo Google"
          description="Mirror local — Google já parou de exibir"
          value={policy.auto_apply_pause_disapproved}
          disabled={!canManage || policy.mode !== 'AUTONOMOUS'}
          onChange={(v) => onChange({ auto_apply_pause_disapproved: v })}
        />
        <Toggle
          label="Adicionar palavras negativas óbvias"
          description="Termos off-topic detectados pela IA"
          value={policy.auto_apply_negative_keywords}
          disabled={!canManage || policy.mode !== 'AUTONOMOUS'}
          onChange={(v) => onChange({ auto_apply_negative_keywords: v })}
        />
        <Toggle
          label="Ajustar orçamento (até +20%)"
          description="Quando campanha satura budget e ROI está acima do alvo"
          value={policy.auto_apply_budget_changes}
          disabled={!canManage || policy.mode !== 'AUTONOMOUS'}
          onChange={(v) => onChange({ auto_apply_budget_changes: v })}
        />
      </div>

      <div className="pt-2 border-t border-border">
        <Toggle
          label="Shadow mode"
          description="IA decide mas não aplica — útil pros primeiros 14 dias de calibração"
          value={policy.shadow_mode}
          disabled={!canManage}
          onChange={(v) => onChange({ shadow_mode: v })}
        />
        <Toggle
          label="Loop horário"
          description="Roda análise leve a cada hora (alertas em quase-tempo real)"
          value={policy.hourly_enabled}
          disabled={!canManage}
          onChange={(v) => onChange({ hourly_enabled: v })}
        />
      </div>

      <div className="pt-2 border-t border-border">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Notificações
        </p>
        <Toggle
          label="WhatsApp"
          description="Recomendado — relatório PDF anexado"
          value={policy.notify_admin_whatsapp}
          disabled={!canManage}
          onChange={(v) => onChange({ notify_admin_whatsapp: v })}
        />
        <Toggle
          label="In-app (sino do CRM)"
          value={policy.notify_admin_inapp}
          disabled={!canManage}
          onChange={(v) => onChange({ notify_admin_inapp: v })}
        />
        <Toggle
          label="Email"
          description="Backup — risco de spam de texto"
          value={policy.notify_admin_email}
          disabled={!canManage}
          onChange={(v) => onChange({ notify_admin_email: v })}
        />
      </div>

      {policy.mode === 'AUTONOMOUS' && !policy.shadow_mode && (
        <div className="text-[11px] flex items-center gap-2 text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          <AlertTriangle size={13} />
          Modo Autônoma ativo SEM shadow_mode — IA aplica mudanças reais quando
          confidence ≥ {policy.min_confidence_for_auto}.
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 py-1.5 ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {description && (
          <p className="text-[11px] text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => !disabled && onChange(!value)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          value ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-700'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            value ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  );
}
