'use client';

/**
 * Tela "Relatórios" — catálogo de relatórios PDF + histórico.
 *
 * Layout:
 *   1. 4 categorias (Gerenciais, Para contadora, Reuniões internas, Para
 *      cliente) — cada uma com cards de relatórios disponíveis.
 *   2. Histórico (últimos 50 PDFs gerados pelo tenant ou pelo usuário).
 *
 * Cada card abre modal de configuração específico do relatório.
 * Backend chama POST /reports/<kind> com responseType=blob, abre nova aba.
 *
 * Permissões:
 *   - ADMIN/FINANCEIRO veem todos os cards.
 *   - ADVOGADO/ASSOCIADO veem cards filtrados (apenas do escopo deles).
 */

import { useEffect, useState, useCallback } from 'react';
import {
  FileText, FileBarChart, FileSpreadsheet, Briefcase, Users, Calendar,
  Loader2, Download, Clock,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import { useRole } from '@/lib/useRole';
import ReportConfigModal, { ReportKind } from './ReportConfigModal';

interface LawyerLite { id: string; name: string }
interface ReportsTabProps { lawyers: LawyerLite[] }

interface HistoryEntry {
  id: string;
  kind: string;
  display_name: string;
  generated_at: string;
  user: { id: string; name: string } | null;
  params: any;
}

interface CatalogCard {
  kind: ReportKind;
  category: 'gerenciais' | 'contadora' | 'reuniao' | 'cliente';
  icon: any;
  title: string;
  description: string;
  status: 'available' | 'coming_soon';
  /** Marca se ja esta endpoint pronto. Se false, mostra "em breve" */
  endpoint?: string;
}

const CATALOG: CatalogCard[] = [
  // ─── GERENCIAIS ───────────────────────────────────────
  {
    kind: 'dashboard-snapshot',
    category: 'gerenciais',
    icon: FileBarChart,
    title: 'Snapshot do dashboard',
    description: 'Resumo executivo: KPIs, comparação MoM, aging, receita por advogado.',
    status: 'available',
    endpoint: '/reports/dashboard-snapshot',
  },
  {
    kind: 'extrato-receitas',
    category: 'gerenciais',
    icon: FileSpreadsheet,
    title: 'Extrato de receitas',
    description: 'Lançamentos de RECEITA cronológicos com totalizadores e status.',
    status: 'available',
    endpoint: '/reports/transactions-statement',
  },
  {
    kind: 'extrato-despesas',
    category: 'gerenciais',
    icon: FileSpreadsheet,
    title: 'Extrato de despesas',
    description: 'Lançamentos de DESPESA cronológicos com totalizadores e status.',
    status: 'available',
    endpoint: '/reports/transactions-statement',
  },
  {
    kind: 'cobrancas-list',
    category: 'gerenciais',
    icon: FileText,
    title: 'Lista de cobranças',
    description: 'Cobranças com status pagamento + Asaas. Filtra por estado.',
    status: 'available',
    endpoint: '/reports/charges-list',
  },
  { kind: 'dre', category: 'gerenciais', icon: FileText, title: 'DRE simplificado',
    description: 'Demonstrativo de Resultado adaptado para escritório de advocacia.',
    status: 'coming_soon' },
  { kind: 'cash-flow', category: 'gerenciais', icon: FileText, title: 'Fluxo de caixa',
    description: '12 meses retroativos: entradas, saídas, saldo acumulado.',
    status: 'coming_soon' },
  { kind: 'inadimplencia', category: 'gerenciais', icon: FileText, title: 'Inadimplência detalhada',
    description: 'Aging + top 10 inadimplentes + taxa de recuperação.',
    status: 'coming_soon' },
  { kind: 'faturamento', category: 'gerenciais', icon: FileText, title: 'Faturamento por período',
    description: 'Receita por dia, semana, mês e trimestre.',
    status: 'coming_soon' },
  { kind: 'performance-comparada', category: 'gerenciais', icon: FileText, title: 'Performance comparada',
    description: 'Compara dois períodos arbitrários (MoM, YoY, Q vs Q).',
    status: 'coming_soon' },

  // ─── CONTADORA ───────────────────────────────────────
  { kind: 'livro-caixa', category: 'contadora', icon: FileText, title: 'Livro caixa',
    description: 'Cronológico com Data, Histórico, Documento, Cliente, Entrada, Saída, Saldo.',
    status: 'coming_soon' },
  { kind: 'fechamento-mensal', category: 'contadora', icon: FileText, title: 'Fechamento mensal',
    description: 'Resumo + livro caixa + NF emitida vs sem NF + dedutíveis.',
    status: 'coming_soon' },
  { kind: 'pacote-comprovantes', category: 'contadora', icon: FileText, title: 'Pacote de comprovantes',
    description: 'Compila todos os anexos de receitas/despesas do período.',
    status: 'coming_soon' },
  { kind: 'conciliacao-bancaria', category: 'contadora', icon: FileText, title: 'Conciliação bancária',
    description: 'Indisponível: sem integração bancária no sistema.',
    status: 'coming_soon' },
  { kind: 'resumo-fiscal', category: 'contadora', icon: FileText, title: 'Resumo fiscal',
    description: 'Receitas brutas mensais + retenções (IR, ISS, PIS/COFINS).',
    status: 'coming_soon' },

  // ─── REUNIÃO INTERNA ─────────────────────────────────
  {
    kind: 'snapshot-reuniao',
    category: 'reuniao',
    icon: FileBarChart,
    title: 'Snapshot do dashboard',
    description: 'Mesmo do gerencial, mas com escolha explícita de filtros.',
    status: 'available',
    endpoint: '/reports/dashboard-snapshot',
  },
  { kind: 'performance-advogado', category: 'reuniao', icon: Users, title: 'Performance por advogado',
    description: 'Receita, casos, ticket médio, taxa de êxito, evolução 6m.',
    status: 'coming_soon' },
  { kind: 'pipeline-cobranca', category: 'reuniao', icon: FileText, title: 'Pipeline de cobrança',
    description: 'Funil: contratado → cobrança → enviada → paga.',
    status: 'coming_soon' },
  { kind: 'metas-vs-realizado', category: 'reuniao', icon: FileText, title: 'Metas vs realizado',
    description: 'Atingimento + projeção + tendência 6m.',
    status: 'coming_soon' },

  // ─── CLIENTE ─────────────────────────────────────────
  { kind: 'prestacao-contas', category: 'cliente', icon: FileText, title: 'Prestação de contas',
    description: 'Por cliente OU por caso: honorários, pagamentos, saldo.',
    status: 'coming_soon' },
  { kind: 'extrato-caso', category: 'cliente', icon: FileText, title: 'Extrato do caso',
    description: 'Tabela simplificada de pagamentos vinculados ao processo.',
    status: 'coming_soon' },
  { kind: 'comprovante-pagamento', category: 'cliente', icon: FileText, title: 'Comprovante de pagamento',
    description: 'Recibo individual de uma receita paga.',
    status: 'coming_soon' },
];

const CATEGORY_LABELS: Record<CatalogCard['category'], { title: string; icon: any; color: string }> = {
  gerenciais: { title: 'Gerenciais', icon: FileBarChart, color: 'text-emerald-400' },
  contadora: { title: 'Para contadora', icon: Briefcase, color: 'text-amber-400' },
  reuniao: { title: 'Reuniões internas', icon: Users, color: 'text-blue-400' },
  cliente: { title: 'Para cliente', icon: FileText, color: 'text-violet-400' },
};

export default function ReportsTab({ lawyers }: ReportsTabProps) {
  const { isAdmin, isFinanceiro } = useRole();
  const canAll = isAdmin || isFinanceiro;

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectedReport, setSelectedReport] = useState<CatalogCard | null>(null);
  const [generating, setGenerating] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const r = await api.get('/reports/history', { params: { limit: 50 } });
      setHistory(Array.isArray(r.data) ? r.data : []);
    } catch {
      // historico vazio é ok
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Re-baixar PDF a partir do histórico (regenera com mesmos params)
  const handleRegenerate = async (entry: HistoryEntry) => {
    setGenerating(true);
    showSuccess('Regenerando PDF...');
    try {
      const endpoint = endpointForKind(entry.kind);
      if (!endpoint) {
        showError('Tipo de relatório não suporta re-download.');
        return;
      }
      const res = await api.post(endpoint, entry.params, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showSuccess('PDF pronto.');
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao regenerar PDF');
    } finally {
      setGenerating(false);
    }
  };

  const groupedByCategory = (cat: CatalogCard['category']) => CATALOG.filter((c) => c.category === cat);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText size={18} className="text-primary" />
        <h2 className="text-lg font-bold text-foreground">Relatórios</h2>
      </div>

      {/* 4 categorias */}
      {(['gerenciais', 'contadora', 'reuniao', 'cliente'] as const).map((cat) => {
        const meta = CATEGORY_LABELS[cat];
        const cards = groupedByCategory(cat);
        const Icon = meta.icon;
        return (
          <div key={cat} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Icon size={14} className={meta.color} />
              <h3 className="text-sm font-bold text-foreground">{meta.title}</h3>
              <span className="text-[10px] text-muted-foreground">
                {cards.filter((c) => c.status === 'available').length} disponível(is) ·{' '}
                {cards.filter((c) => c.status === 'coming_soon').length} em breve
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
              {cards.map((card) => (
                <CatalogCardComponent
                  key={card.kind}
                  card={card}
                  onClick={() => card.status === 'available' && setSelectedReport(card)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Histórico */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-muted-foreground" />
            <h3 className="text-sm font-bold text-foreground">Histórico</h3>
            <span className="text-[10px] text-muted-foreground">
              Últimos {history.length} relatórios gerados
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          {loadingHistory && (
            <div className="p-8 text-center">
              <Loader2 size={16} className="inline animate-spin text-muted-foreground" />
            </div>
          )}
          {!loadingHistory && history.length === 0 && (
            <div className="p-8 text-center text-xs text-muted-foreground italic">
              Nenhum relatório gerado ainda. Use os cards acima para começar.
            </div>
          )}
          {!loadingHistory && history.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Data/hora</th>
                  <th className="px-3 py-2 font-medium">Relatório</th>
                  <th className="px-3 py-2 font-medium">Usuário</th>
                  <th className="px-3 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border/50 hover:bg-accent/10">
                    <td className="px-3 py-2.5 text-foreground tabular-nums">{fmtDateTime(h.generated_at)}</td>
                    <td className="px-3 py-2.5 text-foreground">{h.display_name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{h.user?.name || '—'}</td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => handleRegenerate(h)}
                        disabled={generating}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                        title="Regenerar PDF com os mesmos parâmetros"
                      >
                        <Download size={11} /> Baixar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-2 text-[10px] text-muted-foreground italic">
          Re-download regenera o PDF a partir dos parâmetros originais — pode refletir dados atualizados se houver mudança nos lançamentos.
        </div>
      </div>

      {/* Modal de configuração */}
      {selectedReport && selectedReport.endpoint && (
        <ReportConfigModal
          card={{
            kind: selectedReport.kind,
            title: selectedReport.title,
            endpoint: selectedReport.endpoint,
          }}
          lawyers={lawyers}
          canAll={canAll}
          onClose={() => setSelectedReport(null)}
          onGenerated={() => {
            setSelectedReport(null);
            loadHistory();
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Card individual
────────────────────────────────────────────────────────────── */

function CatalogCardComponent({ card, onClick }: { card: CatalogCard; onClick: () => void }) {
  const Icon = card.icon;
  const disabled = card.status === 'coming_soon';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left p-3 border rounded-lg transition-colors ${
        disabled
          ? 'border-dashed border-border bg-muted/20 opacity-60 cursor-not-allowed'
          : 'border-border bg-card hover:border-primary hover:bg-accent/10'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon size={16} className={disabled ? 'text-muted-foreground' : 'text-primary'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-bold text-foreground">{card.title}</span>
            {disabled && (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
                Em breve
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">{card.description}</p>
        </div>
      </div>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */

function endpointForKind(kind: string): string | null {
  switch (kind) {
    case 'dashboard-snapshot':
    case 'snapshot-reuniao':
      return '/reports/dashboard-snapshot';
    case 'extrato-receitas':
    case 'extrato-despesas':
      return '/reports/transactions-statement';
    case 'charges-list':
    case 'cobrancas-list':
      return '/reports/charges-list';
    default:
      return null;
  }
}

function fmtDateTime(iso: string): string {
  const dt = new Date(iso);
  const date = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  const time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}
