/**
 * Base template para relatórios PDF do escritório.
 *
 * Helpers para cabeçalho (logo + nome + paginação), rodapé (data de geração
 * + filtros + paginação) e seções comuns (KPI cards, tabelas zebradas,
 * resumo executivo).
 *
 * Padrão visual:
 *   - Times-Roman 11pt corpo, 14pt títulos seção, 18pt título relatório
 *   - Margens 2cm
 *   - Tabelas zebradas (linhas alternadas cinza claro)
 *   - Header/footer em sans-serif Helvetica 9pt
 *
 * Uso:
 *   const ctx = createReportContext({ title, period, filters, ... });
 *   ctx.doc.pipe(stream);
 *   await renderHeader(ctx);
 *   renderFirstPageHeader(ctx);
 *   ... corpo ...
 *   renderFooter(ctx);
 *   ctx.doc.end();
 */

import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Constantes visuais ─────────────────────────────────

export const COLORS = {
  text: '#1a1a1a',
  muted: '#666',
  faint: '#999',
  rule: '#cccccc',
  zebra: '#f6f6f6',
  positive: '#196c4f',
  negative: '#9e2a2a',
  primary: '#3d2914', // marrom escuro do brand
};

export const FONTS = {
  body: 'Times-Roman',
  bold: 'Times-Bold',
  italic: 'Times-Italic',
  sans: 'Helvetica',
  sansBold: 'Helvetica-Bold',
};

export const SIZES = {
  title: 18,
  section: 14,
  body: 11,
  small: 10,
  meta: 9,
};

const PAGE_MARGIN_PT = 56.7; // 2cm em pontos

// ─── Tipos ──────────────────────────────────────────────

export interface ReportFilters {
  /** Texto livre que vai no rodapé (ex.: "Mes: Abril/2026 · Advogado: todos") */
  summary: string;
  /** Lista de pares chave-valor pra exibir num bloco no topo */
  details?: Array<{ label: string; value: string }>;
}

export interface ReportContext {
  doc: any; // PDFKit.PDFDocument — typing weak no pdfkit
  title: string;
  generatedBy: string;
  generatedAt: Date;
  filters: ReportFilters;
  /** Texto livre opcional (vai na ultima pagina) */
  observations?: string;
  /** Subtítulo curto (ex: "Período: 01/04/2026 a 30/04/2026") */
  subtitle?: string;
}

// ─── Logo carregado uma vez ─────────────────────────────

let logoBuffer: Buffer | null = null;
function getLogoBuffer(): Buffer | null {
  if (logoBuffer) return logoBuffer;
  // Configurado em nest-cli.json pra copiar src/reports/assets/* pra dist/.
  // Em runtime (Docker), __dirname e dist/reports/templates/, entao
  // ../assets/ resolve pra dist/reports/assets/.
  // Em dev (ts-node), __dirname e src/reports/templates/, entao
  // ../assets/ resolve pra src/reports/assets/.
  const candidates = [
    join(__dirname, '../assets/logo.png'),
    join(process.cwd(), 'src/reports/assets/logo.png'),
    join(process.cwd(), 'dist/reports/assets/logo.png'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      logoBuffer = readFileSync(p);
      return logoBuffer;
    }
  }
  return null;
}

// ─── Setup do documento ─────────────────────────────────

export function createReportContext(params: {
  title: string;
  generatedBy: string;
  filters: ReportFilters;
  observations?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
}): ReportContext {
  const doc = new PDFDocument({
    size: 'A4',
    layout: params.orientation || 'portrait',
    margins: { top: PAGE_MARGIN_PT + 18, bottom: PAGE_MARGIN_PT + 18, left: PAGE_MARGIN_PT, right: PAGE_MARGIN_PT },
    bufferPages: true, // permite editar páginas depois (paginação X de Y)
    info: {
      Title: params.title,
      Author: 'André Lustosa Advogados',
      Creator: 'CRM Lustosa Advogados',
      Producer: 'pdfkit',
    },
  });

  return {
    doc,
    title: params.title,
    generatedBy: params.generatedBy,
    generatedAt: new Date(),
    filters: params.filters,
    observations: params.observations,
    subtitle: params.subtitle,
  };
}

// ─── Cabeçalho (em todas as páginas) ────────────────────

export function renderRunningHeader(ctx: ReportContext) {
  const { doc } = ctx;
  const left = PAGE_MARGIN_PT;
  const right = doc.page.width - PAGE_MARGIN_PT;
  const top = PAGE_MARGIN_PT - 24;

  const logo = getLogoBuffer();
  if (logo) {
    try {
      doc.image(logo, left, top, { width: 28 });
    } catch {
      // se falhar, ignora — header sem logo
    }
  }

  doc.font(FONTS.sansBold).fontSize(SIZES.meta).fillColor(COLORS.text);
  doc.text('André Lustosa Advogados', left + 36, top + 4, { width: 250 });
  doc.font(FONTS.sans).fontSize(SIZES.meta).fillColor(COLORS.muted);
  doc.text('OAB/AL 14.209', left + 36, top + 16, { width: 250 });

  // Linha sutil abaixo
  doc.strokeColor(COLORS.rule).lineWidth(0.5).moveTo(left, top + 30).lineTo(right, top + 30).stroke();

  // Reset cursor pra área de conteúdo
  doc.fillColor(COLORS.text);
}

// ─── Rodapé com paginação ───────────────────────────────

/**
 * Aplica rodapé em todas as páginas. Chamar DEPOIS de renderizar todo o conteúdo,
 * antes de doc.end(). Usa bufferPages.
 */
export function renderFooterAllPages(ctx: ReportContext) {
  const { doc } = ctx;
  const range = doc.bufferedPageRange();
  const total = range.start + range.count;

  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    const pageNumber = i + 1;
    renderFooterCurrentPage(ctx, pageNumber, total);
  }
}

function renderFooterCurrentPage(ctx: ReportContext, pageNumber: number, totalPages: number) {
  const { doc } = ctx;
  const left = PAGE_MARGIN_PT;
  const right = doc.page.width - PAGE_MARGIN_PT;
  const bottom = doc.page.height - PAGE_MARGIN_PT + 12;

  // CRITICAL: Bug 2026-04-28 — cada doc.text() no footer estava em y >
  // (page.height - page.margins.bottom), entao PDFKit auto-criava nova pagina
  // a cada chamada (8 paginas extras vazias no PDF). Fix: zera margem inferior
  // temporariamente pra desligar o auto-page-break, restaura depois.
  const origBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  try {
    doc.strokeColor(COLORS.rule).lineWidth(0.5).moveTo(left, bottom - 6).lineTo(right, bottom - 6).stroke();

    doc.font(FONTS.sans).fontSize(SIZES.meta).fillColor(COLORS.muted);
    const generatedAt = formatDateTime(ctx.generatedAt);
    doc.text(`Gerado em ${generatedAt}`, left, bottom, {
      width: (right - left) / 2,
      lineBreak: false,
    });
    doc.text(`Por: ${ctx.generatedBy}`, left, bottom + 10, {
      width: (right - left) / 2,
      lineBreak: false,
    });
    doc.text(`${pageNumber} / ${totalPages}`, left, bottom, {
      width: right - left,
      align: 'right',
      lineBreak: false,
    });
    if (ctx.filters.summary) {
      doc.fillColor(COLORS.faint);
      doc.text(ctx.filters.summary, left + (right - left) / 2, bottom + 10, {
        width: (right - left) / 2,
        align: 'right',
        lineBreak: false,
      });
    }
    doc.fillColor(COLORS.text);
  } finally {
    doc.page.margins.bottom = origBottomMargin;
  }
}

// ─── Cabeçalho da primeira página (título + filtros) ─────

export function renderFirstPageHeader(ctx: ReportContext) {
  const { doc, title, subtitle, filters } = ctx;

  doc.font(FONTS.bold).fontSize(SIZES.title).fillColor(COLORS.text);
  doc.text(title, { align: 'left' });
  doc.moveDown(0.2);

  if (subtitle) {
    doc.font(FONTS.italic).fontSize(SIZES.body).fillColor(COLORS.muted);
    doc.text(subtitle);
    doc.moveDown(0.3);
  }

  // Bloco de filtros (caixa cinza)
  if (filters.details && filters.details.length > 0) {
    const x = doc.x;
    const y = doc.y;
    const boxWidth = doc.page.width - PAGE_MARGIN_PT * 2;
    const lineHeight = 14;
    const boxHeight = filters.details.length * lineHeight + 10;

    doc.rect(x, y, boxWidth, boxHeight).fill(COLORS.zebra).fillColor(COLORS.text);
    doc.rect(x, y, boxWidth, boxHeight).stroke(COLORS.rule);

    let cursorY = y + 6;
    doc.font(FONTS.sans).fontSize(SIZES.small).fillColor(COLORS.muted);
    for (const f of filters.details) {
      doc.text(`${f.label}:`, x + 8, cursorY, { width: 140, lineBreak: false });
      doc.fillColor(COLORS.text).font(FONTS.sansBold);
      doc.text(f.value, x + 150, cursorY, { width: boxWidth - 158, lineBreak: false });
      doc.font(FONTS.sans).fillColor(COLORS.muted);
      cursorY += lineHeight;
    }

    doc.fillColor(COLORS.text);
    doc.y = y + boxHeight + 12;
    doc.x = x;
  }
}

// ─── Resumo executivo (cards de KPI) ─────────────────────

export function renderKpiCards(
  ctx: ReportContext,
  kpis: Array<{ label: string; value: string; sublabel?: string; tone?: 'positive' | 'negative' | 'neutral' }>,
) {
  const { doc } = ctx;
  if (kpis.length === 0) return;

  const x0 = PAGE_MARGIN_PT;
  const fullWidth = doc.page.width - PAGE_MARGIN_PT * 2;
  const colCount = Math.min(kpis.length, 4);
  const gap = 8;
  const cardWidth = (fullWidth - gap * (colCount - 1)) / colCount;
  const cardHeight = 64;
  const startY = doc.y;

  kpis.forEach((kpi, i) => {
    const col = i % colCount;
    const row = Math.floor(i / colCount);
    const x = x0 + col * (cardWidth + gap);
    const y = startY + row * (cardHeight + gap);

    doc.rect(x, y, cardWidth, cardHeight).fill(COLORS.zebra);
    doc.rect(x, y, cardWidth, cardHeight).stroke(COLORS.rule);

    doc.font(FONTS.sans).fontSize(SIZES.meta).fillColor(COLORS.muted);
    doc.text(kpi.label.toUpperCase(), x + 8, y + 8, { width: cardWidth - 16, lineBreak: false });

    const valueColor =
      kpi.tone === 'positive' ? COLORS.positive : kpi.tone === 'negative' ? COLORS.negative : COLORS.text;
    doc.font(FONTS.bold).fontSize(SIZES.section).fillColor(valueColor);
    doc.text(kpi.value, x + 8, y + 22, { width: cardWidth - 16, lineBreak: false });

    if (kpi.sublabel) {
      doc.font(FONTS.sans).fontSize(SIZES.meta).fillColor(COLORS.muted);
      doc.text(kpi.sublabel, x + 8, y + 46, { width: cardWidth - 16, lineBreak: false });
    }
  });

  const rows = Math.ceil(kpis.length / colCount);
  doc.y = startY + rows * (cardHeight + gap) + 6;
  doc.x = x0;
  doc.fillColor(COLORS.text);
}

// ─── Título de seção ────────────────────────────────────

export function renderSectionTitle(ctx: ReportContext, title: string, subtitle?: string) {
  const { doc } = ctx;
  doc.moveDown(0.4);
  doc.font(FONTS.bold).fontSize(SIZES.section).fillColor(COLORS.text);
  doc.text(title);
  if (subtitle) {
    doc.font(FONTS.italic).fontSize(SIZES.small).fillColor(COLORS.muted);
    doc.text(subtitle);
  }
  doc.moveDown(0.3);
  doc.fillColor(COLORS.text);
}

// ─── Tabela com cabeçalho + linhas zebradas ─────────────

export interface TableColumn {
  header: string;
  /** Largura em pontos. Se omitido, distribui proporcionalmente. */
  width?: number;
  align?: 'left' | 'right' | 'center';
  /** Função opcional pra estilizar valor (cor) */
  toneFor?: (row: any) => 'positive' | 'negative' | 'neutral' | undefined;
}

/**
 * Trunca texto pra caber numa largura dada usando o text width medido pelo
 * proprio PDFKit (precisao real, considerando fonte/tamanho ativos).
 * Evita o bug onde lineBreak:false ainda quebra numeros longos sem espaco.
 */
function truncateToWidth(doc: any, text: string, maxWidth: number): string {
  if (!text) return '';
  if (doc.widthOfString(text) <= maxWidth) return text;
  const ellipsis = '…';
  const ellipsisW = doc.widthOfString(ellipsis);
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (doc.widthOfString(text.slice(0, mid)) + ellipsisW <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis;
}

export function renderTable(
  ctx: ReportContext,
  columns: TableColumn[],
  rows: Array<Record<string, string | number>>,
  options: { headerFill?: string; rowHeight?: number } = {},
) {
  const { doc } = ctx;
  const x0 = PAGE_MARGIN_PT;
  const fullWidth = doc.page.width - PAGE_MARGIN_PT * 2;
  const rowHeight = options.rowHeight || 20; // 18 → 20 dá mais ar
  const headerFill = options.headerFill || '#3d2914';

  // Calcula larguras — defensivo contra colunas mal dimensionadas.
  // Bug 2026-04-28: dashboard-snapshot tinha 520pt fixos em A4 retrato (util 482pt),
  // fazendo flex receber 0 ou negativo, e doc.text com width=-8 quebrava PDFKit
  // silenciosamente. Salvaguarda: redistribui proporcionalmente se overflow.
  let fixedTotal = columns.reduce((acc, c) => acc + (c.width || 0), 0);
  const flexCount = columns.filter((c) => !c.width).length;
  let widths: number[];

  if (fixedTotal > fullWidth) {
    // Overflow: encolhe TODAS as colunas proporcionalmente pra caber
    const scale = fullWidth / fixedTotal;
    widths = columns.map((c) => (c.width || 50) * scale);
  } else {
    const flexWidth = flexCount > 0 ? Math.max(20, (fullWidth - fixedTotal) / flexCount) : 0;
    widths = columns.map((c) => c.width || flexWidth);
  }
  // Garante minimo absoluto pra prevenir width negativo no doc.text
  widths = widths.map((w) => Math.max(20, w));

  // Header
  let y = doc.y;
  // Quebra de pagina se header nao caber
  if (y + rowHeight > doc.page.height - PAGE_MARGIN_PT - 30) {
    doc.addPage();
    y = doc.y;
  }
  doc.rect(x0, y, fullWidth, rowHeight).fill(headerFill);
  // Header em fonte meta (9pt) em vez de small (10pt) — sobra mais espaco.
  doc.font(FONTS.sansBold).fontSize(SIZES.meta).fillColor('#ffffff');
  let cursorX = x0;
  columns.forEach((col, i) => {
    const innerW = widths[i] - 8;
    const headerText = truncateToWidth(doc, col.header.toUpperCase(), innerW);
    doc.text(headerText, cursorX + 4, y + 6, {
      width: innerW,
      align: col.align || 'left',
      lineBreak: false,
    });
    cursorX += widths[i];
  });
  y += rowHeight;

  // Linhas
  doc.font(FONTS.body).fontSize(SIZES.small).fillColor(COLORS.text);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];

    // Quebra pagina se proxima linha nao cabe
    if (y + rowHeight > doc.page.height - PAGE_MARGIN_PT - 30) {
      doc.addPage();
      y = doc.y;
      // Re-renderiza header na nova pagina
      doc.rect(x0, y, fullWidth, rowHeight).fill(headerFill);
      doc.font(FONTS.sansBold).fontSize(SIZES.meta).fillColor('#ffffff');
      let hx = x0;
      columns.forEach((col, i) => {
        const innerW = widths[i] - 8;
        const headerText = truncateToWidth(doc, col.header.toUpperCase(), innerW);
        doc.text(headerText, hx + 4, y + 6, {
          width: innerW,
          align: col.align || 'left',
          lineBreak: false,
        });
        hx += widths[i];
      });
      y += rowHeight;
      doc.font(FONTS.body).fontSize(SIZES.small).fillColor(COLORS.text);
    }

    // Zebra
    if (r % 2 === 1) {
      doc.rect(x0, y, fullWidth, rowHeight).fill(COLORS.zebra);
    }

    let cx = x0;
    columns.forEach((col, i) => {
      const key = col.header;
      const value = row[key];
      const tone = col.toneFor ? col.toneFor(row) : undefined;
      const color =
        tone === 'positive' ? COLORS.positive : tone === 'negative' ? COLORS.negative : COLORS.text;

      doc.fillColor(color).font(FONTS.body).fontSize(SIZES.small);
      const innerW = widths[i] - 8;
      // Trunca manualmente — lineBreak:false + ellipsis:true do PDFKit ainda
      // quebra numeros longos sem espaco (ex: "071310067202380200").
      const display = truncateToWidth(doc, String(value ?? ''), innerW);
      doc.text(display, cx + 4, y + 5, {
        width: innerW,
        align: col.align || 'left',
        lineBreak: false,
      });
      cx += widths[i];
    });
    y += rowHeight;
  }

  doc.fillColor(COLORS.text);
  doc.y = y + 6;
  doc.x = x0;
}

// ─── Última página: observações + disclaimer ────────────

export function renderObservationsAndClosing(ctx: ReportContext) {
  const { doc, observations } = ctx;
  if (observations) {
    doc.addPage();
    renderSectionTitle(ctx, 'Observações');
    doc.font(FONTS.body).fontSize(SIZES.body).fillColor(COLORS.text);
    doc.text(observations, { align: 'left', lineGap: 2 });
    doc.moveDown(2);
  } else {
    doc.moveDown(2);
  }

  doc.font(FONTS.italic).fontSize(SIZES.meta).fillColor(COLORS.faint);
  doc.text(
    'Documento gerado automaticamente pelo sistema · não substitui obrigações legais.',
    { align: 'center' },
  );
  doc.fillColor(COLORS.text);
}

// ─── Helpers de formatação ──────────────────────────────

export const fmtBRL = (v: number | string | null | undefined): string => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (n == null || isNaN(Number(n))) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  }).format(Number(n));
};

export const fmtDate = (d: Date | string | null | undefined): string => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
};

export const fmtDateTime = (d: Date): string => {
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
};

export const formatDateTime = fmtDateTime;

/**
 * Auto-instala o cabeçalho running em cada nova página (incluindo a primeira).
 * Chamar logo após createReportContext.
 */
export function installRunningHeader(ctx: ReportContext) {
  // Pdfkit emite 'pageAdded' a cada página adicionada, exceto a primeira.
  // Pra primeira, renderizamos manualmente já no início.
  renderRunningHeader(ctx);
  ctx.doc.on('pageAdded', () => {
    renderRunningHeader(ctx);
  });
}
