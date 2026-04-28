'use client';

/**
 * Modal de configuração para gerar um relatório do catálogo.
 *
 * Campos comuns:
 *   - Período (date pickers)
 *   - Escopo (advogado)
 *   - Observações livres
 *   - Orientação (portrait/landscape)
 *
 * Campos específicos por kind:
 *   - charges-list: filtro (overdue/pending/etc)
 *   - extrato-receitas/extrato-despesas: summaryOnly toggle
 *   - dashboard-snapshot: includeCharts/includeDetailTable
 */

import { useEffect, useState } from 'react';
import { X, FileText, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

export type ReportKind =
  | 'dashboard-snapshot' | 'snapshot-reuniao'
  | 'extrato-receitas' | 'extrato-despesas'
  | 'charges-list' | 'cobrancas-list'
  | 'dre' | 'cash-flow' | 'inadimplencia' | 'faturamento' | 'performance-comparada'
  | 'livro-caixa' | 'fechamento-mensal' | 'pacote-comprovantes'
  | 'conciliacao-bancaria' | 'resumo-fiscal'
  | 'performance-advogado' | 'pipeline-cobranca' | 'metas-vs-realizado'
  | 'prestacao-contas' | 'extrato-caso' | 'comprovante-pagamento';

interface ReportConfigModalProps {
  card: { kind: ReportKind; title: string; endpoint: string };
  lawyers: Array<{ id: string; name: string }>;
  canAll: boolean; // se admin/financeiro
  onClose: () => void;
  onGenerated: () => void;
}

const monthRange = (offset = 0): { from: string; to: string } => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offset;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
  return { from: start.toISOString(), to: end.toISOString() };
};

export default function ReportConfigModal({
  card, lawyers, canAll, onClose, onGenerated,
}: ReportConfigModalProps) {
  const initial = monthRange(0);
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));
  const [lawyerId, setLawyerId] = useState('');
  const [observations, setObservations] = useState('');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeDetailTable, setIncludeDetailTable] = useState(true);
  const [summaryOnly, setSummaryOnly] = useState(false);
  const [chargeFilter, setChargeFilter] = useState<'all' | 'overdue' | 'pending' | 'paid' | 'awaiting_alvara'>('all');
  const [submitting, setSubmitting] = useState(false);

  // ESC fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // Inadimplencia + charges-list nao usam periodo (snapshot atual)
  const showPeriodFields = !['charges-list', 'cobrancas-list', 'inadimplencia'].includes(card.kind);
  const showFilterField = ['charges-list', 'cobrancas-list'].includes(card.kind);
  const showOrientation = ['dashboard-snapshot', 'snapshot-reuniao', 'extrato-receitas', 'extrato-despesas'].includes(card.kind);
  const showCharts = ['dashboard-snapshot', 'snapshot-reuniao'].includes(card.kind);
  const showSummaryOnly = ['extrato-receitas', 'extrato-despesas'].includes(card.kind);
  // Performance advogado e sempre todos os advogados (relatorio comparativo)
  const showLawyerScope = card.kind !== 'performance-advogado';

  const handleShortcut = (kind: 'this_month' | 'last_month' | 'this_year') => {
    if (kind === 'this_month') {
      const r = monthRange(0);
      setFrom(r.from.slice(0, 10));
      setTo(r.to.slice(0, 10));
    } else if (kind === 'last_month') {
      const r = monthRange(-1);
      setFrom(r.from.slice(0, 10));
      setTo(r.to.slice(0, 10));
    } else {
      const y = new Date().getUTCFullYear();
      setFrom(`${y}-01-01`);
      setTo(`${y}-12-31`);
    }
  };

  const handleGenerate = async () => {
    setSubmitting(true);
    showSuccess('Gerando PDF...');
    try {
      const body: any = { observations: observations || undefined };
      if (showPeriodFields) {
        body.from = new Date(from).toISOString();
        body.to = new Date(to + 'T23:59:59').toISOString();
      }
      if (lawyerId) body.lawyerId = lawyerId;
      if (showOrientation) body.orientation = orientation;
      if (showCharts) {
        body.includeCharts = includeCharts;
        body.includeDetailTable = includeDetailTable;
      }
      if (showSummaryOnly) body.summaryOnly = summaryOnly;
      if (showFilterField) body.filter = chargeFilter;

      // Especifico do extrato: tipo
      if (card.kind === 'extrato-receitas') body.type = 'RECEITA';
      if (card.kind === 'extrato-despesas') body.type = 'DESPESA';

      const res = await api.post(card.endpoint, body, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showSuccess('PDF pronto.');
      onGenerated();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao gerar PDF');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">{card.title}</h3>
          <button onClick={onClose} disabled={submitting} className="p-1 rounded hover:bg-accent/30 text-muted-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {/* Período (com shortcuts) */}
          {showPeriodFields && (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-muted-foreground block">Período</label>
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {[
                  { k: 'this_month' as const, label: 'Este mês' },
                  { k: 'last_month' as const, label: 'Mês anterior' },
                  { k: 'this_year' as const, label: 'Ano corrente' },
                ].map((s) => (
                  <button
                    key={s.k}
                    onClick={() => handleShortcut(s.k)}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block">De</label>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block">Até</label>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Escopo */}
          {canAll && showLawyerScope && (
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Escopo</label>
              <select
                value={lawyerId}
                onChange={(e) => setLawyerId(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
              >
                <option value="">Todos os advogados</option>
                {lawyers.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Filtro (charges) */}
          {showFilterField && (
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Filtro</label>
              <select
                value={chargeFilter}
                onChange={(e) => setChargeFilter(e.target.value as any)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
              >
                <option value="all">Todas</option>
                <option value="overdue">Atrasadas</option>
                <option value="pending">A vencer</option>
                <option value="paid">Pagas</option>
                <option value="awaiting_alvara">Aguardando alvará</option>
              </select>
            </div>
          )}

          {/* Orientação */}
          {showOrientation && (
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Orientação</label>
              <div className="grid grid-cols-2 gap-2">
                {(['portrait', 'landscape'] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOrientation(o)}
                    className={`px-3 py-1.5 rounded text-[11px] font-semibold border ${
                      orientation === o
                        ? 'bg-primary/10 border-primary text-foreground'
                        : 'bg-card border-border text-muted-foreground hover:bg-accent/20'
                    }`}
                  >
                    {o === 'portrait' ? 'Retrato' : 'Paisagem'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Charts */}
          {showCharts && (
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCharts}
                  onChange={(e) => setIncludeCharts(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs font-semibold text-foreground">Incluir gráficos</div>
                  <div className="text-[11px] text-muted-foreground">Receita por advogado e visualização do aging.</div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDetailTable}
                  onChange={(e) => setIncludeDetailTable(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs font-semibold text-foreground">Incluir tabela detalhada</div>
                  <div className="text-[11px] text-muted-foreground">Anexo com cobranças pendentes.</div>
                </div>
              </label>
            </div>
          )}

          {/* Summary only */}
          {showSummaryOnly && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={summaryOnly}
                onChange={(e) => setSummaryOnly(e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <div className="text-xs font-semibold text-foreground">Resumo apenas</div>
                <div className="text-[11px] text-muted-foreground">Omite tabela detalhada — só totalizadores.</div>
              </div>
            </label>
          )}

          {/* Observações */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Observações (opcional)</label>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={3}
              placeholder="Ex: Reunião de fechamento de Abril."
              className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded border border-border text-xs font-semibold text-foreground hover:bg-accent/20">
            Cancelar
          </button>
          <button
            onClick={handleGenerate}
            disabled={submitting}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            Gerar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
