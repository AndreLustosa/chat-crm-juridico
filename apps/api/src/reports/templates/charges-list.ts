/**
 * Lista de cobrancas com status Asaas — extrato consolidado por advogado.
 * Reusa getOperationalCharges do FinancialDashboardService.
 */

import {
  createReportContext, installRunningHeader, renderFirstPageHeader,
  renderKpiCards, renderSectionTitle, renderTable, renderFooterAllPages,
  renderObservationsAndClosing,
  TableColumn, fmtBRL, fmtDate,
} from './base-template';

export interface ChargeListRow {
  leadName: string;
  leadCpf: string | null;
  caseNumber: string | null;
  legalArea: string | null;
  dueDate: string | null;
  amount: number;
  paymentStatus: string;
  asaasStatus: string;
  lawyerName: string | null;
}

export interface ChargesListData {
  filterLabel: string;       // "Atrasadas", "A vencer", etc
  period?: { from: string; to: string; label: string };
  scopeLabel: string;
  generatedBy: string;
  rows: ChargeListRow[];
  counts: {
    overdue: number;
    pending: number;
    awaitingAlvara: number;
    paid: number;
  };
  totals: {
    overdue: number;
    pending: number;
    paid: number;
  };
  observations?: string;
}

export function buildChargesListPdf(data: ChargesListData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ctx = createReportContext({
      title: 'Cobranças — Estado consolidado',
      generatedBy: data.generatedBy,
      filters: {
        summary: `${data.filterLabel} · ${data.scopeLabel}`,
        details: [
          { label: 'Filtro aplicado', value: data.filterLabel },
          { label: 'Escopo', value: data.scopeLabel },
        ],
      },
      observations: data.observations,
      subtitle: data.period ? `Período: ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)}` : undefined,
      orientation: 'landscape',
    });

    installRunningHeader(ctx);
    const chunks: Buffer[] = [];
    ctx.doc.on('data', (c: Buffer) => chunks.push(c));
    ctx.doc.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.doc.on('error', reject);

    renderFirstPageHeader(ctx);

    // Totais por status
    renderSectionTitle(ctx, 'Status atual');
    renderKpiCards(ctx, [
      {
        label: 'Atrasadas',
        value: String(data.counts.overdue),
        sublabel: fmtBRL(data.totals.overdue),
        tone: 'negative',
      },
      {
        label: 'A vencer',
        value: String(data.counts.pending),
        sublabel: fmtBRL(data.totals.pending),
        tone: 'neutral',
      },
      {
        label: 'Aguard. alvará',
        value: String(data.counts.awaitingAlvara),
        sublabel: 'Sem data de vencimento',
        tone: 'neutral',
      },
      {
        label: 'Pagas',
        value: String(data.counts.paid),
        sublabel: fmtBRL(data.totals.paid),
        tone: 'positive',
      },
    ]);

    if (data.rows.length === 0) {
      renderSectionTitle(ctx, 'Detalhamento');
      ctx.doc.font('Times-Italic').fontSize(11).fillColor('#666');
      ctx.doc.text('Nenhuma cobrança encontrada para o filtro selecionado.');
      ctx.doc.fillColor('#000');
    } else {
      ctx.doc.addPage();
      renderSectionTitle(ctx, 'Detalhamento', `${data.rows.length} cobrança(s)`);

      const cols: TableColumn[] = [
        { header: 'Cliente', width: 140 },
        { header: 'CPF/CNPJ', width: 90 },
        { header: 'Processo', width: 130 },
        { header: 'Área', width: 75 },
        { header: 'Vencimento', width: 70, align: 'center' },
        { header: 'Valor', width: 75, align: 'right' },
        { header: 'Status', width: 60, align: 'center' },
        { header: 'Asaas', align: 'center' },
      ];

      const rows = data.rows.map((r) => ({
        Cliente: r.leadName,
        'CPF/CNPJ': r.leadCpf || '—',
        Processo: r.caseNumber || '—',
        Área: r.legalArea || '—',
        Vencimento: r.dueDate ? fmtDate(r.dueDate) : '—',
        Valor: fmtBRL(r.amount),
        Status: r.paymentStatus,
        Asaas: r.asaasStatus,
      }));

      renderTable(ctx, cols, rows as any);
    }

    renderObservationsAndClosing(ctx);
    renderFooterAllPages(ctx);
    ctx.doc.end();
  });
}
