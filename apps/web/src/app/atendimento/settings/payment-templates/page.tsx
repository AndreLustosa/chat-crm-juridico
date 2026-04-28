'use client';

/**
 * Templates de Cobrança — admin edita as 7 mensagens automaticas
 * disparadas pelo PaymentReminderService:
 *   - initial: cobranca inicial gerada
 *   - pre-due-{3d, 1d, 0d}: lembretes antes do vencimento
 *   - overdue-{1d, 3d, 7d}: cobrancas de atraso (cordial → urgente)
 *
 * Cada template usa placeholders {variavel} substituidos no envio:
 *   {cliente}, {valor}, {vencimento}, {processo}, {forma}, etc.
 *
 * Preview live: ao editar, atualiza com dados ficticios em 500ms debounce.
 * Reset: botao volta o kind atual pro default original (sobrescreve).
 *
 * Visivel apenas pra ADMIN (settings/layout.tsx ja restringe via
 * adminOnlyPaths).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Save, RotateCcw, Eye, MessageSquare, Loader2, Copy, Check,
  AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type TemplateGroup = 'single' | 'bulk';

const TEMPLATE_KIND_INFO: Array<{
  kind: string;
  group: TemplateGroup;
  title: string;
  description: string;
  badge: string;
  badgeClass: string;
}> = [
  // SINGLE — 1 cobrança/parcela por mensagem
  {
    kind: 'initial',
    group: 'single',
    title: 'Cobrança gerada',
    description: 'Enviada quando o advogado clica em "Cobrar PIX/Boleto" — primeiro contato com o cliente.',
    badge: '✉️ INICIAL',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  {
    kind: 'pre-due-3d',
    group: 'single',
    title: 'Lembrete: vence em 3 dias',
    description: 'Cron 9h. Tom cordial — cliente tem tempo de organizar.',
    badge: '🔔 -3d',
    badgeClass: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  },
  {
    kind: 'pre-due-1d',
    group: 'single',
    title: 'Lembrete: vence amanhã',
    description: 'Cron 9h. Aviso direto pra cliente lembrar.',
    badge: '🔔 -1d',
    badgeClass: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  },
  {
    kind: 'pre-due-0d',
    group: 'single',
    title: 'Lembrete: vence hoje',
    description: 'Cron 9h. Última chance de pagar sem atraso.',
    badge: '🔔 hoje',
    badgeClass: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  },
  {
    kind: 'overdue-1d',
    group: 'single',
    title: 'Atraso 1 dia (cordial)',
    description: 'Cron 14h. Tom leve — pode ser que esqueceu.',
    badge: '⏰ +1d',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  {
    kind: 'overdue-3d',
    group: 'single',
    title: 'Atraso 3 dias (firme)',
    description: 'Cron 14h. Tom mais firme — chama atenção pra juros/multa.',
    badge: '⚠️ +3d',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  {
    kind: 'overdue-7d',
    group: 'single',
    title: 'Atraso 7 dias (urgente)',
    description: 'Cron 14h. Última cobrança automática — após isso (15d) só ação manual.',
    badge: '🚨 +7d',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
  },

  // BULK — usado quando o cliente tem 2+ parcelas no mesmo kind/janela.
  // Em vez de mandar N mensagens iguais, agrega em uma só com lista de
  // parcelas formatada. Disparado automaticamente pelo sistema —
  // advogado nao escolhe entre single e bulk (sistema decide pelo count).
  {
    kind: 'bulk-pre-due',
    group: 'bulk',
    title: 'Múltiplas parcelas a vencer',
    description: 'Quando cliente tem 2+ parcelas vencendo na mesma janela, em vez de mandar N mensagens, agrega em uma só.',
    badge: '🔔 LOTE',
    badgeClass: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  },
  {
    kind: 'bulk-overdue',
    group: 'bulk',
    title: 'Múltiplas parcelas em atraso',
    description: 'Quando cliente tem 2+ parcelas atrasadas na mesma janela. Lista todas em uma mensagem com total agregado.',
    badge: '⚠️ LOTE',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
];

type Variable = { key: string; label: string; example: string; bulkOnly?: boolean };

export default function PaymentTemplatesPage() {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [variables, setVariables] = useState<Variable[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>('initial');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // ─── Carrega templates + variaveis ──────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/payment-gateway/templates');
      const tpl = res.data?.templates || {};
      setTemplates(tpl);
      setDrafts(tpl); // editor inicia com valor atual
      setVariables(res.data?.variables || []);
    } catch {
      showError('Erro ao carregar templates');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ─── Preview com debounce ───────────────────────────────────

  const debouncedPreview = useCallback((kind: string, customText: string) => {
    const handler = setTimeout(async () => {
      try {
        const res = await api.post(`/payment-gateway/templates/${kind}/preview`, { customText });
        setPreviews(prev => ({ ...prev, [kind]: res.data?.text || '' }));
      } catch { /* silent */ }
    }, 500);
    return () => clearTimeout(handler);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const text = drafts[expanded];
    if (typeof text !== 'string') return;
    const cleanup = debouncedPreview(expanded, text);
    return cleanup;
  }, [expanded, drafts, debouncedPreview]);

  // ─── Acoes ──────────────────────────────────────────────────

  function handleEdit(kind: string, text: string) {
    setDrafts(prev => ({ ...prev, [kind]: text }));
  }

  async function handleSave(kind: string) {
    setSaving(kind);
    try {
      const text = drafts[kind] ?? '';
      const res = await api.post('/payment-gateway/templates', { [kind]: text });
      const tpl = res.data?.templates || {};
      setTemplates(tpl);
      // Mantem drafts em sincronia com o que foi salvo
      setDrafts(tpl);
      showSuccess('Template salvo');
    } catch {
      showError('Erro ao salvar');
    } finally {
      setSaving(null);
    }
  }

  async function handleReset(kind: string) {
    if (!confirm('Restaurar mensagem padrão? A customização atual será perdida.')) return;
    setSaving(kind);
    try {
      // Envia string vazia → backend remove customizacao e volta pro default
      const res = await api.post('/payment-gateway/templates', { [kind]: '' });
      const tpl = res.data?.templates || {};
      setTemplates(tpl);
      setDrafts(tpl);
      showSuccess('Mensagem padrão restaurada');
    } catch {
      showError('Erro ao resetar');
    } finally {
      setSaving(null);
    }
  }

  function insertVariable(kind: string, varKey: string) {
    // Insere {var} no fim do texto atual (sem cursor — simples)
    const current = drafts[kind] ?? '';
    const insertion = `{${varKey}}`;
    setDrafts(prev => ({ ...prev, [kind]: current + insertion }));
  }

  function isDirty(kind: string): boolean {
    return (drafts[kind] ?? '') !== (templates[kind] ?? '');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-base font-bold text-foreground flex items-center gap-2">
          <MessageSquare size={16} className="text-primary" />
          Templates de Cobrança
        </h1>
        <p className="text-[12px] text-muted-foreground mt-1">
          Personalize as mensagens automáticas enviadas aos clientes via WhatsApp.
          Use placeholders entre <code className="bg-accent px-1 rounded text-[11px]">{'{chaves}'}</code> pra
          inserir dados dinâmicos. Clique em "Restaurar padrão" pra voltar à mensagem original.
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-2 italic">
          Lembrete: estas mensagens só são enviadas pra honorários CONTRATUAL ou ENTRADA.
          SUCUMBÊNCIA e ACORDO não disparam cobrança automática.
        </p>
      </div>

      {/* Lista de variaveis disponiveis (acordion sticky no topo) */}
      <details className="bg-card border border-border rounded-xl">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold flex items-center justify-between hover:bg-accent/30 transition-colors">
          <span className="flex items-center gap-2">
            <Eye size={13} /> Variáveis disponíveis ({variables.length})
          </span>
          <span className="text-[10px] text-muted-foreground">clique pra expandir</span>
        </summary>
        <div className="border-t border-border p-3 grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {variables.map(v => (
            <div
              key={v.key}
              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
                v.bulkOnly
                  ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10'
                  : 'bg-accent/20 border-border/50 hover:bg-accent/40'
              }`}
              title={v.bulkOnly
                ? `Só funciona em templates de lote — Exemplo: ${v.example}`
                : `Exemplo: ${v.example}`}
            >
              <div className="flex-1 min-w-0">
                <code className={`text-[11px] font-mono ${v.bulkOnly ? 'text-amber-400' : 'text-primary'}`}>
                  {`{${v.key}}`}
                </code>
                <span className="text-[10px] text-muted-foreground ml-2">
                  {v.label}
                  {v.bulkOnly && <span className="ml-1 text-amber-400/70">(lote)</span>}
                </span>
              </div>
              <span className="text-[9px] text-muted-foreground/70 truncate max-w-[120px]">{v.example}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Section: Mensagens individuais */}
      <div>
        <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
          📨 Individuais (1 parcela por mensagem)
        </h2>
        <p className="text-[10px] text-muted-foreground/70 mb-3">
          Usadas quando o cliente tem só 1 parcela elegível na janela do cron.
        </p>
      </div>

      {/* Lista de templates — agrupada */}
      <div className="space-y-3">
        {TEMPLATE_KIND_INFO.filter(i => i.group === 'single').map(info => {
          const isExpanded = expanded === info.kind;
          const dirty = isDirty(info.kind);
          const text = drafts[info.kind] ?? '';
          const preview = previews[info.kind] ?? '';
          return (
            <div
              key={info.kind}
              className="bg-card border border-border rounded-xl overflow-hidden"
            >
              {/* Header — clickavel */}
              <button
                onClick={() => setExpanded(isExpanded ? null : info.kind)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/20 transition-colors"
              >
                <span className={`text-[9px] font-bold px-2 py-1 rounded-full border tabular-nums ${info.badgeClass}`}>
                  {info.badge}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-foreground">{info.title}</p>
                  <p className="text-[11px] text-muted-foreground">{info.description}</p>
                </div>
                {dirty && !isExpanded && (
                  <span className="text-[10px] text-amber-400 font-bold">Não salvo</span>
                )}
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {/* Body — editor + preview */}
              {isExpanded && (
                <div className="border-t border-border p-4 space-y-3">
                  {/* Insertar variavel */}
                  <div className="flex flex-wrap gap-1.5">
                    {variables.map(v => (
                      <button
                        key={v.key}
                        onClick={() => insertVariable(info.kind, v.key)}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
                        title={`Inserir ${v.label} (${v.example})`}
                      >
                        {`{${v.key}}`}
                      </button>
                    ))}
                  </div>

                  {/* Editor */}
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Mensagem
                    </label>
                    <textarea
                      value={text}
                      onChange={e => handleEdit(info.kind, e.target.value)}
                      rows={Math.min(20, Math.max(8, text.split('\n').length + 1))}
                      className="w-full px-3 py-2 text-[12px] bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono resize-y"
                      placeholder="Digite a mensagem com placeholders {variavel}..."
                    />
                  </div>

                  {/* Preview */}
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Preview (com dados de exemplo)
                    </label>
                    <div className="px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg whitespace-pre-line text-[12px] text-foreground/90 min-h-[80px]">
                      {preview || <span className="text-muted-foreground italic">Aguarde…</span>}
                    </div>
                  </div>

                  {/* Acoes */}
                  <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
                    <button
                      onClick={() => handleSave(info.kind)}
                      disabled={!dirty || saving === info.kind}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {saving === info.kind ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      Salvar
                    </button>
                    <button
                      onClick={() => handleReset(info.kind)}
                      disabled={saving === info.kind}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
                      title="Volta a mensagem padrão original"
                    >
                      <RotateCcw size={11} /> Restaurar padrão
                    </button>
                    {dirty && (
                      <span className="text-[10px] text-amber-400 italic flex items-center gap-1">
                        <AlertCircle size={10} /> Você tem alterações não salvas
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Section: Mensagens em lote (bulk) */}
      <div className="pt-4 border-t border-border">
        <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
          📦 Em lote (várias parcelas em uma mensagem)
        </h2>
        <p className="text-[10px] text-muted-foreground/70 mb-3">
          Disparadas automaticamente quando o cliente tem 2+ parcelas elegíveis na mesma janela.
          Em vez de mandar várias mensagens iguais, agrega tudo numa só com lista detalhada.
          Use <code className="bg-accent px-1 rounded">{'{parcelas_lista}'}</code> e <code className="bg-accent px-1 rounded">{'{qtd_parcelas}'}</code> nesses templates.
        </p>
      </div>

      <div className="space-y-3">
        {TEMPLATE_KIND_INFO.filter(i => i.group === 'bulk').map(info => {
          const isExpanded = expanded === info.kind;
          const dirty = isDirty(info.kind);
          const text = drafts[info.kind] ?? '';
          const preview = previews[info.kind] ?? '';
          return (
            <div
              key={info.kind}
              className="bg-card border border-border rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpanded(isExpanded ? null : info.kind)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/20 transition-colors"
              >
                <span className={`text-[9px] font-bold px-2 py-1 rounded-full border tabular-nums ${info.badgeClass}`}>
                  {info.badge}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-foreground">{info.title}</p>
                  <p className="text-[11px] text-muted-foreground">{info.description}</p>
                </div>
                {dirty && !isExpanded && (
                  <span className="text-[10px] text-amber-400 font-bold">Não salvo</span>
                )}
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {isExpanded && (
                <div className="border-t border-border p-4 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {variables.map(v => (
                      <button
                        key={v.key}
                        onClick={() => insertVariable(info.kind, v.key)}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-md border transition-colors ${
                          v.bulkOnly
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/40 hover:bg-amber-500/25'
                            : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
                        }`}
                        title={v.bulkOnly
                          ? `Disponível só em templates de lote — ${v.label} (${v.example})`
                          : `Inserir ${v.label} (${v.example})`}
                      >
                        {`{${v.key}}`}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Mensagem
                    </label>
                    <textarea
                      value={text}
                      onChange={e => handleEdit(info.kind, e.target.value)}
                      rows={Math.min(25, Math.max(10, text.split('\n').length + 1))}
                      className="w-full px-3 py-2 text-[12px] bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono resize-y"
                      placeholder="Digite a mensagem com placeholders {variavel}..."
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Preview (3 parcelas de exemplo)
                    </label>
                    <div className="px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg whitespace-pre-line text-[12px] text-foreground/90 min-h-[80px]">
                      {preview || <span className="text-muted-foreground italic">Aguarde…</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
                    <button
                      onClick={() => handleSave(info.kind)}
                      disabled={!dirty || saving === info.kind}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {saving === info.kind ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      Salvar
                    </button>
                    <button
                      onClick={() => handleReset(info.kind)}
                      disabled={saving === info.kind}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={11} /> Restaurar padrão
                    </button>
                    {dirty && (
                      <span className="text-[10px] text-amber-400 italic flex items-center gap-1">
                        <AlertCircle size={10} /> Você tem alterações não salvas
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
