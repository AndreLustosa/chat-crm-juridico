/**
 * Faturamento por periodo — relatorio gerencial.
 *
 * Tabelas comparativas: por dia da semana, por semana, por mes, por trimestre.
 * Identifica sazonalidade.
 */

import {
  createReportContext, installRunningHeader, renderFirstPageHeader,
  renderKpiCards, renderSectionTitle, renderTable, renderFooterAllPages,
  renderObservationsAndClosing,
  fmtBRL, fmtDate,
} from './base-template';

export interface BillingByPeriodData {
  period: { from: string; to: string; label: string };
  scopeLabel: string;
  generatedBy: string;
  observations?: string;

  byWeekday: Array<{ weekday: string; total: number; count: number }>;
  byWeek: Array<{ weekStart: string; total: number; count: number }>;
  byMonth: Array<{ month: string; total: number; count: number }>;
  byQuarter: Array<{ quarter: string; total: number; count: number }>;

  totals: { gross: number; transactionsCount: number; avgTicket: number };
}

export function buildBillingByPeriodPdf(data: BillingByPeriodData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ctx = createReportContext({
      title: 'Faturamento por período',
      generatedBy: data.generatedBy,
      filters: {
        summary: `${data.period.label} · ${data.scopeLabel}`,
        details: [
          { label: 'Período', value: data.period.label },
          { label: 'Escopo', value: data.scopeLabel },
        ],
      },
      observations: data.observations,
      subtitle: `Período: ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)}`,
    });

    installRunningHeader(ctx);
    const chunks: Buffer[] = [];
    ctx.doc.on('data', (c: Buffer) => chunks.push(c));
    ctx.doc.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.doc.on('error', reject);

    renderFirstPageHeader(ctx);

    // Totais
    renderSectionTitle(ctx, 'Resumo do período');
    renderKpiCards(ctx, [
      { label: 'Total faturado', value: fmtBRL(data.totals.gross), tone: 'positive' },
      { label: 'Transações', value: String(data.totals.transactionsCount), tone: 'neutral' },
      { label: 'Ticket médio', value: fmtBRL(data.totals.avgTicket), tone: 'neutral' },
    ]);

    // Por dia da semana
    if (data.byWeekday.length > 0) {
      renderSectionTitle(ctx, 'Por dia da semana');
      renderTable(
        ctx,
        [
          { header: 'Dia', width: 120 },
          { header: 'Quantidade', width: 100, align: 'right' },
          { header: 'Total', align: 'right' },
        ],
        data.byWeekday.map((d) => ({
          Dia: d.weekday,
          Quantidade: String(d.count),
          Total: fmtBRL(d.total),
        })),
      );
    }

    // Por mes
    if (data.byMonth.length > 0) {
      renderSectionTitle(ctx, 'Por mês');
      renderTable(
        ctx,
        [
          { header: 'Mês', width: 120 },
          { header: 'Quantidade', width: 100, align: 'right' },
          { header: 'Total', align: 'right' },
        ],
        data.byMonth.map((m) => ({
          Mês: m.month,
          Quantidade: String(m.count),
          Total: fmtBRL(m.total),
        })),
      );
    }

    // Por trimestre
    if (data.byQuarter.length > 0) {
      renderSectionTitle(ctx, 'Por trimestre');
      renderTable(
        ctx,
        [
          { header: 'Trimestre', width: 120 },
          { header: 'Quantidade', width: 100, align: 'right' },
          { header: 'Total', align: 'right' },
        ],
        data.byQuarter.map((q) => ({
          Trimestre: q.quarter,
          Quantidade: String(q.count),
          Total: fmtBRL(q.total),
        })),
      );
    }

    // Por semana (ultima pagina, anexo)
    if (data.byWeek.length > 0) {
      ctx.doc.addPage();
      renderSectionTitle(ctx, 'Anexo — Por semana', `${data.byWeek.length} semanas`);
      renderTable(
        ctx,
        [
          { header: 'Semana iniciando', width: 130 },
          { header: 'Quantidade', width: 100, align: 'right' },
          { header: 'Total', align: 'right' },
        ],
        data.byWeek.map((w) => ({
          'Semana iniciando': fmtDate(w.weekStart),
          Quantidade: String(w.count),
          Total: fmtBRL(w.total),
        })),
      );
    }

    renderObservationsAndClosing(ctx);
    renderFooterAllPages(ctx);
    ctx.doc.end();
  });
}
