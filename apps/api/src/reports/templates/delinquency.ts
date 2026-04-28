/**
 * Inadimplencia detalhada — relatorio gerencial.
 *
 * Estrutura:
 *   1. Aging com 5 faixas (visualizacao de barras horizontais ASCII).
 *   2. Top 10 inadimplentes (cliente · valor devido · dias em atraso · ultima cobranca).
 *   3. Cobrancas por status Asaas.
 *   4. Taxa de recuperacao 30/60/90d.
 */

import {
  createReportContext, installRunningHeader, renderFirstPageHeader,
  renderKpiCards, renderSectionTitle, renderTable, renderFooterAllPages,
  renderObservationsAndClosing,
  TableColumn, fmtBRL, fmtDate,
} from './base-template';

export interface DelinquencyData {
  scopeLabel: string;
  generatedBy: string;
  observations?: string;

  aging: Array<{ label: string; total: number; count: number }>;
  topDelinquent: Array<{
    leadName: string;
    leadCpf: string | null;
    totalDue: number;
    oldestDueDate: string | null;
    daysOverdue: number;
    lastReminderAt: string | null;
    lastReminderKind: string | null;
  }>;
  byAsaasStatus: Array<{ status: string; count: number; total: number }>;
  recoveryRate: {
    payed30d: number;   // % das vencidas que foram pagas em <= 30 dias
    payed60d: number;
    payed90d: number;
    sampleSize: number;
  };

  totals: {
    totalOverdue: number;
    totalPending: number;
  };
}

export function buildDelinquencyPdf(data: DelinquencyData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ctx = createReportContext({
      title: 'Inadimplência — Relatório detalhado',
      generatedBy: data.generatedBy,
      filters: {
        summary: data.scopeLabel,
        details: [{ label: 'Escopo', value: data.scopeLabel }],
      },
      observations: data.observations,
      orientation: 'landscape',
    });

    installRunningHeader(ctx);
    const chunks: Buffer[] = [];
    ctx.doc.on('data', (c: Buffer) => chunks.push(c));
    ctx.doc.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.doc.on('error', reject);

    renderFirstPageHeader(ctx);

    // Resumo executivo
    renderSectionTitle(ctx, 'Resumo executivo');
    renderKpiCards(ctx, [
      { label: 'Total atrasado', value: fmtBRL(data.totals.totalOverdue), tone: 'negative' },
      { label: 'Total a vencer', value: fmtBRL(data.totals.totalPending), tone: 'neutral' },
      {
        label: 'Recuperação 30d',
        value: `${data.recoveryRate.payed30d.toFixed(1)}%`,
        sublabel: `${data.recoveryRate.sampleSize} cobranças amostradas`,
        tone: data.recoveryRate.payed30d >= 70 ? 'positive' : data.recoveryRate.payed30d >= 40 ? 'neutral' : 'negative',
      },
      {
        label: 'Recuperação 90d',
        value: `${data.recoveryRate.payed90d.toFixed(1)}%`,
        tone: data.recoveryRate.payed90d >= 80 ? 'positive' : 'neutral',
      },
    ]);

    // Aging
    renderSectionTitle(ctx, 'Aging — parcelas em aberto');
    renderTable(
      ctx,
      [
        { header: 'Faixa', width: 200 },
        { header: 'Quantidade', width: 100, align: 'right' },
        { header: 'Total', align: 'right' },
      ],
      data.aging.map((b) => ({
        Faixa: b.label,
        Quantidade: String(b.count),
        Total: fmtBRL(b.total),
      })),
    );

    // Top inadimplentes
    if (data.topDelinquent.length > 0) {
      ctx.doc.addPage();
      renderSectionTitle(ctx, `Top ${data.topDelinquent.length} inadimplentes`, 'Por valor total devido');
      const cols: TableColumn[] = [
        { header: 'Cliente', width: 180 },
        { header: 'CPF/CNPJ', width: 110 },
        { header: 'Valor devido', width: 100, align: 'right' },
        { header: 'Vencido há', width: 80, align: 'right' },
        { header: 'Última cobrança', align: 'left' },
      ];
      const rows = data.topDelinquent.map((d) => ({
        Cliente: d.leadName,
        'CPF/CNPJ': d.leadCpf || '—',
        'Valor devido': fmtBRL(d.totalDue),
        'Vencido há': `${d.daysOverdue} d`,
        'Última cobrança': formatLastReminder(d.lastReminderAt, d.lastReminderKind),
      }));
      renderTable(ctx, cols, rows);
    }

    // Por status Asaas
    if (data.byAsaasStatus.length > 0) {
      renderSectionTitle(ctx, 'Por status no Asaas');
      renderTable(
        ctx,
        [
          { header: 'Status', width: 200 },
          { header: 'Quantidade', width: 100, align: 'right' },
          { header: 'Total', align: 'right' },
        ],
        data.byAsaasStatus.map((s) => ({
          Status: s.status,
          Quantidade: String(s.count),
          Total: fmtBRL(s.total),
        })),
      );
    }

    // Taxa de recuperação
    renderSectionTitle(ctx, 'Taxa de recuperação histórica');
    renderTable(
      ctx,
      [
        { header: 'Janela', width: 150 },
        { header: '% pago dentro da janela', align: 'right' },
      ],
      [
        { Janela: 'Até 30 dias após vencer', '% pago dentro da janela': `${data.recoveryRate.payed30d.toFixed(1)}%` },
        { Janela: 'Até 60 dias após vencer', '% pago dentro da janela': `${data.recoveryRate.payed60d.toFixed(1)}%` },
        { Janela: 'Até 90 dias após vencer', '% pago dentro da janela': `${data.recoveryRate.payed90d.toFixed(1)}%` },
      ],
    );
    ctx.doc.font('Times-Italic').fontSize(10).fillColor('#666');
    ctx.doc.text(
      `Calculado sobre ${data.recoveryRate.sampleSize} cobrança(s) com due_date nos últimos 12 meses.`,
    );
    ctx.doc.fillColor('#000');

    renderObservationsAndClosing(ctx);
    renderFooterAllPages(ctx);
    ctx.doc.end();
  });
}

function formatLastReminder(at: string | null, kind: string | null): string {
  if (!at) return 'Nunca';
  const dt = new Date(at);
  const date = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  return kind ? `${date} (${kind})` : date;
}
