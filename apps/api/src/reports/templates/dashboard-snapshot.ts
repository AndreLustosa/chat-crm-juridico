/**
 * Dashboard Snapshot — PDF do estado atual da aba Resumo.
 *
 * Estrutura:
 *   1. Cabeçalho com filtros (período, advogado, comparação).
 *   2. KPIs (Receita realizada, Despesas, Saldo, A receber) com MoM.
 *   3. Faixa "Mês a mês" (Receita / Despesa / Saldo lado a lado).
 *   4. Aging — parcelas em aberto.
 *   5. Receita por advogado (top N).
 *   6. Tabela de cobranças pendentes (anexo).
 *   7. Observações + disclaimer.
 *
 * Quando includeCharts=false, omite Receita por advogado + Aging visual
 * (só mantém os números) — útil pra impressão rápida.
 *
 * Quando includeDetailTable=false, omite a tabela final de cobranças
 * pendentes — útil pra reuniões executivas onde só os KPIs importam.
 */

import {
  createReportContext, installRunningHeader, renderFirstPageHeader,
  renderKpiCards, renderSectionTitle, renderTable, renderFooterAllPages,
  renderObservationsAndClosing,
  TableColumn, ReportContext, fmtBRL, fmtDate,
  COLORS, FONTS, SIZES,
} from './base-template';

export interface DashboardSnapshotData {
  period: { from: string; to: string; label: string };
  comparedTo: { label: string };
  scopeLabel: string; // "Todos os advogados" ou "Dra. Gianny"
  generatedBy: string;

  kpis: {
    revenue: { value: number; previous: number; deltaPct: number | null };
    expenses: { value: number; previous: number; deltaPct: number | null };
    balance: { value: number; previous: number };
    receivable: { value: number; dueValue?: number; overdueValue?: number };
  };
  monthOverMonth: {
    revenue: { current: number; previous: number; deltaPct: number | null };
    expenses: { current: number; previous: number; deltaPct: number | null };
    balance: { current: number; previous: number; deltaPct: number | null };
  };
  aging: Array<{ label: string; total: number; count: number }>;
  byLawyer: Array<{ lawyerName: string; revenue: number }>;
  pendingCharges: Array<{
    leadName: string;
    caseNumber: string | null;
    dueDate: string | null;
    amount: number;
    status: string;
    asaasStatus: string;
  }>;
  goalSummary?: {
    target: number;
    realized: number;
    progressPct: number;
  } | null;

  // Opções
  includeCharts?: boolean;
  includeDetailTable?: boolean;
  observations?: string;
  orientation?: 'portrait' | 'landscape';
}

export function buildDashboardSnapshotPdf(data: DashboardSnapshotData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ctx = createReportContext({
      title: 'Dashboard Financeiro — Snapshot',
      generatedBy: data.generatedBy,
      filters: {
        summary: `${data.period.label} · ${data.scopeLabel}`,
        details: [
          { label: 'Período', value: data.period.label },
          { label: 'Escopo', value: data.scopeLabel },
          { label: 'Comparado com', value: data.comparedTo.label },
        ],
      },
      observations: data.observations,
      subtitle: `Período: ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)}`,
      orientation: data.orientation,
    });

    installRunningHeader(ctx);
    const chunks: Buffer[] = [];
    ctx.doc.on('data', (c: Buffer) => chunks.push(c));
    ctx.doc.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.doc.on('error', reject);

    // 1. Cabeçalho da primeira página
    renderFirstPageHeader(ctx);

    // 2. KPIs principais
    renderSectionTitle(ctx, 'Resumo executivo');
    renderKpiCards(ctx, [
      {
        label: 'Receita realizada',
        value: fmtBRL(data.kpis.revenue.value),
        sublabel: deltaSublabel(data.kpis.revenue.deltaPct, data.kpis.revenue.previous, data.comparedTo.label),
        tone: data.kpis.revenue.deltaPct != null && data.kpis.revenue.deltaPct > 0 ? 'positive' : data.kpis.revenue.deltaPct != null && data.kpis.revenue.deltaPct < -2 ? 'negative' : 'neutral',
      },
      {
        label: 'Despesas',
        value: fmtBRL(data.kpis.expenses.value),
        sublabel: deltaSublabel(data.kpis.expenses.deltaPct, data.kpis.expenses.previous, data.comparedTo.label),
        tone: data.kpis.expenses.deltaPct != null && data.kpis.expenses.deltaPct > 2 ? 'negative' : data.kpis.expenses.deltaPct != null && data.kpis.expenses.deltaPct < -2 ? 'positive' : 'neutral',
      },
      {
        label: 'Saldo',
        value: fmtBRL(data.kpis.balance.value),
        sublabel: `vs ${data.comparedTo.label}: ${fmtBRL(data.kpis.balance.previous)}`,
        tone: data.kpis.balance.value >= 0 ? 'positive' : 'negative',
      },
      {
        label: 'A receber',
        value: fmtBRL(data.kpis.receivable.value),
        sublabel:
          data.kpis.receivable.overdueValue && data.kpis.receivable.overdueValue > 0
            ? `Vencido: ${fmtBRL(data.kpis.receivable.overdueValue)}`
            : 'Total a vencer',
        tone: data.kpis.receivable.overdueValue && data.kpis.receivable.overdueValue > 0 ? 'negative' : 'neutral',
      },
    ]);

    // 3. Mês a mês (3 blocos)
    renderSectionTitle(ctx, 'Mês a mês', `Comparação ${data.period.label} vs ${data.comparedTo.label}`);
    renderMonthOverMonthBlock(ctx, data.monthOverMonth, data.period.label, data.comparedTo.label);

    // 4. Meta (se houver)
    if (data.goalSummary) {
      renderSectionTitle(ctx, 'Meta do mês');
      const pct = data.goalSummary.progressPct.toFixed(1);
      renderKpiCards(ctx, [
        { label: 'Realizado', value: fmtBRL(data.goalSummary.realized) },
        { label: 'Meta', value: fmtBRL(data.goalSummary.target) },
        { label: 'Atingido', value: `${pct}%`, tone: data.goalSummary.progressPct >= 80 ? 'positive' : data.goalSummary.progressPct >= 50 ? 'neutral' : 'negative' },
      ]);
    }

    // 5. Aging
    if (data.aging.length > 0) {
      renderSectionTitle(ctx, 'Aging — parcelas em aberto');
      const agingCols: TableColumn[] = [
        { header: 'Faixa', width: 150 },
        { header: 'Quantidade', width: 100, align: 'right' },
        { header: 'Total', align: 'right' },
      ];
      const agingRows = data.aging.map((b) => ({
        Faixa: b.label,
        Quantidade: String(b.count),
        Total: fmtBRL(b.total),
      }));
      renderTable(ctx, agingCols, agingRows);
    }

    // 6. Receita por advogado (se incluir gráficos = sim)
    if (data.includeCharts !== false && data.byLawyer.length > 0) {
      renderSectionTitle(ctx, 'Receita por advogado', `Top ${Math.min(data.byLawyer.length, 8)}`);
      const lawCols: TableColumn[] = [
        { header: 'Advogado' },
        { header: 'Receita realizada', width: 160, align: 'right' },
      ];
      const lawRows = data.byLawyer.slice(0, 8).map((l) => ({
        Advogado: l.lawyerName,
        'Receita realizada': fmtBRL(l.revenue),
      }));
      renderTable(ctx, lawCols, lawRows);
    }

    // 7. Tabela de cobranças pendentes (anexo, se habilitado)
    if (data.includeDetailTable !== false && data.pendingCharges.length > 0) {
      ctx.doc.addPage();
      renderSectionTitle(ctx, 'Anexo — Cobranças pendentes', `${data.pendingCharges.length} parcelas em aberto`);
      const chargeCols: TableColumn[] = [
        { header: 'Cliente', width: 160 },
        { header: 'Processo', width: 130 },
        { header: 'Vencimento', width: 80, align: 'center' },
        { header: 'Valor', width: 80, align: 'right' },
        { header: 'Status', width: 70, align: 'center' },
        { header: 'Asaas', align: 'center' },
      ];
      const chargeRows = data.pendingCharges.map((c) => ({
        Cliente: c.leadName,
        Processo: c.caseNumber || '—',
        Vencimento: c.dueDate ? fmtDate(c.dueDate) : '—',
        Valor: fmtBRL(c.amount),
        Status: paymentStatusLabel(c.status, c.dueDate),
        Asaas: c.asaasStatus,
      }));
      renderTable(ctx, chargeCols, chargeRows);
    }

    // 8. Observações + disclaimer
    renderObservationsAndClosing(ctx);

    // 9. Rodapé em todas as páginas
    renderFooterAllPages(ctx);

    ctx.doc.end();
  });
}

// ─── Helpers internos ───────────────────────────────────

function deltaSublabel(deltaPct: number | null, previous: number, prevLabel: string): string {
  if (deltaPct == null) return `vs ${prevLabel}: —`;
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1)}% vs ${prevLabel} (${fmtBRL(previous)})`;
}

function paymentStatusLabel(status: string, dueDate: string | null): string {
  if (status === 'PAGO') return 'Pago';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dueDate) {
    const dt = new Date(dueDate);
    dt.setHours(0, 0, 0, 0);
    if (dt < today) return 'Atrasado';
    if (dt.getTime() === today.getTime()) return 'Vence hoje';
  }
  return 'A vencer';
}

function renderMonthOverMonthBlock(
  ctx: ReportContext,
  mom: DashboardSnapshotData['monthOverMonth'],
  currentLabel: string,
  prevLabel: string,
) {
  const blocks = [
    { key: 'Receita', current: mom.revenue.current, previous: mom.revenue.previous, deltaPct: mom.revenue.deltaPct, semantic: 'positive-good' as const },
    { key: 'Despesa', current: mom.expenses.current, previous: mom.expenses.previous, deltaPct: mom.expenses.deltaPct, semantic: 'positive-bad' as const },
    { key: 'Saldo', current: mom.balance.current, previous: mom.balance.previous, deltaPct: mom.balance.deltaPct, semantic: 'positive-good' as const },
  ];

  const cards = blocks.map((b) => {
    const sign = b.deltaPct == null ? '—' : `${b.deltaPct > 0 ? '+' : ''}${b.deltaPct.toFixed(1)}%`;
    const tone =
      b.deltaPct == null ? 'neutral' :
      b.semantic === 'positive-good'
        ? b.deltaPct > 2 ? 'positive' : b.deltaPct < -2 ? 'negative' : 'neutral'
        : b.deltaPct > 2 ? 'negative' : b.deltaPct < -2 ? 'positive' : 'neutral';
    return {
      label: b.key,
      value: fmtBRL(b.current),
      sublabel: `${prevLabel}: ${fmtBRL(b.previous)} · Δ ${sign}`,
      tone: tone as any,
    };
  });
  renderKpiCards(ctx, cards);
}
