/**
 * Template generico de extrato de transacoes (FinancialTransaction).
 *
 * Usado por:
 *   - Extrato de receitas (type=RECEITA)
 *   - Extrato de despesas (type=DESPESA)
 *
 * Formato:
 *   Pag 1: titulo + filtros + totalizadores (4 cards: total bruto, pago,
 *          a receber/pagar, atrasado)
 *   Pag 2+: tabela cronologica completa (Data · Categoria · Descrição ·
 *           Cliente/Fornecedor · Status · Valor)
 *   Ultima: observacoes + disclaimer
 */

import {
  createReportContext, installRunningHeader, renderFirstPageHeader,
  renderKpiCards, renderSectionTitle, renderTable, renderFooterAllPages,
  renderObservationsAndClosing,
  TableColumn, fmtBRL, fmtDate,
} from './base-template';

export interface StatementRow {
  date: string;             // ISO
  category: string;
  description: string;
  counterpart: string;      // cliente OU fornecedor
  status: 'PAGO' | 'PENDENTE' | 'CANCELADO';
  amount: number;
  paidAt: string | null;
  dueDate: string | null;
}

export interface StatementData {
  type: 'RECEITA' | 'DESPESA';
  period: { from: string; to: string; label: string };
  scopeLabel: string;
  generatedBy: string;

  rows: StatementRow[];
  totals: {
    gross: number;          // soma todos
    paid: number;           // soma PAGO
    pending: number;        // soma PENDENTE
    overdue: number;        // soma PENDENTE com due_date < hoje
  };

  observations?: string;
  orientation?: 'portrait' | 'landscape';
  /** Quando true, omite a tabela detalhada (so totalizadores) */
  summaryOnly?: boolean;
}

export function buildStatementPdf(data: StatementData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const isReceita = data.type === 'RECEITA';
    const title = isReceita ? 'Extrato de Receitas' : 'Extrato de Despesas';
    const counterpartLabel = isReceita ? 'Cliente' : 'Fornecedor';

    const ctx = createReportContext({
      title,
      generatedBy: data.generatedBy,
      filters: {
        summary: `${data.period.label} · ${data.scopeLabel}`,
        details: [
          { label: 'Período', value: data.period.label },
          { label: 'Escopo', value: data.scopeLabel },
          { label: 'Tipo', value: isReceita ? 'Receitas' : 'Despesas' },
        ],
      },
      observations: data.observations,
      subtitle: `Período: ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)}`,
      orientation: data.orientation || (data.summaryOnly ? 'portrait' : 'landscape'),
    });

    installRunningHeader(ctx);
    const chunks: Buffer[] = [];
    ctx.doc.on('data', (c: Buffer) => chunks.push(c));
    ctx.doc.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.doc.on('error', reject);

    // 1. Cabeçalho
    renderFirstPageHeader(ctx);

    // 2. Totalizadores
    renderSectionTitle(ctx, 'Totalizadores do período');
    renderKpiCards(ctx, [
      {
        label: 'Total bruto',
        value: fmtBRL(data.totals.gross),
        sublabel: `${data.rows.length} registro(s)`,
        tone: 'neutral',
      },
      {
        label: isReceita ? 'Recebido' : 'Pago',
        value: fmtBRL(data.totals.paid),
        sublabel: `${pctOf(data.totals.paid, data.totals.gross)}% do bruto`,
        tone: 'positive',
      },
      {
        label: isReceita ? 'A receber' : 'A pagar',
        value: fmtBRL(data.totals.pending),
        sublabel: `${pctOf(data.totals.pending, data.totals.gross)}% do bruto`,
        tone: 'neutral',
      },
      {
        label: 'Atrasado',
        value: fmtBRL(data.totals.overdue),
        sublabel:
          data.totals.overdue > 0
            ? `${pctOf(data.totals.overdue, data.totals.pending)}% do pendente`
            : '—',
        tone: data.totals.overdue > 0 ? 'negative' : 'neutral',
      },
    ]);

    // 3. Tabela detalhada (a menos que summaryOnly)
    if (!data.summaryOnly && data.rows.length > 0) {
      ctx.doc.addPage();
      renderSectionTitle(ctx, 'Detalhamento', `${data.rows.length} lançamento(s)`);

      const cols: TableColumn[] = [
        { header: 'Data', width: 60, align: 'center' },
        { header: 'Categoria', width: 90 },
        { header: 'Descrição', width: 220 },
        { header: counterpartLabel, width: 130 },
        { header: 'Status', width: 70, align: 'center' },
        { header: 'Valor', align: 'right' },
      ];

      const rows = data.rows.map((r) => ({
        Data: fmtDate(r.paidAt || r.date),
        Categoria: r.category,
        Descrição: r.description,
        [counterpartLabel]: r.counterpart || '—',
        Status: statusLabel(r.status, r.dueDate),
        Valor: fmtBRL(r.amount),
      }));

      renderTable(ctx, cols, rows as any);
    }

    if (data.summaryOnly && data.rows.length > 0) {
      ctx.doc.font('Times-Italic').fontSize(10).fillColor('#666');
      ctx.doc.text(
        `Detalhamento omitido — gere novamente sem "Resumo apenas" pra ver os ${data.rows.length} lançamentos.`,
      );
      ctx.doc.fillColor('#000');
      ctx.doc.moveDown();
    }

    renderObservationsAndClosing(ctx);
    renderFooterAllPages(ctx);
    ctx.doc.end();
  });
}

function pctOf(part: number, total: number): string {
  if (total === 0) return '0';
  return ((part / total) * 100).toFixed(1);
}

function statusLabel(status: string, dueDate: string | null): string {
  if (status === 'PAGO') return 'Pago';
  if (status === 'CANCELADO') return 'Cancelado';
  if (status === 'PENDENTE') {
    if (dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dt = new Date(dueDate);
      dt.setHours(0, 0, 0, 0);
      if (dt < today) return 'Atrasado';
    }
    return 'Pendente';
  }
  return status;
}
