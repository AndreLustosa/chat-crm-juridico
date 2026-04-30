/**
 * Tráfego (Google Ads) — Snapshot.
 *
 * Estrutura:
 *   1. Cabeçalho (logo + filtros — período, conta).
 *   2. KPIs do período: gasto, leads, CPL, CTR, CPC médio, ROAS, campanhas
 *      ativas/pausadas.
 *   3. Tabela "Performance por campanha": nome, status, canal, impressões,
 *      cliques, gasto, conv, CPL.
 *   4. Tabela "Resumo diário": data, impressões, cliques, gasto, conv, CTR%.
 *   5. Observações + rodapé.
 *
 * Reusa todos os helpers do base-template.ts (createReportContext,
 * renderKpiCards, renderSectionTitle, renderTable, renderFooterAllPages).
 */

import {
  createReportContext,
  renderRunningHeader,
  renderFirstPageHeader,
  renderKpiCards,
  renderSectionTitle,
  renderTable,
  renderFooterAllPages,
  renderObservationsAndClosing,
  TableColumn,
  fmtBRL,
} from './base-template';

export interface TrafegoSnapshotData {
  period: { from: string; to: string; label: string };
  account: {
    customer_id: string;
    account_name: string | null;
    last_sync_at: string | null;
  };
  generatedBy: string;

  kpis: {
    spend_brl: number;
    leads: number;
    cpl_brl: number;
    ctr: number; // 0..1
    avg_cpc_brl: number;
    roas: number;
    impressions: number;
    clicks: number;
    active_campaigns: number;
    paused_campaigns: number;
  };

  /** Tabela por campanha — agregado do periodo */
  byCampaign: Array<{
    name: string;
    status: string;
    channel_type: string | null;
    impressions: number;
    clicks: number;
    cost_brl: number;
    conversions: number;
    cpl_brl: number;
  }>;

  /** Tabela por dia — agregado total da conta */
  byDay: Array<{
    date: string; // YYYY-MM-DD
    impressions: number;
    clicks: number;
    cost_brl: number;
    conversions: number;
    ctr: number; // 0..1
  }>;

  observations?: string;
}

export function buildTrafegoSnapshotPdf(data: TrafegoSnapshotData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let ctx: ReturnType<typeof createReportContext> | null = null;
    try {
      ctx = createReportContext({
        title: 'Tráfego Google Ads — Snapshot',
        generatedBy: data.generatedBy,
        filters: {
          summary: `${data.period.label} · Conta ${data.account.customer_id}`,
          details: [
            { label: 'Período', value: data.period.label },
            {
              label: 'Conta',
              value: `${data.account.account_name ?? data.account.customer_id} (${data.account.customer_id})`,
            },
            ...(data.account.last_sync_at
              ? [
                  {
                    label: 'Último sync',
                    value: new Date(data.account.last_sync_at).toLocaleString(
                      'pt-BR',
                    ),
                  },
                ]
              : []),
          ],
        },
        observations: data.observations,
        subtitle: `Período: ${data.period.from} a ${data.period.to}`,
      });

      const buffers: Buffer[] = [];
      ctx.doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      ctx.doc.on('end', () => resolve(Buffer.concat(buffers)));
      ctx.doc.on('error', reject);

      // ─── Cabeçalho corrente em todas as páginas ────────────────────────
      // bufferPages com 1 page só — header desenhado depois nas demais via switchToPage
      renderRunningHeader(ctx);
      renderFirstPageHeader(ctx);

      // ─── KPIs ─────────────────────────────────────────────────────────
      const kpiTone = (v: number, target?: number, lowerBetter = false) => {
        if (target === undefined || target === null) return 'neutral' as const;
        if (lowerBetter) return v <= target ? ('positive' as const) : ('negative' as const);
        return v >= target ? ('positive' as const) : ('negative' as const);
      };

      renderKpiCards(ctx, [
        {
          label: 'Gasto',
          value: fmtBRL(data.kpis.spend_brl),
          sublabel: `${data.kpis.impressions.toLocaleString('pt-BR')} impr · ${data.kpis.clicks.toLocaleString('pt-BR')} cliques`,
        },
        {
          label: 'Leads',
          value: data.kpis.leads.toString(),
          tone: data.kpis.leads > 0 ? 'positive' : 'negative',
        },
        {
          label: 'CPL médio',
          value: fmtBRL(data.kpis.cpl_brl),
        },
        {
          label: 'CTR médio',
          value: `${(data.kpis.ctr * 100).toFixed(2)}%`,
        },
        {
          label: 'CPC médio',
          value: fmtBRL(data.kpis.avg_cpc_brl),
        },
        {
          label: 'ROAS estimado',
          value: `${data.kpis.roas.toFixed(2)}x`,
          tone: kpiTone(data.kpis.roas, 1.0),
        },
        {
          label: 'Campanhas ativas',
          value: data.kpis.active_campaigns.toString(),
          tone: 'positive',
        },
        {
          label: 'Campanhas pausadas',
          value: data.kpis.paused_campaigns.toString(),
          tone: 'neutral',
        },
      ]);

      // ─── Performance por campanha ──────────────────────────────────────
      if (data.byCampaign.length > 0) {
        renderSectionTitle(
          ctx,
          'Performance por campanha',
          `Agregado do período (${data.byCampaign.length} campanha(s))`,
        );

        const colsCampaigns: TableColumn[] = [
          { header: 'Campanha', width: 180 },
          { header: 'Status', width: 60, align: 'left' },
          { header: 'Canal', width: 70, align: 'left' },
          { header: 'Impr.', width: 50, align: 'right' },
          { header: 'Cliques', width: 50, align: 'right' },
          { header: 'Gasto', width: 60, align: 'right' },
          { header: 'Conv.', width: 40, align: 'right' },
          { header: 'CPL', width: 60, align: 'right' },
        ];

        const rowsCampaigns = data.byCampaign.map((c) => ({
          Campanha: c.name,
          Status: statusLabel(c.status),
          Canal: c.channel_type ?? '—',
          'Impr.': c.impressions.toLocaleString('pt-BR'),
          Cliques: c.clicks.toLocaleString('pt-BR'),
          Gasto: fmtBRL(c.cost_brl),
          'Conv.': c.conversions.toFixed(0),
          CPL: c.cpl_brl > 0 ? fmtBRL(c.cpl_brl) : '—',
        }));

        renderTable(ctx, colsCampaigns, rowsCampaigns);
      } else {
        renderSectionTitle(ctx, 'Performance por campanha');
        ctx.doc
          .font('Times-Italic')
          .fontSize(11)
          .fillColor('#666')
          .text('Nenhuma campanha com dados no período.');
      }

      // ─── Resumo diário ─────────────────────────────────────────────────
      if (data.byDay.length > 0) {
        renderSectionTitle(
          ctx,
          'Resumo diário',
          `${data.byDay.length} dia(s) com dados`,
        );

        const colsDay: TableColumn[] = [
          { header: 'Data', width: 70 },
          { header: 'Impressões', width: 70, align: 'right' },
          { header: 'Cliques', width: 60, align: 'right' },
          { header: 'CTR %', width: 50, align: 'right' },
          { header: 'Gasto', width: 70, align: 'right' },
          { header: 'Conversões', width: 70, align: 'right' },
        ];

        const rowsDay = data.byDay.map((d) => ({
          Data: formatDateBR(d.date),
          'Impressões': d.impressions.toLocaleString('pt-BR'),
          Cliques: d.clicks.toLocaleString('pt-BR'),
          'CTR %': `${(d.ctr * 100).toFixed(2)}%`,
          Gasto: fmtBRL(d.cost_brl),
          'Conversões': d.conversions.toFixed(0),
        }));

        renderTable(ctx, colsDay, rowsDay);
      }

      // ─── Observações + fechamento ──────────────────────────────────────
      renderObservationsAndClosing(ctx);

      // Aplica rodapé em todas as páginas (precisa bufferPages)
      renderFooterAllPages(ctx);

      ctx.doc.end();
    } catch (e: any) {
      // Se setup falhou antes de pipe, tenta encerrar doc e rejeitar
      try {
        ctx?.doc?.end?.();
      } catch {
        // ignora
      }
      reject(e);
    }
  });
}

// ─── Helpers locais ─────────────────────────────────────────────────────

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ENABLED: 'Ativa',
    PAUSED: 'Pausada',
    REMOVED: 'Removida',
    UNSPECIFIED: '—',
  };
  return map[status] ?? status;
}

function formatDateBR(iso: string): string {
  // iso = YYYY-MM-DD
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
