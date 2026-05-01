'use client';

import { useEffect, useState } from 'react';
import {
  Loader2,
  Target,
  Inbox,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { LeadFormCard } from './LeadFormCard';
import { AudiencesCard } from './AudiencesCard';

interface ConversionAction {
  id: string;
  google_conversion_id: string;
  name: string;
  category: string;
  status: string;
  type: string | null;
  crm_event_kind: string | null;
  default_value_brl: number | null;
}

interface OCIUpload {
  id: string;
  trigger_event: string;
  status: string;
  conversion_at: string;
  uploaded_at: string | null;
  error_message: string | null;
  gclid: string | null;
  manual: boolean;
  created_at: string;
}

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— Nao mapeado —' },
  { value: 'lead.created', label: 'Lead criado (entrada CRM)' },
  { value: 'lead.qualified', label: 'Lead qualificado' },
  { value: 'client.signed', label: 'Cliente assinou contrato' },
  { value: 'payment.received', label: 'Pagamento recebido' },
];

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  UPLOADED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  FAILED: 'bg-red-500/15 text-red-600 dark:text-red-400',
  DUPLICATE_REJECTED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const STATUS_ICON: Record<string, any> = {
  PENDING: Clock,
  UPLOADED: CheckCircle2,
  FAILED: AlertCircle,
  DUPLICATE_REJECTED: AlertCircle,
};

const fmtBRL = (v: number | null) =>
  v === null
    ? '—'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(v);

interface AiSuggestion {
  conversion_action_id: string;
  name: string;
  category: string;
  current_mapping: string | null;
  suggested_event: string | null;
  confidence: number;
  reasoning: string;
}

export function ConversoesTab({ canManage }: { canManage: boolean }) {
  const [actions, setActions] = useState<ConversionAction[]>([]);
  const [uploads, setUploads] = useState<OCIUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[] | null>(
    null,
  );
  const [aiAcceptedIds, setAiAcceptedIds] = useState<Set<string>>(new Set());
  const [aiApplying, setAiApplying] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const a = await api.get<ConversionAction[]>('/trafego/conversion-actions');
      setActions(Array.isArray(a.data) ? a.data : []);
      // Endpoint /trafego/oci-uploads ainda nao existe — placeholder ate Sprint OCI.
      setUploads([]);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.message ??
        'Falha desconhecida ao listar ConversionActions';
      setLoadError(msg);
      showError(`Erro ao carregar ConversionActions: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function fetchAiSuggestions() {
    if (!canManage) return;
    setAiLoading(true);
    try {
      const { data } = await api.post<{
        suggestions: AiSuggestion[];
        model: string;
        total_unmapped: number;
      }>('/trafego/conversion-actions/ai-suggestions');
      setAiSuggestions(data.suggestions);
      // Por padrão aceita só sugestões com confidence >= 0.75 e que mudam
      // o mapping atual (mantém o admin no controle das mudanças sutis).
      const preAccepted = new Set(
        data.suggestions
          .filter(
            (s) =>
              s.confidence >= 0.75 &&
              s.suggested_event !== s.current_mapping,
          )
          .map((s) => s.conversion_action_id),
      );
      setAiAcceptedIds(preAccepted);
      showSuccess(
        `IA gerou ${data.suggestions.length} sugestões com modelo ${data.model}`,
      );
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Falha ao chamar IA';
      showError(`IA: ${msg}`);
    } finally {
      setAiLoading(false);
    }
  }

  async function applyAiSuggestions() {
    if (!aiSuggestions || aiAcceptedIds.size === 0) return;
    setAiApplying(true);
    let okCount = 0;
    let failCount = 0;
    for (const s of aiSuggestions) {
      if (!aiAcceptedIds.has(s.conversion_action_id)) continue;
      try {
        await api.patch(
          `/trafego/conversion-actions/${s.conversion_action_id}`,
          {
            crm_event_kind: s.suggested_event,
          },
        );
        okCount++;
      } catch {
        failCount++;
      }
    }
    setAiApplying(false);
    setAiSuggestions(null);
    setAiAcceptedIds(new Set());
    if (failCount === 0) {
      showSuccess(`${okCount} mapeamento(s) aplicado(s) com sucesso.`);
    } else {
      showError(
        `${okCount} aplicado(s), ${failCount} falhou(aram). Recarregando.`,
      );
    }
    await load();
  }

  function toggleAcceptedSuggestion(id: string) {
    setAiAcceptedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function updateMapping(
    ca: ConversionAction,
    crmEventKind: string,
    valueBrl: number | null,
  ) {
    if (!canManage) return;
    setSavingId(ca.id);
    try {
      await api.patch(`/trafego/conversion-actions/${ca.id}`, {
        crm_event_kind: crmEventKind === '' ? null : crmEventKind,
        default_value_brl: valueBrl,
      });
      showSuccess('Mapeamento atualizado.');
      await load();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao mapear conversao.');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 size={28} className="animate-spin mb-2" />
        <p className="text-sm">Carregando conversoes...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Mapeamento de ConversionActions */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-primary" />
              <h3 className="text-base font-bold text-foreground">
                ConversionActions do Google Ads
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Mapeie cada conversao do Google a um evento do CRM. Quando o evento
              disparar (lead criado, contrato assinado, pagamento recebido), o
              sistema sobe automaticamente uma conversao offline (OCI) com gclid
              do lead.
            </p>
          </div>
          {actions.length > 0 && canManage && (
            <button
              type="button"
              onClick={fetchAiSuggestions}
              disabled={aiLoading}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 shadow-sm whitespace-nowrap"
              title="Sugerir mapeamentos automaticamente com Claude"
            >
              {aiLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Mapear com IA
            </button>
          )}
        </div>

        {loadError ? (
          <div className="p-12 text-center">
            <AlertCircle size={40} className="mx-auto text-red-500 mb-3" />
            <h3 className="text-base font-bold text-foreground mb-1">
              Falha ao carregar ConversionActions
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-3">
              {loadError}
            </p>
            <button
              onClick={load}
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-card hover:bg-accent border border-border"
            >
              Tentar novamente
            </button>
          </div>
        ) : actions.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox size={40} className="mx-auto text-muted-foreground mb-3" />
            <h3 className="text-base font-bold text-foreground mb-1">
              Nenhuma ConversionAction sincronizada
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Crie ConversionActions no Google Ads (tipo "Lead" ou
              "Upload"), aguarde o proximo sync e elas aparecerao aqui. Se ja
              criou no Google, abra <strong>Sync logs</strong> em Configurações
              pra ver se houve falha no sub-sync.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 w-64">Evento CRM</th>
                <th className="text-right px-4 py-3 w-32">Valor padrão</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr
                  key={a.id}
                  className="border-t border-border hover:bg-accent/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {a.category}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        a.status === 'ENABLED'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-zinc-500/15 text-zinc-500'
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="w-full px-2 py-1 text-xs bg-background border border-border rounded"
                      value={a.crm_event_kind ?? ''}
                      disabled={!canManage || savingId === a.id}
                      onChange={(e) =>
                        updateMapping(a, e.target.value, a.default_value_brl)
                      }
                    >
                      {EVENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={a.default_value_brl ?? ''}
                      placeholder="R$"
                      disabled={!canManage || savingId === a.id}
                      className="w-24 px-2 py-1 text-xs bg-background border border-border rounded text-right"
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value.replace(',', '.'));
                        const newVal =
                          Number.isFinite(v) && v >= 0 ? v : null;
                        if (newVal !== a.default_value_brl) {
                          updateMapping(
                            a,
                            a.crm_event_kind ?? '',
                            newVal,
                          );
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit de uploads OCI recentes */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-base font-bold text-foreground">
            Uploads recentes (audit)
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Conversoes offline subidas pro Google. Listagem aparece aqui apos o
            primeiro upload via evento CRM disparado por lead com gclid.
          </p>
        </div>

        {uploads.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum upload registrado ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Evento</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Erro</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => {
                const Icon = STATUS_ICON[u.status] ?? Clock;
                return (
                  <tr
                    key={u.id}
                    className="border-t border-border hover:bg-accent/30"
                  >
                    <td className="px-4 py-3 text-xs">
                      {new Date(u.conversion_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {u.trigger_event}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          STATUS_BADGE[u.status] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Icon size={11} />
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-md truncate">
                      {u.error_message ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Lead Form Asset — captura direto do anúncio */}
      <LeadFormCard canManage={canManage} />

      {/* Customer Match — audiences sincronizadas com Google Ads */}
      <AudiencesCard canManage={canManage} />

      {/* Modal de revisão das sugestões da IA */}
      {aiSuggestions && (
        <AiSuggestionsModal
          suggestions={aiSuggestions}
          acceptedIds={aiAcceptedIds}
          applying={aiApplying}
          onToggle={toggleAcceptedSuggestion}
          onCancel={() => {
            setAiSuggestions(null);
            setAiAcceptedIds(new Set());
          }}
          onApply={applyAiSuggestions}
        />
      )}
    </div>
  );
}

// ─── Modal de sugestões da IA ────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  'lead.created': 'Lead criado',
  'lead.qualified': 'Lead qualificado',
  'client.signed': 'Cliente assinou',
  'payment.received': 'Pagamento recebido',
};

function AiSuggestionsModal({
  suggestions,
  acceptedIds,
  applying,
  onToggle,
  onCancel,
  onApply,
}: {
  suggestions: AiSuggestion[];
  acceptedIds: Set<string>;
  applying: boolean;
  onToggle: (id: string) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const accepted = suggestions.filter((s) =>
    acceptedIds.has(s.conversion_action_id),
  );
  // Ordena: maior confidence primeiro pra revisão prioritária
  const sorted = [...suggestions].sort((a, b) => b.confidence - a.confidence);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying) onCancel();
      }}
    >
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-violet-600" />
            <h3 className="text-base font-bold text-foreground">
              Sugestões da IA — revise antes de aplicar
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 text-xs text-muted-foreground border-b border-border">
          A IA analisou {suggestions.length} ConversionAction(s) e marcou as que
          mudam o mapping atual com confidence ≥ 75%. Desmarque o que não quiser
          aplicar. Cada item aplicado vira um <code className="font-mono">PATCH</code> no
          Google Ads para popular o evento CRM.
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">ConversionAction</th>
                <th className="text-left px-3 py-2">Atual</th>
                <th className="text-left px-3 py-2">Sugerido</th>
                <th className="text-right px-3 py-2 w-20">Conf.</th>
                <th className="text-left px-3 py-2">Justificativa</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const checked = acceptedIds.has(s.conversion_action_id);
                const sameAsCurrent = s.suggested_event === s.current_mapping;
                const lowConfidence = s.confidence < 0.6;
                return (
                  <tr
                    key={s.conversion_action_id}
                    className={`border-t border-border ${
                      checked ? 'bg-violet-500/5' : ''
                    } ${sameAsCurrent ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={applying}
                        onChange={() => onToggle(s.conversion_action_id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {s.current_mapping
                        ? EVENT_LABEL[s.current_mapping] ?? s.current_mapping
                        : '— Não mapeado —'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.suggested_event ? (
                        <span className="font-semibold text-violet-700 dark:text-violet-300">
                          {EVENT_LABEL[s.suggested_event] ?? s.suggested_event}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          deixar em branco
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      <span
                        className={
                          lowConfidence
                            ? 'text-amber-500'
                            : s.confidence >= 0.85
                              ? 'text-emerald-500'
                              : 'text-foreground'
                        }
                      >
                        {(s.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {s.reasoning}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {accepted.length} de {suggestions.length} selecionada(s)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={applying}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={applying || accepted.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying && <Loader2 size={14} className="animate-spin" />}
              Aplicar {accepted.length > 0 ? `(${accepted.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
