/**
 * Performance por advogado — reuniao interna.
 *
 * Para cada advogado:
 *   - Receita gerada no periodo
 *   - Numero de casos ativos / arquivados
 *   - Ticket medio (receita / numero casos com receita)
 *   - Tempo medio de cobranca (dias entre charge.created_at e paid_at)
 *   - Inadimplencia da carteira (% das parcelas vencidas)
 *
 * Comparativo: ranking ordenado por receita.
 */

import {
  createReportContext, installRunningHeader, renderFirstPageHeader,
  renderKpiCards, renderSectionTitle, renderTable, renderFooterAllPages,
  renderObservationsAndClosing,
  TableColumn, fmtBRL, fmtDate,
} from './base-template';

export interface LawyerPerformanceRow {
  lawyerId: string;
  lawyerName: string;
  revenue: number;
  caseCount: number;
  archivedCount: number;
  avgTicket: number;
  avgPaymentDays: number | null;
  delinquencyPct: number;
  delinquencyAmount: number;
}

export interface LawyerPerformanceData {
  period: { from: string; to: string; label: string };
  generatedBy: string;
  observations?: string;
  rows: LawyerPerformanceRow[];
  totals: {
    totalRevenue: number;
    totalCases: number;
    overallAvgTicket: number;
  };
}

export function buildLawyerPerformancePdf(data: LawyerPerformanceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ctx = createReportContext({
      title: 'Performance por Advogado',
      generatedBy: data.generatedBy,
      filters: {
        summary: data.period.label,
        details: [{ label: 'Período', value: data.period.label }],
      },
      observations: data.observations,
      subtitle: `Período: ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)}`,
      orientation: 'landscape',
    });

    installRunningHeader(ctx);
    const chunks: Buffer[] = [];
    ctx.doc.on('data', (c: Buffer) => chunks.push(c));
    ctx.doc.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.doc.on('error', reject);

    renderFirstPageHeader(ctx);

    renderSectionTitle(ctx, 'Visão geral do escritório');
    renderKpiCards(ctx, [
      { label: 'Receita total', value: fmtBRL(data.totals.totalRevenue), tone: 'positive' },
      { label: 'Casos ativos', value: String(data.totals.totalCases), tone: 'neutral' },
      { label: 'Ticket médio geral', value: fmtBRL(data.totals.overallAvgTicket), tone: 'neutral' },
      {
        label: 'Advogados',
        value: String(data.rows.length),
        sublabel: 'Com atividade no período',
        tone: 'neutral',
      },
    ]);

    if (data.rows.length === 0) {
      renderSectionTitle(ctx, 'Detalhamento');
      ctx.doc.font('Times-Italic').fontSize(11).fillColor('#666');
      ctx.doc.text('Nenhum advogado com atividade no período.');
      ctx.doc.fillColor('#000');
    } else {
      renderSectionTitle(ctx, 'Ranking', `${data.rows.length} advogado(s) ordenados por receita`);

      const cols: TableColumn[] = [
        { header: '#', width: 30, align: 'center' },
        { header: 'Advogado', width: 160 },
        { header: 'Receita', width: 100, align: 'right' },
        { header: 'Casos', width: 60, align: 'right' },
        { header: 'Ticket médio', width: 100, align: 'right' },
        { header: 'Tempo médio cob.', width: 90, align: 'right' },
        { header: 'Inadimplência', align: 'right' },
      ];

      const rows = data.rows.map((r, i) => ({
        '#': String(i + 1),
        Advogado: r.lawyerName,
        Receita: fmtBRL(r.revenue),
        Casos: `${r.caseCount}${r.archivedCount > 0 ? ` (${r.archivedCount} arq.)` : ''}`,
        'Ticket médio': fmtBRL(r.avgTicket),
        'Tempo médio cob.': r.avgPaymentDays !== null ? `${r.avgPaymentDays.toFixed(0)} d` : '—',
        Inadimplência: `${r.delinquencyPct.toFixed(1)}% (${fmtBRL(r.delinquencyAmount)})`,
      }));

      renderTable(ctx, cols, rows as any);
    }

    renderObservationsAndClosing(ctx);
    renderFooterAllPages(ctx);
    ctx.doc.end();
  });
}
